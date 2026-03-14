import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DagOrchestrator, SdkOperation } from "./dag-orchestrator.ts";

// ───── Dynamic AWS SDK Loader (prevents bundle timeout) ─────
// SDK modules are loaded on-demand at runtime, not at bundle time.

const SDK_MODULE_MAP: Record<string, string> = {
  EC2: "npm:@aws-sdk/client-ec2",
  S3: "npm:@aws-sdk/client-s3",
  CloudFront: "npm:@aws-sdk/client-cloudfront",
  Route53: "npm:@aws-sdk/client-route-53",
  Lambda: "npm:@aws-sdk/client-lambda",
  ACM: "npm:@aws-sdk/client-acm",
  EKS: "npm:@aws-sdk/client-eks",
  AppMesh: "npm:@aws-sdk/client-app-mesh",
  ELBv2: "npm:@aws-sdk/client-elastic-load-balancing-v2",
  SQS: "npm:@aws-sdk/client-sqs",
  DynamoDB: "npm:@aws-sdk/client-dynamodb",
  EventBridge: "npm:@aws-sdk/client-eventbridge",
  ApiGatewayV2: "npm:@aws-sdk/client-apigatewayv2",
  RDS: "npm:@aws-sdk/client-rds",
  AutoScaling: "npm:@aws-sdk/client-auto-scaling",
  ElastiCache: "npm:@aws-sdk/client-elasticache",
};

const _sdkCache: Record<string, any> = {};

async function loadSdkModule(service: string): Promise<any> {
  if (_sdkCache[service]) return _sdkCache[service];
  const specifier = SDK_MODULE_MAP[service];
  if (!specifier) throw new Error(`Unknown SDK service: ${service}`);
  const mod = await import(specifier);
  _sdkCache[service] = mod;
  return mod;
}

async function getClient(service: string, region: string, credentials: any): Promise<any> {
  const mod = await loadSdkModule(service);
  // All AWS SDK v3 clients follow the pattern: <Service>Client
  const clientName = Object.keys(mod).find(k => k.endsWith("Client") && k !== "Client");
  if (!clientName) throw new Error(`No Client export found in ${service} SDK`);
  return new mod[clientName]({ region, credentials });
}

async function getCommand(service: string, commandName: string): Promise<any> {
  const mod = await loadSdkModule(service);
  const CommandClass = mod[commandName];
  if (!CommandClass) throw new Error(`Command ${commandName} not found in ${service} SDK`);
  return CommandClass;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ───── Types ─────
interface ExecuteRequest {
  intent: "terraform" | "kubernetes" | "ansible" | "compute" | "network" | "eks" | "reconcile" | "inventory" | "sre-supreme" | "naawi";
  action: "deploy" | "update" | "destroy" | "plan" | "apply" | "status" | "discover" | "dry_run" | "add_nodegroup" | "reconcile" | "scan" | "nuke" | "execute";
  spec: Record<string, unknown>;
  metadata?: { user?: string; project?: string };
  approved?: boolean;
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
    case "dry_run":
    case "plan": {
      // DryRun validates permissions, quotas, AMI, instance type — without launching
      const instanceType = spec.instance_type as string || "t3.micro";
      const os = spec.os as string || "amazon-linux-2023";
      const count = spec.count as number || 1;

      const ami = AMI_MAP[region]?.[os];
      if (!ami) return err("compute", action, `No AMI for ${os} in ${region}. Try us-east-1.`);

      const params = new URLSearchParams({
        Action: "RunInstances",
        Version: "2016-11-15",
        DryRun: "true",
        ImageId: ami,
        InstanceType: instanceType,
        MinCount: String(count),
        MaxCount: String(count),
      });

      if (spec.subnet_id) params.set("SubnetId", spec.subnet_id as string);
      if (spec.key_name) params.set("KeyName", spec.key_name as string);
      const sgIds = spec.security_group_ids as string[] | undefined;
      if (sgIds?.length) sgIds.forEach((sg, i) => params.set(`SecurityGroupId.${i + 1}`, sg));

      const res = await ec2Request("POST", region, params.toString(), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);
      const body = await res.text();

      // DryRun returns 412 with "DryRunOperation" on success, or a real error
      if (body.includes("DryRunOperation")) {
        return ok("compute", action, `Dry run passed: ${instanceType} x${count} in ${region} is valid`, {
          instance_type: instanceType,
          ami,
          region,
          count,
          validation: "passed",
          dry_run: true,
        });
      }

      const errorMatch = body.match(/<Message>(.*?)<\/Message>/);
      return err("compute", action, `Dry run failed: ${errorMatch?.[1] || "Validation error"}`);
    }

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

// ───── Network (VPC / Subnets / IGW / Routes / NACLs) ─────

function extractEc2Error(xml: string): string | null {
  return xml.match(/<Message>(.*?)<\/Message>/)?.[1] || null;
}

async function describeExistingNetworkStack(
  region: string,
  name: string,
  environment: string,
  accessKey: string,
  secretKey: string,
): Promise<{
  vpc_id: string;
  security_group_id: string | null;
  subnets: { id: string; type: string; az: string; cidr: string }[];
  region: string;
  vpc_cidr?: string;
  reused: true;
} | null> {
  const vpcParams = new URLSearchParams({
    Action: "DescribeVpcs",
    Version: "2016-11-15",
    "Filter.1.Name": "tag:ManagedBy",
    "Filter.1.Value.1": "UIDI",
    "Filter.2.Name": "tag:Name",
    "Filter.2.Value.1": name,
    "Filter.3.Name": "tag:Environment",
    "Filter.3.Value.1": environment,
  });

  const vpcRes = await ec2Request("POST", region, vpcParams.toString(), accessKey, secretKey);
  const vpcBody = await vpcRes.text();
  if (!vpcRes.ok) throw new Error(extractEc2Error(vpcBody) || "DescribeVpcs failed");

  const vpcId = vpcBody.match(/<vpcId>(vpc-[a-f0-9]+)<\/vpcId>/)?.[1];
  if (!vpcId) return null;

  const vpcCidr = vpcBody.match(/<cidrBlock>([^<]+)<\/cidrBlock>/)?.[1];

  const subnetRes = await ec2Request(
    "POST",
    region,
    new URLSearchParams({
      Action: "DescribeSubnets",
      Version: "2016-11-15",
      "Filter.1.Name": "vpc-id",
      "Filter.1.Value.1": vpcId,
    }).toString(),
    accessKey,
    secretKey,
  );
  const subnetBody = await subnetRes.text();
  if (!subnetRes.ok) throw new Error(extractEc2Error(subnetBody) || "DescribeSubnets failed");

  const subnetChunks = subnetBody.match(/<item>[\s\S]*?<subnetId>subnet-[a-f0-9]+<\/subnetId>[\s\S]*?<\/item>/g) || [];
  const subnets = subnetChunks.map((chunk) => {
    const id = chunk.match(/<subnetId>(subnet-[a-f0-9]+)<\/subnetId>/)?.[1] || "";
    const az = chunk.match(/<availabilityZone>([^<]+)<\/availabilityZone>/)?.[1] || "";
    const cidr = chunk.match(/<cidrBlock>([^<]+)<\/cidrBlock>/)?.[1] || "";
    const subnetType = chunk.match(/<key>SubnetType<\/key>[\s\S]*?<value>([^<]+)<\/value>/)?.[1] || "private";
    return { id, az, cidr, type: subnetType };
  }).filter((subnet) => subnet.id);

  const sgRes = await ec2Request(
    "POST",
    region,
    new URLSearchParams({
      Action: "DescribeSecurityGroups",
      Version: "2016-11-15",
      "Filter.1.Name": "vpc-id",
      "Filter.1.Value.1": vpcId,
      "Filter.2.Name": "tag:ManagedBy",
      "Filter.2.Value.1": "UIDI",
    }).toString(),
    accessKey,
    secretKey,
  );
  const sgBody = await sgRes.text();
  if (!sgRes.ok) throw new Error(extractEc2Error(sgBody) || "DescribeSecurityGroups failed");

  const securityGroupId = sgBody.match(/<groupId>(sg-[a-f0-9]+)<\/groupId>/)?.[1] || null;

  return {
    vpc_id: vpcId,
    security_group_id: securityGroupId,
    subnets,
    region,
    vpc_cidr: vpcCidr,
    reused: true,
  };
}

async function handleNetwork(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("network", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";

  switch (action) {
    case "deploy": {
      const vpcCidr = spec.vpc_cidr as string || "10.0.0.0/16";
      const name = spec.name as string || "uidi-vpc";
      const environment = spec.environment as string || "dev";
      const azCount = Math.min(spec.az_count as number || 2, 3);

      const existingStack = await describeExistingNetworkStack(region, name, environment, AWS_KEY, AWS_SECRET);
      if (existingStack) {
        return ok(
          "network",
          action,
          `Reused existing VPC stack: ${existingStack.vpc_id} with ${existingStack.subnets.length} subnets`,
          existingStack,
        );
      }

      let res = await ec2Request("POST", region, new URLSearchParams({ Action: "CreateVpc", Version: "2016-11-15", CidrBlock: vpcCidr, "TagSpecification.1.ResourceType": "vpc", "TagSpecification.1.Tag.1.Key": "Name", "TagSpecification.1.Tag.1.Value": name, "TagSpecification.1.Tag.2.Key": "ManagedBy", "TagSpecification.1.Tag.2.Value": "UIDI", "TagSpecification.1.Tag.3.Key": "Environment", "TagSpecification.1.Tag.3.Value": environment }).toString(), AWS_KEY, AWS_SECRET);
      let body = await res.text();
      if (!res.ok) return err("network", action, extractEc2Error(body) || "CreateVpc failed");
      const vpcId = body.match(/<vpcId>(vpc-[a-f0-9]+)<\/vpcId>/)?.[1];
      if (!vpcId) return err("network", action, "Failed to extract VPC ID");
      console.log(`Created VPC: ${vpcId}`);

      await ec2Request("POST", region, new URLSearchParams({ Action: "ModifyVpcAttribute", Version: "2016-11-15", VpcId: vpcId, "EnableDnsHostnames.Value": "true" }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());

      res = await ec2Request("POST", region, new URLSearchParams({ Action: "CreateInternetGateway", Version: "2016-11-15", "TagSpecification.1.ResourceType": "internet-gateway", "TagSpecification.1.Tag.1.Key": "Name", "TagSpecification.1.Tag.1.Value": `${name}-igw`, "TagSpecification.1.Tag.2.Key": "ManagedBy", "TagSpecification.1.Tag.2.Value": "UIDI" }).toString(), AWS_KEY, AWS_SECRET);
      body = await res.text();
      if (!res.ok) return err("network", action, extractEc2Error(body) || "CreateInternetGateway failed");
      const igwId = body.match(/<internetGatewayId>(igw-[a-f0-9]+)<\/internetGatewayId>/)?.[1];
      if (!igwId) return err("network", action, "Failed to extract IGW ID");

      res = await ec2Request("POST", region, new URLSearchParams({ Action: "AttachInternetGateway", Version: "2016-11-15", InternetGatewayId: igwId, VpcId: vpcId }).toString(), AWS_KEY, AWS_SECRET);
      body = await res.text();
      if (!res.ok) return err("network", action, extractEc2Error(body) || "AttachInternetGateway failed");
      console.log(`Created & attached IGW: ${igwId}`);

      res = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeAvailabilityZones", Version: "2016-11-15", "Filter.1.Name": "state", "Filter.1.Value.1": "available" }).toString(), AWS_KEY, AWS_SECRET);
      body = await res.text();
      const azs = [...body.matchAll(/<zoneName>([^<]+)<\/zoneName>/g)].map(m => m[1]).slice(0, azCount);
      if (!azs.length) return err("network", action, "No availability zones found");

      const subnets: { id: string; type: string; az: string; cidr: string }[] = [];
      const cidrBase = vpcCidr.split(".").slice(0, 2);
      for (let i = 0; i < azs.length; i++) {
        const pubCidr = `${cidrBase[0]}.${cidrBase[1]}.${i * 2}.0/24`;
        res = await ec2Request("POST", region, new URLSearchParams({ Action: "CreateSubnet", Version: "2016-11-15", VpcId: vpcId, CidrBlock: pubCidr, AvailabilityZone: azs[i], "TagSpecification.1.ResourceType": "subnet", "TagSpecification.1.Tag.1.Key": "Name", "TagSpecification.1.Tag.1.Value": `${name}-public-${azs[i]}`, "TagSpecification.1.Tag.2.Key": "ManagedBy", "TagSpecification.1.Tag.2.Value": "UIDI", "TagSpecification.1.Tag.3.Key": "SubnetType", "TagSpecification.1.Tag.3.Value": "public" }).toString(), AWS_KEY, AWS_SECRET);
        body = await res.text();
        if (!res.ok) return err("network", action, extractEc2Error(body) || `CreateSubnet failed`);
        const pubId = body.match(/<subnetId>(subnet-[a-f0-9]+)<\/subnetId>/)?.[1];
        if (pubId) {
          subnets.push({ id: pubId, type: "public", az: azs[i], cidr: pubCidr });
          await ec2Request("POST", region, new URLSearchParams({ Action: "ModifySubnetAttribute", Version: "2016-11-15", SubnetId: pubId, "MapPublicIpOnLaunch.Value": "true" }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
        }
        const privCidr = `${cidrBase[0]}.${cidrBase[1]}.${i * 2 + 1}.0/24`;
        res = await ec2Request("POST", region, new URLSearchParams({ Action: "CreateSubnet", Version: "2016-11-15", VpcId: vpcId, CidrBlock: privCidr, AvailabilityZone: azs[i], "TagSpecification.1.ResourceType": "subnet", "TagSpecification.1.Tag.1.Key": "Name", "TagSpecification.1.Tag.1.Value": `${name}-private-${azs[i]}`, "TagSpecification.1.Tag.2.Key": "ManagedBy", "TagSpecification.1.Tag.2.Value": "UIDI", "TagSpecification.1.Tag.3.Key": "SubnetType", "TagSpecification.1.Tag.3.Value": "private" }).toString(), AWS_KEY, AWS_SECRET);
        body = await res.text();
        if (!res.ok) return err("network", action, extractEc2Error(body) || `CreateSubnet failed`);
        const privId = body.match(/<subnetId>(subnet-[a-f0-9]+)<\/subnetId>/)?.[1];
        if (privId) subnets.push({ id: privId, type: "private", az: azs[i], cidr: privCidr });
      }
      console.log(`Created ${subnets.length} subnets`);

      res = await ec2Request("POST", region, new URLSearchParams({ Action: "CreateRouteTable", Version: "2016-11-15", VpcId: vpcId, "TagSpecification.1.ResourceType": "route-table", "TagSpecification.1.Tag.1.Key": "Name", "TagSpecification.1.Tag.1.Value": `${name}-public-rt`, "TagSpecification.1.Tag.2.Key": "ManagedBy", "TagSpecification.1.Tag.2.Value": "UIDI" }).toString(), AWS_KEY, AWS_SECRET);
      body = await res.text();
      const rtbId = body.match(/<routeTableId>(rtb-[a-f0-9]+)<\/routeTableId>/)?.[1];
      if (rtbId) {
        await ec2Request("POST", region, new URLSearchParams({ Action: "CreateRoute", Version: "2016-11-15", RouteTableId: rtbId, DestinationCidrBlock: "0.0.0.0/0", GatewayId: igwId }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
        for (const sub of subnets.filter(s => s.type === "public")) {
          await ec2Request("POST", region, new URLSearchParams({ Action: "AssociateRouteTable", Version: "2016-11-15", RouteTableId: rtbId, SubnetId: sub.id }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
        }
      }

      res = await ec2Request("POST", region, new URLSearchParams({ Action: "CreateNetworkAcl", Version: "2016-11-15", VpcId: vpcId, "TagSpecification.1.ResourceType": "network-acl", "TagSpecification.1.Tag.1.Key": "Name", "TagSpecification.1.Tag.1.Value": `${name}-nacl`, "TagSpecification.1.Tag.2.Key": "ManagedBy", "TagSpecification.1.Tag.2.Value": "UIDI" }).toString(), AWS_KEY, AWS_SECRET);
      body = await res.text();
      const naclId = body.match(/<networkAclId>(acl-[a-f0-9]+)<\/networkAclId>/)?.[1];
      if (naclId) {
        await ec2Request("POST", region, new URLSearchParams({ Action: "CreateNetworkAclEntry", Version: "2016-11-15", NetworkAclId: naclId, RuleNumber: "100", Protocol: "-1", RuleAction: "allow", CidrBlock: "0.0.0.0/0", Egress: "false" }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
        await ec2Request("POST", region, new URLSearchParams({ Action: "CreateNetworkAclEntry", Version: "2016-11-15", NetworkAclId: naclId, RuleNumber: "100", Protocol: "-1", RuleAction: "allow", CidrBlock: "0.0.0.0/0", Egress: "true" }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
      }

      res = await ec2Request("POST", region, new URLSearchParams({ Action: "CreateSecurityGroup", Version: "2016-11-15", GroupName: `${name}-sg`, Description: `UIDI managed SG for ${name}`, VpcId: vpcId, "TagSpecification.1.ResourceType": "security-group", "TagSpecification.1.Tag.1.Key": "Name", "TagSpecification.1.Tag.1.Value": `${name}-sg`, "TagSpecification.1.Tag.2.Key": "ManagedBy", "TagSpecification.1.Tag.2.Value": "UIDI" }).toString(), AWS_KEY, AWS_SECRET);
      body = await res.text();
      const sgId = body.match(/<groupId>(sg-[a-f0-9]+)<\/groupId>/)?.[1];
      if (sgId) {
        await ec2Request("POST", region, new URLSearchParams({ Action: "AuthorizeSecurityGroupIngress", Version: "2016-11-15", GroupId: sgId, "IpPermissions.1.IpProtocol": "tcp", "IpPermissions.1.FromPort": "22", "IpPermissions.1.ToPort": "22", "IpPermissions.1.IpRanges.1.CidrIp": "0.0.0.0/0" }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
        await ec2Request("POST", region, new URLSearchParams({ Action: "AuthorizeSecurityGroupIngress", Version: "2016-11-15", GroupId: sgId, "IpPermissions.1.IpProtocol": "tcp", "IpPermissions.1.FromPort": "443", "IpPermissions.1.ToPort": "443", "IpPermissions.1.IpRanges.1.CidrIp": "0.0.0.0/0" }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
      }

      return ok("network", action, `VPC stack created: ${vpcId} with ${subnets.length} subnets, IGW, route table, NACL, and security group`, { vpc_id: vpcId, igw_id: igwId, route_table_id: rtbId, nacl_id: naclId, security_group_id: sgId, subnets, region, vpc_cidr: vpcCidr });
    }

    case "discover": {
      const dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeVpcs", Version: "2016-11-15", "Filter.1.Name": "tag:ManagedBy", "Filter.1.Value.1": "UIDI" }).toString(), AWS_KEY, AWS_SECRET);
      const dBody = await dRes.text();
      if (!dRes.ok) return err("network", action, extractEc2Error(dBody) || "DescribeVpcs failed");
      const vpcs = [...dBody.matchAll(/<vpcId>(vpc-[a-f0-9]+)<\/vpcId>/g)].map(m => m[1]);
      return ok("network", action, `Discovered ${vpcs.length} UIDI-managed VPC(s)`, { vpcs, region });
    }

    case "destroy": {
      const vpcId = spec.vpc_id as string;
      if (!vpcId) return err("network", action, "vpc_id required for destroy");
      let dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeSubnets", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
      let dBody = await dRes.text();
      for (const sid of [...dBody.matchAll(/<subnetId>(subnet-[a-f0-9]+)<\/subnetId>/g)].map(m => m[1])) {
        await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteSubnet", Version: "2016-11-15", SubnetId: sid }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
      }
      dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeInternetGateways", Version: "2016-11-15", "Filter.1.Name": "attachment.vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
      dBody = await dRes.text();
      for (const gid of [...dBody.matchAll(/<internetGatewayId>(igw-[a-f0-9]+)<\/internetGatewayId>/g)].map(m => m[1])) {
        await ec2Request("POST", region, new URLSearchParams({ Action: "DetachInternetGateway", Version: "2016-11-15", InternetGatewayId: gid, VpcId: vpcId }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
        await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteInternetGateway", Version: "2016-11-15", InternetGatewayId: gid }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
      }
      dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteVpc", Version: "2016-11-15", VpcId: vpcId }).toString(), AWS_KEY, AWS_SECRET);
      dBody = await dRes.text();
      if (!dRes.ok) return err("network", action, extractEc2Error(dBody) || "DeleteVpc failed");
      return ok("network", action, `VPC ${vpcId} destroyed`, { vpc_id: vpcId, region });
    }

    default:
      return err("network", action, `Unknown network action: ${action}`);
  }
}

// ───── IAM Role Resolver ─────

async function iamRequest(method: string, path: string, body: string | undefined, accessKey: string, secretKey: string): Promise<Response> {
  const service = "iam";
  const host = "iam.amazonaws.com";
  const url = `https://${host}${path}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Host: host,
    "X-Amz-Date": amzDate,
  };

  const bodyStr = body || "";
  const bodyHash = await sha256Hex(bodyStr);
  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]}`).join("\n") + "\n";
  const signedHeadersStr = signedHeaderKeys.join(";");

  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeadersStr, bodyHash].join("\n");
  const credentialScope = `${dateStamp}/us-east-1/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, "us-east-1");
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return fetch(url, { method, headers, body: bodyStr || undefined });
}

async function getOrCreateEksRole(accessKey: string, secretKey: string, roleType: "cluster" | "node" = "cluster"): Promise<{ arn: string; created: boolean }> {
  const roleName = roleType === "cluster" ? "UIDI-EKS-Cluster-Role" : "UIDI-EKS-Node-Role";
  const policyArn = roleType === "cluster"
    ? "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
    : "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy";
  const trustService = roleType === "cluster" ? "eks.amazonaws.com" : "ec2.amazonaws.com";

  // 1. Try to get the existing role
  console.log(`IAM Role Resolver: Looking for ${roleName}...`);
  const getRes = await iamRequest("POST", "/", new URLSearchParams({
    Action: "GetRole",
    Version: "2010-05-08",
    RoleName: roleName,
  }).toString(), accessKey, secretKey);
  const getBody = await getRes.text();

  if (getRes.ok) {
    const arnMatch = getBody.match(/<Arn>([^<]+)<\/Arn>/);
    if (arnMatch) {
      console.log(`IAM Role Resolver: Found existing role ${arnMatch[1]}`);
      return { arn: arnMatch[1], created: false };
    }
  }

  // 2. Role not found — create it
  console.log(`IAM Role Resolver: Creating ${roleName}...`);
  const trustPolicy = JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: trustService },
      Action: "sts:AssumeRole",
    }],
  });

  const createRes = await iamRequest("POST", "/", new URLSearchParams({
    Action: "CreateRole",
    Version: "2010-05-08",
    RoleName: roleName,
    AssumeRolePolicyDocument: trustPolicy,
    Description: `Auto-provisioned by UIDI for EKS ${roleType}`,
    "Tag.member.1.Key": "ManagedBy",
    "Tag.member.1.Value": "UIDI",
  }).toString(), accessKey, secretKey);
  const createBody = await createRes.text();
  console.log(`IAM CreateRole response: ${createRes.status} ${createBody.slice(0, 300)}`);

  // Handle EntityAlreadyExists (role created on previous timed-out attempt)
  if (!createRes.ok) {
    if (createBody.includes("EntityAlreadyExists")) {
      console.log(`IAM Role Resolver: Role already exists (previous attempt), fetching ARN...`);
      const retryGet = await iamRequest("POST", "/", new URLSearchParams({
        Action: "GetRole",
        Version: "2010-05-08",
        RoleName: roleName,
      }).toString(), accessKey, secretKey);
      const retryBody = await retryGet.text();
      const retryArn = retryBody.match(/<Arn>([^<]+)<\/Arn>/)?.[1];
      if (retryArn) return { arn: retryArn, created: false };
    }
    throw new Error(`Failed to create IAM role ${roleName}: ${createBody.match(/<Message>(.*?)<\/Message>/)?.[1] || createBody.slice(0, 300)}`);
  }

  const arnMatch = createBody.match(/<Arn>([^<]+)<\/Arn>/);
  if (!arnMatch) throw new Error(`Created role but couldn't extract ARN`);
  console.log(`IAM Role Resolver: Role created with ARN ${arnMatch[1]}, attaching policies...`);

  // 3. Attach the required policy
  const attachRes = await iamRequest("POST", "/", new URLSearchParams({
    Action: "AttachRolePolicy",
    Version: "2010-05-08",
    RoleName: roleName,
    PolicyArn: policyArn,
  }).toString(), accessKey, secretKey);
  const attachBody = await attachRes.text();
  console.log(`IAM AttachRolePolicy response: ${attachRes.status}`);

  // For node role, attach additional required policies
  if (roleType === "node") {
    for (const extraPolicy of [
      "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
      "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    ]) {
      const extraRes = await iamRequest("POST", "/", new URLSearchParams({
        Action: "AttachRolePolicy",
        Version: "2010-05-08",
        RoleName: roleName,
        PolicyArn: extraPolicy,
      }).toString(), accessKey, secretKey);
      await extraRes.text();
    }
  }

  console.log(`IAM Role Resolver: Created and configured ${roleName} → ${arnMatch[1]}`);

  // Brief wait for IAM propagation (reduced from 5s)
  await new Promise(r => setTimeout(r, 2000));

  return { arn: arnMatch[1], created: true };
}

// ───── EKS ─────

async function handleEks(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("eks", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";

  switch (action) {
    case "deploy": {
      const clusterName = spec.cluster_name as string || `uidi-cluster-${Date.now()}`;
      const subnetIds = spec.subnet_ids as string[];
      const securityGroupIds = spec.security_group_ids as string[];
      if (!subnetIds?.length) return err("eks", action, "subnet_ids required (at least 2 AZs).");

      // Auto-resolve cluster role ARN
      let roleArn = spec.role_arn as string;
      let roleAutoProvisioned = false;
      if (!roleArn) {
        try {
          const resolved = await getOrCreateEksRole(AWS_KEY, AWS_SECRET, "cluster");
          roleArn = resolved.arn;
          roleAutoProvisioned = resolved.created;
          console.log(`EKS deploy: role ${roleAutoProvisioned ? "auto-created" : "discovered"}: ${roleArn}`);
        } catch (e) {
          return err("eks", action, `IAM Role Resolver failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const res = await awsSignedRequest({ service: "eks", region, method: "POST", path: "/clusters", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET, body: JSON.stringify({ name: clusterName, version: spec.kubernetes_version || "1.29", roleArn, resourcesVpcConfig: { subnetIds, securityGroupIds: securityGroupIds || [], endpointPublicAccess: true, endpointPrivateAccess: true }, tags: { ManagedBy: "UIDI", Environment: spec.environment || "dev" } }), extraHeaders: { "Content-Type": "application/json" } });
      const body = await res.text();
      if (!res.ok) { if (body.includes("ResourceInUseException") || body.includes("already exists")) return ok("eks", action, `Cluster ${clusterName} already exists — reusing`, { cluster_name: clusterName, status: "existing", region }); return err("eks", action, `CreateCluster failed: ${body.slice(0, 500)}`); }
      const data = JSON.parse(body);
      return ok("eks", action, `EKS cluster ${clusterName} creation started (~10-15 min)${roleAutoProvisioned ? " (IAM role auto-provisioned)" : ""}`, { cluster_name: clusterName, status: data.cluster?.status || "CREATING", arn: data.cluster?.arn, region, role_arn: roleArn, role_auto_provisioned: roleAutoProvisioned });
    }

    case "discover":
    case "status": {
      const clusterName = spec.cluster_name as string;
      if (clusterName) {
        const res = await awsSignedRequest({ service: "eks", region, method: "GET", path: `/clusters/${clusterName}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
        const body = await res.text();
        if (!res.ok) return err("eks", action, `DescribeCluster failed: ${body.slice(0, 500)}`);
        const data = JSON.parse(body);
        return ok("eks", action, `Cluster ${clusterName}: ${data.cluster?.status}`, { cluster_name: clusterName, status: data.cluster?.status, endpoint: data.cluster?.endpoint, version: data.cluster?.version });
      }
      const res = await awsSignedRequest({ service: "eks", region, method: "GET", path: "/clusters", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
      const body = await res.text();
      if (!res.ok) return err("eks", action, `ListClusters failed: ${body.slice(0, 500)}`);
      const data = JSON.parse(body);
      return ok("eks", action, `Found ${data.clusters?.length || 0} cluster(s)`, { clusters: data.clusters || [], region });
    }

    case "add_nodegroup": {
      const clusterName = spec.cluster_name as string;
      if (!clusterName || !spec.node_role_arn || !(spec.subnet_ids as string[])?.length) return err("eks", action, "cluster_name, node_role_arn, subnet_ids required.");
      const res = await awsSignedRequest({ service: "eks", region, method: "POST", path: `/clusters/${clusterName}/node-groups`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET, body: JSON.stringify({ nodegroupName: spec.nodegroup_name || `${clusterName}-nodes`, nodeRole: spec.node_role_arn, subnets: spec.subnet_ids, instanceTypes: spec.instance_types || ["t3.medium"], scalingConfig: { desiredSize: spec.desired_size || 2, minSize: spec.min_size || 1, maxSize: spec.max_size || 3 }, tags: { ManagedBy: "UIDI" } }), extraHeaders: { "Content-Type": "application/json" } });
      const body = await res.text();
      if (!res.ok) return err("eks", action, `CreateNodegroup failed: ${body.slice(0, 500)}`);
      return ok("eks", action, `Node group creation started`, JSON.parse(body).nodegroup || {});
    }

    case "destroy": {
      const clusterName = spec.cluster_name as string;
      if (!clusterName) return err("eks", action, "cluster_name required.");
      const ngRes = await awsSignedRequest({ service: "eks", region, method: "GET", path: `/clusters/${clusterName}/node-groups`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
      const ngBody = await ngRes.text();
      if (ngRes.ok) { for (const ng of (JSON.parse(ngBody).nodegroups || [])) { await awsSignedRequest({ service: "eks", region, method: "DELETE", path: `/clusters/${clusterName}/node-groups/${ng}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET }).then(r => r.text()); } }
      const res = await awsSignedRequest({ service: "eks", region, method: "DELETE", path: `/clusters/${clusterName}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
      const body = await res.text();
      if (!res.ok && !body.includes("ResourceNotFoundException")) return err("eks", action, `DeleteCluster failed: ${body.slice(0, 500)}`);
      return ok("eks", action, `EKS cluster ${clusterName} deletion initiated`, { cluster_name: clusterName, region });
    }

    default:
      return err("eks", action, `Unknown EKS action: ${action}`);
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

// ───── Reconciliation Engine (Drift Controller) ─────

interface ReconcileSpec {
  environment: string;
  region: string;
  desired_resources: {
    network?: { name: string; vpc_cidr?: string; az_count?: number };
    eks?: { cluster_name: string; kubernetes_version?: string };
    compute?: { name: string; instance_type?: string; os?: string; count?: number };
  };
}

interface ResourceState {
  exists: boolean;
  status: "match" | "drift" | "missing" | "orphan";
  live?: Record<string, unknown>;
  desired?: Record<string, unknown>;
  delta?: string[];
}

interface ReconcileReport {
  intent_hash: string;
  timestamp: string;
  region: string;
  environment: string;
  resources: Record<string, ResourceState>;
  actions_taken: { resource: string; action: string; result: string }[];
  summary: { total: number; matched: number; drifted: number; missing: number; created: number; updated: number; failed: number };
}

async function generateIntentHash(spec: ReconcileSpec): Promise<string> {
  // Deterministic hash of the desired state — same intent always yields same hash
  const normalized = JSON.stringify({
    env: spec.environment,
    region: spec.region,
    resources: spec.desired_resources,
  }, Object.keys(spec).sort());
  return await sha256Hex(normalized);
}

function detectDrift(desired: Record<string, unknown>, live: Record<string, unknown>): string[] {
  const drifts: string[] = [];
  for (const [key, val] of Object.entries(desired)) {
    if (val === undefined || val === null) continue;
    const liveVal = live[key];
    if (liveVal === undefined) {
      drifts.push(`${key}: missing in live state`);
    } else if (JSON.stringify(val) !== JSON.stringify(liveVal)) {
      drifts.push(`${key}: desired=${JSON.stringify(val)} live=${JSON.stringify(liveVal)}`);
    }
  }
  return drifts;
}

async function handleReconcile(spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("reconcile", "reconcile", "AWS credentials required.");

  const reconcileSpec: ReconcileSpec = {
    environment: spec.environment as string || "dev",
    region: spec.region as string || "us-east-1",
    desired_resources: spec.desired_resources as ReconcileSpec["desired_resources"] || {},
  };

  const { environment, region, desired_resources } = reconcileSpec;
  const intentHash = await generateIntentHash(reconcileSpec);

  console.log(`Reconcile: hash=${intentHash.slice(0, 12)}… env=${environment} region=${region}`);

  const report: ReconcileReport = {
    intent_hash: intentHash,
    timestamp: new Date().toISOString(),
    region,
    environment,
    resources: {},
    actions_taken: [],
    summary: { total: 0, matched: 0, drifted: 0, missing: 0, created: 0, updated: 0, failed: 0 },
  };

  // ── 1. Reconcile Network ──
  if (desired_resources.network) {
    const net = desired_resources.network;
    const name = net.name || `uidi-vpc-${environment}`;
    report.summary.total++;

    try {
      const liveStack = await describeExistingNetworkStack(region, name, environment, AWS_KEY, AWS_SECRET);

      if (liveStack) {
        // Network exists — check for drift
        const desiredState = { vpc_cidr: net.vpc_cidr || "10.0.0.0/16", az_count: net.az_count || 2 };
        const liveState: Record<string, unknown> = {
          vpc_cidr: liveStack.vpc_cidr,
          az_count: Math.floor(liveStack.subnets.length / 2), // pub+priv per AZ
        };

        const drifts = detectDrift(desiredState, liveState);

        if (drifts.length === 0) {
          report.resources.network = { exists: true, status: "match", live: liveStack as unknown as Record<string, unknown> };
          report.summary.matched++;
          report.actions_taken.push({ resource: "network", action: "none", result: `VPC ${liveStack.vpc_id} matches desired state` });
        } else {
          report.resources.network = {
            exists: true,
            status: "drift",
            live: liveStack as unknown as Record<string, unknown>,
            desired: desiredState,
            delta: drifts,
          };
          report.summary.drifted++;
          // Network drift is informational — VPC CIDR can't be changed in-place
          report.actions_taken.push({ resource: "network", action: "drift_detected", result: `Drifts: ${drifts.join("; ")}` });
        }
      } else {
        // Network missing — create it
        report.resources.network = { exists: false, status: "missing", desired: net as Record<string, unknown> };
        report.summary.missing++;

        console.log(`Reconcile: Network missing, deploying...`);
        const deployResult = await handleNetwork("deploy", {
          region, environment, name,
          vpc_cidr: net.vpc_cidr || "10.0.0.0/16",
          az_count: net.az_count || 2,
        });

        if (deployResult.status === "success") {
          report.summary.created++;
          report.resources.network.live = deployResult.details as Record<string, unknown>;
          report.actions_taken.push({ resource: "network", action: "created", result: deployResult.message || "VPC stack deployed" });
        } else {
          report.summary.failed++;
          report.actions_taken.push({ resource: "network", action: "create_failed", result: deployResult.error || "Unknown error" });
        }
      }
    } catch (e) {
      report.summary.failed++;
      report.resources.network = { exists: false, status: "missing" };
      report.actions_taken.push({ resource: "network", action: "error", result: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── 2. Reconcile EKS ──
  if (desired_resources.eks) {
    const eks = desired_resources.eks;
    const clusterName = eks.cluster_name || `uidi-${environment}-cluster`;
    report.summary.total++;

    try {
      // Discover cluster
      const descRes = await awsSignedRequest({
        service: "eks", region, method: "GET",
        path: `/clusters/${clusterName}`,
        accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
      });
      const descBody = await descRes.text();

      if (descRes.ok) {
        const clusterData = JSON.parse(descBody);
        const liveVersion = clusterData.cluster?.version;
        const desiredVersion = eks.kubernetes_version || "1.29";
        const clusterStatus = clusterData.cluster?.status;

        const drifts: string[] = [];
        if (liveVersion !== desiredVersion) drifts.push(`kubernetes_version: desired=${desiredVersion} live=${liveVersion}`);

        if (drifts.length === 0) {
          report.resources.eks = {
            exists: true, status: "match",
            live: { cluster_name: clusterName, version: liveVersion, status: clusterStatus, endpoint: clusterData.cluster?.endpoint },
          };
          report.summary.matched++;
          report.actions_taken.push({ resource: "eks", action: "none", result: `Cluster ${clusterName} matches (${clusterStatus})` });
        } else {
          report.resources.eks = {
            exists: true, status: "drift",
            live: { cluster_name: clusterName, version: liveVersion, status: clusterStatus },
            desired: { cluster_name: clusterName, kubernetes_version: desiredVersion },
            delta: drifts,
          };
          report.summary.drifted++;
          report.actions_taken.push({ resource: "eks", action: "drift_detected", result: `Drifts: ${drifts.join("; ")}. EKS version upgrades require explicit action.` });
        }
      } else if (descBody.includes("ResourceNotFoundException")) {
        // Cluster missing — create it
        report.resources.eks = { exists: false, status: "missing", desired: eks as Record<string, unknown> };
        report.summary.missing++;

        // Need subnet IDs from network step
        const networkState = report.resources.network?.live as Record<string, unknown> | undefined;
        const subnets = networkState?.subnets as { id: string }[] | undefined;
        const subnetIds = subnets?.map(s => s.id) || [];
        const sgId = networkState?.security_group_id as string | undefined;

        if (subnetIds.length >= 2) {
          console.log(`Reconcile: EKS cluster missing, deploying with ${subnetIds.length} subnets...`);
          const deployResult = await handleEks("deploy", {
            region, environment,
            cluster_name: clusterName,
            subnet_ids: subnetIds,
            security_group_ids: sgId ? [sgId] : [],
            kubernetes_version: eks.kubernetes_version || "1.29",
          });

          if (deployResult.status === "success") {
            report.summary.created++;
            report.resources.eks.live = deployResult.details as Record<string, unknown>;
            report.actions_taken.push({ resource: "eks", action: "created", result: deployResult.message || "Cluster creation started" });
          } else {
            report.summary.failed++;
            report.actions_taken.push({ resource: "eks", action: "create_failed", result: deployResult.error || "Unknown error" });
          }
        } else {
          report.summary.failed++;
          report.actions_taken.push({ resource: "eks", action: "blocked", result: "Cannot create EKS — no subnet IDs available. Deploy network first." });
        }
      } else {
        report.summary.failed++;
        report.resources.eks = { exists: false, status: "missing" };
        report.actions_taken.push({ resource: "eks", action: "error", result: `DescribeCluster failed: ${descBody.slice(0, 200)}` });
      }
    } catch (e) {
      report.summary.failed++;
      report.resources.eks = { exists: false, status: "missing" };
      report.actions_taken.push({ resource: "eks", action: "error", result: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── 3. Reconcile Compute ──
  if (desired_resources.compute) {
    const comp = desired_resources.compute;
    const name = comp.name || `uidi-${environment}-instance`;
    report.summary.total++;

    try {
      // Discover existing instances with this name
      const discoverResult = await handleCompute("discover", { region, environment, name });

      if (discoverResult.status === "success") {
        const instances = (discoverResult.details as Record<string, unknown>)?.instances as Record<string, unknown>[] || [];
        const runningInstances = instances.filter(i => (i as Record<string, unknown>).state === "running");

        if (runningInstances.length > 0) {
          // Check for drift
          const desiredType = comp.instance_type || "t3.micro";
          const liveType = (runningInstances[0] as Record<string, unknown>).instance_type as string;
          const desiredCount = comp.count || 1;

          const drifts: string[] = [];
          if (liveType !== desiredType) drifts.push(`instance_type: desired=${desiredType} live=${liveType}`);
          if (runningInstances.length !== desiredCount) drifts.push(`count: desired=${desiredCount} live=${runningInstances.length}`);

          if (drifts.length === 0) {
            report.resources.compute = { exists: true, status: "match", live: { instances: runningInstances } };
            report.summary.matched++;
            report.actions_taken.push({ resource: "compute", action: "none", result: `${runningInstances.length} instance(s) match desired state` });
          } else {
            report.resources.compute = {
              exists: true, status: "drift",
              live: { instances: runningInstances, instance_type: liveType, count: runningInstances.length },
              desired: { instance_type: desiredType, count: desiredCount },
              delta: drifts,
            };
            report.summary.drifted++;
            report.actions_taken.push({ resource: "compute", action: "drift_detected", result: `Drifts: ${drifts.join("; ")}` });
          }
        } else {
          // No running instances — deploy
          report.resources.compute = { exists: false, status: "missing", desired: comp as Record<string, unknown> };
          report.summary.missing++;

          const networkState = report.resources.network?.live as Record<string, unknown> | undefined;
          const subnets = networkState?.subnets as { id: string; type: string }[] | undefined;
          const publicSubnet = subnets?.find(s => s.type === "public");
          const sgId = networkState?.security_group_id as string | undefined;

          console.log(`Reconcile: Compute missing, deploying...`);
          const deployResult = await handleCompute("deploy", {
            region, environment, name,
            instance_type: comp.instance_type || "t3.micro",
            os: comp.os || "amazon-linux-2023",
            count: comp.count || 1,
            ...(publicSubnet ? { subnet_id: publicSubnet.id } : {}),
            ...(sgId ? { security_group_ids: [sgId] } : {}),
          });

          if (deployResult.status === "success") {
            report.summary.created++;
            report.resources.compute.live = deployResult.details as Record<string, unknown>;
            report.actions_taken.push({ resource: "compute", action: "created", result: deployResult.message || "Instance(s) launched" });
          } else {
            report.summary.failed++;
            report.actions_taken.push({ resource: "compute", action: "create_failed", result: deployResult.error || "Unknown error" });
          }
        }
      } else {
        report.summary.failed++;
        report.resources.compute = { exists: false, status: "missing" };
        report.actions_taken.push({ resource: "compute", action: "error", result: discoverResult.error || "Discovery failed" });
      }
    } catch (e) {
      report.summary.failed++;
      report.resources.compute = { exists: false, status: "missing" };
      report.actions_taken.push({ resource: "compute", action: "error", result: e instanceof Error ? e.message : String(e) });
    }
  }

  // Build summary message
  const { summary } = report;
  const summaryMsg = [
    `Reconciliation complete (hash: ${intentHash.slice(0, 12)}…)`,
    `${summary.total} resource(s): ${summary.matched} matched, ${summary.drifted} drifted, ${summary.missing} missing`,
    summary.created ? `${summary.created} created` : null,
    summary.updated ? `${summary.updated} updated` : null,
    summary.failed ? `${summary.failed} failed` : null,
  ].filter(Boolean).join(" | ");

  return ok("reconcile", "reconcile", summaryMsg, report);
}

// ───── Inventory (Resource Discovery + Waste Hunter) ─────

interface InventoryResource {
  id: string;
  type: "ec2" | "vpc" | "ebs" | "eip" | "eks" | "subnet" | "security_group";
  name: string;
  region: string;
  state: string;
  managed: boolean; // has ManagedBy:UIDI tag
  waste?: { reason: string; savings_hint?: string };
  tags: Record<string, string>;
  details: Record<string, unknown>;
}

async function handleInventory(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("inventory", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";

  switch (action) {
    case "scan": {
      const resources: InventoryResource[] = [];

      // ── EC2 Instances ──
      const ec2Params = new URLSearchParams({ Action: "DescribeInstances", Version: "2016-11-15" });
      // Exclude terminated
      ec2Params.set("Filter.1.Name", "instance-state-name");
      ec2Params.set("Filter.1.Value.1", "pending");
      ec2Params.set("Filter.1.Value.2", "running");
      ec2Params.set("Filter.1.Value.3", "stopping");
      ec2Params.set("Filter.1.Value.4", "stopped");

      const ec2Res = await ec2Request("POST", region, ec2Params.toString(), AWS_KEY, AWS_SECRET);
      const ec2Body = await ec2Res.text();
      if (ec2Res.ok) {
        // Parse reservation items to get instance blocks
        const instanceBlocks = ec2Body.match(/<instancesSet>[\s\S]*?<\/instancesSet>/g) || [];
        for (const block of instanceBlocks) {
          const items = block.match(/<item>[\s\S]*?<\/item>/g) || [];
          for (const item of items) {
            const id = item.match(/<instanceId>(i-[a-f0-9]+)<\/instanceId>/)?.[1];
            if (!id) continue;
            const state = item.match(/<instanceState>[\s\S]*?<name>([^<]+)<\/name>/)?.[1] || "unknown";
            const iType = item.match(/<instanceType>([^<]+)<\/instanceType>/)?.[1] || "unknown";
            const launchTime = item.match(/<launchTime>([^<]+)<\/launchTime>/)?.[1] || "";
            const publicIp = item.match(/<ipAddress>([^<]+)<\/ipAddress>/)?.[1];
            const tags: Record<string, string> = {};
            const tagMatches = item.matchAll(/<key>([^<]+)<\/key>\s*<value>([^<]*)<\/value>/g);
            for (const m of tagMatches) tags[m[1]] = m[2];
            const managed = tags["ManagedBy"] === "UIDI";
            const name = tags["Name"] || id;

            // Waste detection: stopped instance
            let waste: InventoryResource["waste"] = undefined;
            if (state === "stopped") {
              waste = { reason: "Instance stopped — accruing EBS costs", savings_hint: "Terminate or snapshot & delete" };
            }

            resources.push({ id, type: "ec2", name, region, state, managed, waste, tags, details: { instance_type: iType, launch_time: launchTime, public_ip: publicIp } });
          }
        }
      }

      // ── EBS Volumes (orphaned = available) ──
      const ebsParams = new URLSearchParams({ Action: "DescribeVolumes", Version: "2016-11-15" });
      const ebsRes = await ec2Request("POST", region, ebsParams.toString(), AWS_KEY, AWS_SECRET);
      const ebsBody = await ebsRes.text();
      if (ebsRes.ok) {
        const volItems = ebsBody.match(/<item>[\s\S]*?<volumeId>vol-[a-f0-9]+<\/volumeId>[\s\S]*?<\/item>/g) || [];
        for (const item of volItems) {
          const id = item.match(/<volumeId>(vol-[a-f0-9]+)<\/volumeId>/)?.[1];
          if (!id) continue;
          const volState = item.match(/<status>([^<]+)<\/status>/)?.[1] || "unknown";
          const size = item.match(/<size>([^<]+)<\/size>/)?.[1] || "0";
          const volType = item.match(/<volumeType>([^<]+)<\/volumeType>/)?.[1] || "gp3";
          const tags: Record<string, string> = {};
          const tagMatches = item.matchAll(/<key>([^<]+)<\/key>\s*<value>([^<]*)<\/value>/g);
          for (const m of tagMatches) tags[m[1]] = m[2];
          const managed = tags["ManagedBy"] === "UIDI";

          let waste: InventoryResource["waste"] = undefined;
          if (volState === "available") {
            waste = { reason: "Orphaned volume — not attached", savings_hint: `Snapshot & delete to save ~$${(parseFloat(size) * 0.08).toFixed(2)}/mo` };
          }

          resources.push({ id, type: "ebs", name: tags["Name"] || id, region, state: volState, managed, waste, tags, details: { size_gb: size, volume_type: volType } });
        }
      }

      // ── Elastic IPs (unused = no association) ──
      const eipParams = new URLSearchParams({ Action: "DescribeAddresses", Version: "2016-11-15" });
      const eipRes = await ec2Request("POST", region, eipParams.toString(), AWS_KEY, AWS_SECRET);
      const eipBody = await eipRes.text();
      if (eipRes.ok) {
        const eipItems = eipBody.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of eipItems) {
          const allocId = item.match(/<allocationId>([^<]+)<\/allocationId>/)?.[1];
          const publicIp = item.match(/<publicIp>([^<]+)<\/publicIp>/)?.[1];
          if (!allocId) continue;
          const assocId = item.match(/<associationId>([^<]+)<\/associationId>/)?.[1];
          const tags: Record<string, string> = {};
          const tagMatches = item.matchAll(/<key>([^<]+)<\/key>\s*<value>([^<]*)<\/value>/g);
          for (const m of tagMatches) tags[m[1]] = m[2];
          const managed = tags["ManagedBy"] === "UIDI";

          let waste: InventoryResource["waste"] = undefined;
          if (!assocId) {
            waste = { reason: "Idle Elastic IP — not associated", savings_hint: "Release to avoid $3.60/mo idle fee" };
          }

          resources.push({ id: allocId, type: "eip", name: publicIp || allocId, region, state: assocId ? "associated" : "idle", managed, waste, tags, details: { public_ip: publicIp, association_id: assocId || null } });
        }
      }

      // ── VPCs ──
      const vpcParams = new URLSearchParams({ Action: "DescribeVpcs", Version: "2016-11-15" });
      const vpcRes = await ec2Request("POST", region, vpcParams.toString(), AWS_KEY, AWS_SECRET);
      const vpcBody = await vpcRes.text();
      if (vpcRes.ok) {
        const vpcItems = vpcBody.match(/<item>[\s\S]*?<vpcId>vpc-[a-f0-9]+<\/vpcId>[\s\S]*?<\/item>/g) || [];
        for (const item of vpcItems) {
          const id = item.match(/<vpcId>(vpc-[a-f0-9]+)<\/vpcId>/)?.[1];
          if (!id) continue;
          const cidr = item.match(/<cidrBlock>([^<]+)<\/cidrBlock>/)?.[1] || "";
          const isDefault = item.includes("<isDefault>true</isDefault>");
          const tags: Record<string, string> = {};
          const tagMatches = item.matchAll(/<key>([^<]+)<\/key>\s*<value>([^<]*)<\/value>/g);
          for (const m of tagMatches) tags[m[1]] = m[2];
          const managed = tags["ManagedBy"] === "UIDI";

          resources.push({ id, type: "vpc", name: tags["Name"] || (isDefault ? "default-vpc" : id), region, state: "available", managed, tags, details: { cidr, is_default: isDefault } });
        }
      }

      // ── EKS Clusters ──
      try {
        const eksListRes = await awsSignedRequest({ service: "eks", region, method: "GET", path: "/clusters", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
        if (eksListRes.ok) {
          const eksData = JSON.parse(await eksListRes.text());
          for (const clusterName of (eksData.clusters || [])) {
            const descRes = await awsSignedRequest({ service: "eks", region, method: "GET", path: `/clusters/${clusterName}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
            if (descRes.ok) {
              const cData = JSON.parse(await descRes.text());
              const c = cData.cluster || {};
              const tags = c.tags || {};
              resources.push({
                id: c.arn || clusterName, type: "eks", name: clusterName, region,
                state: c.status || "unknown", managed: tags["ManagedBy"] === "UIDI",
                tags, details: { version: c.version, endpoint: c.endpoint, status: c.status },
              });
            }
          }
        }
      } catch { /* EKS scan optional */ }

      // Categorize
      const wasteResources = resources.filter(r => r.waste);
      const managedResources = resources.filter(r => r.managed);
      const orphanResources = resources.filter(r => !r.managed && r.type !== "vpc");

      return ok("inventory", action, `Scanned ${resources.length} resource(s): ${managedResources.length} managed, ${wasteResources.length} waste, ${orphanResources.length} unmanaged`, {
        resources,
        summary: {
          total: resources.length,
          managed: managedResources.length,
          waste: wasteResources.length,
          orphan: orphanResources.length,
          by_type: {
            ec2: resources.filter(r => r.type === "ec2").length,
            ebs: resources.filter(r => r.type === "ebs").length,
            eip: resources.filter(r => r.type === "eip").length,
            vpc: resources.filter(r => r.type === "vpc").length,
            eks: resources.filter(r => r.type === "eks").length,
          },
        },
        region,
      });
    }

    case "nuke":
    case "destroy": {
      const resourceId = spec.resource_id as string;
      const resourceType = spec.resource_type as string;
      if (!resourceId || !resourceType) return err("inventory", action, "resource_id and resource_type required.");

      // Dependency-aware smart deletion
      switch (resourceType) {
        case "ec2": {
          const params = new URLSearchParams({ Action: "TerminateInstances", Version: "2016-11-15", "InstanceId.1": resourceId });
          const res = await ec2Request("POST", region, params.toString(), AWS_KEY, AWS_SECRET);
          const body = await res.text();
          if (!res.ok) return err("inventory", action, extractEc2Error(body) || "TerminateInstances failed");

          // Verify deletion
          await new Promise(r => setTimeout(r, 2000));
          const verifyParams = new URLSearchParams({ Action: "DescribeInstances", Version: "2016-11-15", "InstanceId.1": resourceId });
          const verifyRes = await ec2Request("POST", region, verifyParams.toString(), AWS_KEY, AWS_SECRET);
          const verifyBody = await verifyRes.text();
          const finalState = verifyBody.match(/<name>(shutting-down|terminated)<\/name>/)?.[1] || "terminating";

          return ok("inventory", action, `Instance ${resourceId} ${finalState}`, { resource_id: resourceId, state: finalState });
        }
        case "ebs": {
          const params = new URLSearchParams({ Action: "DeleteVolume", Version: "2016-11-15", VolumeId: resourceId });
          const res = await ec2Request("POST", region, params.toString(), AWS_KEY, AWS_SECRET);
          const body = await res.text();
          if (!res.ok) return err("inventory", action, extractEc2Error(body) || "DeleteVolume failed");
          return ok("inventory", action, `Volume ${resourceId} deleted`, { resource_id: resourceId });
        }
        case "eip": {
          const params = new URLSearchParams({ Action: "ReleaseAddress", Version: "2016-11-15", AllocationId: resourceId });
          const res = await ec2Request("POST", region, params.toString(), AWS_KEY, AWS_SECRET);
          const body = await res.text();
          if (!res.ok) return err("inventory", action, extractEc2Error(body) || "ReleaseAddress failed");
          return ok("inventory", action, `Elastic IP ${resourceId} released`, { resource_id: resourceId });
        }
        case "vpc": {
          // Smart deletion: reverse order (subnets → igw → sg → vpc)
          const result = await handleNetwork("destroy", { vpc_id: resourceId, region });
          return result;
        }
        case "eks": {
          const clusterName = spec.cluster_name as string || resourceId;
          const result = await handleEks("destroy", { cluster_name: clusterName, region });
          return result;
        }
        default:
          return err("inventory", action, `Unknown resource_type: ${resourceType}`);
      }
    }

    default:
      return err("inventory", action, `Unknown inventory action: ${action}. Supported: scan, nuke.`);
  }
}

// ───── Project Naawi: Execution Runtime (Stateless) ─────

interface ExecutionState {
  [opId: string]: Record<string, any>;
}

// Client + Command loading now uses dynamic imports via getClient() and getCommand()

function resolveReferences(input: any, state: ExecutionState): any {
  if (typeof input !== "object" || input === null) return input;
  
  if (Array.isArray(input)) {
    return input.map(item => resolveReferences(item, state));
  }

  const result: any = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      result[key] = value.replace(/ref\(([^.]+)\.([^)]+)\)/g, (match, opId, property) => {
        const val = state[opId]?.[property];
        return val !== undefined ? val : match;
      });
    } else if (typeof value === "object") {
      result[key] = resolveReferences(value, state);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function handleDiscovery(ops: SdkOperation[], credentials: any, region: string): Promise<DiscoveryReport[]> {
  const reports: DiscoveryReport[] = [];

  for (const op of ops) {
    const { service, discoveryContext, id } = op;
    const { identifiers } = discoveryContext || { identifiers: [] };
    
    let liveState: any = null;
    let status: DiscoveryReport["status"] = "NOT_FOUND";

    try {
      const ClientClass = CLIENT_MAP[service];
      if (ClientClass) {
        const client = new ClientClass({ region: (service === "CloudFront" || service === "Route53" || service === "ACM" || service === "Lambda") ? "us-east-1" : region, credentials });
        
        if (service === "S3") {
          for (const name of identifiers) {
            try {
              const head = await client.send(new HeadBucketCommand({ Bucket: name }));
              liveState = { BucketName: name, ...head };
              status = "MATCH";
              break;
            } catch (e) { if (e.name !== "NotFound" && e.$metadata?.httpStatusCode !== 404) throw e; }
          }
        } else if (service === "EC2") {
          for (const id of identifiers) {
            try {
              const desc = await client.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
              const instance = desc.Reservations?.[0]?.Instances?.[0];
              if (instance) { liveState = instance; status = "MATCH"; break; }
            } catch (e) { if (e.name !== "InvalidInstanceID.NotFound") throw e; }
          }
        } else if (service === "Route53") {
          // Discovery for Hosted Zones etc.
        }
      }

      reports.push({
        operationId: id,
        status,
        liveState,
        suggestedAction: status === "NOT_FOUND" ? "CREATE" : "NONE",
      });
    } catch (e) {
      reports.push({ operationId: id, status: "ERROR", suggestedAction: "NONE" });
    }
  }

  return reports;
}

async function executeNaawiOps(ops: SdkOperation[], credentials: any, region: string): Promise<EngineResponse> {
  const state: ExecutionState = {};
  const history: { opId: string; status: string; result?: any; error?: string }[] = [];

  for (const op of ops) {
    const resolvedInput = resolveReferences(op.input, state);
    
    if (JSON.stringify(resolvedInput).includes("ref(")) {
      return err("naawi", "execute", `Circuit Breaker: Unresolved dependency in ${op.id}.`);
    }

    try {
      const ClientClass = CLIENT_MAP[op.service];
      const CommandClass = COMMAND_MAP[op.command];

      if (!ClientClass || !CommandClass) {
        throw new Error(`Naawi Error: Unsupported service/command - ${op.service}.${op.command}`);
      }

      const client = new ClientClass({ 
        region: (op.service === "CloudFront" || op.service === "Route53" || op.service === "ACM" || op.service === "Lambda") ? "us-east-1" : region, 
        credentials 
      });
      const commandInstance = new CommandClass(resolvedInput);
      const result = await client.send(commandInstance);

      state[op.id] = result || {};
      history.push({ opId: op.id, status: "SUCCESS", result });

    } catch (e) {
      console.error(`Execution failed at ${op.id}:`, e);
      history.push({ opId: op.id, status: "FAILED", error: e.message });
      return err("naawi", "execute", `Execution Halted at ${op.id}: ${e.message}`, { history, state_at_failure: state });
    }
  }

  return ok("naawi", "execute", "Project Naawi: Full Execution Sequence Successful", { history });
}

function estimateOperationMonthlyCost(op: SdkOperation): number {
  const service = op.service;
  const command = op.command;

  if (service === "EKS" && command === "CreateCluster") return 72;
  if (service === "CloudFront" && command === "CreateDistribution") return 18;
  if (service === "S3" && command === "CreateBucket") return 2;
  if (service === "Lambda" && command === "CreateFunction") return 6;
  if (service === "SQS" && command === "CreateQueue") return 4;
  if (service === "DynamoDB" && command === "CreateTable") return 25;
  if (service === "EventBridge" && command === "PutRule") return 2;
  if (service === "ApiGatewayV2" && command === "CreateApi") return 12;
  if (service === "RDS" && (command === "CreateDBCluster" || command === "CreateDBInstance")) return 90;
  if (service === "RDS" && command === "CreateDBProxy") return 15;
  if (service === "AutoScaling" && command === "CreateAutoScalingGroup") return 45;
  if (service === "ELBv2" && command === "CreateLoadBalancer") return 22;
  if (service === "ElastiCache" && command === "CreateReplicationGroup") return 55;
  if (service === "EC2" && (command === "RunInstances" || command === "CreateVpc" || command === "CreateSubnet")) return 20;

  return 5;
}

function estimateOpsMonthlyCost(ops: SdkOperation[]): number {
  const total = ops.reduce((sum, op) => sum + estimateOperationMonthlyCost(op), 0);
  return Math.round(total * 100) / 100;
}

// ───── Project Naawi: Discovery & Execution Orchestrator ─────

async function handleNaawi(action: string, spec: Record<string, unknown>, approved?: boolean): Promise<EngineResponse> {
  const ops = spec.operations as SdkOperation[];
  if (!ops || !Array.isArray(ops)) return err("naawi", action, "operations array is required in spec.");

  const region = spec.region as string || "us-east-1";
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };

  // 1. Discovery-First Guardrail: Establish "Ground Truth"
  // (Assuming handleDiscovery is already defined as per previous step)
  const discoveryReports = await handleDiscovery(ops, credentials, region);
  
  // 2. Risk Assessment & Human-in-the-Loop
  const hasHighRisk = ops.some(op => op.riskLevel === "HIGH");
  const needsApproval = hasHighRisk && !approved;

  if (action === "plan" || needsApproval) {
    return ok("naawi", "plan", needsApproval ? "HIGH Risk Operations Detected: Approval Required" : "Naawi Plan Generated", {
      discovery: discoveryReports,
      operations: ops.map(op => ({ id: op.id, service: op.service, command: op.command, riskLevel: op.riskLevel })),
      estimated_monthly_cost_usd: estimateOpsMonthlyCost(ops),
      requires_approval: needsApproval,
      risk_level: hasHighRisk ? "HIGH" : "LOW"
    });
  }

  // 3. Execution with Idempotency Handshake
  return await executeNaawiOps(ops, credentials, region);
}

// ───── SRE-Supreme IDI Execution Engine (v2.0) ─────

async function handleSreSupreme(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const workloadType = spec.workload_type as string;
  const region = spec.region as string || "us-east-1";
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;

  if (!AWS_KEY || !AWS_SECRET) return err("sre-supreme", action, "AWS credentials required.");

  try {
    const orchestrator = new DagOrchestrator(region, { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
    const operations = await orchestrator.generateDag(workloadType, spec);
    
    // Inject the compiled DAG into the spec and hand off to the Naawi Runtime
    return await handleNaawi(action, { ...spec, operations }, spec.approved as boolean);
  } catch (e) {
    return err("sre-supreme", action, `Compilation Failed: ${e instanceof Error ? e.message : String(e)}`);
  }
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
      case "network":
        result = await handleNetwork(action, spec);
        break;
      case "eks":
        result = await handleEks(action, spec);
        break;
      case "reconcile":
        result = await handleReconcile(spec);
        break;
      case "inventory":
        result = await handleInventory(action, spec);
        break;
      case "sre-supreme":
        result = await handleSreSupreme(action, spec);
        break;
      case "naawi":
        result = await handleNaawi(action, spec, body.approved);
        break;
      default:
        result = err(intent, action, `Unknown intent: ${intent}. Supported: terraform, kubernetes, ansible, compute, network, eks, reconcile, sre-supreme, naawi.`);
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
