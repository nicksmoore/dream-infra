import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * EKS Poller — Background worker that polls EKS cluster status
 * and updates the deployments table when async operations complete.
 * 
 * Called on a schedule (pg_cron) or manually by the UI.
 * Finds deployments with status "running" that have pending EKS steps,
 * checks AWS for cluster status, and updates accordingly.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID")!;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY")!;

  if (!AWS_KEY || !AWS_SECRET) {
    return new Response(JSON.stringify({ error: "AWS credentials not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Accept optional deployment_id + step_id for targeted polling
  let targetDeploymentId: string | null = null;
  let targetStepId: string | null = null;
  try {
    const body = await req.json();
    targetDeploymentId = body.deployment_id || null;
    targetStepId = body.step_id || null;
  } catch { /* no body — scan all */ }

  // Find running deployments with pending async EKS steps
  let query = supabase
    .from("deployments")
    .select("*")
    .in("status", ["running", "partial_failure"]);

  if (targetDeploymentId) {
    query = query.eq("id", targetDeploymentId);
  }

  const { data: deployments, error: fetchErr } = await query.limit(20);

  if (fetchErr || !deployments?.length) {
    return new Response(JSON.stringify({ message: "No active deployments to poll", checked: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ deployment_id: string; step_id: string; status: string; message: string }> = [];

  for (const deployment of deployments) {
    const steps = deployment.steps as any[];
    const stepOutputs = (deployment.step_outputs || {}) as Record<string, any>;
    let modified = false;

    for (const step of steps) {
      // Only poll steps that are in "running" status with async_job flag
      if (step.status !== "running") continue;
      if (targetStepId && step.id !== targetStepId) continue;

      const output = stepOutputs[step.id];
      if (!output?.async_job) continue;

      const clusterName = output.cluster_name as string;
      const region = output.region as string || deployment.region || "us-east-1";

      if (!clusterName) continue;

      console.log(`Polling EKS cluster: ${clusterName} in ${region} for deployment ${deployment.id}`);

      try {
        const clusterStatus = await describeCluster(clusterName, region, AWS_KEY, AWS_SECRET);

        if (clusterStatus === "ACTIVE") {
          step.status = "done";
          step.output = `Cluster ${clusterName} is ACTIVE`;
          stepOutputs[step.id] = { ...output, status: "ACTIVE", async_complete: true };
          modified = true;
          results.push({ deployment_id: deployment.id, step_id: step.id, status: "ACTIVE", message: `Cluster ${clusterName} is now ACTIVE` });
        } else if (clusterStatus === "FAILED") {
          step.status = "error";
          step.output = `Cluster ${clusterName} FAILED`;
          stepOutputs[step.id] = { ...output, status: "FAILED", async_complete: true };
          modified = true;
          results.push({ deployment_id: deployment.id, step_id: step.id, status: "FAILED", message: `Cluster ${clusterName} FAILED` });
        } else {
          // Still creating
          results.push({ deployment_id: deployment.id, step_id: step.id, status: clusterStatus, message: `Still ${clusterStatus}` });
        }
      } catch (e) {
        console.error(`Poll error for ${clusterName}:`, e);
        results.push({ deployment_id: deployment.id, step_id: step.id, status: "poll_error", message: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    if (modified) {
      // Check if all steps are done or if there's a failure
      const allDone = steps.every((s: any) => s.status === "done");
      const hasFailed = steps.some((s: any) => s.status === "error");
      const newStatus = allDone ? "completed" : hasFailed ? "partial_failure" : "running";

      await supabase
        .from("deployments")
        .update({
          steps,
          step_outputs: stepOutputs,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deployment.id);
    }
  }

  return new Response(JSON.stringify({ polled: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// ───── Minimal SigV4 EKS DescribeCluster ─────

async function describeCluster(name: string, region: string, accessKey: string, secretKey: string): Promise<string> {
  const host = `eks.${region}.amazonaws.com`;
  const path = `/clusters/${encodeURIComponent(name)}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    Host: host,
    "X-Amz-Date": amzDate,
  };

  const payloadHash = await sha256Hex("");
  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]}`).join("\n") + "\n";
  const signedHeadersStr = signedHeaderKeys.join(";");

  const canonicalRequest = ["GET", path, "", canonicalHeaders, signedHeadersStr, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/eks/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "eks");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  const res = await fetch(`https://${host}${path}`, { method: "GET", headers });
  const body = await res.text();
  if (!res.ok) throw new Error(`DescribeCluster failed (${res.status}): ${body.slice(0, 300)}`);
  const data = JSON.parse(body);
  return data.cluster?.status || "UNKNOWN";
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const keyBuffer = key instanceof Uint8Array ? (key.buffer as ArrayBuffer) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function hmacSha256Hex(key: Uint8Array | ArrayBuffer, data: string): Promise<string> {
  const sig = await hmacSha256(key, data);
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
