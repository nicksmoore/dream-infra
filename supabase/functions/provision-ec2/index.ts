import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// AWS Signature V4 implementation for EC2 API calls
function hmacSha256(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then((k) =>
    crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message))
  );
}

async function sha256(message: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string) {
  let kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  let kRegion = await hmacSha256(new Uint8Array(kDate), region);
  let kService = await hmacSha256(new Uint8Array(kRegion), service);
  let kSigning = await hmacSha256(new Uint8Array(kService), "aws4_request");
  return new Uint8Array(kSigning);
}

async function signedRequest(
  method: string,
  region: string,
  service: string,
  body: string,
  accessKey: string,
  secretKey: string
) {
  const host = `${service}.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeadersList = "content-type;host;x-amz-date";
  const payloadHash = await sha256(body);
  const canonicalRequest = `${method}\n/\n\n${canonicalHeaders}\n${signedHeadersList}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`;
  const signingKey = await getSignatureKey(secretKey, dateStamp, region, service);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));
  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  return fetch(endpoint, {
    method,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Amz-Date": amzDate,
      Authorization: authHeader,
    },
    body,
  });
}

// AMI lookup map (latest common AMIs per region — simplified for POC)
const AMI_MAP: Record<string, Record<string, string>> = {
  "us-east-1": {
    "amazon-linux-2023": "ami-0c02fb55956c7d316",
    ubuntu: "ami-0c7217cdde317cfec",
  },
  "us-west-2": {
    "amazon-linux-2023": "ami-017fecd1353bcc96e",
    ubuntu: "ami-03f65b8614a860c29",
  },
  "eu-west-1": {
    "amazon-linux-2023": "ami-0905a3c97561e0b69",
    ubuntu: "ami-0694d931cee176e7d",
  },
  "ap-southeast-1": {
    "amazon-linux-2023": "ami-0b825ad86f2aec8cc",
    ubuntu: "ami-078c1149d8ad719a7",
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { config, credentials } = await req.json();

    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
      return new Response(JSON.stringify({ error: "AWS credentials required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!config?.instanceType || !config?.region || !config?.os) {
      return new Response(JSON.stringify({ error: "Invalid configuration" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ami = AMI_MAP[config.region]?.[config.os];
    if (!ami) {
      return new Response(JSON.stringify({ error: `No AMI found for ${config.os} in ${config.region}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // RunInstances API call
    const params = new URLSearchParams({
      Action: "RunInstances",
      Version: "2016-11-15",
      ImageId: ami,
      InstanceType: config.instanceType,
      MinCount: "1",
      MaxCount: "1",
      "TagSpecification.1.ResourceType": "instance",
      "TagSpecification.1.Tag.1.Key": "Name",
      "TagSpecification.1.Tag.1.Value": `idi-${config.environment}-${Date.now()}`,
      "TagSpecification.1.Tag.2.Key": "ManagedBy",
      "TagSpecification.1.Tag.2.Value": "IDI-Console",
      "TagSpecification.1.Tag.3.Key": "Environment",
      "TagSpecification.1.Tag.3.Value": config.environment,
    });

    const response = await signedRequest(
      "POST",
      config.region,
      "ec2",
      params.toString(),
      credentials.accessKeyId,
      credentials.secretAccessKey
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error("EC2 API error:", response.status, responseText);
      // Parse AWS error
      const errorMatch = responseText.match(/<Message>(.*?)<\/Message>/);
      const errorMsg = errorMatch ? errorMatch[1] : "EC2 API error";
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse instance ID from XML response
    const instanceIdMatch = responseText.match(/<instanceId>(i-[a-f0-9]+)<\/instanceId>/);
    const instanceId = instanceIdMatch ? instanceIdMatch[1] : "unknown";

    // For POC, public IP comes later (instance needs to be in running state)
    return new Response(
      JSON.stringify({
        instanceId,
        publicIp: "Pending (check AWS console)",
        status: "launched",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("provision-ec2 error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
