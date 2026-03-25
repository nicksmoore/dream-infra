// eval-engine/aws-inspector.ts
// Read-only AWS API inspector for eval-engine.
// Uses the same SigV4 signing pattern as uidi-engine — no AWS SDK.

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface ResourceInspection {
  exists: boolean;
  details: Record<string, unknown>; // API response fields relevant to scoring
  error?: string;
}

export interface InspectionResult {
  deploymentId: string;
  archetype: string;
  resources: Record<string, ResourceInspection>;
  inspectedAt: string;
}

// ─── SigV4 (copied verbatim from uidi-engine pattern) ───

async function awsSignedRequest(opts: {
  service: string;
  region: string;
  method: string;
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  body?: string;
  extraHeaders?: Record<string, string>;
  hostOverride?: string;
}): Promise<Response> {
  const host = opts.hostOverride || `${opts.service}.${opts.region}.amazonaws.com`;

  const qIdx = opts.path.indexOf("?");
  const canonicalUri = qIdx >= 0 ? opts.path.slice(0, qIdx) : opts.path;
  const queryString = qIdx >= 0 ? opts.path.slice(qIdx + 1) : "";
  const sortedQS = queryString
    ? queryString.split("&").map(p => p.includes("=") ? p : `${p}=`).sort().join("&")
    : "";

  const url = `https://${host}${opts.path}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const bodyHash = await sha256Hex(opts.body || "");

  const headers: Record<string, string> = {
    Host: host,
    "X-Amz-Date": amzDate,
    "x-amz-content-sha256": bodyHash,
    ...(opts.extraHeaders || {}),
  };

  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders =
    signedHeaderKeys
      .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]}`)
      .join("\n") + "\n";
  const signedHeadersStr = signedHeaderKeys.join(";");

  const canonicalRequest = [
    opts.method, canonicalUri, sortedQS, canonicalHeaders, signedHeadersStr, bodyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${opts.secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, opts.region);
  const kService = await hmacSha256(kRegion, opts.service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  headers["Authorization"] =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return fetch(url, { method: opts.method, headers, body: opts.body || undefined });
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, data: string): Promise<Uint8Array> {
  const keyBuffer = key instanceof Uint8Array ? (key.buffer as ArrayBuffer) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)));
}

async function hmacSha256Hex(key: Uint8Array | ArrayBuffer, data: string): Promise<string> {
  const sig = await hmacSha256(key, data);
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── Resource name derivation ───

function baseNameFromDeploymentId(deploymentId: string): string {
  // "deploy_<ts>_<archetype>" → "<archetype>" lowercased
  return deploymentId.split("_").slice(2).join("-").toLowerCase();
}

// ─── Per-service inspectors ───

async function inspectEks(
  baseName: string,
  creds: AwsCredentials,
): Promise<ResourceInspection> {
  try {
    const res = await awsSignedRequest({
      service: "eks",
      region: creds.region,
      method: "GET",
      path: `/clusters/${encodeURIComponent(baseName)}`,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    });

    if (res.status === 404) return { exists: false, details: {} };
    if (!res.ok) {
      const text = await res.text();
      return { exists: false, details: {}, error: `EKS ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json() as Record<string, any>;
    const cluster = data.cluster ?? {};
    return {
      exists: true,
      details: {
        encryptionAtRest: Array.isArray(cluster.encryptionConfig) && cluster.encryptionConfig.length > 0,
        securityGroupCount: (cluster.resourcesVpcConfig?.securityGroupIds ?? []).length,
        status: cluster.status,
      },
    };
  } catch (e) {
    return { exists: false, details: {}, error: String(e) };
  }
}

async function inspectS3(
  baseName: string,
  creds: AwsCredentials,
): Promise<ResourceInspection> {
  const bucket = baseName;
  const host = `s3.${creds.region}.amazonaws.com`;

  try {
    // HeadBucket
    const headRes = await awsSignedRequest({
      service: "s3",
      region: creds.region,
      method: "HEAD",
      path: `/${bucket}`,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      hostOverride: host,
    });

    if (headRes.status === 404 || headRes.status === 403) {
      return { exists: headRes.status === 403, details: {} }; // 403 = exists but no access
    }
    if (!headRes.ok) {
      return { exists: false, details: {}, error: `S3 HeadBucket ${headRes.status}` };
    }

    // GetBucketEncryption
    const encRes = await awsSignedRequest({
      service: "s3",
      region: creds.region,
      method: "GET",
      path: `/${bucket}?encryption`,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      hostOverride: host,
    });

    const encryptionAtRest = encRes.ok;
    return { exists: true, details: { encryptionAtRest } };
  } catch (e) {
    return { exists: false, details: {}, error: String(e) };
  }
}

async function inspectLambda(
  baseName: string,
  creds: AwsCredentials,
): Promise<ResourceInspection> {
  try {
    const res = await awsSignedRequest({
      service: "lambda",
      region: creds.region,
      method: "GET",
      path: `/2015-03-31/functions/${encodeURIComponent(baseName)}`,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    });

    if (res.status === 404) return { exists: false, details: {} };
    if (!res.ok) {
      const text = await res.text();
      return { exists: false, details: {}, error: `Lambda ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json() as Record<string, any>;
    return {
      exists: true,
      details: {
        functionArn: data.Configuration?.FunctionArn,
        runtime: data.Configuration?.Runtime,
      },
    };
  } catch (e) {
    return { exists: false, details: {}, error: String(e) };
  }
}

async function inspectRds(creds: AwsCredentials): Promise<ResourceInspection> {
  try {
    const params = new URLSearchParams({
      Action: "DescribeDBInstances",
      Version: "2014-10-31",
    });
    const res = await awsSignedRequest({
      service: "rds",
      region: creds.region,
      method: "GET",
      path: `/?${params}`,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    });

    if (!res.ok) {
      const text = await res.text();
      return { exists: false, details: {}, error: `RDS ${res.status}: ${text.slice(0, 200)}` };
    }

    const xml = await res.text();
    const hasInstance = /<DBInstanceIdentifier>/.test(xml);
    const encryptionAtRest = /<StorageEncrypted>true<\/StorageEncrypted>/.test(xml);
    const multiAz = /<MultiAZ>true<\/MultiAZ>/.test(xml);

    return { exists: hasInstance, details: { encryptionAtRest, multiAz } };
  } catch (e) {
    return { exists: false, details: {}, error: String(e) };
  }
}

async function inspectElb(creds: AwsCredentials): Promise<ResourceInspection> {
  try {
    const params = new URLSearchParams({
      Action: "DescribeLoadBalancers",
      Version: "2015-12-01",
    });
    const res = await awsSignedRequest({
      service: "elasticloadbalancing",
      region: creds.region,
      method: "GET",
      path: `/?${params}`,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    });

    if (!res.ok) {
      const text = await res.text();
      return { exists: false, details: {}, error: `ELBv2 ${res.status}: ${text.slice(0, 200)}` };
    }

    const xml = await res.text();
    const hasLb = /<LoadBalancerArn>/.test(xml);
    return { exists: hasLb, details: {} };
  } catch (e) {
    return { exists: false, details: {}, error: String(e) };
  }
}

async function inspectApiGateway(creds: AwsCredentials): Promise<ResourceInspection> {
  try {
    const res = await awsSignedRequest({
      service: "apigateway",
      region: creds.region,
      method: "GET",
      path: "/v2/apis",
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    });

    if (!res.ok) {
      const text = await res.text();
      return { exists: false, details: {}, error: `ApiGW ${res.status}: ${text.slice(0, 200)}` };
    }

    const data = await res.json() as Record<string, any>;
    const items = data.Items ?? data.items ?? [];
    return { exists: items.length > 0, details: { apiCount: items.length } };
  } catch (e) {
    return { exists: false, details: {}, error: String(e) };
  }
}

async function inspectEc2(creds: AwsCredentials): Promise<ResourceInspection> {
  try {
    const params = new URLSearchParams({
      Action: "DescribeInstances",
      Version: "2016-11-15",
    });
    const res = await awsSignedRequest({
      service: "ec2",
      region: creds.region,
      method: "GET",
      path: `/?${params}`,
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    });

    if (!res.ok) {
      const text = await res.text();
      return { exists: false, details: {}, error: `EC2 ${res.status}: ${text.slice(0, 200)}` };
    }

    const xml = await res.text();
    const instanceMatches = xml.match(/<instanceId>/g);
    const instanceCount = instanceMatches ? instanceMatches.length : 0;
    const imdsv2Enforced = /<httpTokens>required<\/httpTokens>/.test(xml);

    return {
      exists: instanceCount > 0,
      details: { instanceCount, imdsv2Enforced },
    };
  } catch (e) {
    return { exists: false, details: {}, error: String(e) };
  }
}

// ─── Resource type mapping ───

function mapResourceToType(resource: string): string {
  const r = resource.toLowerCase();
  if (r.includes("eks") || r.includes("kubernetes") || r.includes("k8s")) return "eks";
  if (r.includes("s3") || r.includes("bucket")) return "s3";
  if (r.includes("lambda") || r.includes("function")) return "lambda";
  if (r.includes("rds") || r.includes("postgres") || r.includes("mysql") || r.includes("aurora")) return "rds";
  if (r.includes("elb") || r.includes("alb") || r.includes("load-balancer") || r.includes("nlb")) return "elb";
  if (r.includes("api-gateway") || r.includes("apigateway") || r.includes("apigw")) return "api-gateway";
  if (r.includes("ec2") || r.includes("instance")) return "ec2";
  return "unknown";
}

// ─── Main export ───

export async function inspectDeployment(
  deploymentId: string,
  archetype: string,
  requiredResources: string[],
  credentials: AwsCredentials,
  _securitySpec: {
    vaultIntegration: boolean;
    imdsv2Only: boolean;
    encryptionAtRest: boolean;
    securityContext: boolean;
  },
): Promise<InspectionResult> {
  const baseName = baseNameFromDeploymentId(deploymentId);

  // Deduplicate resource types
  const typesToInspect = new Set(requiredResources.map(mapResourceToType));

  const inspections = await Promise.allSettled(
    [...typesToInspect].map(async (type): Promise<[string, ResourceInspection]> => {
      switch (type) {
        case "eks":        return [type, await inspectEks(baseName, credentials)];
        case "s3":         return [type, await inspectS3(baseName, credentials)];
        case "lambda":     return [type, await inspectLambda(baseName, credentials)];
        case "rds":        return [type, await inspectRds(credentials)];
        case "elb":        return [type, await inspectElb(credentials)];
        case "api-gateway":return [type, await inspectApiGateway(credentials)];
        case "ec2":        return [type, await inspectEc2(credentials)];
        default:
          return [type, { exists: false, details: {}, error: `No inspector for resource type: ${type}` }];
      }
    })
  );

  const resources: Record<string, ResourceInspection> = {};
  for (const settled of inspections) {
    if (settled.status === "fulfilled") {
      const [type, inspection] = settled.value;
      resources[type] = inspection;
    }
  }

  return {
    deploymentId,
    archetype,
    resources,
    inspectedAt: new Date().toISOString(),
  };
}
