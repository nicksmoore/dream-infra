import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ───── Types ─────
interface ExecuteRequest {
  intent: "terraform" | "kubernetes" | "ansible" | "compute";
  action: "deploy" | "update" | "destroy" | "plan" | "apply" | "status" | "discover";
  spec: Record<string, unknown>;
  metadata?: { user?: string; project?: string };
}

interface EngineResponse {
  status: "success" | "error" | "pending";
  intent: string;
  action: string;
  message?: string;
  error?: string;
  details?: unknown;
  timestamp: string;
}

// ───── Provider Clients ─────

async function resolveWorkspaceId(
  tfeBase: string,
  headers: Record<string, string>,
  workspaceIdOrName: string,
  organization?: string,
): Promise<{ id: string; error?: string }> {
  // If it already looks like a workspace ID (ws-...), use it directly
  if (workspaceIdOrName.startsWith("ws-")) {
    return { id: workspaceIdOrName };
  }

  // Otherwise treat it as a name and look it up via the org
  if (!organization) {
    return { id: "", error: "organization is required when workspace_id is a name (not ws-xxx). Add 'organization' to spec." };
  }

  const res = await fetch(
    `${tfeBase}/api/v2/organizations/${encodeURIComponent(organization)}/workspaces/${encodeURIComponent(workspaceIdOrName)}`,
    { headers },
  );

  if (!res.ok) {
    const body = await res.text();
    return { id: "", error: `Workspace lookup failed (${res.status}): ${body}` };
  }

  const data = await res.json();
  const id = data.data?.id as string;
  if (!id) {
    return { id: "", error: "Workspace found but missing id in response." };
  }
  return { id };
}

async function handleTerraform(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const TFE_TOKEN = Deno.env.get("TFE_TOKEN");
  if (!TFE_TOKEN) {
    return err("terraform", action, "TFE_TOKEN not configured. Add your HCP Terraform API token.");
  }

  const TFE_BASE = spec.tfe_base_url as string || "https://app.terraform.io";
  const rawWorkspaceId = spec.workspace_id as string;
  const organization = spec.organization as string | undefined;

  const headers = {
    "Authorization": `Bearer ${TFE_TOKEN}`,
    "Content-Type": "application/vnd.api+json",
  };

  switch (action) {
    case "plan":
    case "deploy":
    case "apply": {
      const hcl = spec.hcl as string | undefined;

      if (!rawWorkspaceId) {
        return err("terraform", action, "workspace_id is required in spec.");
      }

      // Resolve workspace name → ID if needed
      const ws = await resolveWorkspaceId(TFE_BASE, headers, rawWorkspaceId, organization);
      if (ws.error) return err("terraform", action, ws.error);
      const workspaceId = ws.id;

      // Ensure workspace is in remote execution mode
      const patchRes = await fetch(`${TFE_BASE}/api/v2/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          data: {
            type: "workspaces",
            id: workspaceId,
            attributes: { "execution-mode": "remote" },
          },
        }),
      });
      console.log("PATCH execution-mode response:", patchRes.status, await patchRes.clone().text().then(t => t.slice(0, 300)));

      // Verify workspace is accessible
      const verifyRes = await fetch(`${TFE_BASE}/api/v2/workspaces/${workspaceId}`, { headers });
      const verifyData = await verifyRes.json();
      console.log("Workspace verify:", verifyRes.status, "execution-mode:", verifyData.data?.attributes?.["execution-mode"], "permissions:", JSON.stringify(verifyData.data?.attributes?.permissions || {}).slice(0, 200));

      // Create a run (plan-only for "plan", auto-apply for "apply"/"deploy")
      const isAutoApply = action !== "plan";

      const runPayload = {
        data: {
          attributes: {
            "is-destroy": false,
            "auto-apply": isAutoApply,
            message: `UIDI ${action} via Core Engine`,
            ...(hcl ? { "plan-only": action === "plan" } : {}),
          },
          type: "runs",
          relationships: {
            workspace: {
              data: { type: "workspaces", id: workspaceId },
            },
          },
        },
      };

      // If HCL provided, we need to create a configuration version first
      if (hcl) {
        // Step 1: Create config version
        const cvUrl = `${TFE_BASE}/api/v2/workspaces/${workspaceId}/configuration-versions`;
        console.log("Creating config version at:", cvUrl, "workspaceId:", workspaceId);
        const cvRes = await fetch(cvUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            data: {
              type: "configuration-versions",
              attributes: { "auto-queue-runs": false },
            },
          }),
        });

        if (!cvRes.ok) {
          const cvErr = await cvRes.text();
          console.error("Config version error:", cvRes.status, cvErr);
          return err("terraform", action, `Failed to create config version (workspace: ${workspaceId}): ${cvErr}`);
        }

        const cvData = await cvRes.json();
        const uploadUrl = cvData.data?.attributes?.["upload-url"];
        const cvId = cvData.data?.id;

        if (uploadUrl) {
          // Step 2: Upload HCL as a tar.gz
          // For simplicity, we'll create a minimal tar with main.tf
          const tarball = await createTarGz(hcl);
          const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: tarball,
          });

          if (!uploadRes.ok) {
            return err("terraform", action, `Failed to upload configuration: ${await uploadRes.text()}`);
          }
        }

        // Add config version to run
        if (cvId) {
          runPayload.data.relationships["configuration-version" as string] = {
            data: { type: "configuration-versions", id: cvId },
          };
        }
      }

      // Step 3: Create the run
      const runRes = await fetch(`${TFE_BASE}/api/v2/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify(runPayload),
      });

      if (!runRes.ok) {
        const runErr = await runRes.text();
        return err("terraform", action, `Failed to create run: ${runErr}`);
      }

      const runData = await runRes.json();
      const runId = runData.data?.id;
      const runStatus = runData.data?.attributes?.status;

      // Poll for completion (up to 60s)
      const finalStatus = await pollRunStatus(TFE_BASE, headers, runId, 60);

      return ok("terraform", action, `Run ${runId} completed with status: ${finalStatus.status}`, {
        run_id: runId,
        status: finalStatus.status,
        plan_summary: finalStatus.plan,
        workspace_id: workspaceId,
      });
    }

    case "destroy": {
      if (!rawWorkspaceId) {
        return err("terraform", action, "workspace_id is required for destroy.");
      }
      const wsD = await resolveWorkspaceId(TFE_BASE, headers, rawWorkspaceId, organization);
      if (wsD.error) return err("terraform", action, wsD.error);
      const workspaceId = wsD.id;

      const destroyRes = await fetch(`${TFE_BASE}/api/v2/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          data: {
            attributes: {
              "is-destroy": true,
              "auto-apply": true,
              message: "UIDI destroy via Core Engine",
            },
            type: "runs",
            relationships: {
              workspace: {
                data: { type: "workspaces", id: workspaceId },
              },
            },
          },
        }),
      });

      if (!destroyRes.ok) {
        return err("terraform", action, `Destroy failed: ${await destroyRes.text()}`);
      }

      const destroyData = await destroyRes.json();
      const destroyRunId = destroyData.data?.id;
      const finalStatus = await pollRunStatus(TFE_BASE, headers, destroyRunId, 60);

      return ok("terraform", action, `Destroy run ${destroyRunId}: ${finalStatus.status}`, {
        run_id: destroyRunId,
        status: finalStatus.status,
      });
    }

    case "status": {
      const runId = spec.run_id as string;
      if (!runId) return err("terraform", action, "run_id required for status check.");

      const statusRes = await fetch(`${TFE_BASE}/api/v2/runs/${runId}`, { headers });
      if (!statusRes.ok) return err("terraform", action, `Status check failed: ${await statusRes.text()}`);
      
      const statusData = await statusRes.json();
      return ok("terraform", action, `Run ${runId}: ${statusData.data?.attributes?.status}`, {
        run_id: runId,
        status: statusData.data?.attributes?.status,
        attributes: statusData.data?.attributes,
      });
    }

    default:
      return err("terraform", action, `Unknown terraform action: ${action}`);
  }
}

async function handleKubernetes(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  // K8s management via EKS API + raw K8s API calls
  // Requires: cluster_name, region, and manifest (for deploy/update)
  const clusterName = spec.cluster_name as string;
  const region = spec.region as string || "us-east-1";
  const manifest = spec.manifest as Record<string, unknown> | undefined;
  const namespace = spec.namespace as string || "default";

  if (!clusterName) {
    return err("kubernetes", action, "cluster_name is required in spec.");
  }

  // We need AWS credentials from the environment to call EKS
  const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
  const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return err("kubernetes", action, 
      "AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) not configured. These are needed to authenticate with EKS.");
  }

  // Step 1: Describe the EKS cluster to get endpoint + CA
  const eksDescribe = await awsSignedRequest({
    service: "eks",
    region,
    method: "GET",
    path: `/clusters/${clusterName}`,
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  });

  if (!eksDescribe.ok) {
    return err("kubernetes", action, `Failed to describe EKS cluster: ${await eksDescribe.text()}`);
  }

  const clusterData = await eksDescribe.json();
  const endpoint = clusterData.cluster?.endpoint;
  const caData = clusterData.cluster?.certificateAuthority?.data;

  if (!endpoint) {
    return err("kubernetes", action, "Could not retrieve cluster endpoint from EKS.");
  }

  // Step 2: Get a bearer token for K8s API via STS
  const k8sToken = await getEksToken(clusterName, region, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);

  switch (action) {
    case "deploy":
    case "apply":
    case "update": {
      if (!manifest) {
        return err("kubernetes", action, "manifest is required for deploy/apply/update.");
      }

      const kind = (manifest.kind as string || "").toLowerCase();
      const name = (manifest.metadata as Record<string, unknown>)?.name as string;
      const apiVersion = manifest.apiVersion as string || "v1";

      // Determine the correct API path
      const apiPath = getK8sApiPath(apiVersion, kind, namespace, name);

      // Try PATCH (update), fall back to POST (create)
      let res = await fetch(`${endpoint}${apiPath}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${k8sToken}`,
          "Content-Type": "application/strategic-merge-patch+json",
        },
        body: JSON.stringify(manifest),
      });

      if (res.status === 404) {
        // Resource doesn't exist, create it
        const createPath = getK8sApiPath(apiVersion, kind, namespace);
        res = await fetch(`${endpoint}${createPath}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${k8sToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(manifest),
        });
      }

      if (!res.ok) {
        return err("kubernetes", action, `K8s ${action} failed: ${await res.text()}`);
      }

      const result = await res.json();
      return ok("kubernetes", action, `${kind}/${name} ${action === "deploy" ? "deployed" : "updated"} in ${namespace}`, {
        kind, name, namespace,
        uid: result.metadata?.uid,
        resourceVersion: result.metadata?.resourceVersion,
      });
    }

    case "destroy": {
      const kind = spec.kind as string;
      const name = spec.name as string;
      const apiVersion = spec.apiVersion as string || "v1";

      if (!kind || !name) {
        return err("kubernetes", action, "kind and name are required for destroy.");
      }

      const apiPath = getK8sApiPath(apiVersion, kind.toLowerCase(), namespace, name);
      const res = await fetch(`${endpoint}${apiPath}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${k8sToken}` },
      });

      if (!res.ok && res.status !== 404) {
        return err("kubernetes", action, `K8s delete failed: ${await res.text()}`);
      }

      return ok("kubernetes", action, `${kind}/${name} deleted from ${namespace}`, { kind, name, namespace });
    }

    case "status": {
      const kind = spec.kind as string;
      const name = spec.name as string;
      const apiVersion = spec.apiVersion as string || "v1";

      if (!kind || !name) {
        return err("kubernetes", action, "kind and name are required for status.");
      }

      const apiPath = getK8sApiPath(apiVersion, kind.toLowerCase(), namespace, name);
      const res = await fetch(`${endpoint}${apiPath}`, {
        headers: { Authorization: `Bearer ${k8sToken}` },
      });

      if (!res.ok) {
        return err("kubernetes", action, `Status check failed: ${await res.text()}`);
      }

      const result = await res.json();
      return ok("kubernetes", action, `${kind}/${name} status retrieved`, {
        kind, name, namespace,
        status: result.status,
        metadata: result.metadata,
      });
    }

    default:
      return err("kubernetes", action, `Unknown kubernetes action: ${action}`);
  }
}

async function handleAnsible(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  // Ansible/Config management via SSH
  const host = spec.host as string;
  const port = spec.port as number || 22;
  const username = spec.username as string || "ec2-user";
  const playbook = spec.playbook as string;
  const commands = spec.commands as string[];

  if (!host) {
    return err("ansible", action, "host is required in spec.");
  }

  // For edge functions, we can't use node-ssh directly.
  // Instead, we'll use Systems Manager (SSM) Run Command for AWS instances
  // or fall back to a webhook-based execution pattern.

  const instanceId = spec.instance_id as string;
  const region = spec.region as string || "us-east-1";

  const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
  const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");

  if (instanceId && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
    // Use SSM Run Command
    return await handleAnsibleViaSSM(action, {
      instanceId, region, commands: commands || (playbook ? [`ansible-playbook ${playbook}`] : []),
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    });
  }

  // Fallback: return instructions for manual SSH execution
  return ok("ansible", action, 
    "Ansible execution requires either an EC2 instance_id (for SSM) or a dedicated runner. " +
    "Add instance_id and AWS credentials to use SSM Run Command.", {
    host, port, username,
    playbook, commands,
    hint: "Provide instance_id in spec to use AWS Systems Manager for remote execution.",
  });
}

async function handleAnsibleViaSSM(
  action: string,
  opts: { instanceId: string; region: string; commands: string[]; accessKeyId: string; secretAccessKey: string }
): Promise<EngineResponse> {
  if (!opts.commands.length) {
    return err("ansible", action, "No commands or playbook provided.");
  }

  // SSM SendCommand via AWS API
  const ssmPayload = {
    DocumentName: "AWS-RunShellScript",
    InstanceIds: [opts.instanceId],
    Parameters: {
      commands: opts.commands,
    },
    Comment: `UIDI ${action} via Core Engine`,
  };

  const res = await awsSignedRequest({
    service: "ssm",
    region: opts.region,
    method: "POST",
    path: "/",
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    body: JSON.stringify(ssmPayload),
    extraHeaders: {
      "X-Amz-Target": "AmazonSSM.SendCommand",
      "Content-Type": "application/x-amz-json-1.1",
    },
  });

  if (!res.ok) {
    return err("ansible", action, `SSM SendCommand failed: ${await res.text()}`);
  }

  const data = await res.json();
  const commandId = data.Command?.CommandId;

  return ok("ansible", action, `SSM command ${commandId} sent to ${opts.instanceId}`, {
    command_id: commandId,
    instance_id: opts.instanceId,
    status: data.Command?.Status,
  });
}

// ───── AWS Signature V4 (minimal) ─────

async function awsSignedRequest(opts: {
  service: string;
  region: string;
  method: string;
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  body?: string;
  extraHeaders?: Record<string, string>;
}): Promise<Response> {
  const host = `${opts.service}.${opts.region}.amazonaws.com`;
  const url = `https://${host}${opts.path}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    Host: host,
    "X-Amz-Date": amzDate,
    ...(opts.extraHeaders || {}),
  };

  const bodyHash = await sha256Hex(opts.body || "");

  // Canonical request
  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]}`).join("\n") + "\n";
  const signedHeadersStr = signedHeaderKeys.join(";");

  const canonicalRequest = [
    opts.method,
    opts.path,
    "", // query string
    canonicalHeaders,
    signedHeadersStr,
    bodyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  // Signing key
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${opts.secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, opts.region);
  const kService = await hmacSha256(kRegion, opts.service);
  const kSigning = await hmacSha256(kService, "aws4_request");

  const signature = await hmacSha256Hex(kSigning, stringToSign);

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return fetch(url, {
    method: opts.method,
    headers,
    body: opts.body || undefined,
  });
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

async function hmacSha256Hex(key: Uint8Array | ArrayBuffer, data: string): Promise<string> {
  const sig = await hmacSha256(key, data);
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ───── HCP Terraform Helpers ─────

async function pollRunStatus(
  base: string,
  headers: Record<string, string>,
  runId: string,
  timeoutSecs: number
): Promise<{ status: string; plan?: unknown }> {
  const start = Date.now();
  const terminalStatuses = new Set([
    "planned", "applied", "errored", "discarded", "canceled",
    "planned_and_finished", "policy_checked", "policy_soft_failed",
  ]);

  while (Date.now() - start < timeoutSecs * 1000) {
    const res = await fetch(`${base}/api/v2/runs/${runId}`, { headers });
    if (!res.ok) break;

    const data = await res.json();
    const status = data.data?.attributes?.status;

    if (terminalStatuses.has(status)) {
      return { status, plan: data.data?.attributes };
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  return { status: "timeout" };
}

async function createTarGz(hcl: string): Promise<Uint8Array> {
  // Create a minimal tar archive containing main.tf
  // Tar format: 512-byte header + file content padded to 512-byte blocks
  const fileName = "main.tf";
  const content = new TextEncoder().encode(hcl);
  const fileSize = content.length;

  // Create tar header (512 bytes)
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();

  // File name (0-99)
  header.set(encoder.encode(fileName), 0);
  // File mode (100-107)
  header.set(encoder.encode("0000644\0"), 100);
  // Owner ID (108-115)
  header.set(encoder.encode("0001000\0"), 108);
  // Group ID (116-123)
  header.set(encoder.encode("0001000\0"), 116);
  // File size in octal (124-135)
  header.set(encoder.encode(fileSize.toString(8).padStart(11, "0") + "\0"), 124);
  // Mod time (136-147)
  const mtime = Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0";
  header.set(encoder.encode(mtime), 136);
  // Checksum placeholder (148-155) - spaces
  header.set(encoder.encode("        "), 148);
  // Type flag (156) - '0' for regular file
  header[156] = 0x30;
  // USTAR indicator (257-262)
  header.set(encoder.encode("ustar\0"), 257);
  // USTAR version (263-264)
  header.set(encoder.encode("00"), 263);

  // Calculate checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.set(encoder.encode(checksum.toString(8).padStart(6, "0") + "\0 "), 148);

  // Pad content to 512-byte boundary
  const paddedSize = Math.ceil(fileSize / 512) * 512;
  const paddedContent = new Uint8Array(paddedSize);
  paddedContent.set(content);

  // End-of-archive marker (two 512-byte blocks of zeros)
  const endMarker = new Uint8Array(1024);

  // Combine into tar
  const tar = new Uint8Array(512 + paddedSize + 1024);
  tar.set(header, 0);
  tar.set(paddedContent, 512);
  tar.set(endMarker, 512 + paddedSize);

  // Compress with gzip using CompressionStream
  const stream = new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).arrayBuffer();
  return new Uint8Array(compressed);
}

// ───── K8s Helpers ─────

function getK8sApiPath(apiVersion: string, kind: string, namespace: string, name?: string): string {
  const isCore = !apiVersion.includes("/");
  const base = isCore ? "/api/v1" : `/apis/${apiVersion}`;

  const pluralKind = kind.endsWith("s") ? kind : `${kind}s`;

  const namespacedPath = `${base}/namespaces/${namespace}/${pluralKind}`;
  return name ? `${namespacedPath}/${name}` : namespacedPath;
}

async function getEksToken(
  clusterName: string,
  region: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<string> {
  // Generate a presigned STS GetCallerIdentity URL, then base64url-encode it as the token
  // This is the standard EKS authentication mechanism
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = `sts.${region}.amazonaws.com`;
  const credentialScope = `${dateStamp}/${region}/sts/aws4_request`;

  const queryParams = new URLSearchParams({
    Action: "GetCallerIdentity",
    Version: "2011-06-15",
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": "60",
    "X-Amz-SignedHeaders": "host;x-k8s-aws-id",
  });

  const canonicalHeaders = `host:${host}\nx-k8s-aws-id:${clusterName}\n`;
  const canonicalRequest = [
    "GET", "/", queryParams.toString(),
    canonicalHeaders, "host;x-k8s-aws-id",
    await sha256Hex(""),
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "sts");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  queryParams.set("X-Amz-Signature", signature);

  const presignedUrl = `https://${host}/?${queryParams.toString()}`;
  // EKS token format: "k8s-aws-v1." + base64url(presigned URL)
  const b64 = btoa(presignedUrl).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `k8s-aws-v1.${b64}`;
}

// ───── Compute (SDK-first, idempotent) ─────

const AMI_MAP: Record<string, Record<string, string>> = {
  "us-east-1": { "amazon-linux-2023": "ami-0c02fb55956c7d316", ubuntu: "ami-0c7217cdde317cfec", debian: "ami-0b6d6dac03916517a", rhel: "ami-0583d8c7a9c35822c" },
  "us-east-2": { "amazon-linux-2023": "ami-0ea3c35c5c3284d82", ubuntu: "ami-0b8b44ec9a8f90422" },
  "us-west-1": { "amazon-linux-2023": "ami-0f8e81a3da6e2510a", ubuntu: "ami-0ce2cb35386fc22e9" },
  "us-west-2": { "amazon-linux-2023": "ami-017fecd1353bcc96e", ubuntu: "ami-03f65b8614a860c29" },
  "eu-west-1": { "amazon-linux-2023": "ami-0905a3c97561e0b69", ubuntu: "ami-0694d931cee176e7d" },
  "eu-central-1": { "amazon-linux-2023": "ami-0faab6bdbac9486fb", ubuntu: "ami-0faab6bdbac9486fb" },
  "ap-southeast-1": { "amazon-linux-2023": "ami-0b825ad86f2aec8cc", ubuntu: "ami-078c1149d8ad719a7" },
  "ap-northeast-1": { "amazon-linux-2023": "ami-0d52744d6551d851e", ubuntu: "ami-07c589821f2b353aa" },
};

async function handleCompute(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return err("compute", action, "AWS credentials required. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or pass in spec.");
  }

  const region = spec.region as string || "us-east-1";

  switch (action) {
    case "deploy":
    case "apply": {
      const instanceType = spec.instance_type as string || "t3.micro";
      const os = spec.os as string || "amazon-linux-2023";
      const count = spec.count as number || 1;
      const name = spec.name as string || `uidi-${Date.now()}`;
      const environment = spec.environment as string || "dev";

      const ami = AMI_MAP[region]?.[os];
      if (!ami) return err("compute", action, `No AMI for ${os} in ${region}. Try us-east-1.`);

      // Idempotency via ClientToken — re-sending the same token returns the same instances
      const clientToken = spec.client_token as string || `uidi-${name}-${environment}-${instanceType}-${region}`;

      const params = new URLSearchParams({
        Action: "RunInstances",
        Version: "2016-11-15",
        ImageId: ami,
        InstanceType: instanceType,
        MinCount: String(count),
        MaxCount: String(count),
        ClientToken: clientToken,
        "TagSpecification.1.ResourceType": "instance",
        "TagSpecification.1.Tag.1.Key": "Name",
        "TagSpecification.1.Tag.1.Value": name,
        "TagSpecification.1.Tag.2.Key": "ManagedBy",
        "TagSpecification.1.Tag.2.Value": "UIDI",
        "TagSpecification.1.Tag.3.Key": "Environment",
        "TagSpecification.1.Tag.3.Value": environment,
        "TagSpecification.1.Tag.4.Key": "ClientToken",
        "TagSpecification.1.Tag.4.Value": clientToken,
      });

      // Optional: subnet, security groups, key pair, user data
      if (spec.subnet_id) params.set("SubnetId", spec.subnet_id as string);
      if (spec.key_name) params.set("KeyName", spec.key_name as string);
      if (spec.user_data) params.set("UserData", btoa(spec.user_data as string));
      const sgIds = spec.security_group_ids as string[] | undefined;
      if (sgIds?.length) sgIds.forEach((sg, i) => params.set(`SecurityGroupId.${i + 1}`, sg));
      if (spec.iam_instance_profile) {
        const profile = spec.iam_instance_profile as string;
        if (profile.startsWith("arn:")) params.set("IamInstanceProfile.Arn", profile);
        else params.set("IamInstanceProfile.Name", profile);
      }

      // EBS root volume
      if (spec.root_volume_size) {
        params.set("BlockDeviceMapping.1.DeviceName", os.startsWith("windows") ? "/dev/sda1" : "/dev/xvda");
        params.set("BlockDeviceMapping.1.Ebs.VolumeSize", String(spec.root_volume_size));
        params.set("BlockDeviceMapping.1.Ebs.VolumeType", spec.root_volume_type as string || "gp3");
        params.set("BlockDeviceMapping.1.Ebs.DeleteOnTermination", "true");
      }

      console.log(`Compute deploy: ${instanceType} x${count} in ${region}, token=${clientToken}`);

      const res = await ec2Request("POST", region, params.toString(), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);
      const body = await res.text();

      if (!res.ok) {
        // IdempotentParameterMismatch means same token, different params
        if (body.includes("IdempotentParameterMismatch")) {
          return err("compute", action, "Idempotent conflict: a deployment with this token exists but with different parameters. Use a new client_token or change the name.");
        }
        const errorMatch = body.match(/<Message>(.*?)<\/Message>/);
        return err("compute", action, errorMatch?.[1] || `EC2 API error (${res.status})`);
      }

      const instanceIds = [...body.matchAll(/<instanceId>(i-[a-f0-9]+)<\/instanceId>/g)].map(m => m[1]);

      return ok("compute", action, `Launched ${instanceIds.length} instance(s) with idempotency token`, {
        instance_ids: instanceIds,
        client_token: clientToken,
        instance_type: instanceType,
        region,
        ami,
        idempotent: true,
      });
    }

    case "discover":
    case "status": {
      // Query real AWS state — no tfstate needed
      const filters: string[][] = [];
      if (spec.name) filters.push(["tag:Name", spec.name as string]);
      if (spec.environment) filters.push(["tag:Environment", spec.environment as string]);
      if (spec.client_token) filters.push(["client-token", spec.client_token as string]);
      filters.push(["tag:ManagedBy", "UIDI"]);
      // Exclude terminated
      filters.push(["instance-state-name", "pending", "running", "stopping", "stopped"]);

      const params = new URLSearchParams({ Action: "DescribeInstances", Version: "2016-11-15" });
      filters.forEach((f, i) => {
        params.set(`Filter.${i + 1}.Name`, f[0]);
        f.slice(1).forEach((v, vi) => params.set(`Filter.${i + 1}.Value.${vi + 1}`, v));
      });

      const res = await ec2Request("POST", region, params.toString(), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);
      const body = await res.text();

      if (!res.ok) {
        const errorMatch = body.match(/<Message>(.*?)<\/Message>/);
        return err("compute", action, errorMatch?.[1] || `DescribeInstances failed (${res.status})`);
      }

      // Parse instances from XML
      const instances = [...body.matchAll(/<instanceId>(i-[a-f0-9]+)<\/instanceId>/g)].map(m => m[1]);
      const states = [...body.matchAll(/<name>(pending|running|stopping|stopped|shutting-down|terminated)<\/name>/g)].map(m => m[1]);
      const types = [...body.matchAll(/<instanceType>([^<]+)<\/instanceType>/g)].map(m => m[1]);
      const publicIps = [...body.matchAll(/<ipAddress>([^<]+)<\/ipAddress>/g)].map(m => m[1]);
      const privateIps = [...body.matchAll(/<privateIpAddress>([^<]+)<\/privateIpAddress>/g)].map(m => m[1]);
      const launchTimes = [...body.matchAll(/<launchTime>([^<]+)<\/launchTime>/g)].map(m => m[1]);

      const discovered = instances.map((id, i) => ({
        instance_id: id,
        state: states[i] || "unknown",
        instance_type: types[i] || "unknown",
        public_ip: publicIps[i] || null,
        private_ip: privateIps[i] || null,
        launch_time: launchTimes[i] || null,
      }));

      return ok("compute", action, `Discovered ${discovered.length} UIDI-managed instance(s)`, {
        instances: discovered,
        region,
        source: "aws-api-realtime",
      });
    }

    case "destroy": {
      const instanceIds = spec.instance_ids as string[] || (spec.instance_id ? [spec.instance_id as string] : []);
      if (!instanceIds.length) return err("compute", action, "instance_ids or instance_id required for destroy.");

      const params = new URLSearchParams({ Action: "TerminateInstances", Version: "2016-11-15" });
      instanceIds.forEach((id, i) => params.set(`InstanceId.${i + 1}`, id));

      const res = await ec2Request("POST", region, params.toString(), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);
      const body = await res.text();

      if (!res.ok) {
        const errorMatch = body.match(/<Message>(.*?)<\/Message>/);
        return err("compute", action, errorMatch?.[1] || `TerminateInstances failed (${res.status})`);
      }

      return ok("compute", action, `Terminated ${instanceIds.length} instance(s)`, { instance_ids: instanceIds, region });
    }

    default:
      return err("compute", action, `Unknown compute action: ${action}. Supported: deploy, discover, status, destroy.`);
  }
}

async function ec2Request(method: string, region: string, body: string, accessKey: string, secretKey: string): Promise<Response> {
  const service = "ec2";
  const host = `${service}.${region}.amazonaws.com`;
  const url = `https://${host}/`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Host: host,
    "X-Amz-Date": amzDate,
  };

  const bodyHash = await sha256Hex(body);
  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]}`).join("\n") + "\n";
  const signedHeadersStr = signedHeaderKeys.join(";");

  const canonicalRequest = [method, "/", "", canonicalHeaders, signedHeadersStr, bodyHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return fetch(url, { method, headers, body });
}

// ───── Helpers ─────

function ok(intent: string, action: string, message: string, details?: unknown): EngineResponse {
  return { status: "success", intent, action, message, details, timestamp: new Date().toISOString() };
}

function err(intent: string, action: string, error: string): EngineResponse {
  return { status: "error", intent, action, error, timestamp: new Date().toISOString() };
}

// ───── Main Handler ─────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: ExecuteRequest = await req.json();
    const { intent, action, spec, metadata } = body;

    if (!intent || !action || !spec) {
      return new Response(
        JSON.stringify(err("unknown", "unknown", "intent, action, and spec are required.")),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`UIDI Engine: ${intent}/${action}`, metadata ? JSON.stringify(metadata) : "", JSON.stringify(spec).slice(0, 300));

    let result: EngineResponse;

    switch (intent) {
      case "terraform":
        result = await handleTerraform(action, spec);
        break;
      case "kubernetes":
        result = await handleKubernetes(action, spec);
        break;
      case "ansible":
        result = await handleAnsible(action, spec);
        break;
      case "compute":
        result = await handleCompute(action, spec);
        break;
      default:
        result = err(intent, action, `Unknown intent: ${intent}. Supported: terraform, kubernetes, ansible, compute.`);
    }

    return new Response(JSON.stringify(result), {
      status: result.status === "error" ? 400 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("UIDI Engine error:", e);
    return new Response(
      JSON.stringify(err("unknown", "unknown", e instanceof Error ? e.message : "Internal engine error")),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
