import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// AWS Signature V4
function hmacSha256(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  return crypto.subtle.importKey("raw", key.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then((k) =>
    crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message))
  );
}

async function sha256(message: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string) {
  let kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  let kRegion = await hmacSha256(new Uint8Array(kDate), region);
  let kService = await hmacSha256(new Uint8Array(kRegion), service);
  let kSigning = await hmacSha256(new Uint8Array(kService), "aws4_request");
  return new Uint8Array(kSigning);
}

async function signedRequest(method: string, region: string, service: string, body: string, accessKey: string, secretKey: string) {
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

// AMI lookup map
const AMI_MAP: Record<string, Record<string, string>> = {
  "us-east-1": { "amazon-linux-2023": "ami-0c02fb55956c7d316", ubuntu: "ami-0c7217cdde317cfec", debian: "ami-0b6d6dac03916517a", rhel: "ami-0583d8c7a9c35822c", suse: "ami-0e2e44c03b85f58b3", "windows-2022": "ami-0069eac59d05ae12b", "windows-2019": "ami-0c2b0d3fb02824d92" },
  "us-east-2": { "amazon-linux-2023": "ami-0ea3c35c5c3284d82", ubuntu: "ami-0b8b44ec9a8f90422", debian: "ami-0e3f6d14addf8e4ae", rhel: "ami-0aa8fc2422c7862c0", suse: "ami-0c4b3e0c3e6e0c5c7" },
  "us-west-1": { "amazon-linux-2023": "ami-0f8e81a3da6e2510a", ubuntu: "ami-0ce2cb35386fc22e9" },
  "us-west-2": { "amazon-linux-2023": "ami-017fecd1353bcc96e", ubuntu: "ami-03f65b8614a860c29", debian: "ami-0b6d6dac03916517a", rhel: "ami-0583d8c7a9c35822c", suse: "ami-0e2e44c03b85f58b3", "windows-2022": "ami-0069eac59d05ae12b", "windows-2019": "ami-0c2b0d3fb02824d92" },
  "eu-west-1": { "amazon-linux-2023": "ami-0905a3c97561e0b69", ubuntu: "ami-0694d931cee176e7d", debian: "ami-0b6d6dac03916517a", rhel: "ami-0583d8c7a9c35822c" },
  "eu-west-2": { "amazon-linux-2023": "ami-0e5f882be1900e43b", ubuntu: "ami-0b9932f4918a00c4f" },
  "eu-west-3": { "amazon-linux-2023": "ami-0c55b159cbfafe1f0", ubuntu: "ami-0302fddaa4b64df6f" },
  "eu-central-1": { "amazon-linux-2023": "ami-0faab6bdbac9486fb", ubuntu: "ami-0faab6bdbac9486fb", debian: "ami-0b6d6dac03916517a", rhel: "ami-0583d8c7a9c35822c" },
  "eu-north-1": { "amazon-linux-2023": "ami-0014ce3e52a4f92d6", ubuntu: "ami-089146c5626baa6bf" },
  "ap-southeast-1": { "amazon-linux-2023": "ami-0b825ad86f2aec8cc", ubuntu: "ami-078c1149d8ad719a7", debian: "ami-0b6d6dac03916517a" },
  "ap-southeast-2": { "amazon-linux-2023": "ami-0310483fb2b488153", ubuntu: "ami-04f5097681773b989" },
  "ap-northeast-1": { "amazon-linux-2023": "ami-0d52744d6551d851e", ubuntu: "ami-07c589821f2b353aa" },
  "ap-northeast-2": { "amazon-linux-2023": "ami-0c9c942bd7bf113a2", ubuntu: "ami-0f3a440bbcff3d043" },
  "ap-south-1": { "amazon-linux-2023": "ami-0614680123427b75e", ubuntu: "ami-03f4878755434977f" },
  "sa-east-1": { "amazon-linux-2023": "ami-0af6e9042ea5a4e3e", ubuntu: "ami-0b6c2d49148000cd5" },
  "ca-central-1": { "amazon-linux-2023": "ami-0c4596ce1e7ae33ce", ubuntu: "ami-0a2e7efb4257c0907" },
  "af-south-1": { "amazon-linux-2023": "ami-0e3fa363aed69e2e3", ubuntu: "ami-0ab979de35c897a26" },
  "me-south-1": { "amazon-linux-2023": "ami-0b4946d7d1e45a7f8", ubuntu: "ami-0c00b4c6b4f54e7a0" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { config, credentials } = await req.json();

    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
      return new Response(JSON.stringify({ error: "AWS credentials required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!config?.instanceType || !config?.region || !config?.os) {
      return new Response(JSON.stringify({ error: "Invalid configuration" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ami = AMI_MAP[config.region]?.[config.os];
    if (!ami) {
      return new Response(JSON.stringify({ error: `No AMI found for ${config.os} in ${config.region}. Try us-east-1 or us-west-2 for full OS support.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const minCount = config.instanceCount ?? 1;
    const maxCount = config.instanceCount ?? 1;

    // Build RunInstances parameters
    const params = new URLSearchParams({
      Action: "RunInstances",
      Version: "2016-11-15",
      ImageId: ami,
      InstanceType: config.instanceType,
      MinCount: String(minCount),
      MaxCount: String(maxCount),
    });

    // Tags
    params.set("TagSpecification.1.ResourceType", "instance");
    params.set("TagSpecification.1.Tag.1.Key", "Name");
    params.set("TagSpecification.1.Tag.1.Value", `idi-${config.environment}-${Date.now()}`);
    params.set("TagSpecification.1.Tag.2.Key", "ManagedBy");
    params.set("TagSpecification.1.Tag.2.Value", "IDI-Console");
    params.set("TagSpecification.1.Tag.3.Key", "Environment");
    params.set("TagSpecification.1.Tag.3.Value", config.environment);

    // Key pair
    if (config.keyName) {
      params.set("KeyName", config.keyName);
    }

    // Security groups
    if (config.securityGroupIds?.length) {
      config.securityGroupIds.forEach((sg: string, i: number) => {
        params.set(`SecurityGroupId.${i + 1}`, sg);
      });
    }

    // Subnet
    if (config.subnetId) {
      params.set("SubnetId", config.subnetId);
    }

    // Private IP
    if (config.privateIpAddress) {
      params.set("PrivateIpAddress", config.privateIpAddress);
    }

    // User data (base64 encoded)
    if (config.userData) {
      const encoded = btoa(config.userData);
      params.set("UserData", encoded);
    }

    // IAM Instance Profile
    if (config.iamInstanceProfile) {
      if (config.iamInstanceProfile.startsWith("arn:")) {
        params.set("IamInstanceProfile.Arn", config.iamInstanceProfile);
      } else {
        params.set("IamInstanceProfile.Name", config.iamInstanceProfile);
      }
    }

    // Monitoring (detailed)
    if (config.detailedMonitoring) {
      params.set("Monitoring.Enabled", "true");
    }

    // EBS Optimized
    if (config.ebsOptimized !== undefined) {
      params.set("EbsOptimized", String(config.ebsOptimized));
    }

    // Shutdown behavior
    if (config.shutdownBehavior) {
      params.set("InstanceInitiatedShutdownBehavior", config.shutdownBehavior);
    }

    // Termination protection
    if (config.terminationProtection) {
      params.set("DisableApiTermination", "true");
    }

    // Credit specification (for burstable instances)
    if (config.creditSpecification && config.instanceType.startsWith("t")) {
      params.set("CreditSpecification.CpuCredits", config.creditSpecification);
    }

    // Placement
    if (config.tenancy && config.tenancy !== "default") {
      params.set("Placement.Tenancy", config.tenancy);
    }
    if (config.placementGroupName) {
      params.set("Placement.GroupName", config.placementGroupName);
    }

    // Metadata options (IMDSv2)
    if (config.httpTokens) {
      params.set("MetadataOptions.HttpTokens", config.httpTokens);
      params.set("MetadataOptions.HttpEndpoint", config.httpEndpoint !== false ? "enabled" : "disabled");
      params.set("MetadataOptions.HttpPutResponseHopLimit", "2");
    }

    // Block device mapping (root volume)
    if (config.rootVolumeSize || config.rootVolumeType) {
      const deviceName = config.os?.startsWith("windows") ? "/dev/sda1" : "/dev/xvda";
      params.set("BlockDeviceMapping.1.DeviceName", deviceName);
      params.set("BlockDeviceMapping.1.Ebs.VolumeSize", String(config.rootVolumeSize ?? 20));
      params.set("BlockDeviceMapping.1.Ebs.VolumeType", config.rootVolumeType ?? "gp3");
      params.set("BlockDeviceMapping.1.Ebs.DeleteOnTermination", String(config.deleteOnTermination ?? true));

      if (config.rootVolumeEncrypted) {
        params.set("BlockDeviceMapping.1.Ebs.Encrypted", "true");
      }

      if (config.rootVolumeIops && ["io1", "io2", "gp3"].includes(config.rootVolumeType ?? "gp3")) {
        params.set("BlockDeviceMapping.1.Ebs.Iops", String(config.rootVolumeIops));
      }

      if (config.rootVolumeThroughput && config.rootVolumeType === "gp3") {
        params.set("BlockDeviceMapping.1.Ebs.Throughput", String(config.rootVolumeThroughput));
      }
    }

    // Additional volumes
    if (config.additionalVolumes?.length) {
      config.additionalVolumes.forEach((vol: any, i: number) => {
        const idx = i + 2; // 1-indexed, root is 1
        params.set(`BlockDeviceMapping.${idx}.DeviceName`, vol.deviceName);
        params.set(`BlockDeviceMapping.${idx}.Ebs.VolumeSize`, String(vol.volumeSize));
        params.set(`BlockDeviceMapping.${idx}.Ebs.VolumeType`, vol.volumeType || "gp3");
        params.set(`BlockDeviceMapping.${idx}.Ebs.DeleteOnTermination`, String(vol.deleteOnTermination ?? true));
        if (vol.encrypted) params.set(`BlockDeviceMapping.${idx}.Ebs.Encrypted`, "true");
        if (vol.iops) params.set(`BlockDeviceMapping.${idx}.Ebs.Iops`, String(vol.iops));
        if (vol.throughput) params.set(`BlockDeviceMapping.${idx}.Ebs.Throughput`, String(vol.throughput));
      });
    }

    // Spot instance
    if (config.purchaseOption === "spot") {
      params.set("InstanceMarketOptions.MarketType", "spot");
      if (config.spotMaxPrice) {
        params.set("InstanceMarketOptions.SpotOptions.MaxPrice", config.spotMaxPrice);
      }
      params.set("InstanceMarketOptions.SpotOptions.SpotInstanceType", "one-time");
    }

    // Network interface for public IP (only when subnet is specified)
    if (config.subnetId && config.associatePublicIp !== undefined) {
      // When specifying subnet + public IP, use network interface
      params.delete("SubnetId");
      params.delete("SecurityGroupId.1");
      params.set("NetworkInterface.1.DeviceIndex", "0");
      params.set("NetworkInterface.1.SubnetId", config.subnetId);
      params.set("NetworkInterface.1.AssociatePublicIpAddress", String(config.associatePublicIp));
      if (config.privateIpAddress) {
        params.delete("PrivateIpAddress");
        params.set("NetworkInterface.1.PrivateIpAddress", config.privateIpAddress);
      }
      if (config.securityGroupIds?.length) {
        config.securityGroupIds.forEach((sg: string, i: number) => {
          params.delete(`SecurityGroupId.${i + 1}`);
          params.set(`NetworkInterface.1.SecurityGroupId.${i + 1}`, sg);
        });
      }
    }

    console.log("RunInstances params:", Object.fromEntries(params));

    const response = await signedRequest("POST", config.region, "ec2", params.toString(), credentials.accessKeyId, credentials.secretAccessKey);
    const responseText = await response.text();

    if (!response.ok) {
      console.error("EC2 API error:", response.status, responseText);
      const errorMatch = responseText.match(/<Message>(.*?)<\/Message>/);
      const errorMsg = errorMatch ? errorMatch[1] : "EC2 API error";
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse instance IDs from XML
    const instanceIds = [...responseText.matchAll(/<instanceId>(i-[a-f0-9]+)<\/instanceId>/g)].map(m => m[1]);
    const instanceId = instanceIds.length > 0 ? instanceIds.join(", ") : "unknown";

    return new Response(
      JSON.stringify({
        instanceId,
        instanceIds,
        publicIp: "Pending (check AWS console)",
        status: "launched",
        count: instanceIds.length,
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
