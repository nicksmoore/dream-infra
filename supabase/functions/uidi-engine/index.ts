import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DagOrchestrator, SdkOperation } from "./dag-orchestrator.ts";
import { dolt, DoltResource } from "./dolt-client.ts";
import type { PreparedRequest, PreparedOperation } from "./manifest-types.ts";
import { ManifestError, buildRestRequest } from "./manifest-engine.ts";
import { prepareOperation } from "./manifest-engine.ts";

// ───── Raw AWS API Executor (zero SDK dependencies) ─────
// All AWS calls use SigV4-signed HTTP requests via awsSignedRequest().

interface ServiceConfig {
  signingService: string;
  host: (region: string) => string;
  apiStyle: "json-target" | "rest-json" | "s3" | "rest-xml" | "query";
  targetPrefix?: string;
  apiVersion?: string;
  jsonVersion?: string;
}

const SERVICE_CONFIG: Record<string, ServiceConfig> = {
  S3:            { signingService: "s3",   host: r => `s3.${r}.amazonaws.com`, apiStyle: "s3" },
  CloudFront:    { signingService: "cloudfront", host: () => "cloudfront.amazonaws.com", apiStyle: "rest-xml" },
  Route53:       { signingService: "route53", host: () => "route53.amazonaws.com", apiStyle: "rest-xml" },
  Lambda:        { signingService: "lambda", host: r => `lambda.${r}.amazonaws.com`, apiStyle: "rest-json" },
  ACM:           { signingService: "acm", host: r => `acm.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "CertificateManager", jsonVersion: "1.1" },
  EKS:           { signingService: "eks", host: r => `eks.${r}.amazonaws.com`, apiStyle: "rest-json" },
  AppMesh:       { signingService: "appmesh", host: r => `appmesh.${r}.amazonaws.com`, apiStyle: "rest-json" },
  SQS:           { signingService: "sqs", host: r => `sqs.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "AmazonSQS", jsonVersion: "1.0" },
  DynamoDB:      { signingService: "dynamodb", host: r => `dynamodb.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "DynamoDB_20120810", jsonVersion: "1.0" },
  EventBridge:   { signingService: "events", host: r => `events.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "AWSEvents", jsonVersion: "1.1" },
  ApiGatewayV2:  { signingService: "apigateway", host: r => `apigateway.${r}.amazonaws.com`, apiStyle: "rest-json" },
  RDS:           { signingService: "rds", host: r => `rds.${r}.amazonaws.com`, apiStyle: "query", apiVersion: "2014-10-31" },
  EC2:           { signingService: "ec2", host: r => `ec2.${r}.amazonaws.com`, apiStyle: "query", apiVersion: "2016-11-15" },
  AutoScaling:   { signingService: "autoscaling", host: r => `autoscaling.${r}.amazonaws.com`, apiStyle: "query", apiVersion: "2011-01-01" },
  ELBv2:         { signingService: "elasticloadbalancing", host: r => `elasticloadbalancing.${r}.amazonaws.com`, apiStyle: "query", apiVersion: "2015-12-01" },
  ElastiCache:   { signingService: "elasticache", host: r => `elasticache.${r}.amazonaws.com`, apiStyle: "query", apiVersion: "2015-02-02" },
  IAM:           { signingService: "iam", host: () => "iam.amazonaws.com", apiStyle: "query", apiVersion: "2010-05-08" },
  STS:           { signingService: "sts", host: r => `sts.${r}.amazonaws.com`, apiStyle: "query", apiVersion: "2011-06-15" },
  SNS:           { signingService: "sns", host: r => `sns.${r}.amazonaws.com`, apiStyle: "query", apiVersion: "2010-03-31" },
  CloudWatch:    { signingService: "monitoring", host: r => `monitoring.${r}.amazonaws.com`, apiStyle: "query", apiVersion: "2010-08-01" },
  CloudWatchLogs:{ signingService: "logs", host: r => `logs.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "Logs_20140328", jsonVersion: "1.1" },
  KMS:           { signingService: "kms", host: r => `kms.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "TrentService", jsonVersion: "1.1" },
  SecretsManager:{ signingService: "secretsmanager", host: r => `secretsmanager.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "secretsmanager", jsonVersion: "1.1" },
  SSM:           { signingService: "ssm", host: r => `ssm.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "AmazonSSM", jsonVersion: "1.1" },
  EFS:           { signingService: "elasticfilesystem", host: r => `elasticfilesystem.${r}.amazonaws.com`, apiStyle: "rest-json" },
  AppRunner:     { signingService: "apprunner", host: r => `apprunner.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "AppRunner", jsonVersion: "1.0" },
  WAFV2:         { signingService: "wafv2", host: r => `wafv2.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "AWSWAF_20190729", jsonVersion: "1.1" },
  GuardDuty:     { signingService: "guardduty", host: r => `guardduty.${r}.amazonaws.com`, apiStyle: "rest-json" },
  SecurityHub:   { signingService: "securityhub", host: r => `securityhub.${r}.amazonaws.com`, apiStyle: "rest-json" },
  CloudTrail:    { signingService: "cloudtrail", host: r => `cloudtrail.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101", jsonVersion: "1.1" },
  ConfigService: { signingService: "config", host: r => `config.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "StarlingDoveService", jsonVersion: "1.1" },
  StepFunctions: { signingService: "states", host: r => `states.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "AmazonStatesService", jsonVersion: "1.0" },
  Bedrock:       { signingService: "bedrock", host: r => `bedrock.${r}.amazonaws.com`, apiStyle: "rest-json" },
  ECS:           { signingService: "ecs", host: r => `ecs.${r}.amazonaws.com`, apiStyle: "json-target", targetPrefix: "AmazonEC2ContainerServiceV20141113", jsonVersion: "1.1" },
};

// REST command routing for path-based APIs
const REST_ROUTES: Record<string, Record<string, { method: string; path: (i: any) => string }>> = {
  Lambda: {
    CreateFunction:          { method: "POST", path: () => "/2015-03-31/functions" },
    PublishVersion:          { method: "POST", path: i => `/2015-03-31/functions/${encodeURIComponent(i.FunctionName)}/versions` },
    PutFunctionConcurrency:  { method: "PUT",  path: i => `/2015-03-31/functions/${encodeURIComponent(i.FunctionName)}/concurrency` },
    GetFunction:             { method: "GET",  path: i => `/2015-03-31/functions/${encodeURIComponent(i.FunctionName)}` },
    DeleteFunction:          { method: "DELETE", path: i => `/2015-03-31/functions/${encodeURIComponent(i.FunctionName)}` },
    CreateEventSourceMapping:{ method: "POST", path: () => "/2015-03-31/event-source-mappings" },
    AddPermission:           { method: "POST", path: i => `/2015-03-31/functions/${encodeURIComponent(i.FunctionName)}/policy` },
    ListFunctions:           { method: "GET", path: () => "/2015-03-31/functions" },
  },
  EKS: {
    CreateCluster:   { method: "POST", path: () => "/clusters" },
    DescribeCluster: { method: "GET",  path: i => `/clusters/${encodeURIComponent(i.name)}` },
    DeleteCluster:   { method: "DELETE", path: i => `/clusters/${encodeURIComponent(i.name)}` },
    CreateNodegroup: { method: "POST", path: i => `/clusters/${encodeURIComponent(i.clusterName)}/node-groups` },
  },
  AppMesh: {
    CreateMesh:        { method: "PUT", path: () => "/v20190125/meshes" },
    CreateVirtualNode: { method: "PUT", path: i => `/v20190125/meshes/${encodeURIComponent(i.meshName)}/virtualNodes` },
    DescribeMesh:      { method: "GET", path: i => `/v20190125/meshes/${encodeURIComponent(i.meshName)}` },
  },
  ApiGatewayV2: {
    CreateApi:  { method: "POST", path: () => "/v2/apis" },
    DeleteApi:  { method: "DELETE", path: i => `/v2/apis/${i.ApiId}` },
    GetApis:    { method: "GET",  path: () => "/v2/apis" },
    GetApi:     { method: "GET",  path: (i: any) => `/v2/apis/${i.ApiId}` },
  },
  EFS: {
    CreateFileSystem:    { method: "POST",   path: () => "/2015-02-01/file-systems" },
    DescribeFileSystems: { method: "GET",    path: () => "/2015-02-01/file-systems" },
    DeleteFileSystem:    { method: "DELETE", path: (i: any) => `/2015-02-01/file-systems/${i.FileSystemId}` },
  },
  GuardDuty: {
    CreateDetector: { method: "POST",   path: () => "/detector" },
    ListDetectors:  { method: "GET",    path: () => "/detector" },
    GetDetector:    { method: "GET",    path: (i: any) => `/detector/${i.DetectorId}` },
    DeleteDetector: { method: "DELETE", path: (i: any) => `/detector/${i.DetectorId}` },
  },
  SecurityHub: {
    EnableSecurityHub: { method: "POST", path: () => "/accounts" },
    GetFindings:       { method: "POST", path: () => "/findings" },
  },
  Bedrock: {
    CreateProvisionedModelThroughput: { method: "POST",   path: () => "/provisioned-model-throughput" },
    ListFoundationModels:             { method: "GET",    path: () => "/foundation-models" },
    GetProvisionedModelThroughput:    { method: "GET",    path: (i: any) => `/provisioned-model-throughput/${i.ProvisionedModelId}` },
    DeleteProvisionedModelThroughput: { method: "DELETE", path: (i: any) => `/provisioned-model-throughput/${i.ProvisionedModelId}` },
  },
};

// S3 command routing
const S3_ROUTES: Record<string, { method: string; path: (i: any) => string; queryString?: string }> = {
  CreateBucket:     { method: "PUT",  path: i => `/${i.Bucket}` },
  PutBucketPolicy:  { method: "PUT",  path: i => `/${i.Bucket}`, queryString: "policy" },
  HeadBucket:       { method: "HEAD", path: i => `/${i.Bucket}` },
  DeleteBucket:     { method: "DELETE", path: i => `/${i.Bucket}` },
  PutObject:        { method: "PUT",  path: i => `/${i.Bucket}/${i.Key}` },
  DeleteObject:     { method: "DELETE", path: i => `/${i.Bucket}/${i.Key}` },
  ListObjectsV2:    { method: "GET",  path: i => `/${i.Bucket}`, queryString: "list-type=2" },
  ListBuckets:               { method: "GET",  path: () => "/" },
  GetBucketVersioning:       { method: "GET",  path: (i: any) => `/${i.Bucket}`, queryString: "versioning" },
  PutBucketVersioning:       { method: "PUT",  path: (i: any) => `/${i.Bucket}`, queryString: "versioning" },
  PutObjectLockConfiguration: { method: "PUT", path: (i: any) => `/${i.Bucket}`, queryString: "object-lock" },
};

// CloudFront XML request builder
function buildCloudFrontRequest(command: string, input: any): { method: string; path: string; body?: string } {
  const xmlns = "http://cloudfront.amazonaws.com/doc/2020-05-31/";
  switch (command) {
    case "CreateOriginAccessControl":
      return { method: "POST", path: "/2020-05-31/origin-access-control", body: jsonToXml("OriginAccessControlConfig", input.OriginAccessControlConfig, xmlns) };
    case "CreateDistribution":
      return { method: "POST", path: "/2020-05-31/distribution", body: jsonToXml("DistributionConfig", input.DistributionConfig, xmlns) };
    case "CreateInvalidation":
      return { method: "POST", path: `/2020-05-31/distribution/${input.DistributionId}/invalidation`, body: jsonToXml("InvalidationBatch", input.InvalidationBatch, xmlns) };
    case "GetDistribution":
      return { method: "GET", path: `/2020-05-31/distribution/${input.Id}` };
    case "GetDistributionConfig":
      return { method: "GET", path: `/2020-05-31/distribution/${input.Id}/config` };
    case "UpdateDistribution":
      return { method: "PUT", path: `/2020-05-31/distribution/${input.Id}/config`, body: jsonToXml("DistributionConfig", input.DistributionConfig, xmlns) };
    case "DeleteDistribution":
      return { method: "DELETE", path: `/2020-05-31/distribution/${input.Id}` };
    case "ListDistributions":
      return { method: "GET", path: "/2020-05-31/distribution" };
    default:
      throw new Error(`No CloudFront mapping for ${command}`);
  }
}

// Route53 XML request builder
function buildRoute53Request(command: string, input: any): { method: string; path: string; body?: string } {
  const xmlns = "https://route53.amazonaws.com/doc/2013-04-01/";
  switch (command) {
    case "ChangeResourceRecordSets":
      return { method: "POST", path: `/2013-04-01/hostedzone/${input.HostedZoneId}/rrset`, body: jsonToXml("ChangeResourceRecordSetsRequest", { ChangeBatch: input.ChangeBatch }, xmlns) };
    case "ListHostedZones":
      return { method: "GET", path: "/2013-04-01/hostedzone" };
    case "CreateHostedZone":
      return { method: "POST", path: "/2013-04-01/hostedzone", body: jsonToXml("CreateHostedZoneRequest", { Name: input.Name, CallerReference: input.CallerReference }, xmlns) };
    case "DeleteHostedZone":
      return { method: "DELETE", path: `/2013-04-01/hostedzone/${input.Id}` };
    case "GetHostedZone":
      return { method: "GET", path: `/2013-04-01/hostedzone/${input.Id}` };
    case "ListResourceRecordSets":
      return { method: "GET", path: `/2013-04-01/hostedzone/${input.HostedZoneId}/rrset` };
    default:
      throw new Error(`No Route53 mapping for ${command}`);
  }
}

// JSON → XML converter for AWS REST-XML APIs
function jsonToXml(rootName: string, obj: any, xmlns?: string): string {
  const ns = xmlns ? ` xmlns="${xmlns}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${rootName}${ns}>${objToXml(obj)}</${rootName}>`;
}

function objToXml(obj: any): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return escapeXml(String(obj));
  if (Array.isArray(obj)) {
    return obj.map(item => {
      if (typeof item === "object" && item !== null) {
        return Object.entries(item).map(([k, v]) => `<${k}>${objToXml(v)}</${k}>`).join("");
      }
      return escapeXml(String(item));
    }).join("");
  }
  let xml = "";
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      xml += `<${key}>`;
      value.forEach(item => {
        const tag = key === "Items" ? guessItemTag(item) : key === "Changes" ? "Change" : "member";
        xml += `<${tag}>${typeof item === "object" ? objToXml(item) : escapeXml(String(item))}</${tag}>`;
      });
      xml += `</${key}>`;
    } else if (typeof value === "object") {
      xml += `<${key}>${objToXml(value)}</${key}>`;
    } else if (typeof value === "boolean") {
      xml += `<${key}>${value ? "true" : "false"}</${key}>`;
    } else {
      xml += `<${key}>${escapeXml(String(value))}</${key}>`;
    }
  }
  return xml;
}

function guessItemTag(item: any): string {
  if (typeof item !== "object") return "member";
  if (item.EventType) return "LambdaFunctionAssociation";
  if (item.Id && item.DomainName) return "Origin";
  if (item.Action && item.ResourceRecordSet) return "Change";
  return "member";
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Flatten nested objects to AWS Query API format
function flattenToQueryParams(obj: any, params: URLSearchParams, prefix = ""): void {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => flattenToQueryParams(item, params, `${prefix}.${i + 1}`));
    return;
  }
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      flattenToQueryParams(value, params, prefix ? `${prefix}.${key}` : key);
    }
    return;
  }
  params.set(prefix, String(obj));
}

// Parse XML responses into usable objects
function parseSimpleXmlResponse(xml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const patterns: Record<string, RegExp> = {
    VpcId: /<vpcId>([^<]+)<\/vpcId>/i,
    SubnetId: /<subnetId>([^<]+)<\/subnetId>/i,
    GroupId: /<groupId>([^<]+)<\/groupId>/i,
    InternetGatewayId: /<internetGatewayId>([^<]+)<\/internetGatewayId>/i,
    Id: /<Id>([^<]+)<\/Id>/,
    DomainName: /<DomainName>([^<]+)<\/DomainName>/,
    ARN: /<ARN>([^<]+)<\/ARN>/,
    QueueUrl: /<QueueUrl>([^<]+)<\/QueueUrl>/,
    BucketName: /<Name>([^<]+)<\/Name>/,
    FunctionArn: /<FunctionArn>([^<]+)<\/FunctionArn>/,
    FunctionName: /<FunctionName>([^<]+)<\/FunctionName>/,
    CertificateArn: /<CertificateArn>([^<]+)<\/CertificateArn>/,
    Status: /<Status>([^<]+)<\/Status>/,
    OriginAccessControlId: /<Id>([^<]+)<\/Id>/,
  };
  for (const [key, regex] of Object.entries(patterns)) {
    const match = xml.match(regex);
    if (match) result[key] = match[1];
  }
  // Nest for common response shapes
  if (result.Id) {
    result.Distribution = { Id: result.Id, DomainName: result.DomainName, ARN: result.ARN };
    result.OriginAccessControl = { Id: result.Id };
  }
  if (result.CertificateArn) {
    result.Certificate = { CertificateArn: result.CertificateArn, Status: result.Status };
  }
  return result;
}

// Waiter implementation (polls until condition met)
async function handleWaiter(
  service: string, command: string, input: any,
  region: string, credentials: { accessKeyId: string; secretAccessKey: string }
): Promise<any> {
  const maxAttempts = 40;
  const delayMs = 15000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (command === "WaitUntilCertificateValidated") {
        const result = await executeAwsCommand("ACM", "DescribeCertificate", { CertificateArn: input.CertificateArn }, region, credentials);
        if (result?.Certificate?.Status === "ISSUED") return result;
      } else if (command === "WaitUntilClusterActive") {
        const result = await executeAwsCommand("EKS", "DescribeCluster", { name: input.name }, region, credentials);
        if (result?.cluster?.status === "ACTIVE") return result;
      } else {
        // Generic waiter: just return after first successful call
        return {};
      }
    } catch { /* continue polling */ }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Waiter ${command} timed out after ${maxAttempts} attempts`);
}

// Core dispatcher: routes service+command → raw signed AWS API call
async function executeAwsCommand(
  service: string, command: string, input: Record<string, any>,
  region: string, credentials: { accessKeyId: string; secretAccessKey: string }
): Promise<any> {
  const config = SERVICE_CONFIG[service];
  if (!config) throw new Error(`Unsupported AWS service: ${service}. Supported: ${Object.keys(SERVICE_CONFIG).join(", ")}`);

  // Handle waiters
  if (command.startsWith("WaitUntil")) {
    return handleWaiter(service, command, input, region, credentials);
  }

  const actionName = command.replace(/Command$/, "");
  const host = config.host(region);
  let method: string;
  let path: string;
  let body: string | undefined;
  let extraHeaders: Record<string, string> = {};
  let queryString = "";

  switch (config.apiStyle) {
    case "json-target": {
      method = "POST";
      path = "/";
      body = JSON.stringify(input);
      extraHeaders = {
        "X-Amz-Target": `${config.targetPrefix}.${actionName}`,
        "Content-Type": `application/x-amz-json-${config.jsonVersion || "1.1"}`,
      };
      break;
    }
    case "query": {
      method = "POST";
      path = "/";
      const params = new URLSearchParams();
      params.set("Action", actionName);
      params.set("Version", config.apiVersion!);
      flattenToQueryParams(input, params);
      body = params.toString();
      extraHeaders = { "Content-Type": "application/x-www-form-urlencoded" };
      break;
    }
    case "rest-json": {
      const route = REST_ROUTES[service]?.[actionName];
      if (!route) throw new Error(`No REST mapping for ${service}.${actionName}. Add it to REST_ROUTES.`);
      method = route.method;
      path = route.path(input);
      body = (method !== "GET" && method !== "HEAD" && method !== "DELETE") ? JSON.stringify(input) : undefined;
      if (body) extraHeaders = { "Content-Type": "application/json" };
      break;
    }
    case "s3": {
      const route = S3_ROUTES[actionName];
      if (!route) throw new Error(`No S3 mapping for ${actionName}. Add it to S3_ROUTES.`);
      method = route.method;
      path = route.path(input);
      if (route.queryString) queryString = route.queryString;
      if (actionName === "PutBucketPolicy") {
        body = typeof input.Policy === "string" ? input.Policy : JSON.stringify(input.Policy);
      } else if (actionName === "PutObject") {
        body = typeof input.Body === "string" ? input.Body : JSON.stringify(input.Body);
        if (input.ContentType) {
          extraHeaders["Content-Type"] = input.ContentType;
        }
      } else if (actionName === "PutBucketVersioning") {
        const status = (input as any).VersioningConfiguration?.Status || "Enabled";
        body = `<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>${status}</Status></VersioningConfiguration>`;
        extraHeaders["Content-Type"] = "application/xml";
      } else if (actionName === "PutObjectLockConfiguration") {
        body = `<?xml version="1.0" encoding="UTF-8"?><ObjectLockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>`;
        extraHeaders["Content-Type"] = "application/xml";
      }
      break;
    }
    case "rest-xml": {
      let req: { method: string; path: string; body?: string };
      if (service === "CloudFront") {
        req = buildCloudFrontRequest(actionName, input);
      } else if (service === "Route53") {
        req = buildRoute53Request(actionName, input);
      } else {
        throw new Error(`No XML handler for ${service}.${actionName}`);
      }
      method = req.method;
      path = req.path;
      body = req.body;
      if (body) extraHeaders = { "Content-Type": "application/xml" };
      break;
    }
    default:
      throw new Error(`Unknown API style for ${service}`);
  }

  const fullPath = queryString ? `${path}?${queryString}` : path;

  const res = await awsSignedRequest({
    service: config.signingService,
    region,
    method,
    path: fullPath,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    body,
    extraHeaders,
    hostOverride: host,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${service}.${actionName} failed (${res.status}): ${text.slice(0, 800)}`);
  }

  if (!text || text.trim().length === 0) return {};
  try { return JSON.parse(text); } catch { return parseSimpleXmlResponse(text); }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ───── Types ─────
interface ExecuteRequest {
  intent: "kubernetes" | "ansible" | "compute" | "network" | "eks" | "reconcile" | "inventory" | "sre-supreme" | "naawi";
  action: "deploy" | "update" | "destroy" | "plan" | "apply" | "status" | "discover" | "dry_run" | "add_nodegroup" | "reconcile" | "scan" | "nuke" | "execute" | "wait";
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

// ───── Manifest Engine Helper ─────

// ── Intent name normalization ─────────────────────────────────────────────────
function normalizeIntent(intent: string): string {
  if (intent === "eks" || intent === "kubernetes") return "k8s";
  return intent;
}

// ── response202 ───────────────────────────────────────────────────────────────
function response202(op: PreparedOperation): EngineResponse {
  return ok(op.entry.intent, op.entry.action,
    `Guardrails validated. Worker for '${op.entry.execution.type}' is in development.`,
    { manifest_version: op.manifest_version, resolved_spec: op.resolved_spec, execution_type: op.entry.execution.type }
  );
}

// ───── Provider Clients ─────

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
  hostOverride?: string;
}): Promise<Response> {
  const host = opts.hostOverride || `${opts.service}.${opts.region}.amazonaws.com`;

  // Split path from query string for proper SigV4 canonical request
  const qIdx = opts.path.indexOf("?");
  const canonicalUri = qIdx >= 0 ? opts.path.slice(0, qIdx) : opts.path;
  const queryString = qIdx >= 0 ? opts.path.slice(qIdx + 1) : "";
  // Sort query params for canonical query string; ensure key=value format for bare params
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

  // Canonical request
  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]}`).join("\n") + "\n";
  const signedHeadersStr = signedHeaderKeys.join(";");

  const canonicalRequest = [
    opts.method,
    canonicalUri,
    sortedQS,
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
  const keyBuffer = key instanceof Uint8Array ? (key.buffer as ArrayBuffer) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

async function hmacSha256Hex(key: Uint8Array | ArrayBuffer, data: string): Promise<string> {
  const sig = await hmacSha256(key, data);
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
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
  const provider = ((spec.provider as string) || "aws").toLowerCase();
  if (provider === "oci") return ociCompute(action, spec);
  if (provider === "gcp") return gcpCompute(action, spec);
  if (provider === "azure") return azureCompute(action, spec);

  const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;

  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return err("compute", action, "AWS credentials required. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or pass in spec.");
  }

  const region = spec.region as string || "us-east-1";

  switch (action) {
    case "dry_run":
    case "plan": {
      // Validate instance type availability and credentials using DescribeInstanceTypes.
      // RunInstances DryRun=true requires a default VPC (or explicit SubnetId) which may
      // not exist in production accounts, causing "GroupName only supported for EC2-Classic"
      // errors. DescribeInstanceTypes is VPC-agnostic and sufficient for preflight.
      const instanceType = spec.instance_type as string || "t3.micro";
      const os = spec.os as string || "amazon-linux-2023";
      const count = spec.count as number || 1;

      const ami = AMI_MAP[region]?.[os];
      if (!ami) return err("compute", action, `No AMI for ${os} in ${region}. Try us-east-1.`);

      const params = new URLSearchParams({
        Action: "DescribeInstanceTypes",
        Version: "2016-11-15",
        "InstanceType.1": instanceType,
      });

      const res = await ec2Request("POST", region, params.toString(), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);
      const body = await res.text();

      if (!res.ok) {
        const errorMatch = body.match(/<Message>(.*?)<\/Message>/);
        return err("compute", action, `Dry run failed: ${errorMatch?.[1] || "Validation error"}`);
      }

      if (!body.includes(instanceType)) {
        return err("compute", action, `Dry run failed: instance type ${instanceType} not available in ${region}`);
      }

      return ok("compute", action, `Dry run passed: ${instanceType} x${count} in ${region} is valid`, {
        instance_type: instanceType,
        ami,
        region,
        count,
        validation: "passed",
        dry_run: true,
      });
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

      // Idempotency via ClientToken — deterministic hash ≤64 chars
      // Same params → same token (idempotent retry). Changed params → new token.
      let clientToken = spec.client_token as string;
      if (!clientToken) {
        const raw = `uidi:${name}:${environment}:${instanceType}:${os}:${count}:${region}:${ami}`;
        const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
        const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
        clientToken = `uidi-${hashHex.slice(0, 59)}`; // "uidi-" (5) + 59 hex = 64 chars
      }

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

      // Resolve SubnetId — required in accounts without a default VPC.
      // If the caller supplies one, use it directly; otherwise discover the first
      // available public subnet (i.e. one with MapPublicIpOnLaunch=true).
      let resolvedSubnetId = spec.subnet_id as string | undefined;
      if (!resolvedSubnetId) {
        const subnetRes = await ec2Request("POST", region, new URLSearchParams({
          Action: "DescribeSubnets",
          Version: "2016-11-15",
          "Filter.1.Name": "map-public-ip-on-launch",
          "Filter.1.Value.1": "true",
          "Filter.2.Name": "state",
          "Filter.2.Value.1": "available",
          MaxResults: "5",
        }).toString(), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY);
        const subnetBody = await subnetRes.text();
        resolvedSubnetId = subnetBody.match(/<subnetId>(subnet-[a-f0-9]+)<\/subnetId>/)?.[1];
      }
      if (!resolvedSubnetId) {
        return err("compute", action, "No subnet available. Create a VPC with public subnets first (run the VPC Foundation golden path), or supply subnet_id in the spec.");
      }
      params.set("SubnetId", resolvedSubnetId);

      // Optional: security groups, key pair, user data
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
  subnet_ids: string[];
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
    subnet_ids: subnets.map((subnet) => subnet.id),
    region,
    vpc_cidr: vpcCidr,
    reused: true,
  };
}

async function handleNetwork(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const provider = ((spec.provider as string) || "aws").toLowerCase();
  if (provider === "oci") return ociNetwork(action, spec);
  if (provider === "gcp") return gcpNetwork(action, spec);
  if (provider === "azure") return azureNetwork(action, spec);

  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("network", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";

  switch (action) {
    case "dry_run":
    case "plan": {
      // Validate credentials + region access without creating any resources
      const res = await ec2Request("POST", region, new URLSearchParams({
        Action: "DescribeVpcs",
        Version: "2016-11-15",
        MaxResults: "5",
      }).toString(), AWS_KEY, AWS_SECRET);
      const body = await res.text();
      if (!res.ok) {
        const msg = extractEc2Error(body) || "AWS credential validation failed";
        return err("network", action, `Dry run failed: ${msg}`);
      }
      return ok("network", action, "Credentials and region validated — VPC stack ready to deploy", {
        region,
        vpc_cidr: spec.vpc_cidr || "10.0.0.0/16",
        az_count: spec.az_count || 2,
        validation: "passed",
        dry_run: true,
      });
    }

    case "deploy": {
      const vpcCidr = spec.vpc_cidr as string || "10.0.0.0/16";
      const name = spec.name as string || "uidi-vpc";
      const environment = spec.environment as string || "dev";
      const azCount = Math.min(spec.az_count as number || 2, 3);

      const existingStack = await describeExistingNetworkStack(region, name, environment, AWS_KEY, AWS_SECRET);
      if (existingStack) {
        const hasRequiredSubnetCount = existingStack.subnet_ids.length >= 2;
        const hasSecurityGroup = Boolean(existingStack.security_group_id);

        if (hasRequiredSubnetCount && hasSecurityGroup) {
          return ok(
            "network",
            action,
            `Reused existing VPC stack: ${existingStack.vpc_id} with ${existingStack.subnets.length} subnets`,
            existingStack,
          );
        }

        console.warn(`Existing VPC ${existingStack.vpc_id} is incomplete (subnets=${existingStack.subnet_ids.length}, sg=${existingStack.security_group_id || "none"}). Rebuilding network stack.`);

        const cleanup = await handleNetwork("destroy", { vpc_id: existingStack.vpc_id, region });
        if (cleanup.status === "error") {
          console.warn(`Pre-rebuild cleanup failed for ${existingStack.vpc_id}: ${cleanup.error}`);
        }
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

      const subnetIds = subnets.map(s => s.id);
      return ok("network", action, `VPC stack created: ${vpcId} with ${subnets.length} subnets, IGW, route table, NACL, and security group`, { vpc_id: vpcId, igw_id: igwId, route_table_id: rtbId, nacl_id: naclId, security_group_id: sgId, subnets, subnet_ids: subnetIds, region, vpc_cidr: vpcCidr });
    }

    case "discover": {
      const dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeVpcs", Version: "2016-11-15", "Filter.1.Name": "tag:ManagedBy", "Filter.1.Value.1": "UIDI" }).toString(), AWS_KEY, AWS_SECRET);
      const dBody = await dRes.text();
      if (!dRes.ok) return err("network", action, extractEc2Error(dBody) || "DescribeVpcs failed");
      const vpcs = [...dBody.matchAll(/<vpcId>(vpc-[a-f0-9]+)<\/vpcId>/g)].map(m => m[1]);
      return ok("network", action, `Discovered ${vpcs.length} UIDI-managed VPC(s)`, { vpcs, region, _debug_spec_provider: spec.provider ?? "MISSING" });
    }

    // Standalone peering connection delete (used by rollback)
    case "delete_peering": {
      const pcxId = spec.peering_connection_id as string;
      if (!pcxId) return err("network", action, "peering_connection_id required for delete_peering");
      const delRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteVpcPeeringConnection", Version: "2016-11-15", VpcPeeringConnectionId: pcxId }).toString(), AWS_KEY, AWS_SECRET);
      const delBody = await delRes.text();
      if (!delRes.ok && !delBody.includes("InvalidStateTransition")) {
        return err("network", action, `DeleteVpcPeeringConnection failed: ${extractEc2Error(delBody) || delBody.slice(0, 300)}`);
      }
      return ok("network", action, `Peering connection ${pcxId} deleted`, { peering_connection_id: pcxId, region });
    }

    // Standalone route deletion (used by rollback for peering-routes)
    case "delete_routes": {
      const rtId = spec.route_table_id as string;
      const destCidr = spec.destination_cidr as string;
      if (!rtId || !destCidr) return ok("network", action, "No routes to delete (missing route_table_id or destination_cidr)", { region });
      const delRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteRoute", Version: "2016-11-15", RouteTableId: rtId, DestinationCidrBlock: destCidr }).toString(), AWS_KEY, AWS_SECRET);
      const delBody = await delRes.text();
      if (!delRes.ok && !delBody.includes("InvalidRoute.NotFound")) {
        console.log(`DeleteRoute ${rtId} ${destCidr}: ${delBody.slice(0, 200)}`);
      }
      return ok("network", action, `Route ${destCidr} deleted from ${rtId}`, { route_table_id: rtId, region });
    }

    case "destroy": {
      const vpcId = spec.vpc_id as string;
      if (!vpcId) return err("network", action, "vpc_id required for destroy");
      const destroyed: string[] = [];

      // Retry helper for DependencyViolation — ENIs from deleted EKS clusters take time to clean up
      async function retryEc2Delete(actionName: string, params: Record<string, string>, label: string, maxRetries = 5): Promise<boolean> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const p = new URLSearchParams({ Action: actionName, Version: "2016-11-15", ...params });
          const r = await ec2Request("POST", region, p.toString(), AWS_KEY, AWS_SECRET);
          const b = await r.text();
          if (r.ok || r.status === 200) {
            destroyed.push(label);
            return true;
          }
          if (b.includes("DependencyViolation") || b.includes("in use")) {
            console.log(`${label}: DependencyViolation, retry ${attempt + 1}/${maxRetries} in 10s...`);
            await new Promise(resolve => setTimeout(resolve, 10_000));
            continue;
          }
          if (b.includes("InvalidParameterValue") || b.includes("NotFound")) {
            console.log(`${label}: already gone`);
            return true;
          }
          console.log(`${label}: failed (${r.status}): ${b.slice(0, 200)}`);
          return false;
        }
        console.log(`${label}: giving up after ${maxRetries} retries`);
        return false;
      }

      try {
        // 0. First, clean up ENIs — these block everything else
        let dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeNetworkInterfaces", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        let dBody = await dRes.text();
        console.log(`Destroy ${vpcId}: DescribeENIs found ${[...dBody.matchAll(/<networkInterfaceId>(eni-[a-f0-9]+)<\/networkInterfaceId>/g)].length} ENIs`);
        const eniIds = [...dBody.matchAll(/<networkInterfaceId>(eni-[a-f0-9]+)<\/networkInterfaceId>/g)].map(m => m[1]);
        for (const eniId of eniIds) {
          const attachMatch = dBody.match(new RegExp(`<networkInterfaceId>${eniId}</networkInterfaceId>[\\s\\S]*?<attachmentId>(eni-attach-[a-f0-9]+)</attachmentId>`));
          if (attachMatch) {
            const detR = await ec2Request("POST", region, new URLSearchParams({ Action: "DetachNetworkInterface", Version: "2016-11-15", AttachmentId: attachMatch[1], Force: "true" }).toString(), AWS_KEY, AWS_SECRET);
            await detR.text();
            console.log(`Detached ENI ${eniId}`);
          }
          const delR = await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteNetworkInterface", Version: "2016-11-15", NetworkInterfaceId: eniId }).toString(), AWS_KEY, AWS_SECRET);
          const delRBody = await delR.text();
          if (delR.ok) {
            destroyed.push(`eni:${eniId}`);
          } else {
            console.log(`ENI ${eniId} delete: ${delRBody.slice(0, 150)}`);
          }
        }

        // If there were ENIs, wait a moment for AWS to settle
        if (eniIds.length > 0) {
          console.log(`Waiting 5s for ENI cleanup to propagate...`);
          await new Promise(r => setTimeout(r, 5000));
        }

        // 1. Delete VPC peering connections first (both sides)
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeVpcPeeringConnections", Version: "2016-11-15", "Filter.1.Name": "requester-vpc-info.vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        const pcxIds = new Set([...dBody.matchAll(/<vpcPeeringConnectionId>(pcx-[a-f0-9]+)<\/vpcPeeringConnectionId>/g)].map(m => m[1]));
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeVpcPeeringConnections", Version: "2016-11-15", "Filter.1.Name": "accepter-vpc-info.vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        for (const m of dBody.matchAll(/<vpcPeeringConnectionId>(pcx-[a-f0-9]+)<\/vpcPeeringConnectionId>/g)) pcxIds.add(m[1]);
        for (const pcx of pcxIds) {
          await retryEc2Delete("DeleteVpcPeeringConnection", { VpcPeeringConnectionId: pcx }, `peering:${pcx}`, 1);
        }

        // 2. Delete NAT gateways (these take time)
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeNatGateways", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        const natIds = [...dBody.matchAll(/<natGatewayId>(nat-[a-f0-9]+)<\/natGatewayId>/g)].map(m => m[1]);
        for (const natId of natIds) {
          await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteNatGateway", Version: "2016-11-15", NatGatewayId: natId }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
          destroyed.push(`nat:${natId}`);
        }
        if (natIds.length > 0) await new Promise(r => setTimeout(r, 5000));

        // 3. Delete VPC endpoints
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeVpcEndpoints", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        for (const vpceId of [...dBody.matchAll(/<vpcEndpointId>(vpce-[a-f0-9]+)<\/vpcEndpointId>/g)].map(m => m[1])) {
          await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteVpcEndpoints", Version: "2016-11-15", "VpcEndpointId.1": vpceId }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
          destroyed.push(`vpce:${vpceId}`);
        }

        // 4. Detach & delete internet gateways
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeInternetGateways", Version: "2016-11-15", "Filter.1.Name": "attachment.vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        const igwIds = [...dBody.matchAll(/<internetGatewayId>(igw-[a-f0-9]+)<\/internetGatewayId>/g)].map(m => m[1]);
        for (const gid of igwIds) {
          await ec2Request("POST", region, new URLSearchParams({ Action: "DetachInternetGateway", Version: "2016-11-15", InternetGatewayId: gid, VpcId: vpcId }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
          await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteInternetGateway", Version: "2016-11-15", InternetGatewayId: gid }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
          destroyed.push(`igw:${gid}`);
        }

        // 5. Delete non-default security groups (with retries for DependencyViolation)
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeSecurityGroups", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        const allSgIds = [...new Set([...dBody.matchAll(/<groupId>(sg-[a-f0-9]+)<\/groupId>/g)].map(m => m[1]))];
        // Identify default SG to skip
        const defaultSgMatch = dBody.match(/<groupName>default<\/groupName>[\s\S]*?<groupId>(sg-[a-f0-9]+)<\/groupId>/);
        const defaultSgId = defaultSgMatch?.[1];
        for (const sgId of allSgIds) {
          if (sgId === defaultSgId) continue;
          await retryEc2Delete("DeleteSecurityGroup", { GroupId: sgId }, `sg:${sgId}`, 4);
        }

        // 6. Delete subnets (with retries for DependencyViolation from lingering ENIs)
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeSubnets", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        const subnetIds = [...dBody.matchAll(/<subnetId>(subnet-[a-f0-9]+)<\/subnetId>/g)].map(m => m[1]);
        for (const sid of subnetIds) {
          await retryEc2Delete("DeleteSubnet", { SubnetId: sid }, `subnet:${sid}`, 4);
        }

        // 7. Delete non-default NACLs
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeNetworkAcls", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId, "Filter.2.Name": "default", "Filter.2.Value.1": "false" }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        for (const naclId of [...new Set([...dBody.matchAll(/<networkAclId>(acl-[a-f0-9]+)<\/networkAclId>/g)].map(m => m[1]))]) {
          await retryEc2Delete("DeleteNetworkAcl", { NetworkAclId: naclId }, `nacl:${naclId}`, 1);
        }

        // 8. Delete non-main route tables
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeRouteTables", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        const allRtIds = [...new Set([...dBody.matchAll(/<routeTableId>(rtb-[a-f0-9]+)<\/routeTableId>/g)].map(m => m[1]))];
        for (const rtId of allRtIds) {
          // Disassociate subnets from RT before deleting
          const rtAssocs = [...dBody.matchAll(new RegExp(`<routeTableId>${rtId}</routeTableId>[\\s\\S]*?<routeTableAssociationId>(rtbassoc-[a-f0-9]+)</routeTableAssociationId>`, "g"))].map(m => m[1]);
          for (const assocId of rtAssocs) {
            await ec2Request("POST", region, new URLSearchParams({ Action: "DisassociateRouteTable", Version: "2016-11-15", AssociationId: assocId }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text()).catch(() => {});
          }
          await retryEc2Delete("DeleteRouteTable", { RouteTableId: rtId }, `rtb:${rtId}`, 1);
        }

        // 9. Final ENI sweep (EKS may release more during our cleanup)
        dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DescribeNetworkInterfaces", Version: "2016-11-15", "Filter.1.Name": "vpc-id", "Filter.1.Value.1": vpcId }).toString(), AWS_KEY, AWS_SECRET);
        dBody = await dRes.text();
        const remainingEnis = [...dBody.matchAll(/<networkInterfaceId>(eni-[a-f0-9]+)<\/networkInterfaceId>/g)].map(m => m[1]);
        for (const eniId of remainingEnis) {
          const attachMatch2 = dBody.match(new RegExp(`<networkInterfaceId>${eniId}</networkInterfaceId>[\\s\\S]*?<attachmentId>(eni-attach-[a-f0-9]+)</attachmentId>`));
          if (attachMatch2) {
            await ec2Request("POST", region, new URLSearchParams({ Action: "DetachNetworkInterface", Version: "2016-11-15", AttachmentId: attachMatch2[1], Force: "true" }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
            await new Promise(r => setTimeout(r, 2000));
          }
          await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteNetworkInterface", Version: "2016-11-15", NetworkInterfaceId: eniId }).toString(), AWS_KEY, AWS_SECRET).then(r => r.text());
          destroyed.push(`eni:${eniId}`);
        }

        // 10. Delete the VPC (retry a few times in case ENIs are still settling)
        let vpcDeleted = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          dRes = await ec2Request("POST", region, new URLSearchParams({ Action: "DeleteVpc", Version: "2016-11-15", VpcId: vpcId }).toString(), AWS_KEY, AWS_SECRET);
          dBody = await dRes.text();
          if (dRes.ok) {
            vpcDeleted = true;
            break;
          }
          if (dBody.includes("DependencyViolation")) {
            console.log(`DeleteVpc ${vpcId}: DependencyViolation, retry ${attempt + 1}/4 in 15s...`);
            await new Promise(r => setTimeout(r, 15_000));
            continue;
          }
          break;
        }

        if (!vpcDeleted) {
          return err("network", action, `DeleteVpc failed after cleaning ${destroyed.length} deps [${destroyed.slice(-5).join(", ")}]: ${dBody.slice(0, 400)}`, { vpc_id: vpcId, destroyed });
        }
        return ok("network", action, `VPC ${vpcId} and ${destroyed.length} dependencies destroyed`, { vpc_id: vpcId, region, destroyed });
      } catch (e) {
        return err("network", action, `Destroy failed after cleaning [${destroyed.slice(-5).join(", ")}]: ${e instanceof Error ? e.message : String(e)}`, { vpc_id: vpcId, destroyed });
      }
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
  const provider = ((spec.provider as string) || "aws").toLowerCase();
  if (provider === "oci") return ociEks(action, spec);
  if (provider === "gcp") return gcpEks(action, spec);
  if (provider === "azure") return azureEks(action, spec);

  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("eks", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";

  switch (action) {
    case "deploy": {
      const clusterName = (spec.cluster_name as string) || `uidi-cluster-${Date.now()}`;
      let subnetIds = spec.subnet_ids as string[];
      let securityGroupIds = spec.security_group_ids as string[];

      // Auto-discover subnets + SGs from the UIDI-managed network stack when not explicitly provided
      if (!Array.isArray(subnetIds) || subnetIds.length < 2) {
        const environment = spec.environment as string || "dev";
        const networkName = spec.network_name as string || `vpc-foundation-${environment}`;
        try {
          const stack = await describeExistingNetworkStack(region, networkName, environment, AWS_KEY, AWS_SECRET);
          if (stack && stack.subnet_ids.length >= 2) {
            subnetIds = stack.subnet_ids;
            if (!Array.isArray(securityGroupIds) || securityGroupIds.length === 0) {
              securityGroupIds = stack.security_group_id ? [stack.security_group_id] : [];
            }
            console.log(`EKS deploy: auto-resolved ${subnetIds.length} subnets and ${securityGroupIds.length} SGs from ${networkName}`);
          }
        } catch (e) {
          console.warn(`EKS deploy: network stack discovery failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const preflight = {
        stage: "preflight",
        region,
        cluster_name: clusterName,
        subnet_ids_count: Array.isArray(subnetIds) ? subnetIds.length : 0,
        subnet_ids_sample: Array.isArray(subnetIds) ? subnetIds.slice(0, 6) : [],
        security_group_ids_count: Array.isArray(securityGroupIds) ? securityGroupIds.length : 0,
        security_group_ids_sample: Array.isArray(securityGroupIds) ? securityGroupIds.slice(0, 6) : [],
      };

      if (!Array.isArray(subnetIds) || subnetIds.length < 2) {
        return err("eks", action, "subnet_ids required (at least 2 subnets across 2 AZs). Deploy VPC Foundation first.", {
          ...preflight,
          stage: "preflight_failed",
          async_complete: true,
        } as any);
      }

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
          return err("eks", action, `IAM Role Resolver failed: ${e instanceof Error ? e.message : String(e)}`,
            { ...preflight, stage: "iam_role_failed", async_complete: true } as any
          );
        }
      }

      // NOTE: omit securityGroupIds entirely when not provided (passing [] can be ambiguous)
      const resourcesVpcConfig: Record<string, unknown> = {
        subnetIds,
        ...(Array.isArray(securityGroupIds) && securityGroupIds.length > 0 ? { securityGroupIds } : {}),
        endpointPublicAccess: true,
        endpointPrivateAccess: true,
      };

      const createPayload = {
        name: clusterName,
        version: spec.kubernetes_version || "1.29",
        roleArn,
        resourcesVpcConfig,
        tags: { ManagedBy: "UIDI", Environment: spec.environment || "dev" },
      };

      const res = await awsSignedRequest({
        service: "eks",
        region,
        method: "POST",
        path: "/clusters",
        accessKeyId: AWS_KEY,
        secretAccessKey: AWS_SECRET,
        body: JSON.stringify(createPayload),
        extraHeaders: { "Content-Type": "application/json" },
      });

      const body = await res.text();
      if (!res.ok) {
        // If it's already there, surface "exists" as a recoverable pending state
        if (body.includes("ResourceInUseException") || body.includes("already exists")) {
          const descRes = await awsSignedRequest({
            service: "eks",
            region,
            method: "GET",
            path: `/clusters/${encodeURIComponent(clusterName)}`,
            accessKeyId: AWS_KEY,
            secretAccessKey: AWS_SECRET,
          });
          const descBody = await descRes.text();

          if (descRes.ok) {
            const descData = JSON.parse(descBody);
            const liveStatus = descData.cluster?.status;

            if (liveStatus === "ACTIVE") {
              return ok("eks", action, `Cluster ${clusterName} already ACTIVE — reusing`, {
                ...preflight,
                stage: "cluster_already_active",
                cluster_name: clusterName,
                status: "ACTIVE",
                endpoint: descData.cluster?.endpoint,
                arn: descData.cluster?.arn,
                region,
                async_complete: true,
              } as any);
            }

            return {
              status: "pending" as const,
              intent: "eks",
              action,
              message: `Cluster ${clusterName} exists and is ${liveStatus}. Poll with eks/wait.`,
              details: {
                ...preflight,
                stage: "cluster_exists_waiting",
                cluster_name: clusterName,
                status: liveStatus,
                region,
                async_job: true,
                role_arn: roleArn,
                role_auto_provisioned: roleAutoProvisioned,
              } as any,
              timestamp: new Date().toISOString(),
            };
          }

          // Describe failed even though Create said "in use" — bubble up with context.
          return err("eks", action, `CreateCluster returned 'already exists' but DescribeCluster failed: ${descBody.slice(0, 500)}`,
            { ...preflight, stage: "cluster_exists_describe_failed", async_complete: true } as any
          );
        }

        return err("eks", action, `CreateCluster failed: ${body.slice(0, 500)}`,
          { ...preflight, stage: "create_cluster_failed", async_complete: true } as any
        );
      }

      let data: any = null;
      try { data = JSON.parse(body); } catch { /* keep null */ }

      return {
        status: "pending" as const,
        intent: "eks",
        action,
        message: `EKS cluster ${clusterName} creation requested (~10-15 min). Poll via eks/wait.${roleAutoProvisioned ? " (IAM role auto-provisioned)" : ""}`,
        details: {
          ...preflight,
          stage: "create_cluster_requested",
          cluster_name: clusterName,
          status: data?.cluster?.status || "CREATING",
          arn: data?.cluster?.arn,
          region,
          role_arn: roleArn,
          role_auto_provisioned: roleAutoProvisioned,
          async_job: true,
        } as any,
        timestamp: new Date().toISOString(),
      };
    }

    // Async poll: check if a long-running EKS operation has completed
    case "wait": {
      const clusterName = spec.cluster_name as string;
      if (!clusterName) return err("eks", action, "cluster_name required for wait.");

      const res = await awsSignedRequest({
        service: "eks",
        region,
        method: "GET",
        path: `/clusters/${encodeURIComponent(clusterName)}`,
        accessKeyId: AWS_KEY,
        secretAccessKey: AWS_SECRET,
      });

      const body = await res.text();

      if (!res.ok) {
        const isNotFound = /No cluster found/i.test(body) || /ResourceNotFoundException/i.test(body);

        if (isNotFound) {
          // Extra granularity: show what EKS thinks exists in this region.
          const listRes = await awsSignedRequest({
            service: "eks",
            region,
            method: "GET",
            path: "/clusters",
            accessKeyId: AWS_KEY,
            secretAccessKey: AWS_SECRET,
          });
          const listBody = await listRes.text();
          let clusters: string[] | undefined;
          try {
            const parsed = JSON.parse(listBody);
            clusters = parsed?.clusters;
          } catch {
            clusters = undefined;
          }

          return err(
            "eks",
            action,
            `DescribeCluster: cluster '${clusterName}' not found in ${region}.`,
            {
              stage: "describe_cluster_not_found",
              cluster_name: clusterName,
              region,
              raw_error: body.slice(0, 500),
              clusters_in_region: clusters?.slice(0, 50),
              async_complete: true,
              retryable: true,
            } as any,
          );
        }

        return err("eks", action, `DescribeCluster failed: ${body.slice(0, 500)}`,
          {
            stage: "describe_cluster_failed",
            cluster_name: clusterName,
            region,
            raw_error: body.slice(0, 500),
            async_complete: true,
          } as any
        );
      }

      const data = JSON.parse(body);
      const clusterStatus = data.cluster?.status;

      if (clusterStatus === "ACTIVE") {
        return ok("eks", action, `Cluster ${clusterName} is ACTIVE`, {
          stage: "cluster_active",
          cluster_name: clusterName,
          status: "ACTIVE",
          endpoint: data.cluster?.endpoint,
          arn: data.cluster?.arn,
          version: data.cluster?.version,
          region,
          async_complete: true,
        } as any);
      }

      if (clusterStatus === "FAILED") {
        return err("eks", action, `Cluster ${clusterName} FAILED: ${JSON.stringify(data.cluster?.health || {})}`,
          {
            stage: "cluster_failed",
            cluster_name: clusterName,
            status: "FAILED",
            health: data.cluster?.health,
            region,
            async_complete: true,
          } as any
        );
      }

      return {
        status: "pending" as const,
        intent: "eks",
        action: "wait",
        message: `Cluster ${clusterName} is ${clusterStatus}. Still provisioning...`,
        details: {
          stage: "cluster_provisioning",
          cluster_name: clusterName,
          status: clusterStatus,
          health: data.cluster?.health,
          region,
          async_job: true,
        } as any,
        timestamp: new Date().toISOString(),
      };
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
      const subnetIds = spec.subnet_ids as string[];
      if (!clusterName || !subnetIds?.length) return err("eks", action, "cluster_name, subnet_ids required.");

      // Auto-resolve node role ARN if not provided
      let nodeRoleArn = spec.node_role_arn as string;
      if (!nodeRoleArn) {
        try {
          const resolved = await getOrCreateEksRole(AWS_KEY, AWS_SECRET, "node");
          nodeRoleArn = resolved.arn;
          console.log(`EKS add_nodegroup: node role ${resolved.created ? "auto-created" : "discovered"}: ${nodeRoleArn}`);
        } catch (e) {
          return err("eks", action, `IAM Node Role Resolver failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Ensure cluster is ACTIVE before adding nodegroup
      const checkRes = await awsSignedRequest({ service: "eks", region, method: "GET", path: `/clusters/${clusterName}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
      const checkBody = await checkRes.text();
      if (checkRes.ok) {
        const checkData = JSON.parse(checkBody);
        if (checkData.cluster?.status !== "ACTIVE") {
          return { status: "pending" as const, intent: "eks", action, message: `Cluster ${clusterName} is ${checkData.cluster?.status} — waiting for ACTIVE before adding nodegroup.`, details: { cluster_name: clusterName, status: checkData.cluster?.status, region, async_job: true, wait_for: "cluster_active" }, timestamp: new Date().toISOString() };
        }
      }

      const res = await awsSignedRequest({ service: "eks", region, method: "POST", path: `/clusters/${clusterName}/node-groups`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET, body: JSON.stringify({ nodegroupName: spec.nodegroup_name || `${clusterName}-nodes`, nodeRole: nodeRoleArn, subnets: subnetIds, instanceTypes: spec.instance_types || ["t3.medium"], scalingConfig: { desiredSize: spec.desired_size || 2, minSize: spec.min_size || 1, maxSize: spec.max_size || 3 }, tags: { ManagedBy: "UIDI" } }), extraHeaders: { "Content-Type": "application/json" } });
      const body = await res.text();
      if (!res.ok) return err("eks", action, `CreateNodegroup failed: ${body.slice(0, 500)}`);
      const ngData = JSON.parse(body).nodegroup || {};
      return ok("eks", action, `Node group creation started`, { ...ngData, nodegroup_name: ngData.nodegroupName || spec.nodegroup_name || `${clusterName}-nodes`, cluster_name: clusterName, region });
    }

    case "destroy": {
      const clusterName = spec.cluster_name as string;
      if (!clusterName) return err("eks", action, "cluster_name required.");
      const destroySteps: string[] = [];

      // 1. List and delete all nodegroups
      const ngRes = await awsSignedRequest({ service: "eks", region, method: "GET", path: `/clusters/${clusterName}/node-groups`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
      const ngBody = await ngRes.text();
      const nodegroups = ngRes.ok ? (JSON.parse(ngBody).nodegroups || []) as string[] : [];

      if (nodegroups.length > 0) {
        for (const ng of nodegroups) {
          console.log(`EKS destroy: deleting nodegroup ${ng}...`);
          const delNg = await awsSignedRequest({ service: "eks", region, method: "DELETE", path: `/clusters/${clusterName}/node-groups/${encodeURIComponent(ng)}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
          const delNgBody = await delNg.text();
          if (!delNg.ok && !delNgBody.includes("ResourceNotFoundException")) {
            console.log(`EKS destroy: nodegroup ${ng} delete response: ${delNgBody.slice(0, 300)}`);
          }
          destroySteps.push(`DeleteNodegroup: ${ng}`);
        }

        // 2. Poll until all nodegroups are gone (max 10 min)
        const ngMaxPolls = 40;
        const ngPollDelay = 15_000;
        for (let poll = 0; poll < ngMaxPolls; poll++) {
          await new Promise(r => setTimeout(r, ngPollDelay));
          const checkNg = await awsSignedRequest({ service: "eks", region, method: "GET", path: `/clusters/${clusterName}/node-groups`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
          const checkBody = await checkNg.text();
          if (!checkNg.ok) break; // cluster may already be gone
          const remaining = (JSON.parse(checkBody).nodegroups || []) as string[];
          console.log(`EKS destroy: nodegroup poll ${poll + 1}/${ngMaxPolls}, remaining: ${remaining.length}`);
          if (remaining.length === 0) {
            destroySteps.push(`All nodegroups deleted (poll ${poll + 1})`);
            break;
          }
          if (poll === ngMaxPolls - 1) {
            destroySteps.push(`Nodegroup cleanup timed out — ${remaining.length} still deleting`);
          }
        }
      }

      // 3. Delete the cluster
      console.log(`EKS destroy: deleting cluster ${clusterName}...`);
      const res = await awsSignedRequest({ service: "eks", region, method: "DELETE", path: `/clusters/${encodeURIComponent(clusterName)}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
      const body = await res.text();
      if (!res.ok && !body.includes("ResourceNotFoundException")) return err("eks", action, `DeleteCluster failed: ${body.slice(0, 500)}`, { steps: destroySteps });
      destroySteps.push(`DeleteCluster: ${clusterName}`);

      // 4. Wait for cluster to be fully gone (max 10 min) so VPC ENIs get cleaned up
      const clMaxPolls = 40;
      const clPollDelay = 15_000;
      for (let poll = 0; poll < clMaxPolls; poll++) {
        await new Promise(r => setTimeout(r, clPollDelay));
        const checkCl = await awsSignedRequest({ service: "eks", region, method: "GET", path: `/clusters/${encodeURIComponent(clusterName)}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
        const checkBody = await checkCl.text();
        if (!checkCl.ok) {
          // 404 = gone
          destroySteps.push(`Cluster confirmed deleted (poll ${poll + 1})`);
          break;
        }
        const clStatus = JSON.parse(checkBody)?.cluster?.status;
        console.log(`EKS destroy: cluster poll ${poll + 1}/${clMaxPolls}, status: ${clStatus}`);
        if (poll === clMaxPolls - 1) {
          destroySteps.push(`Cluster deletion timed out — status: ${clStatus}`);
        }
      }

      return ok("eks", action, `EKS cluster ${clusterName} fully destroyed`, { cluster_name: clusterName, region, steps: destroySteps });
    }

    case "dry_run":
    case "plan": {
      // Validate credentials via STS + confirm EKS API is reachable
      const stsRes = await awsSignedRequest({
        service: "sts",
        region,
        method: "POST",
        path: "/",
        body: "Action=GetCallerIdentity&Version=2011-06-15",
        extraHeaders: { "content-type": "application/x-www-form-urlencoded" },
        accessKeyId: AWS_KEY,
        secretAccessKey: AWS_SECRET,
      });
      if (!stsRes.ok) {
        return err("eks", action, "Credential validation failed — STS GetCallerIdentity rejected");
      }
      const clusterName = (spec.cluster_name as string) || `${spec.environment || "dev"}-cluster`;
      return ok("eks", action, `Credentials validated — EKS cluster '${clusterName}' ready to deploy`, {
        cluster_name: clusterName,
        region,
        kubernetes_version: spec.kubernetes_version || "1.29",
        validation: "passed",
        dry_run: true,
      });
    }

    case "discover": {
      const res = await awsSignedRequest({ service: "eks", region, method: "GET", path: "/clusters", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
      const body = await res.text();
      if (!res.ok) return err("eks", action, `ListClusters failed: ${body.slice(0, 500)}`);
      const data = JSON.parse(body);
      const clusters = data.clusters || [];
      return ok("eks", action, `Found ${clusters.length} cluster(s) in ${region}`, { clusters, region });
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

function err(intent: string, action: string, error: string, details?: unknown): EngineResponse {
  return { status: "error", intent, action, error, details, timestamp: new Date().toISOString() };
}

// ───── Multi-Cloud Auth & Handlers ─────

// ─── OCI HTTP Signature V1 (RSA-SHA256) ───

async function ociSign(
  method: string,
  host: string,
  path: string,
  keyId: string,
  privateKeyPem: string,
  signedHeadersMap: Record<string, string>,
): Promise<string> {
  const pemBody = privateKeyPem
    .replace(/-----BEGIN[^-]+-----/g, "")
    .replace(/-----END[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hasBody = "x-content-sha256" in signedHeadersMap;
  const headerList = hasBody
    ? ["(request-target)", "host", "date", "x-content-sha256", "content-type", "content-length"]
    : ["(request-target)", "host", "date"];
  const signingParts = headerList.map((h) => {
    if (h === "(request-target)") return `(request-target): ${method.toLowerCase()} ${path}`;
    if (h === "host") return `host: ${host}`;
    return `${h}: ${signedHeadersMap[h] || ""}`;
  });
  const signingString = signingParts.join("\n");
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    cryptoKey,
    new TextEncoder().encode(signingString),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `Signature version="1",algorithm="rsa-sha256",headers="${headerList.join(" ")}",keyId="${keyId}",signature="${sigB64}"`;
}

async function ociRequest(
  method: string,
  host: string,
  path: string,
  tenancyOcid: string,
  userOcid: string,
  fingerprint: string,
  privateKey: string,
  body?: string,
): Promise<Response> {
  const keyId = `${tenancyOcid}/${userOcid}/${fingerprint}`;
  const date = new Date().toUTCString();
  const signedHeadersMap: Record<string, string> = { date };
  if (body) {
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    signedHeadersMap["x-content-sha256"] = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
    signedHeadersMap["content-type"] = "application/json";
    signedHeadersMap["content-length"] = String(new TextEncoder().encode(body).length);
  }
  const auth = await ociSign(method, host, path, keyId, privateKey, signedHeadersMap);
  const fetchHeaders: Record<string, string> = { ...signedHeadersMap, Authorization: auth };
  // content-length is set automatically by Deno fetch — removing to avoid "forbidden header" errors
  delete fetchHeaders["content-length"];
  return fetch(`https://${host}${path}`, {
    method,
    headers: fetchHeaders,
    ...(body ? { body } : {}),
  });
}

// ─── GCP OAuth2 JWT Service Account ───

async function gcpGetToken(serviceAccountJson: string, scopes: string[]): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as Record<string, string>;
  const now = Math.floor(Date.now() / 1000);
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const payload = encode({
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  });
  const sigInput = `${header}.${payload}`;
  const pemBody = sa.private_key
    .replace(/-----BEGIN[^-]+-----/g, "")
    .replace(/-----END[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    cryptoKey,
    new TextEncoder().encode(sigInput),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const jwt = `${sigInput}.${sigB64}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok || !data.access_token) throw new Error(`GCP token error: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

// ─── Azure Client Credentials Grant ───

async function azureGetToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://management.azure.com/.default",
    }).toString(),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok || !data.access_token) throw new Error(`Azure token error: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

// ─── OCI Network Handler ───

async function ociNetwork(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const tenancy = spec.oci_tenancy_ocid as string;
  const user = spec.oci_user_ocid as string;
  const fingerprint = spec.oci_fingerprint as string;
  const privateKey = spec.oci_private_key as string;
  const region = spec.oci_region as string || spec.region as string || "us-ashburn-1";
  const compartment = spec.oci_compartment_id as string || tenancy;
  if (!tenancy || !user || !fingerprint || !privateKey) {
    return err("network", action, "OCI credentials required: oci_tenancy_ocid, oci_user_ocid, oci_fingerprint, oci_private_key");
  }
  const host = `iaas.${region}.oraclecloud.com`;

  switch (action) {
    case "dry_run":
    case "plan": {
      const path = `/20160918/vcns?compartmentId=${encodeURIComponent(compartment)}&limit=5`;
      const res = await ociRequest("GET", host, path, tenancy, user, fingerprint, privateKey);
      const body = await res.text();
      if (!res.ok) return err("network", action, `OCI credential validation failed: ${body.slice(0, 400)}`);
      const vcns = JSON.parse(body) as unknown[];
      return ok("network", action, "OCI credentials validated — VCN stack ready to deploy", {
        region, compartment, vcn_count: vcns.length, dry_run: true,
      });
    }
    case "discover": {
      const path = `/20160918/vcns?compartmentId=${encodeURIComponent(compartment)}&limit=50`;
      const res = await ociRequest("GET", host, path, tenancy, user, fingerprint, privateKey);
      const body = await res.text();
      if (!res.ok) return err("network", action, `OCI VCN list failed: ${body.slice(0, 400)}`);
      const vcns = JSON.parse(body) as Array<Record<string, unknown>>;
      return ok("network", action, `Discovered ${vcns.length} VCN(s)`, {
        region, compartment,
        vcns: vcns.map((v) => ({ id: v.id, displayName: v.displayName, cidrBlock: v.cidrBlock, lifecycleState: v.lifecycleState })),
      });
    }
    case "deploy": {
      const name = spec.name as string || "uidi-vcn";
      const cidr = spec.vpc_cidr as string || "10.0.0.0/16";
      const subnetCidr = "10.0.1.0/24";
      // 1. Create VCN
      const vcnRes = await ociRequest("POST", host, "/20160918/vcns", tenancy, user, fingerprint, privateKey,
        JSON.stringify({ displayName: name, cidrBlock: cidr, compartmentId: compartment }));
      const vcnBody = await vcnRes.text();
      if (!vcnRes.ok) return err("network", action, `OCI CreateVCN failed: ${vcnBody.slice(0, 400)}`);
      const vcn = JSON.parse(vcnBody) as Record<string, unknown>;
      const vcnId = vcn.id as string;
      // 2. Create Internet Gateway
      const igwRes = await ociRequest("POST", host, "/20160918/internetGateways", tenancy, user, fingerprint, privateKey,
        JSON.stringify({ displayName: `${name}-igw`, compartmentId: compartment, vcnId, isEnabled: true }));
      const igwBody = await igwRes.text();
      if (!igwRes.ok) return err("network", action, `OCI CreateIGW failed: ${igwBody.slice(0, 400)}`);
      const igwId = (JSON.parse(igwBody) as Record<string, unknown>).id as string;
      // 3. Get default route table and add 0.0.0.0/0 → IGW
      const rtListRes = await ociRequest("GET", host,
        `/20160918/routeTables?compartmentId=${encodeURIComponent(compartment)}&vcnId=${encodeURIComponent(vcnId)}`,
        tenancy, user, fingerprint, privateKey);
      const rtList = JSON.parse(await rtListRes.text()) as Array<Record<string, unknown>>;
      const defaultRt = rtList.find((rt) => String(rt.displayName || "").startsWith("Default Route Table"));
      const rtId = defaultRt?.id as string | undefined;
      if (rtId) {
        await ociRequest("PUT", host, `/20160918/routeTables/${encodeURIComponent(rtId)}`, tenancy, user, fingerprint, privateKey,
          JSON.stringify({ routeRules: [{ destination: "0.0.0.0/0", networkEntityId: igwId, destinationType: "CIDR_BLOCK" }] }));
      }
      // 4. Create Security List
      const slRes = await ociRequest("POST", host, "/20160918/securityLists", tenancy, user, fingerprint, privateKey,
        JSON.stringify({
          displayName: `${name}-sl`, compartmentId: compartment, vcnId,
          egressSecurityRules: [{ protocol: "all", destination: "0.0.0.0/0", isStateless: false }],
          ingressSecurityRules: [{ protocol: "6", source: "0.0.0.0/0", isStateless: false, tcpOptions: { destinationPortRange: { min: 443, max: 443 } } }],
        }));
      const slBody = await slRes.text();
      const slId = slRes.ok ? (JSON.parse(slBody) as Record<string, unknown>).id as string : undefined;
      // 5. Create Subnet
      const subnetRes = await ociRequest("POST", host, "/20160918/subnets", tenancy, user, fingerprint, privateKey,
        JSON.stringify({
          displayName: `${name}-subnet`, compartmentId: compartment, vcnId, cidrBlock: subnetCidr,
          ...(rtId ? { routeTableId: rtId } : {}),
          ...(slId ? { securityListIds: [slId] } : {}),
        }));
      const subnetBody = await subnetRes.text();
      if (!subnetRes.ok) return err("network", action, `OCI CreateSubnet failed: ${subnetBody.slice(0, 400)}`);
      const subnetId = (JSON.parse(subnetBody) as Record<string, unknown>).id as string;
      return ok("network", action, `OCI VCN stack deployed: ${vcnId}`, {
        vcn_id: vcnId, subnet_id: subnetId, igw_id: igwId, route_table_id: rtId, security_list_id: slId, region, compartment,
      });
    }
    case "destroy": {
      const vcnId = spec.vcn_id as string || spec.vpc_id as string;
      if (!vcnId) return err("network", action, "vcn_id required for OCI destroy");
      const q = `compartmentId=${encodeURIComponent(compartment)}&vcnId=${encodeURIComponent(vcnId)}`;
      // Subnets
      const sRes = await ociRequest("GET", host, `/20160918/subnets?${q}`, tenancy, user, fingerprint, privateKey);
      for (const s of JSON.parse(await sRes.text()) as Array<Record<string, unknown>>) {
        await ociRequest("DELETE", host, `/20160918/subnets/${encodeURIComponent(s.id as string)}`, tenancy, user, fingerprint, privateKey);
      }
      // Security Lists (non-default)
      const slsRes = await ociRequest("GET", host, `/20160918/securityLists?${q}`, tenancy, user, fingerprint, privateKey);
      for (const sl of (JSON.parse(await slsRes.text()) as Array<Record<string, unknown>>).filter((s) => !String(s.displayName || "").startsWith("Default"))) {
        await ociRequest("DELETE", host, `/20160918/securityLists/${encodeURIComponent(sl.id as string)}`, tenancy, user, fingerprint, privateKey);
      }
      // Internet Gateways
      const igwsRes = await ociRequest("GET", host, `/20160918/internetGateways?${q}`, tenancy, user, fingerprint, privateKey);
      for (const igw of JSON.parse(await igwsRes.text()) as Array<Record<string, unknown>>) {
        await ociRequest("DELETE", host, `/20160918/internetGateways/${encodeURIComponent(igw.id as string)}`, tenancy, user, fingerprint, privateKey);
      }
      // VCN
      const delRes = await ociRequest("DELETE", host, `/20160918/vcns/${encodeURIComponent(vcnId)}`, tenancy, user, fingerprint, privateKey);
      if (!delRes.ok && delRes.status !== 404) return err("network", action, `OCI VCN delete failed: ${(await delRes.text()).slice(0, 400)}`);
      return ok("network", action, `OCI VCN ${vcnId} destroyed`, { vcn_id: vcnId, region });
    }
    default:
      return err("network", action, `Unknown OCI network action: ${action}`);
  }
}

// ─── GCP Network Handler ───

async function gcpNetwork(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const saJson = spec.gcp_service_account_json as string;
  const projectId = spec.gcp_project_id as string;
  const region = spec.gcp_region as string || spec.region as string || "us-central1";
  if (!saJson || !projectId) return err("network", action, "GCP credentials required: gcp_service_account_json, gcp_project_id");
  let token: string;
  try { token = await gcpGetToken(saJson, ["https://www.googleapis.com/auth/cloud-platform"]); }
  catch (e) { return err("network", action, `GCP auth failed: ${e instanceof Error ? e.message : String(e)}`); }
  const gcpFetch = (path: string, method = "GET", body?: string) =>
    fetch(`https://compute.googleapis.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body } : {}),
    });

  switch (action) {
    case "dry_run":
    case "plan": {
      const res = await gcpFetch(`/compute/v1/projects/${projectId}/global/networks?maxResults=5`);
      const body = await res.text();
      if (!res.ok) return err("network", action, `GCP credential validation failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      return ok("network", action, "GCP credentials validated — VPC stack ready to deploy", {
        projectId, region, network_count: (data.items as unknown[] || []).length, dry_run: true,
      });
    }
    case "discover": {
      const res = await gcpFetch(`/compute/v1/projects/${projectId}/global/networks`);
      const body = await res.text();
      if (!res.ok) return err("network", action, `GCP network list failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      const items = (data.items as Array<Record<string, unknown>> || []);
      return ok("network", action, `Discovered ${items.length} GCP network(s)`, {
        projectId, region,
        networks: items.map((n) => ({ name: n.name, id: n.id, selfLink: n.selfLink })),
      });
    }
    case "deploy": {
      const name = spec.name as string || "uidi-vpc";
      const subnetCidr = spec.vpc_cidr as string || "10.0.0.0/16";
      // Network
      const netRes = await gcpFetch(`/compute/v1/projects/${projectId}/global/networks`, "POST",
        JSON.stringify({ name, autoCreateSubnetworks: false }));
      const netBody = await netRes.text();
      if (!netRes.ok) return err("network", action, `GCP CreateNetwork failed: ${netBody.slice(0, 400)}`);
      // Subnetwork
      const snRes = await gcpFetch(`/compute/v1/projects/${projectId}/regions/${region}/subnetworks`, "POST",
        JSON.stringify({
          name: `${name}-subnet`,
          network: `projects/${projectId}/global/networks/${name}`,
          ipCidrRange: subnetCidr,
          region: `regions/${region}`,
        }));
      const snBody = await snRes.text();
      if (!snRes.ok) return err("network", action, `GCP CreateSubnetwork failed: ${snBody.slice(0, 400)}`);
      // Firewall
      await gcpFetch(`/compute/v1/projects/${projectId}/global/firewalls`, "POST",
        JSON.stringify({
          name: `${name}-allow-https`, network: `projects/${projectId}/global/networks/${name}`,
          allowed: [{ IPProtocol: "tcp", ports: ["443"] }], direction: "INGRESS", sourceRanges: ["0.0.0.0/0"],
        }));
      // Cloud Router + NAT
      const routerRes = await gcpFetch(`/compute/v1/projects/${projectId}/regions/${region}/routers`, "POST",
        JSON.stringify({
          name: `${name}-router`, network: `projects/${projectId}/global/networks/${name}`,
          region: `regions/${region}`,
          nats: [{ name: `${name}-nat`, natIpAllocateOption: "AUTO_ONLY", sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES" }],
        }));
      const routerBody = await routerRes.text();
      return ok("network", action, `GCP network ${name} deployed`, {
        network: name, subnet: `${name}-subnet`, region, projectId,
        router_op: (JSON.parse(routerBody) as Record<string, unknown>).name,
      });
    }
    case "destroy": {
      const name = spec.name as string || spec.vpc_id as string;
      if (!name) return err("network", action, "name or vpc_id required for GCP destroy");
      await gcpFetch(`/compute/v1/projects/${projectId}/regions/${region}/routers/${name}-router`, "DELETE");
      await gcpFetch(`/compute/v1/projects/${projectId}/global/firewalls/${name}-allow-https`, "DELETE");
      await gcpFetch(`/compute/v1/projects/${projectId}/regions/${region}/subnetworks/${name}-subnet`, "DELETE");
      const delRes = await gcpFetch(`/compute/v1/projects/${projectId}/global/networks/${name}`, "DELETE");
      if (!delRes.ok && delRes.status !== 404) return err("network", action, `GCP network delete failed: ${(await delRes.text()).slice(0, 400)}`);
      return ok("network", action, `GCP network ${name} destroyed`, { name, region, projectId });
    }
    default:
      return err("network", action, `Unknown GCP network action: ${action}`);
  }
}

// ─── Azure Network Handler ───

async function azureNetwork(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const clientId = spec.azure_client_id as string;
  const clientSecret = spec.azure_client_secret as string;
  const tenantId = spec.azure_tenant_id as string;
  const subscriptionId = spec.azure_subscription_id as string;
  const resourceGroup = spec.azure_resource_group as string || spec.resource_group as string || `uidi-${spec.environment || "default"}`;
  const region = spec.azure_region as string || spec.region as string || "eastus";
  if (!clientId || !clientSecret || !tenantId || !subscriptionId) {
    return err("network", action, "Azure credentials required: azure_client_id, azure_client_secret, azure_tenant_id, azure_subscription_id");
  }
  let token: string;
  try { token = await azureGetToken(tenantId, clientId, clientSecret); }
  catch (e) { return err("network", action, `Azure auth failed: ${e instanceof Error ? e.message : String(e)}`); }
  const subBase = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network`;
  const azFetch = (path: string, method = "GET", body?: string) =>
    fetch(`https://management.azure.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body } : {}),
    });

  switch (action) {
    case "dry_run":
    case "plan": {
      const res = await azFetch(`${subBase}/virtualNetworks?api-version=2023-04-01`);
      const body = await res.text();
      if (!res.ok) return err("network", action, `Azure credential validation failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      return ok("network", action, "Azure credentials validated — VNet stack ready to deploy", {
        subscriptionId, resourceGroup, region, vnet_count: (data.value as unknown[] || []).length, dry_run: true,
      });
    }
    case "discover": {
      const res = await azFetch(`${subBase}/virtualNetworks?api-version=2023-04-01`);
      const body = await res.text();
      if (!res.ok) return err("network", action, `Azure VNet list failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      const items = (data.value as Array<Record<string, unknown>> || []);
      return ok("network", action, `Discovered ${items.length} Azure VNet(s)`, {
        subscriptionId, resourceGroup, region,
        vnets: items.map((v) => ({ name: v.name, id: v.id, location: v.location })),
      });
    }
    case "deploy": {
      const name = spec.name as string || "uidi-vnet";
      const cidr = spec.vpc_cidr as string || "10.0.0.0/16";
      const subnetCidr = "10.0.1.0/24";
      // NSG
      const nsgRes = await azFetch(`${subBase}/networkSecurityGroups/${name}-nsg?api-version=2023-04-01`, "PUT",
        JSON.stringify({
          location: region,
          properties: {
            securityRules: [{
              name: "AllowHTTPS",
              properties: { priority: 100, protocol: "Tcp", access: "Allow", direction: "Inbound", sourceAddressPrefix: "*", sourcePortRange: "*", destinationAddressPrefix: "*", destinationPortRange: "443" },
            }],
          },
        }));
      const nsgBody = await nsgRes.text();
      if (!nsgRes.ok) return err("network", action, `Azure CreateNSG failed: ${nsgBody.slice(0, 400)}`);
      const nsgId = (JSON.parse(nsgBody) as Record<string, unknown>).id as string;
      // VNet + Subnet
      const vnetRes = await azFetch(`${subBase}/virtualNetworks/${name}?api-version=2023-04-01`, "PUT",
        JSON.stringify({
          location: region,
          properties: {
            addressSpace: { addressPrefixes: [cidr] },
            subnets: [{ name: `${name}-subnet`, properties: { addressPrefix: subnetCidr, networkSecurityGroup: { id: nsgId } } }],
          },
        }));
      const vnetBody = await vnetRes.text();
      if (!vnetRes.ok) return err("network", action, `Azure CreateVNet failed: ${vnetBody.slice(0, 400)}`);
      const vnet = JSON.parse(vnetBody) as Record<string, unknown>;
      return ok("network", action, `Azure VNet ${name} deployed`, {
        vnet_id: vnet.id, name, region, resourceGroup, subscriptionId, nsg_id: nsgId,
      });
    }
    case "destroy": {
      const name = spec.name as string || spec.vpc_id as string;
      if (!name) return err("network", action, "name or vpc_id required for Azure destroy");
      await azFetch(`${subBase}/virtualNetworks/${name}?api-version=2023-04-01`, "DELETE");
      await azFetch(`${subBase}/networkSecurityGroups/${name}-nsg?api-version=2023-04-01`, "DELETE");
      return ok("network", action, `Azure VNet ${name} destroyed`, { name, region, resourceGroup });
    }
    default:
      return err("network", action, `Unknown Azure network action: ${action}`);
  }
}

// ─── OCI EKS/OKE Handler ───

async function ociEks(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const tenancy = spec.oci_tenancy_ocid as string;
  const user = spec.oci_user_ocid as string;
  const fingerprint = spec.oci_fingerprint as string;
  const privateKey = spec.oci_private_key as string;
  const region = spec.oci_region as string || spec.region as string || "us-ashburn-1";
  const compartment = spec.oci_compartment_id as string || tenancy;
  if (!tenancy || !user || !fingerprint || !privateKey) return err("eks", action, "OCI credentials required");
  const host = `containerengine.${region}.oraclecloud.com`;

  switch (action) {
    case "dry_run":
    case "plan": {
      const res = await ociRequest("GET", host, `/20180222/clusters?compartmentId=${encodeURIComponent(compartment)}&limit=5`, tenancy, user, fingerprint, privateKey);
      const body = await res.text();
      if (!res.ok) return err("eks", action, `OKE credential check failed: ${body.slice(0, 400)}`);
      const clusters = JSON.parse(body) as unknown[];
      return ok("eks", action, "OCI credentials validated — OKE cluster ready to deploy", {
        region, compartment, cluster_count: clusters.length, dry_run: true,
      });
    }
    case "discover": {
      const res = await ociRequest("GET", host, `/20180222/clusters?compartmentId=${encodeURIComponent(compartment)}&limit=50`, tenancy, user, fingerprint, privateKey);
      const body = await res.text();
      if (!res.ok) return err("eks", action, `OKE cluster list failed: ${body.slice(0, 400)}`);
      const clusters = JSON.parse(body) as Array<Record<string, unknown>>;
      return ok("eks", action, `Discovered ${clusters.length} OKE cluster(s)`, {
        region, compartment,
        clusters: clusters.map((c) => ({ id: c.id, name: c.name, lifecycleState: c.lifecycleState, kubernetesVersion: c.kubernetesVersion })),
      });
    }
    case "deploy": {
      const clusterName = spec.cluster_name as string || "uidi-oke";
      const vcnId = spec.vcn_id as string;
      const subnetIds = spec.subnet_ids as string[] || [];
      const k8sVersion = spec.kubernetes_version as string || "v1.28.2";
      if (!vcnId) return err("eks", action, "vcn_id required for OKE deploy");
      const clusterRes = await ociRequest("POST", host, "/20180222/clusters", tenancy, user, fingerprint, privateKey,
        JSON.stringify({
          name: clusterName, compartmentId: compartment, vcnId, kubernetesVersion: k8sVersion,
          options: {
            serviceLbSubnetIds: subnetIds.slice(0, 2),
            kubernetesNetworkConfig: { podsCidr: "10.244.0.0/16", servicesCidr: "10.96.0.0/16" },
          },
        }));
      const clusterBody = await clusterRes.text();
      if (!clusterRes.ok) return err("eks", action, `OKE cluster create failed: ${clusterBody.slice(0, 400)}`);
      return ok("eks", action, `OKE cluster ${clusterName} creation initiated`, {
        cluster_name: clusterName, region, compartment, work_request_id: clusterRes.headers.get("opc-work-request-id"),
      });
    }
    case "destroy": {
      const clusterId = spec.cluster_id as string;
      if (!clusterId) return err("eks", action, "cluster_id required for OKE destroy");
      const delRes = await ociRequest("DELETE", host, `/20180222/clusters/${encodeURIComponent(clusterId)}`, tenancy, user, fingerprint, privateKey);
      if (!delRes.ok && delRes.status !== 404) return err("eks", action, `OKE cluster delete failed: ${(await delRes.text()).slice(0, 400)}`);
      return ok("eks", action, `OKE cluster ${clusterId} deletion initiated`, { cluster_id: clusterId, region });
    }
    default:
      return err("eks", action, `Unknown OKE action: ${action}`);
  }
}

// ─── GCP GKE Handler ───

async function gcpEks(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const saJson = spec.gcp_service_account_json as string;
  const projectId = spec.gcp_project_id as string;
  const region = spec.gcp_region as string || spec.region as string || "us-central1";
  if (!saJson || !projectId) return err("eks", action, "GCP credentials required: gcp_service_account_json, gcp_project_id");
  let token: string;
  try { token = await gcpGetToken(saJson, ["https://www.googleapis.com/auth/cloud-platform"]); }
  catch (e) { return err("eks", action, `GCP auth failed: ${e instanceof Error ? e.message : String(e)}`); }
  const gkeFetch = (path: string, method = "GET", body?: string) =>
    fetch(`https://container.googleapis.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body } : {}),
    });

  switch (action) {
    case "dry_run":
    case "plan": {
      const res = await gkeFetch(`/v1/projects/${projectId}/locations/${region}/clusters?pageSize=5`);
      const body = await res.text();
      if (!res.ok) return err("eks", action, `GKE credential check failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      return ok("eks", action, "GCP credentials validated — GKE cluster ready to deploy", {
        projectId, region, cluster_count: (data.clusters as unknown[] || []).length, dry_run: true,
      });
    }
    case "discover": {
      const res = await gkeFetch(`/v1/projects/${projectId}/locations/-/clusters`);
      const body = await res.text();
      if (!res.ok) return err("eks", action, `GKE cluster list failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      const clusters = (data.clusters as Array<Record<string, unknown>> || []);
      return ok("eks", action, `Discovered ${clusters.length} GKE cluster(s)`, {
        projectId, region,
        clusters: clusters.map((c) => ({ name: c.name, location: c.location, status: c.status, currentMasterVersion: c.currentMasterVersion })),
      });
    }
    case "deploy": {
      const clusterName = spec.cluster_name as string || "uidi-gke";
      const network = spec.network as string || "default";
      const subnetwork = spec.subnetwork as string || "default";
      const k8sVersion = spec.kubernetes_version as string || "1.28";
      const res = await gkeFetch(`/v1/projects/${projectId}/locations/${region}/clusters`, "POST",
        JSON.stringify({
          cluster: {
            name: clusterName, initialNodeCount: 1, network, subnetwork, initialClusterVersion: k8sVersion,
            nodePools: [{
              name: "default-pool", initialNodeCount: 1,
              config: { machineType: "e2-standard-2", diskSizeGb: 100, oauthScopes: ["https://www.googleapis.com/auth/cloud-platform"] },
            }],
          },
        }));
      const body = await res.text();
      if (!res.ok) return err("eks", action, `GKE cluster create failed: ${body.slice(0, 400)}`);
      const op = JSON.parse(body) as Record<string, unknown>;
      return ok("eks", action, `GKE cluster ${clusterName} creation initiated`, { cluster_name: clusterName, region, projectId, operation_id: op.name });
    }
    case "destroy": {
      const clusterName = spec.cluster_name as string;
      if (!clusterName) return err("eks", action, "cluster_name required for GKE destroy");
      const res = await gkeFetch(`/v1/projects/${projectId}/locations/${region}/clusters/${clusterName}`, "DELETE");
      if (!res.ok && res.status !== 404) return err("eks", action, `GKE cluster delete failed: ${(await res.text()).slice(0, 400)}`);
      return ok("eks", action, `GKE cluster ${clusterName} deletion initiated`, { cluster_name: clusterName, region, projectId });
    }
    default:
      return err("eks", action, `Unknown GKE action: ${action}`);
  }
}

// ─── Azure AKS Handler ───

async function azureEks(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const clientId = spec.azure_client_id as string;
  const clientSecret = spec.azure_client_secret as string;
  const tenantId = spec.azure_tenant_id as string;
  const subscriptionId = spec.azure_subscription_id as string;
  const resourceGroup = spec.azure_resource_group as string || spec.resource_group as string || `uidi-${spec.environment || "default"}`;
  const region = spec.azure_region as string || spec.region as string || "eastus";
  if (!clientId || !clientSecret || !tenantId || !subscriptionId) {
    return err("eks", action, "Azure credentials required: azure_client_id, azure_client_secret, azure_tenant_id, azure_subscription_id");
  }
  let token: string;
  try { token = await azureGetToken(tenantId, clientId, clientSecret); }
  catch (e) { return err("eks", action, `Azure auth failed: ${e instanceof Error ? e.message : String(e)}`); }
  const subBase = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService`;
  const azFetch = (path: string, method = "GET", body?: string) =>
    fetch(`https://management.azure.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body } : {}),
    });

  switch (action) {
    case "dry_run":
    case "plan": {
      const res = await azFetch(`${subBase}/managedClusters?api-version=2023-04-02-preview`);
      const body = await res.text();
      if (!res.ok) return err("eks", action, `AKS credential check failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      return ok("eks", action, "Azure credentials validated — AKS cluster ready to deploy", {
        subscriptionId, resourceGroup, region, cluster_count: (data.value as unknown[] || []).length, dry_run: true,
      });
    }
    case "discover": {
      const res = await azFetch(`${subBase}/managedClusters?api-version=2023-04-02-preview`);
      const body = await res.text();
      if (!res.ok) return err("eks", action, `AKS cluster list failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      const items = (data.value as Array<Record<string, unknown>> || []);
      return ok("eks", action, `Discovered ${items.length} AKS cluster(s)`, {
        subscriptionId, resourceGroup, region,
        clusters: items.map((c) => ({ name: c.name, location: c.location, provisioningState: (c.properties as Record<string, unknown>)?.provisioningState })),
      });
    }
    case "deploy": {
      const clusterName = spec.cluster_name as string || "uidi-aks";
      const k8sVersion = spec.kubernetes_version as string || "1.28.0";
      const subnetId = spec.subnet_id as string;
      const res = await azFetch(`${subBase}/managedClusters/${clusterName}?api-version=2023-04-02-preview`, "PUT",
        JSON.stringify({
          location: region,
          properties: {
            kubernetesVersion: k8sVersion, dnsPrefix: clusterName,
            agentPoolProfiles: [{
              name: "agentpool", count: 1, vmSize: "Standard_D2_v2", mode: "System",
              ...(subnetId ? { vnetSubnetID: subnetId } : {}),
            }],
            networkProfile: { networkPlugin: "kubenet" },
          },
        }));
      const body = await res.text();
      if (!res.ok) return err("eks", action, `AKS cluster create failed: ${body.slice(0, 400)}`);
      const cluster = JSON.parse(body) as Record<string, unknown>;
      return ok("eks", action, `AKS cluster ${clusterName} creation initiated`, {
        cluster_name: clusterName, region, subscriptionId, resourceGroup,
        provisioning_state: (cluster.properties as Record<string, unknown>)?.provisioningState,
      });
    }
    case "destroy": {
      const clusterName = spec.cluster_name as string;
      if (!clusterName) return err("eks", action, "cluster_name required for AKS destroy");
      const res = await azFetch(`${subBase}/managedClusters/${clusterName}?api-version=2023-04-02-preview`, "DELETE");
      if (!res.ok && res.status !== 404 && res.status !== 202) return err("eks", action, `AKS cluster delete failed: ${(await res.text()).slice(0, 400)}`);
      return ok("eks", action, `AKS cluster ${clusterName} deletion initiated`, { cluster_name: clusterName, region, resourceGroup });
    }
    default:
      return err("eks", action, `Unknown AKS action: ${action}`);
  }
}

// ─── OCI Compute Handler ───

async function ociCompute(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const tenancy = spec.oci_tenancy_ocid as string;
  const user = spec.oci_user_ocid as string;
  const fingerprint = spec.oci_fingerprint as string;
  const privateKey = spec.oci_private_key as string;
  const region = spec.oci_region as string || spec.region as string || "us-ashburn-1";
  const compartment = spec.oci_compartment_id as string || tenancy;
  if (!tenancy || !user || !fingerprint || !privateKey) return err("compute", action, "OCI credentials required");
  const host = `iaas.${region}.oraclecloud.com`;

  switch (action) {
    case "dry_run":
    case "plan": {
      const res = await ociRequest("GET", host, `/20160918/instances?compartmentId=${encodeURIComponent(compartment)}&limit=5`, tenancy, user, fingerprint, privateKey);
      const body = await res.text();
      if (!res.ok) return err("compute", action, `OCI credential check failed: ${body.slice(0, 400)}`);
      const instances = JSON.parse(body) as unknown[];
      return ok("compute", action, "OCI credentials validated — compute instance ready to deploy", {
        region, compartment, instance_count: instances.length, dry_run: true,
      });
    }
    case "discover": {
      const res = await ociRequest("GET", host, `/20160918/instances?compartmentId=${encodeURIComponent(compartment)}&limit=50`, tenancy, user, fingerprint, privateKey);
      const body = await res.text();
      if (!res.ok) return err("compute", action, `OCI instance list failed: ${body.slice(0, 400)}`);
      const instances = JSON.parse(body) as Array<Record<string, unknown>>;
      return ok("compute", action, `Discovered ${instances.length} OCI instance(s)`, {
        region, compartment,
        instances: instances.map((i) => ({ id: i.id, displayName: i.displayName, lifecycleState: i.lifecycleState, shape: i.shape })),
      });
    }
    case "deploy": {
      const name = spec.name as string || "uidi-instance";
      const shape = spec.instance_type as string || "VM.Standard.E4.Flex";
      const subnetId = spec.subnet_id as string;
      const imageId = spec.image_id as string;
      if (!subnetId) return err("compute", action, "subnet_id required for OCI compute deploy");
      if (!imageId) return err("compute", action, "image_id required for OCI compute deploy");
      const instanceRes = await ociRequest("POST", host, "/20160918/instances", tenancy, user, fingerprint, privateKey,
        JSON.stringify({
          displayName: name, compartmentId: compartment, shape,
          shapeConfig: shape.includes("Flex") ? { ocpus: 1, memoryInGBs: 6 } : undefined,
          sourceDetails: { sourceType: "image", imageId },
          createVnicDetails: { subnetId },
        }));
      const instanceBody = await instanceRes.text();
      if (!instanceRes.ok) return err("compute", action, `OCI LaunchInstance failed: ${instanceBody.slice(0, 400)}`);
      const instance = JSON.parse(instanceBody) as Record<string, unknown>;
      return ok("compute", action, `OCI instance ${name} launched`, { instance_id: instance.id, name, region, compartment, shape });
    }
    case "destroy": {
      const instanceId = spec.instance_id as string;
      if (!instanceId) return err("compute", action, "instance_id required for OCI compute destroy");
      const delRes = await ociRequest("DELETE", host, `/20160918/instances/${encodeURIComponent(instanceId)}?preserveBootVolume=false`, tenancy, user, fingerprint, privateKey);
      if (!delRes.ok && delRes.status !== 404) return err("compute", action, `OCI instance terminate failed: ${(await delRes.text()).slice(0, 400)}`);
      return ok("compute", action, `OCI instance ${instanceId} termination initiated`, { instance_id: instanceId, region });
    }
    default:
      return err("compute", action, `Unknown OCI compute action: ${action}`);
  }
}

// ─── GCP Compute Handler ───

async function gcpCompute(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const saJson = spec.gcp_service_account_json as string;
  const projectId = spec.gcp_project_id as string;
  const region = spec.gcp_region as string || spec.region as string || "us-central1";
  const zone = spec.zone as string || `${region}-a`;
  if (!saJson || !projectId) return err("compute", action, "GCP credentials required: gcp_service_account_json, gcp_project_id");
  let token: string;
  try { token = await gcpGetToken(saJson, ["https://www.googleapis.com/auth/cloud-platform"]); }
  catch (e) { return err("compute", action, `GCP auth failed: ${e instanceof Error ? e.message : String(e)}`); }
  const gcpFetch = (path: string, method = "GET", body?: string) =>
    fetch(`https://compute.googleapis.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body } : {}),
    });

  switch (action) {
    case "dry_run":
    case "plan": {
      const res = await gcpFetch(`/compute/v1/projects/${projectId}/zones/${zone}/instances?maxResults=5`);
      const body = await res.text();
      if (!res.ok) return err("compute", action, `GCP credential check failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      return ok("compute", action, "GCP credentials validated — compute instance ready to deploy", {
        projectId, zone, instance_count: (data.items as unknown[] || []).length, dry_run: true,
      });
    }
    case "discover": {
      const res = await gcpFetch(`/compute/v1/projects/${projectId}/zones/${zone}/instances`);
      const body = await res.text();
      if (!res.ok) return err("compute", action, `GCP instance list failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      const items = (data.items as Array<Record<string, unknown>> || []);
      return ok("compute", action, `Discovered ${items.length} GCP instance(s)`, {
        projectId, zone,
        instances: items.map((i) => ({ name: i.name, id: i.id, status: i.status, machineType: i.machineType })),
      });
    }
    case "deploy": {
      const name = spec.name as string || "uidi-instance";
      const machineType = spec.instance_type as string || "e2-medium";
      const network = spec.network as string || "default";
      const res = await gcpFetch(`/compute/v1/projects/${projectId}/zones/${zone}/instances`, "POST",
        JSON.stringify({
          name, machineType: `zones/${zone}/machineTypes/${machineType}`,
          networkInterfaces: [{ network: `projects/${projectId}/global/networks/${network}`, accessConfigs: [{ type: "ONE_TO_ONE_NAT" }] }],
          disks: [{ boot: true, autoDelete: true, initializeParams: { sourceImage: "projects/debian-cloud/global/images/family/debian-11", diskSizeGb: "20" } }],
        }));
      const body = await res.text();
      if (!res.ok) return err("compute", action, `GCP instance create failed: ${body.slice(0, 400)}`);
      const op = JSON.parse(body) as Record<string, unknown>;
      return ok("compute", action, `GCP instance ${name} creation initiated`, { name, zone, projectId, operation_id: op.name });
    }
    case "destroy": {
      const name = spec.name as string || spec.instance_id as string;
      if (!name) return err("compute", action, "name or instance_id required for GCP compute destroy");
      const res = await gcpFetch(`/compute/v1/projects/${projectId}/zones/${zone}/instances/${name}`, "DELETE");
      if (!res.ok && res.status !== 404) return err("compute", action, `GCP instance delete failed: ${(await res.text()).slice(0, 400)}`);
      return ok("compute", action, `GCP instance ${name} deletion initiated`, { name, zone, projectId });
    }
    default:
      return err("compute", action, `Unknown GCP compute action: ${action}`);
  }
}

// ─── Azure Compute Handler ───

async function azureCompute(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const clientId = spec.azure_client_id as string;
  const clientSecret = spec.azure_client_secret as string;
  const tenantId = spec.azure_tenant_id as string;
  const subscriptionId = spec.azure_subscription_id as string;
  const resourceGroup = spec.azure_resource_group as string || spec.resource_group as string || `uidi-${spec.environment || "default"}`;
  const region = spec.azure_region as string || spec.region as string || "eastus";
  if (!clientId || !clientSecret || !tenantId || !subscriptionId) {
    return err("compute", action, "Azure credentials required: azure_client_id, azure_client_secret, azure_tenant_id, azure_subscription_id");
  }
  let token: string;
  try { token = await azureGetToken(tenantId, clientId, clientSecret); }
  catch (e) { return err("compute", action, `Azure auth failed: ${e instanceof Error ? e.message : String(e)}`); }
  const subBase = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute`;
  const netBase = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network`;
  const azFetch = (path: string, method = "GET", body?: string) =>
    fetch(`https://management.azure.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body } : {}),
    });

  switch (action) {
    case "dry_run":
    case "plan": {
      const res = await azFetch(`${subBase}/virtualMachines?api-version=2023-03-01`);
      const body = await res.text();
      if (!res.ok) return err("compute", action, `Azure credential check failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      return ok("compute", action, "Azure credentials validated — VM ready to deploy", {
        subscriptionId, resourceGroup, region, vm_count: (data.value as unknown[] || []).length, dry_run: true,
      });
    }
    case "discover": {
      const res = await azFetch(`${subBase}/virtualMachines?api-version=2023-03-01`);
      const body = await res.text();
      if (!res.ok) return err("compute", action, `Azure VM list failed: ${body.slice(0, 400)}`);
      const data = JSON.parse(body) as Record<string, unknown>;
      const items = (data.value as Array<Record<string, unknown>> || []);
      return ok("compute", action, `Discovered ${items.length} Azure VM(s)`, {
        subscriptionId, resourceGroup, region,
        vms: items.map((v) => ({ name: v.name, location: v.location, provisioningState: (v.properties as Record<string, unknown>)?.provisioningState })),
      });
    }
    case "deploy": {
      const name = spec.name as string || "uidi-vm";
      const vmSize = spec.instance_type as string || "Standard_B2s";
      const subnetId = spec.subnet_id as string;
      // NIC
      const nicRes = await azFetch(`${netBase}/networkInterfaces/${name}-nic?api-version=2023-04-01`, "PUT",
        JSON.stringify({
          location: region,
          properties: {
            ipConfigurations: [{
              name: "ipconfig1",
              properties: { privateIPAllocationMethod: "Dynamic", ...(subnetId ? { subnet: { id: subnetId } } : {}) },
            }],
          },
        }));
      const nicBody = await nicRes.text();
      if (!nicRes.ok) return err("compute", action, `Azure CreateNIC failed: ${nicBody.slice(0, 400)}`);
      const nicId = (JSON.parse(nicBody) as Record<string, unknown>).id as string;
      // VM
      const vmRes = await azFetch(`${subBase}/virtualMachines/${name}?api-version=2023-03-01`, "PUT",
        JSON.stringify({
          location: region,
          properties: {
            hardwareProfile: { vmSize },
            storageProfile: {
              imageReference: { publisher: "Canonical", offer: "UbuntuServer", sku: "18.04-LTS", version: "latest" },
              osDisk: { createOption: "FromImage", diskSizeGB: 30 },
            },
            osProfile: { computerName: name, adminUsername: "uidi", adminPassword: `Uidi-${Date.now()}!` },
            networkProfile: { networkInterfaces: [{ id: nicId }] },
          },
        }));
      const vmBody = await vmRes.text();
      if (!vmRes.ok) return err("compute", action, `Azure CreateVM failed: ${vmBody.slice(0, 400)}`);
      const vm = JSON.parse(vmBody) as Record<string, unknown>;
      return ok("compute", action, `Azure VM ${name} creation initiated`, { vm_id: vm.id, name, region, resourceGroup, subscriptionId });
    }
    case "destroy": {
      const name = spec.name as string || spec.instance_id as string;
      if (!name) return err("compute", action, "name or instance_id required for Azure compute destroy");
      await azFetch(`${subBase}/virtualMachines/${name}?api-version=2023-03-01`, "DELETE");
      await azFetch(`${netBase}/networkInterfaces/${name}-nic?api-version=2023-04-01`, "DELETE");
      return ok("compute", action, `Azure VM ${name} deletion initiated`, { name, region, resourceGroup });
    }
    default:
      return err("compute", action, `Unknown Azure compute action: ${action}`);
  }
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

      // ── S3 Buckets ──
      try {
        const s3Res = await awsSignedRequest({ service: "s3", region, method: "GET", path: "/", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET, hostOverride: `s3.${region}.amazonaws.com` });
        if (s3Res.ok) {
          const s3Body = await s3Res.text();
          const bucketNames = [...s3Body.matchAll(/<Name>([^<]+)<\/Name>/g)].map(m => m[1]);
          for (const bucketName of bucketNames) {
            const managed = bucketName.includes("uidi") || bucketName.includes("sre-");
            resources.push({
              id: bucketName, type: "s3" as any, name: bucketName, region,
              state: "available", managed, tags: {}, details: {},
            });
          }
        }
      } catch { /* S3 scan optional */ }

      // ── CloudFront Distributions ──
      try {
        const cfRes = await awsSignedRequest({ service: "cloudfront", region: "us-east-1", method: "GET", path: "/2020-05-31/distribution", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET, hostOverride: "cloudfront.amazonaws.com" });
        if (cfRes.ok) {
          const cfBody = await cfRes.text();
          const distBlocks = cfBody.match(/<DistributionSummary>[\s\S]*?<\/DistributionSummary>/g) || [];
          for (const block of distBlocks) {
            const id = block.match(/<Id>([^<]+)<\/Id>/)?.[1];
            const domain = block.match(/<DomainName>([^<]+)<\/DomainName>/)?.[1];
            const status = block.match(/<Status>([^<]+)<\/Status>/)?.[1] || "unknown";
            const comment = block.match(/<Comment>([^<]*)<\/Comment>/)?.[1] || "";
            if (!id) continue;
            const managed = comment.toLowerCase().includes("uidi") || comment.includes("sre-") || comment.includes("global-spa");
            resources.push({
              id, type: "cloudfront" as any, name: domain || id, region: "global",
              state: status, managed, tags: {}, details: { domain, comment },
            });
          }
        }
      } catch { /* CloudFront scan optional */ }

      // ── SQS Queues ──
      try {
        const sqsRes = await executeAwsCommand("SQS", "ListQueues", {}, region, { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
        const queueUrls = sqsRes?.QueueUrls || [];
        for (const qUrl of queueUrls) {
          const qName = String(qUrl).split("/").pop() || qUrl;
          const managed = qName.includes("uidi") || qName.includes("pipeline") || qName.includes("sre-");
          resources.push({
            id: qUrl, type: "sqs" as any, name: qName, region,
            state: "active", managed, tags: {}, details: { queue_url: qUrl },
          });
        }
      } catch { /* SQS scan optional */ }

      // ── Lambda Functions ──
      try {
        const lambdaRes = await awsSignedRequest({ service: "lambda", region, method: "GET", path: "/2015-03-31/functions", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET, hostOverride: `lambda.${region}.amazonaws.com` });
        if (lambdaRes.ok) {
          const lambdaData = JSON.parse(await lambdaRes.text());
          for (const fn of (lambdaData.Functions || [])) {
            const managed = (fn.Tags?.ManagedBy === "UIDI") || fn.FunctionName?.includes("uidi") || fn.FunctionName?.includes("sre-");
            resources.push({
              id: fn.FunctionArn || fn.FunctionName, type: "lambda" as any, name: fn.FunctionName, region,
              state: fn.State || "Active", managed, tags: fn.Tags || {},
              details: { runtime: fn.Runtime, memory: fn.MemorySize, timeout: fn.Timeout },
            });
          }
        }
      } catch { /* Lambda scan optional */ }

      // ── API Gateway (HTTP APIs) ──
      try {
        const apigwRes = await awsSignedRequest({ service: "apigateway", region, method: "GET", path: "/v2/apis", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET, hostOverride: `apigateway.${region}.amazonaws.com` });
        if (apigwRes.ok) {
          const apigwData = JSON.parse(await apigwRes.text());
          for (const api of (apigwData.Items || [])) {
            const managed = api.Name?.includes("uidi") || api.Name?.includes("sre-") || api.Tags?.ManagedBy === "UIDI";
            resources.push({
              id: api.ApiId, type: "api_gateway" as any, name: api.Name || api.ApiId, region,
              state: "active", managed, tags: api.Tags || {},
              details: { protocol: api.ProtocolType, endpoint: api.ApiEndpoint },
            });
          }
        }
      } catch { /* API Gateway scan optional */ }

      // ── Security Groups ──
      try {
        const sgParams = new URLSearchParams({ Action: "DescribeSecurityGroups", Version: "2016-11-15" });
        const sgRes = await ec2Request("POST", region, sgParams.toString(), AWS_KEY, AWS_SECRET);
        const sgBody = await sgRes.text();
        if (sgRes.ok) {
          const sgItems = sgBody.match(/<item>[\s\S]*?<groupId>sg-[a-f0-9]+<\/groupId>[\s\S]*?<\/item>/g) || [];
          for (const item of sgItems) {
            const id = item.match(/<groupId>(sg-[a-f0-9]+)<\/groupId>/)?.[1];
            if (!id) continue;
            const groupName = item.match(/<groupName>([^<]+)<\/groupName>/)?.[1] || id;
            const vpcId = item.match(/<vpcId>(vpc-[a-f0-9]+)<\/vpcId>/)?.[1] || "";
            const tags: Record<string, string> = {};
            const tagMatches = item.matchAll(/<key>([^<]+)<\/key>\s*<value>([^<]*)<\/value>/g);
            for (const m of tagMatches) tags[m[1]] = m[2];
            const managed = tags["ManagedBy"] === "UIDI" || groupName.includes("uidi") || groupName.includes("sre-");
            if (groupName === "default") continue; // skip default SGs
            resources.push({
              id, type: "security_group" as any, name: tags["Name"] || groupName, region,
              state: "active", managed, tags, details: { group_name: groupName, vpc_id: vpcId },
            });
          }
        }
      } catch { /* SG scan optional */ }

      // ── Subnets ──
      try {
        const subParams = new URLSearchParams({ Action: "DescribeSubnets", Version: "2016-11-15" });
        const subRes = await ec2Request("POST", region, subParams.toString(), AWS_KEY, AWS_SECRET);
        const subBody = await subRes.text();
        if (subRes.ok) {
          const subItems = subBody.match(/<item>[\s\S]*?<subnetId>subnet-[a-f0-9]+<\/subnetId>[\s\S]*?<\/item>/g) || [];
          for (const item of subItems) {
            const id = item.match(/<subnetId>(subnet-[a-f0-9]+)<\/subnetId>/)?.[1];
            if (!id) continue;
            const cidr = item.match(/<cidrBlock>([^<]+)<\/cidrBlock>/)?.[1] || "";
            const az = item.match(/<availabilityZone>([^<]+)<\/availabilityZone>/)?.[1] || "";
            const defaultForAz = item.includes("<defaultForAz>true</defaultForAz>");
            const tags: Record<string, string> = {};
            const tagMatches = item.matchAll(/<key>([^<]+)<\/key>\s*<value>([^<]*)<\/value>/g);
            for (const m of tagMatches) tags[m[1]] = m[2];
            const managed = tags["ManagedBy"] === "UIDI" || tags["Name"]?.includes("uidi") || tags["Name"]?.includes("sre-");
            if (defaultForAz && !managed) continue; // skip default subnets
            resources.push({
              id, type: "subnet" as any, name: tags["Name"] || `${id} (${az})`, region,
              state: "available", managed, tags, details: { cidr, availability_zone: az },
            });
          }
        }
      } catch { /* Subnet scan optional */ }

      // Categorize
      const wasteResources = resources.filter(r => r.waste);
      const managedResources = resources.filter(r => r.managed);
      const orphanResources = resources.filter(r => !r.managed && r.type !== "vpc");

      const byType: Record<string, number> = {};
      for (const r of resources) {
        byType[r.type] = (byType[r.type] || 0) + 1;
      }

      return ok("inventory", action, `Scanned ${resources.length} resource(s): ${managedResources.length} managed, ${wasteResources.length} waste, ${orphanResources.length} unmanaged`, {
        resources,
        summary: {
          total: resources.length,
          managed: managedResources.length,
          waste: wasteResources.length,
          orphan: orphanResources.length,
          by_type: byType,
        },
        region,
      });
    }

    case "nuke":
    case "destroy": {
      const resourceId = spec.resource_id as string;
      const resourceType = spec.resource_type as string;
      if (!resourceId || !resourceType) return err("inventory", action, "resource_id and resource_type required.");

      const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
      const steps: string[] = [];

      try {
        switch (resourceType) {
          case "ec2": {
            // 1. Check for attached EBS volumes and EIPs
            const descParams = new URLSearchParams({ Action: "DescribeInstances", Version: "2016-11-15", "InstanceId.1": resourceId });
            const descRes = await ec2Request("POST", region, descParams.toString(), AWS_KEY, AWS_SECRET);
            const descBody = await descRes.text();

            // Disassociate any EIPs first
            const eipAssocs = descBody.matchAll(/<associationId>(eipassoc-[a-f0-9]+)<\/associationId>/g);
            for (const m of eipAssocs) {
              const disParams = new URLSearchParams({ Action: "DisassociateAddress", Version: "2016-11-15", AssociationId: m[1] });
              await ec2Request("POST", region, disParams.toString(), AWS_KEY, AWS_SECRET);
              steps.push(`Disassociated EIP ${m[1]}`);
            }

            // Terminate instance
            const termParams = new URLSearchParams({ Action: "TerminateInstances", Version: "2016-11-15", "InstanceId.1": resourceId });
            const termRes = await ec2Request("POST", region, termParams.toString(), AWS_KEY, AWS_SECRET);
            const termBody = await termRes.text();
            if (!termRes.ok) return err("inventory", action, extractEc2Error(termBody) || "TerminateInstances failed", { steps });
            steps.push(`Terminated instance ${resourceId}`);

            // Wait and verify
            await new Promise(r => setTimeout(r, 2000));
            const verifyParams = new URLSearchParams({ Action: "DescribeInstances", Version: "2016-11-15", "InstanceId.1": resourceId });
            const verifyRes = await ec2Request("POST", region, verifyParams.toString(), AWS_KEY, AWS_SECRET);
            const verifyBody = await verifyRes.text();
            const finalState = verifyBody.match(/<name>(shutting-down|terminated)<\/name>/)?.[1] || "terminating";
            steps.push(`Final state: ${finalState}`);

            return ok("inventory", action, `Instance ${resourceId} ${finalState}`, { resource_id: resourceId, state: finalState, steps });
          }

          case "ebs": {
            // 1. Check if attached — detach first if so
            const volParams = new URLSearchParams({ Action: "DescribeVolumes", Version: "2016-11-15", "VolumeId.1": resourceId });
            const volRes = await ec2Request("POST", region, volParams.toString(), AWS_KEY, AWS_SECRET);
            const volBody = await volRes.text();
            const attachedInstance = volBody.match(/<instanceId>(i-[a-f0-9]+)<\/instanceId>/)?.[1];
            const attachStatus = volBody.match(/<status>(attached|attaching)<\/status>/)?.[1];

            if (attachedInstance && attachStatus) {
              const detachParams = new URLSearchParams({ Action: "DetachVolume", Version: "2016-11-15", VolumeId: resourceId, Force: "true" });
              const detachRes = await ec2Request("POST", region, detachParams.toString(), AWS_KEY, AWS_SECRET);
              if (!detachRes.ok) {
                const detachBody = await detachRes.text();
                return err("inventory", action, `Cannot detach volume from ${attachedInstance}: ${extractEc2Error(detachBody)}`, { steps });
              }
              steps.push(`Force-detached from instance ${attachedInstance}`);
              // Poll until volume is fully detached (up to 60s)
              for (let poll = 0; poll < 12; poll++) {
                await new Promise(r => setTimeout(r, 5000));
                const pollParams = new URLSearchParams({ Action: "DescribeVolumes", Version: "2016-11-15", "VolumeId.1": resourceId });
                const pollRes = await ec2Request("POST", region, pollParams.toString(), AWS_KEY, AWS_SECRET);
                const pollBody = await pollRes.text();
                const curStatus = pollBody.match(/<status>(available|in-use|detaching)<\/status>/)?.[1];
                if (curStatus === "available") break;
                if (poll === 11) {
                  steps.push(`Warning: volume still not fully detached after 60s, attempting delete anyway`);
                }
              }
            }

            // Retry delete up to 3 times to handle eventual consistency
            let lastDelError = "";
            for (let attempt = 0; attempt < 3; attempt++) {
              const delParams = new URLSearchParams({ Action: "DeleteVolume", Version: "2016-11-15", VolumeId: resourceId });
              const delRes = await ec2Request("POST", region, delParams.toString(), AWS_KEY, AWS_SECRET);
              const delBody = await delRes.text();
              if (delRes.ok) {
                steps.push(`Deleted volume ${resourceId}`);
                return ok("inventory", action, `Volume ${resourceId} deleted`, { resource_id: resourceId, steps });
              }
              lastDelError = extractEc2Error(delBody) || "DeleteVolume failed";
              // If volume is still in-use/detaching, wait and retry
              if (lastDelError.includes("in-use") || lastDelError.includes("VolumeInUse")) {
                steps.push(`Retry ${attempt + 1}: volume still in-use, waiting 10s...`);
                await new Promise(r => setTimeout(r, 10000));
                continue;
              }
              // Non-retryable error
              break;
            }
            return err("inventory", action, lastDelError, { steps });
          }

          case "eip": {
            // 1. Disassociate if associated
            const eipParams = new URLSearchParams({ Action: "DescribeAddresses", Version: "2016-11-15", "AllocationId.1": resourceId });
            const eipRes = await ec2Request("POST", region, eipParams.toString(), AWS_KEY, AWS_SECRET);
            const eipBody = await eipRes.text();
            const assocId = eipBody.match(/<associationId>(eipassoc-[a-f0-9]+)<\/associationId>/)?.[1];

            if (assocId) {
              const disParams = new URLSearchParams({ Action: "DisassociateAddress", Version: "2016-11-15", AssociationId: assocId });
              const disRes = await ec2Request("POST", region, disParams.toString(), AWS_KEY, AWS_SECRET);
              if (!disRes.ok) {
                const disBody = await disRes.text();
                return err("inventory", action, `Cannot disassociate EIP: ${extractEc2Error(disBody)}`, { steps });
              }
              steps.push(`Disassociated from ${assocId}`);
              await new Promise(r => setTimeout(r, 1000));
            }

            const relParams = new URLSearchParams({ Action: "ReleaseAddress", Version: "2016-11-15", AllocationId: resourceId });
            const relRes = await ec2Request("POST", region, relParams.toString(), AWS_KEY, AWS_SECRET);
            const relBody = await relRes.text();
            if (!relRes.ok) return err("inventory", action, extractEc2Error(relBody) || "ReleaseAddress failed", { steps });
            steps.push(`Released Elastic IP ${resourceId}`);
            return ok("inventory", action, `Elastic IP ${resourceId} released`, { resource_id: resourceId, steps });
          }

          case "vpc": {
            const result = await handleNetwork("destroy", { vpc_id: resourceId, region, access_key_id: AWS_KEY, secret_access_key: AWS_SECRET });
            return result;
          }

          case "eks": {
            const clusterName = spec.cluster_name as string || resourceId;
            const result = await handleEks("destroy", { cluster_name: clusterName, region, access_key_id: AWS_KEY, secret_access_key: AWS_SECRET });
            return result;
          }

          case "s3": {
            // 1. Empty the bucket first (required before deletion)
            const bucketName = spec.bucket_name as string || resourceId;
            let truncated = true;
            let objectsDeleted = 0;

            while (truncated) {
              const listRes = await awsSignedRequest({
                service: "s3", region, method: "GET",
                path: `/${bucketName}?list-type=2&max-keys=1000`,
                accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
                hostOverride: `s3.${region}.amazonaws.com`,
              });
              const listBody = await listRes.text();
              if (!listRes.ok) return err("inventory", action, `Cannot list objects in bucket ${bucketName}: ${listBody.slice(0, 200)}`, { steps });

              const keys = [...listBody.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
              if (keys.length === 0) break;

              // Delete objects one by one (simple approach, avoids XML multi-delete complexity)
              for (const key of keys) {
                await awsSignedRequest({
                  service: "s3", region, method: "DELETE",
                  path: `/${bucketName}/${key}`,
                  accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
                  hostOverride: `s3.${region}.amazonaws.com`,
                });
                objectsDeleted++;
              }
              steps.push(`Deleted ${keys.length} objects`);
              truncated = listBody.includes("<IsTruncated>true</IsTruncated>");
            }
            if (objectsDeleted > 0) steps.push(`Total objects removed: ${objectsDeleted}`);

            // 2. Delete bucket
            const delRes = await awsSignedRequest({
              service: "s3", region, method: "DELETE",
              path: `/${bucketName}`,
              accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
              hostOverride: `s3.${region}.amazonaws.com`,
            });
            if (!delRes.ok) {
              const delBody = await delRes.text();
              return err("inventory", action, `DeleteBucket failed: ${delBody.slice(0, 200)}`, { steps });
            }
            steps.push(`Deleted bucket ${bucketName}`);
            return ok("inventory", action, `S3 bucket ${bucketName} deleted (${objectsDeleted} objects removed)`, { resource_id: resourceId, steps });
          }

          case "cloudfront": {
            const distId = resourceId;
            // 1. Get current config + ETag
            const getRes = await awsSignedRequest({
              service: "cloudfront", region: "us-east-1", method: "GET",
              path: `/2020-05-31/distribution/${distId}/config`,
              accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
              hostOverride: "cloudfront.amazonaws.com",
            });
            if (!getRes.ok) {
              const getBody = await getRes.text();
              return err("inventory", action, `Cannot get distribution config: ${getBody.slice(0, 200)}`, { steps });
            }
            const configBody = await getRes.text();
            let etag = getRes.headers.get("etag") || "";

            // 2. If enabled, disable it first
            if (configBody.includes("<Enabled>true</Enabled>")) {
              const disabledConfig = configBody
                .replace(/<Enabled>true<\/Enabled>/, "<Enabled>false</Enabled>")
                .replace(/<\?xml[^?]*\?>/, ""); // strip XML declaration from body
              
              const disableRes = await awsSignedRequest({
                service: "cloudfront", region: "us-east-1", method: "PUT",
                path: `/2020-05-31/distribution/${distId}/config`,
                accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
                hostOverride: "cloudfront.amazonaws.com",
                body: disabledConfig,
                extraHeaders: { "Content-Type": "application/xml", "If-Match": etag },
              });
              if (!disableRes.ok) {
                const disBody = await disableRes.text();
                return err("inventory", action, `Cannot disable distribution: ${disBody.slice(0, 300)}`, { steps });
              }
              etag = disableRes.headers.get("etag") || etag;
              steps.push(`Disabled distribution ${distId}`);

              // CloudFront distributions take time to disable — we can't delete immediately
              // Return pending status so user can retry
              return ok("inventory", action, `Distribution ${distId} disabled. CloudFront takes 5-15 minutes to fully disable. Re-scan and nuke again to complete deletion.`, {
                resource_id: resourceId,
                state: "disabling",
                retry_after_minutes: 10,
                steps,
              });
            }

            // 3. If already disabled, check if deployed
            const statusRes = await awsSignedRequest({
              service: "cloudfront", region: "us-east-1", method: "GET",
              path: `/2020-05-31/distribution/${distId}`,
              accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
              hostOverride: "cloudfront.amazonaws.com",
            });
            const statusBody = await statusRes.text();
            const distStatus = statusBody.match(/<Status>([^<]+)<\/Status>/)?.[1];

            if (distStatus === "InProgress") {
              return ok("inventory", action, `Distribution ${distId} is still disabling (status: InProgress). Try again in a few minutes.`, {
                resource_id: resourceId, state: "disabling", retry_after_minutes: 5, steps,
              });
            }

            // 4. Delete
            const delRes = await awsSignedRequest({
              service: "cloudfront", region: "us-east-1", method: "DELETE",
              path: `/2020-05-31/distribution/${distId}`,
              accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
              hostOverride: "cloudfront.amazonaws.com",
              extraHeaders: { "If-Match": etag },
            });
            if (!delRes.ok) {
              const delBody = await delRes.text();
              // Common: DistributionNotDisabled
              if (delBody.includes("DistributionNotDisabled")) {
                return err("inventory", action, `Distribution ${distId} is not fully disabled yet. Wait a few minutes and try again.`, { steps, retry_after_minutes: 5 });
              }
              return err("inventory", action, `DeleteDistribution failed: ${delBody.slice(0, 300)}`, { steps });
            }
            steps.push(`Deleted distribution ${distId}`);
            return ok("inventory", action, `CloudFront distribution ${distId} deleted`, { resource_id: resourceId, steps });
          }

          case "sqs": {
            // SQS queues can be deleted directly by URL
            const queueUrl = spec.queue_url as string || resourceId;
            const result = await executeAwsCommand("SQS", "DeleteQueue", { QueueUrl: queueUrl }, region, creds);
            steps.push(`Deleted SQS queue`);
            return ok("inventory", action, `SQS queue deleted`, { resource_id: resourceId, steps });
          }

          case "lambda": {
            const functionName = spec.function_name as string || resourceId;
            // Remove event source mappings first
            try {
              const mappingsRes = await awsSignedRequest({
                service: "lambda", region, method: "GET",
                path: `/2015-03-31/event-source-mappings?FunctionName=${encodeURIComponent(functionName)}`,
                accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
                hostOverride: `lambda.${region}.amazonaws.com`,
              });
              if (mappingsRes.ok) {
                const mappingsData = JSON.parse(await mappingsRes.text());
                for (const m of (mappingsData.EventSourceMappings || [])) {
                  await awsSignedRequest({
                    service: "lambda", region, method: "DELETE",
                    path: `/2015-03-31/event-source-mappings/${m.UUID}`,
                    accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
                    hostOverride: `lambda.${region}.amazonaws.com`,
                  });
                  steps.push(`Removed event source mapping ${m.UUID}`);
                }
              }
            } catch { /* event source cleanup optional */ }

            // Delete function
            await executeAwsCommand("Lambda", "DeleteFunction", { FunctionName: functionName }, region, creds);
            steps.push(`Deleted Lambda function ${functionName}`);
            return ok("inventory", action, `Lambda function ${functionName} deleted`, { resource_id: resourceId, steps });
          }

          case "api_gateway": {
            const apiId = resourceId;
            await executeAwsCommand("ApiGatewayV2", "DeleteApi", { ApiId: apiId }, region, creds);
            steps.push(`Deleted API Gateway ${apiId}`);
            return ok("inventory", action, `API Gateway ${apiId} deleted`, { resource_id: resourceId, steps });
          }

          case "security_group": {
            // 1. Revoke all ingress/egress rules that reference this SG from other SGs
            const sgDescParams = new URLSearchParams({ Action: "DescribeSecurityGroups", Version: "2016-11-15", "GroupId.1": resourceId });
            const sgDescRes = await ec2Request("POST", region, sgDescParams.toString(), AWS_KEY, AWS_SECRET);
            const sgDescBody = await sgDescRes.text();

            // Check for dependent network interfaces
            const eniParams = new URLSearchParams({
              Action: "DescribeNetworkInterfaces", Version: "2016-11-15",
              "Filter.1.Name": "group-id", "Filter.1.Value.1": resourceId,
            });
            const eniRes = await ec2Request("POST", region, eniParams.toString(), AWS_KEY, AWS_SECRET);
            const eniBody = await eniRes.text();
            const eniIds = [...eniBody.matchAll(/<networkInterfaceId>(eni-[a-f0-9]+)<\/networkInterfaceId>/g)].map(m => m[1]);

            if (eniIds.length > 0) {
              // Try to detach ENIs
              for (const eniId of eniIds) {
                const attachId = eniBody.match(new RegExp(`<networkInterfaceId>${eniId}</networkInterfaceId>[\\s\\S]*?<attachmentId>(eni-attach-[a-f0-9]+)</attachmentId>`))?.[1];
                if (attachId) {
                  const detachParams = new URLSearchParams({ Action: "DetachNetworkInterface", Version: "2016-11-15", AttachmentId: attachId, Force: "true" });
                  try {
                    await ec2Request("POST", region, detachParams.toString(), AWS_KEY, AWS_SECRET);
                    steps.push(`Detached ENI ${eniId}`);
                  } catch { steps.push(`Could not detach ENI ${eniId} (may be primary)`); }
                }
              }
              await new Promise(r => setTimeout(r, 2000));
            }

            // Revoke all ingress rules
            const revokeInParams = new URLSearchParams({ Action: "RevokeSecurityGroupIngress", Version: "2016-11-15", GroupId: resourceId });
            // Simplified: revoke all by referencing the SG itself
            try {
              await ec2Request("POST", region, revokeInParams.toString(), AWS_KEY, AWS_SECRET);
            } catch { /* may fail if no rules */ }

            const delParams = new URLSearchParams({ Action: "DeleteSecurityGroup", Version: "2016-11-15", GroupId: resourceId });
            const delRes = await ec2Request("POST", region, delParams.toString(), AWS_KEY, AWS_SECRET);
            const delBody = await delRes.text();
            if (!delRes.ok) {
              const errMsg = extractEc2Error(delBody) || "DeleteSecurityGroup failed";
              if (errMsg.includes("DependencyViolation")) {
                return err("inventory", action, `Security group ${resourceId} has active dependencies (instances or ENIs still using it). Terminate those resources first.`, { steps, eni_count: eniIds.length });
              }
              return err("inventory", action, errMsg, { steps });
            }
            steps.push(`Deleted security group ${resourceId}`);
            return ok("inventory", action, `Security group ${resourceId} deleted`, { resource_id: resourceId, steps });
          }

          case "subnet": {
            // Check for instances in this subnet
            const subEc2Params = new URLSearchParams({
              Action: "DescribeInstances", Version: "2016-11-15",
              "Filter.1.Name": "subnet-id", "Filter.1.Value.1": resourceId,
              "Filter.2.Name": "instance-state-name",
              "Filter.2.Value.1": "running", "Filter.2.Value.2": "stopped", "Filter.2.Value.3": "pending",
            });
            const subEc2Res = await ec2Request("POST", region, subEc2Params.toString(), AWS_KEY, AWS_SECRET);
            const subEc2Body = await subEc2Res.text();
            const subInstances = [...subEc2Body.matchAll(/<instanceId>(i-[a-f0-9]+)<\/instanceId>/g)].map(m => m[1]);

            if (subInstances.length > 0) {
              return err("inventory", action, `Subnet ${resourceId} has ${subInstances.length} active instance(s): ${subInstances.join(", ")}. Terminate them first.`, { steps, blocking_instances: subInstances });
            }

            // Check for ENIs
            const subEniParams = new URLSearchParams({
              Action: "DescribeNetworkInterfaces", Version: "2016-11-15",
              "Filter.1.Name": "subnet-id", "Filter.1.Value.1": resourceId,
            });
            const subEniRes = await ec2Request("POST", region, subEniParams.toString(), AWS_KEY, AWS_SECRET);
            const subEniBody = await subEniRes.text();
            const subEnis = [...subEniBody.matchAll(/<networkInterfaceId>(eni-[a-f0-9]+)<\/networkInterfaceId>/g)].map(m => m[1]);

            // Try to delete non-primary ENIs
            for (const eniId of subEnis) {
              try {
                const delEniParams = new URLSearchParams({ Action: "DeleteNetworkInterface", Version: "2016-11-15", NetworkInterfaceId: eniId });
                await ec2Request("POST", region, delEniParams.toString(), AWS_KEY, AWS_SECRET);
                steps.push(`Deleted ENI ${eniId}`);
              } catch { steps.push(`Could not delete ENI ${eniId} (may be in use)`); }
            }

            const delParams = new URLSearchParams({ Action: "DeleteSubnet", Version: "2016-11-15", SubnetId: resourceId });
            const delRes = await ec2Request("POST", region, delParams.toString(), AWS_KEY, AWS_SECRET);
            const delBody = await delRes.text();
            if (!delRes.ok) {
              const errMsg = extractEc2Error(delBody) || "DeleteSubnet failed";
              if (errMsg.includes("DependencyViolation")) {
                return err("inventory", action, `Subnet ${resourceId} has active dependencies (ENIs or other resources). Clean those up first.`, { steps });
              }
              return err("inventory", action, errMsg, { steps });
            }
            steps.push(`Deleted subnet ${resourceId}`);
            return ok("inventory", action, `Subnet ${resourceId} deleted`, { resource_id: resourceId, steps });
          }

          case "app_mesh": {
            const meshName = spec.mesh_name as string || resourceId;
            // Delete virtual nodes first, then mesh
            try {
              const nodesRes = await awsSignedRequest({
                service: "appmesh", region, method: "GET",
                path: `/v20190125/meshes/${encodeURIComponent(meshName)}/virtualNodes`,
                accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
                hostOverride: `appmesh.${region}.amazonaws.com`,
              });
              if (nodesRes.ok) {
                const nodesData = JSON.parse(await nodesRes.text());
                for (const node of (nodesData.virtualNodes || [])) {
                  const nodeName = node.virtualNodeName || node.meshName;
                  if (!nodeName) continue;
                  await awsSignedRequest({
                    service: "appmesh", region, method: "DELETE",
                    path: `/v20190125/meshes/${encodeURIComponent(meshName)}/virtualNodes/${encodeURIComponent(nodeName)}`,
                    accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
                    hostOverride: `appmesh.${region}.amazonaws.com`,
                  });
                  steps.push(`Deleted virtual node ${nodeName}`);
                }
              }
            } catch { steps.push("Could not clean up virtual nodes"); }

            // Delete the mesh
            try {
              await awsSignedRequest({
                service: "appmesh", region, method: "DELETE",
                path: `/v20190125/meshes/${encodeURIComponent(meshName)}`,
                accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET,
                hostOverride: `appmesh.${region}.amazonaws.com`,
              });
              steps.push(`Deleted mesh ${meshName}`);
            } catch (e) {
              return err("inventory", action, `DeleteMesh failed: ${e instanceof Error ? e.message : String(e)}`, { steps });
            }
            return ok("inventory", action, `App Mesh ${meshName} deleted`, { resource_id: resourceId, steps });
          }

          default:
            return err("inventory", action, `Unsupported resource type for nuke: ${resourceType}. Supported: ec2, ebs, eip, vpc, eks, s3, cloudfront, sqs, lambda, api_gateway, security_group, subnet, app_mesh`);
        }
      } catch (e) {
        return err("inventory", action, `Nuke failed for ${resourceType}/${resourceId}: ${e instanceof Error ? e.message : String(e)}`, { steps });
      }
    }

    case "nuke-stack": {
      // Ordered multi-resource teardown: EKS → VPCs (handles the common "can't nuke because dependencies" problem)
      const targetRegion = spec.region as string || "us-east-1";
      const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
      const stackSteps: string[] = [];
      const errors: string[] = [];

      // Phase 1: Destroy all EKS clusters (this cleans up nodegroups + ENIs)
      try {
        const eksListRes = await awsSignedRequest({ service: "eks", region: targetRegion, method: "GET", path: "/clusters", accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
        if (eksListRes.ok) {
          const eksData = JSON.parse(await eksListRes.text());
          const clusters = (eksData.clusters || []) as string[];
          for (const clusterName of clusters) {
            // Check if managed
            const descRes = await awsSignedRequest({ service: "eks", region: targetRegion, method: "GET", path: `/clusters/${encodeURIComponent(clusterName)}`, accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET });
            if (descRes.ok) {
              const cData = JSON.parse(await descRes.text());
              const tags = cData.cluster?.tags || {};
              if (tags["ManagedBy"] !== "UIDI" && !spec.force) {
                stackSteps.push(`Skipped unmanaged cluster: ${clusterName}`);
                continue;
              }
            }
            stackSteps.push(`Destroying EKS cluster: ${clusterName}...`);
            const result = await handleEks("destroy", { cluster_name: clusterName, region: targetRegion });
            if (result.status === "error") {
              errors.push(`EKS ${clusterName}: ${result.error}`);
              stackSteps.push(`EKS ${clusterName} destroy failed: ${result.error}`);
            } else {
              stackSteps.push(`EKS ${clusterName} destroyed`);
            }
          }
        }
      } catch (e) {
        errors.push(`EKS phase: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Phase 2: Destroy all UIDI-managed VPCs
      try {
        const vpcRes = await ec2Request("POST", targetRegion, new URLSearchParams({ Action: "DescribeVpcs", Version: "2016-11-15" }).toString(), AWS_KEY, AWS_SECRET);
        const vpcBody = await vpcRes.text();
        const vpcItems = vpcBody.match(/<item>[\s\S]*?<vpcId>vpc-[a-f0-9]+<\/vpcId>[\s\S]*?<\/item>/g) || [];
        for (const item of vpcItems) {
          const id = item.match(/<vpcId>(vpc-[a-f0-9]+)<\/vpcId>/)?.[1];
          if (!id) continue;
          const isDefault = item.includes("<isDefault>true</isDefault>");
          if (isDefault) continue;
          const managed = item.includes("UIDI") || !!spec.force;
          if (!managed) {
            stackSteps.push(`Skipped unmanaged VPC: ${id}`);
            continue;
          }
          stackSteps.push(`Destroying VPC: ${id}...`);
          const result = await handleNetwork("destroy", { vpc_id: id, region: targetRegion });
          if (result.status === "error") {
            errors.push(`VPC ${id}: ${result.error}`);
            stackSteps.push(`VPC ${id} destroy failed: ${result.error}`);
          } else {
            stackSteps.push(`VPC ${id} destroyed`);
          }
        }
      } catch (e) {
        errors.push(`VPC phase: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (errors.length > 0) {
        return err("inventory", action, `Stack nuke completed with ${errors.length} error(s): ${errors[0]}`, { steps: stackSteps, errors, region: targetRegion });
      }
      return ok("inventory", action, `Stack nuke complete. ${stackSteps.length} operations.`, { steps: stackSteps, region: targetRegion });
    }

    default:
      return err("inventory", action, `Unknown inventory action: ${action}. Supported: scan, nuke, nuke-stack.`);
  }
}

// ───── Project Naawi: Execution Runtime (Raw API, Stateless) ─────

interface ExecutionState {
  [opId: string]: Record<string, any>;
}

function resolveReferences(input: any, state: ExecutionState): any {
  if (typeof input !== "object" || input === null) return input;
  if (Array.isArray(input)) return input.map(item => resolveReferences(item, state));
  const result: any = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      result[key] = value.replace(/ref\(([^.]+)\.([^)]+)\)/g, (_match, opId, property) => {
        // Support nested property access like ref(opId.Attributes.QueueArn)
        const parts = property.split(".");
        let val: any = state[opId];
        for (const p of parts) {
          val = val?.[p];
        }
        return val !== undefined ? String(val) : _match;
      });
    } else if (typeof value === "object") {
      result[key] = resolveReferences(value, state);
    } else {
      result[key] = value;
    }
  }
  return result;
}

interface DiscoveryReport {
  operationId: string;
  status: "MATCH" | "NOT_FOUND" | "ERROR";
  liveState?: any;
  suggestedAction: string;
}

async function handleDiscovery(ops: SdkOperation[], credentials: any, region: string, forceRefresh = false): Promise<DiscoveryReport[]> {
  const reports: DiscoveryReport[] = [];

  for (const op of ops) {
    const { service, discoveryContext, id } = op;
    const identifiers = discoveryContext?.identifiers || [];
    let status: DiscoveryReport["status"] = "NOT_FOUND";
    let liveState: any = null;

    try {
      // 1. Dolt-First: Check if the resource is already in the versioned state layer
      for (const resId of identifiers) {
        const doltRecord = await dolt.queryResource(resId);
        if (doltRecord && !forceRefresh) {
          console.log(`[Dolt] Hit: Reusing versioned state for ${resId} (Commit: ${doltRecord.ztai_record_index})`);
          liveState = doltRecord.state_json;
          status = "MATCH";
          break;
        }
      }

      // 2. Fallback: Query Cloud API only if not in Dolt or if forced
      if (status === "NOT_FOUND" && SERVICE_CONFIG[service] && identifiers.length > 0) {
        console.log(`[Discovery] Miss: Querying Cloud API for ${service} identifiers: ${identifiers.join(", ")}`);
        const globalServices = ["CloudFront", "Route53", "ACM", "Lambda"];
        const effectiveRegion = globalServices.includes(service) ? "us-east-1" : region;

        if (service === "S3") {
          for (const name of identifiers) {
            try {
              await executeAwsCommand("S3", "HeadBucket", { Bucket: name }, effectiveRegion, credentials);
              liveState = { BucketName: name };
              status = "MATCH";
              break;
            } catch (e: any) {
              if (!e.message?.includes("404") && !e.message?.includes("NotFound")) throw e;
            }
          }
        } else if (service === "EC2") {
          for (const resId of identifiers) {
            try {
              const desc = await executeAwsCommand("EC2", "DescribeInstances", { InstanceId: [resId] }, effectiveRegion, credentials);
              if (desc) { liveState = desc; status = "MATCH"; break; }
            } catch (e: any) {
              if (!e.message?.includes("InvalidInstanceID")) throw e;
            }
          }
        } else if (service === "EKS") {
          for (const name of identifiers) {
            try {
              const desc = await executeAwsCommand("EKS", "DescribeCluster", { name }, effectiveRegion, credentials);
              if (desc?.cluster) { liveState = desc.cluster; status = "MATCH"; break; }
            } catch { /* not found */ }
          }
        }
        // For other services, default to NOT_FOUND (will create)
      }
      reports.push({ operationId: id, status, liveState, suggestedAction: status === "NOT_FOUND" ? "CREATE" : "NONE" });
    } catch (e) {
      console.error(`Discovery error for ${id}:`, e);
      reports.push({ operationId: id, status: "ERROR", suggestedAction: "NONE" });
    }
  }

  return reports;
}

function extractResourceIdentifier(service: string, command: string, result: any, input: any): string | null {
  if (service === "EKS" && command === "CreateCluster") return result?.cluster?.name || input.name;
  if (service === "EC2" && command === "RunInstances") return result?.instance_ids?.[0] || result?.Instances?.[0]?.InstanceId;
  if (service === "EC2" && command === "CreateVpc") return result?.vpc_id || result?.Vpc?.VpcId;
  if (service === "S3" && command === "CreateBucket") return input.Bucket;
  if (service === "Lambda" && command === "CreateFunction") return result?.FunctionName || input.FunctionName;
  return null;
}

function extractResourceType(service: string, command: string): string {
  if (service === "EKS") return "cluster";
  if (service === "EC2" && command.includes("Vpc")) return "vpc";
  if (service === "EC2" && command.includes("Subnet")) return "subnet";
  if (service === "EC2" && command.includes("Instance")) return "instance";
  if (service === "S3") return "bucket";
  return service.toLowerCase();
}

async function executeNaawiOps(ops: SdkOperation[], credentials: any, region: string): Promise<EngineResponse> {
  const state: ExecutionState = {};
  const history: { opId: string; status: string; result?: any; error?: string; dolt_commit?: string }[] = [];
  let dolt_write_failed = false;

  for (const op of ops) {
    const resolvedInput = resolveReferences(op.input, state);

    if (JSON.stringify(resolvedInput).includes("ref(")) {
      return err("naawi", "execute", `Circuit Breaker: Unresolved dependency in ${op.id}.`);
    }

    try {
      if (!SERVICE_CONFIG[op.service]) {
        throw new Error(`Unsupported service: ${op.service}. Supported: ${Object.keys(SERVICE_CONFIG).join(", ")}`);
      }

      const globalServices = ["CloudFront", "Route53", "ACM", "Lambda"];
      const effectiveRegion = op.region || (globalServices.includes(op.service) ? "us-east-1" : region);

      console.log(`[Naawi] Executing ${op.id}: ${op.service}.${op.command}`);
      const result = await executeAwsCommand(op.service, op.command, resolvedInput, effectiveRegion, credentials);

      state[op.id] = result || {};
      
      // 3.2 Write Path: Persist successful execution state to Dolt
      const resourceId = extractResourceIdentifier(op.service, op.command, result, resolvedInput);
      let doltCommitHash: string | undefined;

      if (resourceId) {
        try {
          doltCommitHash = await dolt.writeResource({
            resource_id: resourceId,
            resource_type: extractResourceType(op.service, op.command),
            provider: "aws",
            region: effectiveRegion,
            intent_hash: await sha256Hex(JSON.stringify(op)),
            ztai_record_index: `ztai-${Date.now()}-${op.id}`, // Mock ZTAI link
            observed_at: new Date().toISOString(),
            manifest_version: "0",
            state_json: result || {},
          }, `Auto-commit: ${op.service}.${op.command} for ${resourceId}`);
        } catch (de) {
          console.error(`[Dolt] Write failed for ${resourceId}:`, de);
          dolt_write_failed = true;
        }
      }

      history.push({ opId: op.id, status: "SUCCESS", result, dolt_commit: doltCommitHash });

    } catch (e: any) {
      console.error(`Execution failed at ${op.id}:`, e.message);
      history.push({ opId: op.id, status: "FAILED", error: e.message });
      return err("naawi", "execute", `Execution Halted at ${op.id}: ${e.message}`, { history, state_at_failure: state });
    }
  }

  return ok("naawi", "execute", "Project Naawi: Full Execution Sequence Successful", { 
    history, 
    dolt_commit_ref: dolt.getLatestHash(),
    dolt_write_failed 
  });
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

async function handleDoltAudit(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  switch (action) {
    case "diff": {
      const from = spec.from_commit as string;
      const to = spec.to_commit as string;
      if (!from || !to) return err("dolt", action, "from_commit and to_commit are required for diff.");

      const diffs = await dolt.diff(from, to);
      return ok("dolt", action, `Successfully generated diff between ${from} and ${to}`, {
        from_commit: from,
        to_commit: to,
        changes: diffs,
        total_changes: diffs.length,
      });
    }
    case "history": {
      return ok("dolt", action, "Retrieved Dolt commit history", {
        history: dolt.getHistory().map(c => ({ hash: c.hash, message: c.message, timestamp: c.timestamp })),
      });
    }
    default:
      return err("dolt", action, `Unknown Dolt action: ${action}`);
  }
}

// ───── Main Handler ─────

async function fetchVaultCredentials(authHeader: string, provider = "aws", label = "default"): Promise<{ access_key_id: string; secret_access_key: string } | null> {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/credential-vault`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
      },
      body: JSON.stringify({ action: "retrieve", provider, label }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.credentials) return null;
    return {
      access_key_id: data.credentials.accessKeyId || data.credentials.access_key_id,
      secret_access_key: data.credentials.secretAccessKey || data.credentials.secret_access_key,
    };
  } catch {
    return null;
  }
}

async function fetchVaultCredentialsRaw(authHeader: string, provider: string, label = "default"): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/credential-vault`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
      },
      body: JSON.stringify({ action: "retrieve", provider, label }),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return (data.credentials as Record<string, string>) || null;
  } catch {
    return null;
  }
}

async function handleStorage(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("storage", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "s3").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        if (rt === "s3") {
          const bucket = spec.bucket_name as string;
          if (!bucket) return err("storage", action, "bucket_name required");
          await executeAwsCommand("S3", "CreateBucket", {
            Bucket: bucket,
            ...(region !== "us-east-1" ? { CreateBucketConfiguration: { LocationConstraint: region } } : {}),
          }, region, creds);
          if (spec.versioning) {
            await executeAwsCommand("S3", "PutBucketVersioning", { Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }, region, creds);
          }
          if (spec.object_lock) {
            await executeAwsCommand("S3", "PutObjectLockConfiguration", { Bucket: bucket }, region, creds);
          }
          return ok("storage", action, `S3 bucket ${bucket} created`, { bucket_name: bucket, region });
        }
        if (rt === "efs") {
          const token = spec.creation_token as string || `efs-${Date.now()}`;
          const result = await executeAwsCommand("EFS", "CreateFileSystem", {
            CreationToken: token,
            PerformanceMode: spec.performance_mode || "generalPurpose",
            Encrypted: spec.encrypted !== false,
          }, region, creds);
          return ok("storage", action, `EFS filesystem created`, result);
        }
        return err("storage", action, `Unsupported resource_type '${rt}'. Use: s3, efs`);
      }
      case "discover": {
        if (rt === "s3") {
          const result = await executeAwsCommand("S3", "ListBuckets", {}, region, creds);
          return ok("storage", action, "S3 buckets listed", result);
        }
        if (rt === "ebs") {
          const result = await executeAwsCommand("EC2", "DescribeVolumes", {}, region, creds);
          return ok("storage", action, "EBS volumes listed", result);
        }
        if (rt === "efs") {
          const result = await executeAwsCommand("EFS", "DescribeFileSystems", {}, region, creds);
          return ok("storage", action, "EFS filesystems listed", result);
        }
        return err("storage", action, `Unsupported resource_type '${rt}'. Use: s3, ebs, efs`);
      }
      case "destroy": {
        if (rt === "s3") {
          const bucket = spec.bucket_name as string;
          if (!bucket) return err("storage", action, "bucket_name required");
          await executeAwsCommand("S3", "DeleteBucket", { Bucket: bucket }, region, creds);
          return ok("storage", action, `S3 bucket ${bucket} deleted`, {});
        }
        if (rt === "ebs") {
          const volumeId = spec.volume_id as string;
          if (!volumeId) return err("storage", action, "volume_id required");
          await executeAwsCommand("EC2", "DeleteVolume", { VolumeId: volumeId }, region, creds);
          return ok("storage", action, `EBS volume ${volumeId} deleted`, {});
        }
        return err("storage", action, `Unsupported resource_type '${rt}'. Use: s3, ebs`);
      }
      case "status": {
        if (rt === "s3") {
          const bucket = spec.bucket_name as string;
          if (!bucket) return err("storage", action, "bucket_name required");
          const versioning = await executeAwsCommand("S3", "GetBucketVersioning", { Bucket: bucket }, region, creds);
          return ok("storage", action, `S3 bucket ${bucket} status`, { bucket_name: bucket, versioning });
        }
        return err("storage", action, `Status not supported for resource_type '${rt}'`);
      }
      default: return err("storage", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("storage", action, e instanceof Error ? e.message : String(e));
  }
}

async function handleDatabase(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("database", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "rds").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        if (rt === "rds") {
          const id = spec.db_identifier as string;
          if (!id) return err("database", action, "db_identifier required");
          const result = await executeAwsCommand("RDS", "CreateDBInstance", {
            DBInstanceIdentifier: id,
            DBInstanceClass: spec.db_instance_class || "db.t3.micro",
            Engine: spec.engine || "postgres",
            MasterUsername: spec.username as string,
            MasterUserPassword: spec.password as string,
            AllocatedStorage: spec.allocated_storage || 20,
            MultiAZ: spec.multi_az || false,
          }, region, creds);
          return ok("database", action, `RDS instance ${id} creation initiated`, result);
        }
        if (rt === "dynamodb") {
          const table = spec.table_name as string;
          const pk = spec.partition_key as string;
          if (!table || !pk) return err("database", action, "table_name and partition_key required");
          const result = await executeAwsCommand("DynamoDB", "CreateTable", {
            TableName: table,
            AttributeDefinitions: [{ AttributeName: pk, AttributeType: spec.partition_key_type || "S" }],
            KeySchema: [{ AttributeName: pk, KeyType: "HASH" }],
            BillingMode: spec.billing_mode || "PAY_PER_REQUEST",
          }, region, creds);
          return ok("database", action, `DynamoDB table ${table} created`, result);
        }
        if (rt === "elasticache") {
          const groupId = spec.group_id as string;
          if (!groupId) return err("database", action, "group_id required");
          const result = await executeAwsCommand("ElastiCache", "CreateReplicationGroup", {
            ReplicationGroupId: groupId,
            ReplicationGroupDescription: spec.description || groupId,
            CacheNodeType: spec.node_type || "cache.t3.micro",
            Engine: "redis",
            NumCacheClusters: spec.num_clusters || 1,
            AutomaticFailoverEnabled: false,
          }, region, creds);
          return ok("database", action, `ElastiCache replication group ${groupId} created`, result);
        }
        return err("database", action, `Unsupported resource_type '${rt}'. Use: rds, dynamodb, elasticache`);
      }
      case "discover": {
        if (rt === "rds") {
          const result = await executeAwsCommand("RDS", "DescribeDBInstances", {}, region, creds);
          return ok("database", action, "RDS instances listed", result);
        }
        if (rt === "dynamodb") {
          const result = await executeAwsCommand("DynamoDB", "ListTables", {}, region, creds);
          return ok("database", action, "DynamoDB tables listed", result);
        }
        if (rt === "elasticache") {
          const result = await executeAwsCommand("ElastiCache", "DescribeReplicationGroups", {}, region, creds);
          return ok("database", action, "ElastiCache replication groups listed", result);
        }
        return err("database", action, `Unsupported resource_type '${rt}'. Use: rds, dynamodb, elasticache`);
      }
      case "destroy": {
        if (rt === "rds") {
          const id = spec.db_identifier as string;
          if (!id) return err("database", action, "db_identifier required");
          const result = await executeAwsCommand("RDS", "DeleteDBInstance", {
            DBInstanceIdentifier: id,
            SkipFinalSnapshot: spec.skip_final_snapshot !== false,
          }, region, creds);
          return ok("database", action, `RDS instance ${id} deletion initiated`, result);
        }
        if (rt === "dynamodb") {
          const table = spec.table_name as string;
          if (!table) return err("database", action, "table_name required");
          await executeAwsCommand("DynamoDB", "DeleteTable", { TableName: table }, region, creds);
          return ok("database", action, `DynamoDB table ${table} deleted`, {});
        }
        if (rt === "elasticache") {
          const groupId = spec.group_id as string;
          if (!groupId) return err("database", action, "group_id required");
          await executeAwsCommand("ElastiCache", "DeleteReplicationGroup", {
            ReplicationGroupId: groupId,
          }, region, creds);
          return ok("database", action, `ElastiCache group ${groupId} deleted`, {});
        }
        return err("database", action, `Unsupported resource_type '${rt}'. Use: rds, dynamodb, elasticache`);
      }
      case "status": {
        if (rt === "rds") {
          const id = spec.db_identifier as string;
          if (!id) return err("database", action, "db_identifier required");
          const result = await executeAwsCommand("RDS", "DescribeDBInstances", {
            DBInstanceIdentifier: id,
          }, region, creds);
          return ok("database", action, `RDS instance ${id} status`, result);
        }
        if (rt === "dynamodb") {
          const table = spec.table_name as string;
          if (!table) return err("database", action, "table_name required");
          const result = await executeAwsCommand("DynamoDB", "DescribeTable", { TableName: table }, region, creds);
          return ok("database", action, `DynamoDB table ${table} status`, result);
        }
        return err("database", action, `Status not supported for resource_type '${rt}'`);
      }
      default: return err("database", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("database", action, e instanceof Error ? e.message : String(e));
  }
}

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

    // Inject vault credentials into spec
    const specProvider = ((spec.provider as string) || "aws").toLowerCase();
    const authHeader = req.headers.get("Authorization") || "";
    if (specProvider === "aws") {
      if (!Deno.env.get("AWS_ACCESS_KEY_ID") && !spec.access_key_id) {
        const vaultCreds = await fetchVaultCredentials(authHeader);
        if (vaultCreds) {
          spec.access_key_id = vaultCreds.access_key_id;
          spec.secret_access_key = vaultCreds.secret_access_key;
        }
      }
    } else {
      const rawCreds = await fetchVaultCredentialsRaw(authHeader, specProvider);
      if (rawCreds) {
        if (specProvider === "oci") {
          spec.oci_tenancy_ocid = spec.oci_tenancy_ocid || rawCreds.tenancyOcid;
          spec.oci_user_ocid = spec.oci_user_ocid || rawCreds.userOcid;
          spec.oci_fingerprint = spec.oci_fingerprint || rawCreds.fingerprint;
          spec.oci_private_key = spec.oci_private_key || rawCreds.privateKey;
          if (!spec.oci_region && rawCreds.region) spec.oci_region = rawCreds.region;
        } else if (specProvider === "gcp") {
          spec.gcp_service_account_json = spec.gcp_service_account_json || rawCreds.serviceAccountJson;
          spec.gcp_project_id = spec.gcp_project_id || rawCreds.projectId;
        } else if (specProvider === "azure") {
          spec.azure_tenant_id = spec.azure_tenant_id || rawCreds.tenantId;
          spec.azure_client_id = spec.azure_client_id || rawCreds.clientId;
          spec.azure_client_secret = spec.azure_client_secret || rawCreds.clientSecret;
          spec.azure_subscription_id = spec.azure_subscription_id || rawCreds.subscriptionId;
        }
      }
    }

    console.log(`UIDI Engine: ${intent}/${action}`, metadata ? JSON.stringify(metadata) : "", JSON.stringify(spec).slice(0, 300));

    let result: EngineResponse;

    // ── Manifest-engine unified dispatch ────────────────────────────────────────
    const normalizedIntent = normalizeIntent(intent);
    const provider = ((spec.provider as string) || "aws").toLowerCase();
    const op = prepareOperation(normalizedIntent, action, provider, spec as Record<string, unknown>);

    if (!(op instanceof ManifestError)) {
      (spec as any)._manifest_version = op.manifest_version;
      if (op.entry.execution.type !== "rest-proxy") {
        return new Response(JSON.stringify(response202(op)), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // rest-proxy: fall through to legacy handler
    } else if (op.code !== "NOT_FOUND") {
      return new Response(JSON.stringify(err(normalizedIntent, action, op.message)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // NOT_FOUND or rest-proxy: fall through to legacy handler chain

    switch (intent) {
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
      case "dolt" as string:
        result = await handleDoltAudit(action, spec);
        break;
      default:
        result = err(intent, action, `Unknown intent: ${intent}. Supported: kubernetes, ansible, compute, network, eks, reconcile, sre-supreme, naawi, dolt.`);
    }
    return new Response(JSON.stringify(result), {
      status: 200,
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
