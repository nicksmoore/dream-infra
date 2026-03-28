# V3 Manifest — 14 New AWS Intents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 14 new intent handlers (storage, database, serverless, cdn, dns, load-balancer, security, gateway, secrets, observability, orchestration, ai, container, gap) to the uidi-engine so every test prompt in the v3 manifest eval suite returns a meaningful response instead of `Unknown intent`.

**Architecture:** Each new intent maps to a `handleXxx(action, spec)` function in `index.ts` that routes by `action` (deploy/discover/destroy/status) and `spec.resource_type` (e.g. "s3" | "efs" for storage), delegating to `executeAwsCommand`. New AWS services (EFS, StepFunctions, ECS, etc.) are added to `SERVICE_CONFIG` and `REST_ROUTES`. `manifest-types.ts` `IntentSchema` is extended with all 14 new values so manifest validation still passes. New manifest.json entries are added (bumping version to "3").

**Tech Stack:** Deno/TypeScript, AWS SigV4, existing `executeAwsCommand` dispatcher, Zod (manifest-types.ts)

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `supabase/functions/uidi-engine/manifest-types.ts` | Modify | Add 14 intent values to `IntentSchema` enum |
| `supabase/functions/uidi-engine/index.ts` | Modify | Add SERVICE_CONFIG entries, REST_ROUTES, Route53/S3/CloudFront handlers, 14 handler functions, dispatch switch cases, ExecuteRequest type update |
| `supabase/functions/uidi-engine/manifest.json` | Modify | Add 54 new entries; bump version to "3" |
| `src/test/manifest-engine.test.ts` | Modify | Update "has exactly 69 entries" count; add new intent validation tests |
| `src/test/manifest-router.test.ts` | Modify | Add coverage for new intents |

---

## Shared Patterns

Every handler follows this skeleton:
```typescript
async function handleXxx(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("xxx", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const resourceType = (spec.resource_type as string || "default").toLowerCase();

  switch (action) {
    case "deploy": { ... }
    case "discover": { ... }
    case "destroy": { ... }
    case "status": { ... }
    default: return err("xxx", action, `Unknown action: ${action}`);
  }
}
```

`executeAwsCommand(service, command, input, region, creds)` is the workhorse. For `query`-style services (EC2, RDS, ELBv2, IAM, etc.) any valid Action string works — no route registration needed. For `rest-json` and `rest-xml` services, entries must be in `REST_ROUTES` or the XML builders.

---

## Task 1: Extend IntentSchema

**Files:**
- Modify: `supabase/functions/uidi-engine/manifest-types.ts:13-17`

- [ ] **Step 1: Update the enum**

Replace:
```typescript
export const IntentSchema = z.enum([
  "network", "compute", "k8s",
  "ansible", "reconcile", "inventory",
  "sre-supreme", "naawi", "dolt",
]);
```
With:
```typescript
export const IntentSchema = z.enum([
  "network", "compute", "k8s",
  "ansible", "reconcile", "inventory",
  "sre-supreme", "naawi", "dolt",
  "storage", "database", "serverless", "cdn", "dns", "load-balancer",
  "security", "gateway", "secrets", "observability", "orchestration",
  "ai", "container", "gap",
]);
```

- [ ] **Step 2: Verify no Zod tests break**

Run: `deno test supabase/functions/uidi-engine/ --allow-env 2>&1 | head -20` (or equivalent test runner)

- [ ] **Step 3: Commit**
```bash
git add supabase/functions/uidi-engine/manifest-types.ts
git commit -m "feat(manifest): extend IntentSchema with 14 v3 intent values"
```

---

## Task 2: Add Missing Services to SERVICE_CONFIG + REST_ROUTES

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts:20-45` (SERVICE_CONFIG)
- Modify: `supabase/functions/uidi-engine/index.ts:48-74` (REST_ROUTES)

These services are currently missing and needed by new handlers.

- [ ] **Step 1: Add to SERVICE_CONFIG** (append after the existing `SSM` entry at ~line 44)

```typescript
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
```

- [ ] **Step 2: Add to REST_ROUTES** (append inside the `REST_ROUTES` object after ApiGatewayV2)

```typescript
  Lambda: {
    // existing entries stay; ADD:
    ListFunctions: { method: "GET", path: () => "/2015-03-31/functions" },
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
```

- [ ] **Step 3: Extend S3_ROUTES** (add to the existing `S3_ROUTES` object)

```typescript
  ListBuckets:              { method: "GET",  path: () => "/" },
  GetBucketVersioning:      { method: "GET",  path: (i: any) => `/${i.Bucket}`, queryString: "versioning" },
  PutBucketVersioning:      { method: "PUT",  path: (i: any) => `/${i.Bucket}`, queryString: "versioning" },
  PutObjectLockConfiguration: { method: "PUT", path: (i: any) => `/${i.Bucket}`, queryString: "object-lock" },
```

- [ ] **Step 4: Add S3 body handling in `executeAwsCommand` S3 case** (after the `PutObject` branch, ~line 311)

```typescript
      } else if (actionName === "PutBucketVersioning") {
        const status = (input as any).VersioningConfiguration?.Status || "Enabled";
        body = `<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>${status}</Status></VersioningConfiguration>`;
        extraHeaders["Content-Type"] = "application/xml";
      } else if (actionName === "PutObjectLockConfiguration") {
        body = `<?xml version="1.0" encoding="UTF-8"?><ObjectLockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>`;
        extraHeaders["Content-Type"] = "application/xml";
      }
```

- [ ] **Step 5: Extend `buildRoute53Request`** — add ONLY the missing cases (inside the switch at ~line 113); `ListHostedZones` already exists at line 116–117, do NOT re-add it

```typescript
    case "CreateHostedZone":
      return { method: "POST", path: "/2013-04-01/hostedzone", body: jsonToXml("CreateHostedZoneRequest", { Name: input.Name, CallerReference: input.CallerReference }, xmlns) };
    case "DeleteHostedZone":
      return { method: "DELETE", path: `/2013-04-01/hostedzone/${input.Id}` };
    case "GetHostedZone":
      return { method: "GET", path: `/2013-04-01/hostedzone/${input.Id}` };
    case "ListResourceRecordSets":
      return { method: "GET", path: `/2013-04-01/hostedzone/${input.HostedZoneId}/rrset` };
```

- [ ] **Step 6: Add `GetApi` to `REST_ROUTES.ApiGatewayV2`** (needed by `handleGateway` status action — do NOT skip)

```typescript
GetApi: { method: "GET", path: (i: any) => `/v2/apis/${i.ApiId}` },
```

- [ ] **Step 7: Extend `buildCloudFrontRequest`** to handle list/delete (~line 103); `ListDistributions` belongs here, NOT in `REST_ROUTES`

```typescript
    case "ListDistributions":
      return { method: "GET", path: "/2020-05-31/distribution" };
    case "DeleteDistribution":
      return { method: "DELETE", path: `/2020-05-31/distribution/${input.Id}` };
```

- [ ] **Step 8: Commit**
```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(engine): add 10 new services to SERVICE_CONFIG, extend REST_ROUTES and XML builders"
```

---

## Task 3: handleStorage + handleDatabase handlers

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts` (add before `serve()`)

- [ ] **Step 1: Add `handleStorage`**

```typescript
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
```

- [ ] **Step 2: Add `handleDatabase`**

```typescript
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
```

- [ ] **Step 3: Commit**
```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(engine): add handleStorage and handleDatabase intent handlers"
```

---

## Task 4: handleServerless + handleCdn + handleDns

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts` (add before `serve()`)

- [ ] **Step 1: Add `handleServerless`**

```typescript
async function handleServerless(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("serverless", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "lambda").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        if (rt === "lambda") {
          const name = spec.function_name as string;
          if (!name) return err("serverless", action, "function_name required");
          const result = await executeAwsCommand("Lambda", "CreateFunction", {
            FunctionName: name,
            Runtime: spec.runtime || "nodejs20.x",
            Role: spec.role_arn as string,
            Handler: spec.handler || "index.handler",
            Code: {
              S3Bucket: spec.s3_bucket as string,
              S3Key: spec.s3_key as string,
            },
            Timeout: spec.timeout || 30,
            MemorySize: spec.memory || 128,
          }, region, creds);
          return ok("serverless", action, `Lambda function ${name} created`, result);
        }
        if (rt === "apprunner") {
          const name = spec.service_name as string;
          if (!name) return err("serverless", action, "service_name required");
          const result = await executeAwsCommand("AppRunner", "CreateService", {
            ServiceName: name,
            SourceConfiguration: {
              ImageRepository: {
                ImageIdentifier: spec.image_uri as string,
                ImageRepositoryType: "ECR",
              },
            },
          }, region, creds);
          return ok("serverless", action, `App Runner service ${name} created`, result);
        }
        return err("serverless", action, `Unsupported resource_type '${rt}'. Use: lambda, apprunner`);
      }
      case "discover": {
        if (rt === "lambda") {
          const result = await executeAwsCommand("Lambda", "ListFunctions", {}, region, creds);
          return ok("serverless", action, "Lambda functions listed", result);
        }
        return err("serverless", action, `Unsupported resource_type '${rt}'. Use: lambda`);
      }
      case "destroy": {
        if (rt === "lambda") {
          const name = spec.function_name as string;
          if (!name) return err("serverless", action, "function_name required");
          await executeAwsCommand("Lambda", "DeleteFunction", { FunctionName: name }, region, creds);
          return ok("serverless", action, `Lambda function ${name} deleted`, {});
        }
        return err("serverless", action, `Unsupported resource_type '${rt}'. Use: lambda`);
      }
      case "status": {
        if (rt === "lambda") {
          const name = spec.function_name as string;
          if (!name) return err("serverless", action, "function_name required");
          const result = await executeAwsCommand("Lambda", "GetFunction", { FunctionName: name }, region, creds);
          return ok("serverless", action, `Lambda function ${name} config`, result);
        }
        return err("serverless", action, `Status not supported for resource_type '${rt}'`);
      }
      default: return err("serverless", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("serverless", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 2: Add `handleCdn`**

```typescript
async function handleCdn(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("cdn", action, "AWS credentials required.");
  // CloudFront is global — region fixed to us-east-1 for signing
  const region = "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };

  try {
    switch (action) {
      case "deploy": {
        const originDomain = spec.origin_domain as string;
        const originId = spec.origin_id as string || "default-origin";
        const callerRef = spec.caller_reference as string || `cf-${Date.now()}`;
        if (!originDomain) return err("cdn", action, "origin_domain required");
        const result = await executeAwsCommand("CloudFront", "CreateDistribution", {
          DistributionConfig: {
            CallerReference: callerRef,
            Origins: { Quantity: 1, Items: [{ Id: originId, DomainName: originDomain, CustomOriginConfig: { HTTPSPort: 443, OriginProtocolPolicy: "https-only" } }] },
            DefaultCacheBehavior: { TargetOriginId: originId, ViewerProtocolPolicy: "redirect-to-https", CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6", AllowedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
            Enabled: true,
            Comment: spec.comment || "",
          },
        }, region, creds);
        return ok("cdn", action, "CloudFront distribution created", result);
      }
      case "discover": {
        const result = await executeAwsCommand("CloudFront", "ListDistributions", {}, region, creds);
        return ok("cdn", action, "CloudFront distributions listed", result);
      }
      case "destroy": {
        const distId = spec.distribution_id as string;
        if (!distId) return err("cdn", action, "distribution_id required");
        await executeAwsCommand("CloudFront", "DeleteDistribution", { Id: distId }, region, creds);
        return ok("cdn", action, `CloudFront distribution ${distId} deleted`, {});
      }
      case "status": {
        const distId = spec.distribution_id as string;
        if (!distId) return err("cdn", action, "distribution_id required");
        const result = await executeAwsCommand("CloudFront", "GetDistribution", { Id: distId }, region, creds);
        return ok("cdn", action, `CloudFront distribution ${distId} status`, result);
      }
      default: return err("cdn", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("cdn", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 3: Add `handleDns`**

```typescript
async function handleDns(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("dns", action, "AWS credentials required.");
  const region = "us-east-1"; // Route53 is global
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };

  try {
    switch (action) {
      case "deploy": {
        const name = spec.zone_name as string;
        const callerRef = spec.caller_reference as string || `hz-${Date.now()}`;
        if (!name) return err("dns", action, "zone_name required");
        const result = await executeAwsCommand("Route53", "CreateHostedZone", { Name: name, CallerReference: callerRef }, region, creds);
        return ok("dns", action, `Hosted zone for ${name} created`, result);
      }
      case "discover": {
        const result = await executeAwsCommand("Route53", "ListHostedZones", {}, region, creds);
        return ok("dns", action, "Hosted zones listed", result);
      }
      case "destroy": {
        const zoneId = spec.zone_id as string;
        if (!zoneId) return err("dns", action, "zone_id required");
        await executeAwsCommand("Route53", "DeleteHostedZone", { Id: zoneId }, region, creds);
        return ok("dns", action, `Hosted zone ${zoneId} deleted`, {});
      }
      case "status": {
        const zoneId = spec.zone_id as string;
        if (!zoneId) return err("dns", action, "zone_id required");
        const result = await executeAwsCommand("Route53", "GetHostedZone", { Id: zoneId }, region, creds);
        return ok("dns", action, `Hosted zone ${zoneId} details`, result);
      }
      default: return err("dns", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("dns", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 4: Commit**
```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(engine): add handleServerless, handleCdn, handleDns handlers"
```

---

## Task 5: handleLoadBalancer + handleSecurity

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts`

- [ ] **Step 1: Add `handleLoadBalancer`**

```typescript
async function handleLoadBalancer(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("load-balancer", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };

  try {
    switch (action) {
      case "deploy": {
        const name = spec.name as string;
        const subnets = spec.subnets as string[];
        if (!name || !subnets?.length) return err("load-balancer", action, "name and subnets required");
        const result = await executeAwsCommand("ELBv2", "CreateLoadBalancer", {
          Name: name,
          Subnets: subnets,
          Type: spec.type || "application",
          Scheme: spec.scheme || "internet-facing",
        }, region, creds);
        return ok("load-balancer", action, `Load balancer ${name} creation initiated`, result);
      }
      case "discover": {
        const result = await executeAwsCommand("ELBv2", "DescribeLoadBalancers", {}, region, creds);
        return ok("load-balancer", action, "Load balancers listed", result);
      }
      case "destroy": {
        const arn = spec.load_balancer_arn as string;
        if (!arn) return err("load-balancer", action, "load_balancer_arn required");
        await executeAwsCommand("ELBv2", "DeleteLoadBalancer", { LoadBalancerArn: arn }, region, creds);
        return ok("load-balancer", action, `Load balancer deleted`, {});
      }
      case "status": {
        const arn = spec.load_balancer_arn as string;
        if (!arn) return err("load-balancer", action, "load_balancer_arn required");
        const result = await executeAwsCommand("ELBv2", "DescribeLoadBalancers", {
          LoadBalancerArns: [arn],
        }, region, creds);
        return ok("load-balancer", action, "Load balancer status", result);
      }
      default: return err("load-balancer", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("load-balancer", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 2: Add `handleSecurity`**

Routes by `resource_type`: iam | waf | guardduty | securityhub | cloudtrail | config

```typescript
async function handleSecurity(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("security", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "iam").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        if (rt === "iam") {
          const roleName = spec.role_name as string;
          if (!roleName) return err("security", action, "role_name required");
          const result = await executeAwsCommand("IAM", "CreateRole", {
            RoleName: roleName,
            AssumeRolePolicyDocument: typeof spec.assume_role_policy === "string"
              ? spec.assume_role_policy
              : JSON.stringify(spec.assume_role_policy),
          }, region, creds);
          return ok("security", action, `IAM role ${roleName} created`, result);
        }
        if (rt === "waf") {
          const name = spec.acl_name as string || "default-acl";
          const result = await executeAwsCommand("WAFV2", "CreateWebACL", {
            Name: name,
            Scope: spec.scope || "REGIONAL",
            DefaultAction: { Block: {} },
            Rules: [],
            VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: name },
          }, region, creds);
          return ok("security", action, `WAF Web ACL ${name} created`, result);
        }
        if (rt === "guardduty") {
          const result = await executeAwsCommand("GuardDuty", "CreateDetector", {
            Enable: true,
            FindingPublishingFrequency: spec.finding_frequency || "FIFTEEN_MINUTES",
          }, region, creds);
          return ok("security", action, "GuardDuty detector enabled", result);
        }
        if (rt === "securityhub") {
          await executeAwsCommand("SecurityHub", "EnableSecurityHub", {
            EnableDefaultStandards: spec.enable_default_standards !== false,
          }, region, creds);
          return ok("security", action, "Security Hub enabled", {});
        }
        if (rt === "cloudtrail") {
          const trailName = spec.trail_name as string;
          const s3Bucket = spec.s3_bucket as string;
          if (!trailName || !s3Bucket) return err("security", action, "trail_name and s3_bucket required");
          const result = await executeAwsCommand("CloudTrail", "CreateTrail", {
            Name: trailName,
            S3BucketName: s3Bucket,
            IsMultiRegionTrail: spec.multi_region !== false,
            EnableLogFileValidation: spec.log_validation !== false,
          }, region, creds);
          return ok("security", action, `CloudTrail trail ${trailName} created`, result);
        }
        if (rt === "config") {
          const recorderName = spec.recorder_name as string || "default-recorder";
          const roleArn = spec.role_arn as string;
          if (!roleArn) return err("security", action, "role_arn required for Config recorder");
          const result = await executeAwsCommand("ConfigService", "PutConfigurationRecorder", {
            ConfigurationRecorder: {
              name: recorderName,
              roleARN: roleArn,
              recordingGroup: { allSupported: true },
            },
          }, region, creds);
          return ok("security", action, `AWS Config recorder ${recorderName} configured`, result);
        }
        return err("security", action, `Unsupported resource_type '${rt}'. Use: iam, waf, guardduty, securityhub, cloudtrail, config`);
      }
      case "discover": {
        if (rt === "iam") {
          const result = await executeAwsCommand("IAM", "ListRoles", {}, region, creds);
          return ok("security", action, "IAM roles listed", result);
        }
        if (rt === "waf") {
          const result = await executeAwsCommand("WAFV2", "ListWebACLs", { Scope: "REGIONAL" }, region, creds);
          return ok("security", action, "WAF Web ACLs listed", result);
        }
        if (rt === "guardduty") {
          const result = await executeAwsCommand("GuardDuty", "ListDetectors", {}, region, creds);
          return ok("security", action, "GuardDuty detectors listed", result);
        }
        if (rt === "securityhub") {
          const result = await executeAwsCommand("SecurityHub", "GetFindings", { Filters: {} }, region, creds);
          return ok("security", action, "Security Hub findings listed", result);
        }
        if (rt === "cloudtrail") {
          const result = await executeAwsCommand("CloudTrail", "DescribeTrails", {}, region, creds);
          return ok("security", action, "CloudTrail trails listed", result);
        }
        if (rt === "config") {
          const result = await executeAwsCommand("ConfigService", "DescribeConfigurationRecorders", {}, region, creds);
          return ok("security", action, "AWS Config recorders listed", result);
        }
        return err("security", action, `Unsupported resource_type '${rt}'. Use: iam, waf, guardduty, securityhub, cloudtrail, config`);
      }
      case "destroy": {
        if (rt === "iam") {
          const roleName = spec.role_name as string;
          if (!roleName) return err("security", action, "role_name required");
          await executeAwsCommand("IAM", "DeleteRole", { RoleName: roleName }, region, creds);
          return ok("security", action, `IAM role ${roleName} deleted`, {});
        }
        if (rt === "guardduty") {
          const detectorId = spec.detector_id as string;
          if (!detectorId) return err("security", action, "detector_id required");
          await executeAwsCommand("GuardDuty", "DeleteDetector", { DetectorId: detectorId }, region, creds);
          return ok("security", action, `GuardDuty detector ${detectorId} deleted`, {});
        }
        return err("security", action, `Destroy not supported for resource_type '${rt}'`);
      }
      case "status": {
        if (rt === "iam") {
          const roleName = spec.role_name as string;
          if (!roleName) return err("security", action, "role_name required");
          const result = await executeAwsCommand("IAM", "GetRole", { RoleName: roleName }, region, creds);
          return ok("security", action, `IAM role ${roleName} details`, result);
        }
        return err("security", action, `Status not supported for resource_type '${rt}'`);
      }
      default: return err("security", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("security", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 3: Commit**
```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(engine): add handleLoadBalancer and handleSecurity handlers"
```

---

## Task 6: handleGateway + handleSecrets + handleObservability

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts`

- [ ] **Step 1: Add `handleGateway`** (routes: api-gateway | vpc-endpoint)

```typescript
async function handleGateway(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("gateway", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "api-gateway").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        if (rt === "api-gateway") {
          const name = spec.api_name as string;
          if (!name) return err("gateway", action, "api_name required");
          const result = await executeAwsCommand("ApiGatewayV2", "CreateApi", {
            Name: name,
            ProtocolType: spec.protocol || "HTTP",
          }, region, creds);
          return ok("gateway", action, `API Gateway ${name} created`, result);
        }
        if (rt === "vpc-endpoint") {
          const serviceId = spec.service_name as string;
          const vpcId = spec.vpc_id as string;
          if (!serviceId || !vpcId) return err("gateway", action, "service_name and vpc_id required");
          const result = await executeAwsCommand("EC2", "CreateVpcEndpoint", {
            ServiceName: serviceId,
            VpcId: vpcId,
            VpcEndpointType: spec.endpoint_type || "Interface",
          }, region, creds);
          return ok("gateway", action, `VPC endpoint created`, result);
        }
        return err("gateway", action, `Unsupported resource_type '${rt}'. Use: api-gateway, vpc-endpoint`);
      }
      case "discover": {
        if (rt === "api-gateway") {
          const result = await executeAwsCommand("ApiGatewayV2", "GetApis", {}, region, creds);
          return ok("gateway", action, "API Gateways listed", result);
        }
        if (rt === "vpc-endpoint") {
          const result = await executeAwsCommand("EC2", "DescribeVpcEndpoints", {}, region, creds);
          return ok("gateway", action, "VPC endpoints listed", result);
        }
        return err("gateway", action, `Unsupported resource_type '${rt}'. Use: api-gateway, vpc-endpoint`);
      }
      case "destroy": {
        if (rt === "api-gateway") {
          const apiId = spec.api_id as string;
          if (!apiId) return err("gateway", action, "api_id required");
          await executeAwsCommand("ApiGatewayV2", "DeleteApi", { ApiId: apiId }, region, creds);
          return ok("gateway", action, `API Gateway ${apiId} deleted`, {});
        }
        if (rt === "vpc-endpoint") {
          const endpointId = spec.endpoint_id as string;
          if (!endpointId) return err("gateway", action, "endpoint_id required");
          await executeAwsCommand("EC2", "DeleteVpcEndpoints", { VpcEndpointIds: [endpointId] }, region, creds);
          return ok("gateway", action, `VPC endpoint ${endpointId} deleted`, {});
        }
        return err("gateway", action, `Unsupported resource_type '${rt}'.`);
      }
      case "status": {
        if (rt === "api-gateway") {
          const apiId = spec.api_id as string;
          if (!apiId) return err("gateway", action, "api_id required");
          const result = await executeAwsCommand("ApiGatewayV2", "GetApi", { ApiId: apiId }, region, creds);
          return ok("gateway", action, `API Gateway ${apiId} status`, result);
        }
        return err("gateway", action, `Status not supported for resource_type '${rt}'`);
      }
      default: return err("gateway", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("gateway", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 2: Add `handleSecrets`** (routes: secrets-manager | kms)

```typescript
async function handleSecrets(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("secrets", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "secrets-manager").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        if (rt === "secrets-manager") {
          const name = spec.secret_name as string;
          if (!name) return err("secrets", action, "secret_name required");
          const result = await executeAwsCommand("SecretsManager", "CreateSecret", {
            Name: name,
            SecretString: spec.secret_value as string,
          }, region, creds);
          return ok("secrets", action, `Secret ${name} created`, result);
        }
        if (rt === "kms") {
          const result = await executeAwsCommand("KMS", "CreateKey", {
            Description: spec.description as string || "Created by Naawi",
            KeyUsage: spec.key_usage || "ENCRYPT_DECRYPT",
            KeySpec: spec.key_spec || "SYMMETRIC_DEFAULT",
          }, region, creds);
          return ok("secrets", action, "KMS key created", result);
        }
        return err("secrets", action, `Unsupported resource_type '${rt}'. Use: secrets-manager, kms`);
      }
      case "discover": {
        if (rt === "secrets-manager") {
          const result = await executeAwsCommand("SecretsManager", "ListSecrets", {}, region, creds);
          return ok("secrets", action, "Secrets listed", result);
        }
        if (rt === "kms") {
          const result = await executeAwsCommand("KMS", "ListKeys", {}, region, creds);
          return ok("secrets", action, "KMS keys listed", result);
        }
        return err("secrets", action, `Unsupported resource_type '${rt}'. Use: secrets-manager, kms`);
      }
      case "destroy": {
        if (rt === "secrets-manager") {
          const name = spec.secret_name as string;
          if (!name) return err("secrets", action, "secret_name required");
          await executeAwsCommand("SecretsManager", "DeleteSecret", {
            SecretId: name,
            RecoveryWindowInDays: spec.recovery_window_days || 30,
          }, region, creds);
          return ok("secrets", action, `Secret ${name} scheduled for deletion`, {});
        }
        return err("secrets", action, `Destroy not supported for resource_type '${rt}'`);
      }
      case "status": {
        if (rt === "secrets-manager") {
          const name = spec.secret_name as string;
          if (!name) return err("secrets", action, "secret_name required");
          const result = await executeAwsCommand("SecretsManager", "DescribeSecret", { SecretId: name }, region, creds);
          return ok("secrets", action, `Secret ${name} details`, result);
        }
        return err("secrets", action, `Status not supported for resource_type '${rt}'`);
      }
      default: return err("secrets", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("secrets", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 3: Add `handleObservability`** (routes: alarm | log-group)

```typescript
async function handleObservability(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("observability", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "alarm").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        if (rt === "alarm") {
          const name = spec.alarm_name as string;
          if (!name) return err("observability", action, "alarm_name required");
          const result = await executeAwsCommand("CloudWatch", "PutMetricAlarm", {
            AlarmName: name,
            MetricName: spec.metric_name as string,
            Namespace: spec.namespace as string,
            Period: spec.period || 300,
            EvaluationPeriods: spec.evaluation_periods || 1,
            Threshold: spec.threshold as number,
            ComparisonOperator: spec.comparison_operator as string || "GreaterThanThreshold",
            Statistic: spec.statistic || "Average",
            ActionsEnabled: true,
          }, region, creds);
          return ok("observability", action, `CloudWatch alarm ${name} created`, result);
        }
        if (rt === "log-group") {
          const logGroupName = spec.log_group_name as string;
          if (!logGroupName) return err("observability", action, "log_group_name required");
          await executeAwsCommand("CloudWatchLogs", "CreateLogGroup", { logGroupName }, region, creds);
          if (spec.retention_days) {
            await executeAwsCommand("CloudWatchLogs", "PutRetentionPolicy", {
              logGroupName,
              retentionInDays: spec.retention_days,
            }, region, creds);
          }
          return ok("observability", action, `Log group ${logGroupName} created`, { log_group_name: logGroupName });
        }
        return err("observability", action, `Unsupported resource_type '${rt}'. Use: alarm, log-group`);
      }
      case "discover": {
        if (rt === "alarm") {
          const result = await executeAwsCommand("CloudWatch", "DescribeAlarms", {}, region, creds);
          return ok("observability", action, "CloudWatch alarms listed", result);
        }
        if (rt === "log-group") {
          const result = await executeAwsCommand("CloudWatchLogs", "DescribeLogGroups", {}, region, creds);
          return ok("observability", action, "CloudWatch log groups listed", result);
        }
        return err("observability", action, `Unsupported resource_type '${rt}'. Use: alarm, log-group`);
      }
      case "destroy": {
        if (rt === "alarm") {
          const name = spec.alarm_name as string;
          if (!name) return err("observability", action, "alarm_name required");
          await executeAwsCommand("CloudWatch", "DeleteAlarms", { AlarmNames: [name] }, region, creds);
          return ok("observability", action, `CloudWatch alarm ${name} deleted`, {});
        }
        return err("observability", action, `Destroy not supported for resource_type '${rt}'`);
      }
      case "status": {
        if (rt === "alarm") {
          const name = spec.alarm_name as string;
          if (!name) return err("observability", action, "alarm_name required");
          const result = await executeAwsCommand("CloudWatch", "DescribeAlarms", { AlarmNames: [name] }, region, creds);
          return ok("observability", action, `CloudWatch alarm ${name} status`, result);
        }
        return err("observability", action, `Status not supported for resource_type '${rt}'`);
      }
      default: return err("observability", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("observability", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 4: Commit**
```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(engine): add handleGateway, handleSecrets, handleObservability handlers"
```

---

## Task 7: handleOrchestration + handleAi + handleContainer + handleGap

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts`

- [ ] **Step 1: Add `handleOrchestration`** (routes: step-functions | eventbridge | ssm)

```typescript
async function handleOrchestration(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("orchestration", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "step-functions").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        if (rt === "step-functions") {
          const name = spec.state_machine_name as string;
          const roleArn = spec.role_arn as string;
          const definition = typeof spec.definition === "string" ? spec.definition : JSON.stringify(spec.definition);
          if (!name || !roleArn || !definition) return err("orchestration", action, "state_machine_name, role_arn, and definition required");
          const result = await executeAwsCommand("StepFunctions", "CreateStateMachine", {
            name,
            roleArn,
            definition,
            type: spec.type || "STANDARD",
          }, region, creds);
          return ok("orchestration", action, `Step Functions state machine ${name} created`, result);
        }
        if (rt === "eventbridge") {
          const busName = spec.event_bus_name as string;
          if (!busName) return err("orchestration", action, "event_bus_name required");
          const result = await executeAwsCommand("EventBridge", "CreateEventBus", { Name: busName }, region, creds);
          return ok("orchestration", action, `EventBridge bus ${busName} created`, result);
        }
        if (rt === "ssm") {
          const paramName = spec.parameter_name as string;
          const paramValue = spec.parameter_value as string;
          if (!paramName || !paramValue) return err("orchestration", action, "parameter_name and parameter_value required");
          const result = await executeAwsCommand("SSM", "PutParameter", {
            Name: paramName,
            Value: paramValue,
            Type: spec.parameter_type || "SecureString",
            Overwrite: true,
          }, region, creds);
          return ok("orchestration", action, `SSM parameter ${paramName} stored`, result);
        }
        return err("orchestration", action, `Unsupported resource_type '${rt}'. Use: step-functions, eventbridge, ssm`);
      }
      case "discover": {
        if (rt === "step-functions") {
          const result = await executeAwsCommand("StepFunctions", "ListStateMachines", {}, region, creds);
          return ok("orchestration", action, "Step Functions state machines listed", result);
        }
        if (rt === "eventbridge") {
          const result = await executeAwsCommand("EventBridge", "ListEventBuses", {}, region, creds);
          return ok("orchestration", action, "EventBridge event buses listed", result);
        }
        if (rt === "ssm") {
          const result = await executeAwsCommand("SSM", "DescribeParameters", {}, region, creds);
          return ok("orchestration", action, "SSM parameters listed", result);
        }
        return err("orchestration", action, `Unsupported resource_type '${rt}'. Use: step-functions, eventbridge, ssm`);
      }
      case "destroy": {
        if (rt === "step-functions") {
          const arn = spec.state_machine_arn as string;
          if (!arn) return err("orchestration", action, "state_machine_arn required");
          await executeAwsCommand("StepFunctions", "DeleteStateMachine", { stateMachineArn: arn }, region, creds);
          return ok("orchestration", action, `State machine ${arn} deleted`, {});
        }
        if (rt === "eventbridge") {
          const busName = spec.event_bus_name as string;
          if (!busName) return err("orchestration", action, "event_bus_name required");
          await executeAwsCommand("EventBridge", "DeleteEventBus", { Name: busName }, region, creds);
          return ok("orchestration", action, `EventBridge bus ${busName} deleted`, {});
        }
        if (rt === "ssm") {
          const paramName = spec.parameter_name as string;
          if (!paramName) return err("orchestration", action, "parameter_name required");
          await executeAwsCommand("SSM", "DeleteParameter", { Name: paramName }, region, creds);
          return ok("orchestration", action, `SSM parameter ${paramName} deleted`, {});
        }
        return err("orchestration", action, `Destroy not supported for resource_type '${rt}'`);
      }
      case "status": {
        if (rt === "step-functions") {
          const arn = spec.state_machine_arn as string;
          if (!arn) return err("orchestration", action, "state_machine_arn required");
          const result = await executeAwsCommand("StepFunctions", "DescribeStateMachine", { stateMachineArn: arn }, region, creds);
          return ok("orchestration", action, `State machine ${arn} details`, result);
        }
        return err("orchestration", action, `Status not supported for resource_type '${rt}'`);
      }
      default: return err("orchestration", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("orchestration", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 2: Add `handleAi`** (Bedrock)

```typescript
async function handleAi(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("ai", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };

  try {
    switch (action) {
      case "deploy": {
        const modelId = spec.model_id as string;
        const name = spec.provisioned_model_name as string;
        const units = spec.model_units as number || 1;
        if (!modelId || !name) return err("ai", action, "model_id and provisioned_model_name required");
        const result = await executeAwsCommand("Bedrock", "CreateProvisionedModelThroughput", {
          modelId,
          provisionedModelName: name,
          modelUnits: units,
        }, region, creds);
        return ok("ai", action, `Bedrock provisioned throughput ${name} created`, result);
      }
      case "discover": {
        const result = await executeAwsCommand("Bedrock", "ListFoundationModels", {}, region, creds);
        return ok("ai", action, "Bedrock foundation models listed", result);
      }
      case "destroy": {
        const provisionedModelId = spec.provisioned_model_id as string;
        if (!provisionedModelId) return err("ai", action, "provisioned_model_id required");
        await executeAwsCommand("Bedrock", "DeleteProvisionedModelThroughput", { ProvisionedModelId: provisionedModelId }, region, creds);
        return ok("ai", action, `Provisioned model ${provisionedModelId} deleted`, {});
      }
      case "status": {
        const provisionedModelId = spec.provisioned_model_id as string;
        if (!provisionedModelId) return err("ai", action, "provisioned_model_id required");
        const result = await executeAwsCommand("Bedrock", "GetProvisionedModelThroughput", { ProvisionedModelId: provisionedModelId }, region, creds);
        return ok("ai", action, `Provisioned model ${provisionedModelId} status`, result);
      }
      default: return err("ai", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("ai", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 3: Add `handleContainer`** (ECS Fargate)

```typescript
async function handleContainer(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("container", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "cluster").toLowerCase();

  try {
    switch (action) {
      case "deploy": {
        const clusterName = spec.cluster_name as string;
        if (!clusterName) return err("container", action, "cluster_name required");
        const result = await executeAwsCommand("ECS", "CreateCluster", {
          clusterName,
          capacityProviders: spec.capacity_providers || ["FARGATE"],
          settings: spec.container_insights ? [{ name: "containerInsights", value: "enabled" }] : [],
        }, region, creds);
        return ok("container", action, `ECS cluster ${clusterName} created`, result);
      }
      case "discover": {
        const result = await executeAwsCommand("ECS", "ListClusters", {}, region, creds);
        return ok("container", action, "ECS clusters listed", result);
      }
      case "destroy": {
        const clusterArn = spec.cluster_arn as string || spec.cluster_name as string;
        if (!clusterArn) return err("container", action, "cluster_arn or cluster_name required");
        await executeAwsCommand("ECS", "DeleteCluster", { cluster: clusterArn }, region, creds);
        return ok("container", action, `ECS cluster ${clusterArn} deleted`, {});
      }
      case "status": {
        const clusterArn = spec.cluster_arn as string || spec.cluster_name as string;
        if (!clusterArn) return err("container", action, "cluster_arn or cluster_name required");
        const result = await executeAwsCommand("ECS", "DescribeClusters", { clusters: [clusterArn] }, region, creds);
        return ok("container", action, `ECS cluster status`, result);
      }
      default: return err("container", action, `Unknown action: ${action}`);
    }
  } catch (e) {
    return err("container", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 4: Add `handleGap`** (Gap analysis — orphan discovery + cleanup)

```typescript
async function handleGap(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const AWS_KEY = Deno.env.get("AWS_ACCESS_KEY_ID") || spec.access_key_id as string;
  const AWS_SECRET = Deno.env.get("AWS_SECRET_ACCESS_KEY") || spec.secret_access_key as string;
  if (!AWS_KEY || !AWS_SECRET) return err("gap", action, "AWS credentials required.");
  const region = spec.region as string || "us-east-1";
  const creds = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET };
  const rt = (spec.resource_type as string || "snapshots").toLowerCase();

  // gap only supports discover and destroy
  if (action !== "discover" && action !== "destroy") {
    return err("gap", action, "Gap analysis supports discover and destroy only.");
  }

  try {
    if (action === "discover") {
      if (rt === "snapshots") {
        // Orphaned EBS snapshots owned by the account
        const result = await executeAwsCommand("EC2", "DescribeSnapshots", {
          Filters: [{ Name: "status", Values: ["completed"] }],
          OwnerIds: ["self"],
        }, region, creds);
        return ok("gap", action, "Orphaned EBS snapshots discovered", result);
      }
      if (rt === "elastic-ips") {
        const result = await executeAwsCommand("EC2", "DescribeAddresses", {}, region, creds);
        return ok("gap", action, "Elastic IPs discovered", result);
      }
      if (rt === "security-groups") {
        const result = await executeAwsCommand("EC2", "DescribeSecurityGroups", {}, region, creds);
        return ok("gap", action, "Security groups audited", result);
      }
      if (rt === "unattached-volumes") {
        const result = await executeAwsCommand("EC2", "DescribeVolumes", {
          Filters: [{ Name: "status", Values: ["available"] }],
        }, region, creds);
        return ok("gap", action, "Unattached EBS volumes discovered", result);
      }
      if (rt === "route53-records") {
        const zoneId = spec.zone_id as string;
        if (!zoneId) return err("gap", action, "zone_id required for route53-records discovery");
        const result = await executeAwsCommand("Route53", "ListResourceRecordSets", { HostedZoneId: zoneId }, region, creds);
        return ok("gap", action, "Route53 records listed", result);
      }
      return err("gap", action, `Unsupported resource_type '${rt}'. Use: snapshots, elastic-ips, security-groups, unattached-volumes, route53-records`);
    }

    // action === "destroy"
    if (rt === "elastic-ips") {
      const allocationId = spec.allocation_id as string;
      if (!allocationId) return err("gap", action, "allocation_id required");
      await executeAwsCommand("EC2", "ReleaseAddress", { AllocationId: allocationId }, region, creds);
      return ok("gap", action, `Elastic IP ${allocationId} released`, {});
    }
    if (rt === "snapshots") {
      const snapshotId = spec.snapshot_id as string;
      if (!snapshotId) return err("gap", action, "snapshot_id required");
      await executeAwsCommand("EC2", "DeleteSnapshot", { SnapshotId: snapshotId }, region, creds);
      return ok("gap", action, `EBS snapshot ${snapshotId} deleted`, {});
    }
    return err("gap", action, `Destroy not supported for resource_type '${rt}'`);
  } catch (e) {
    return err("gap", action, e instanceof Error ? e.message : String(e));
  }
}
```

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(engine): add handleOrchestration, handleAi, handleContainer, handleGap handlers"
```

---

## Task 8: Wire Up Dispatch Switch

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts:364-371` (ExecuteRequest type)
- Modify: `supabase/functions/uidi-engine/index.ts:4617-4619` (default case + add new cases)

- [ ] **Step 1: Update `ExecuteRequest` intent union** (~line 366)

Replace:
```typescript
intent: "kubernetes" | "ansible" | "compute" | "network" | "eks" | "reconcile" | "inventory" | "sre-supreme" | "naawi";
```
With:
```typescript
intent: "kubernetes" | "ansible" | "compute" | "network" | "eks" | "reconcile" | "inventory" |
        "sre-supreme" | "naawi" | "dolt" |
        "storage" | "database" | "serverless" | "cdn" | "dns" | "load-balancer" |
        "security" | "gateway" | "secrets" | "observability" | "orchestration" |
        "ai" | "container" | "gap";
```

- [ ] **Step 2: Add 14 dispatch cases** before the `default:` at ~line 4617

```typescript
      case "storage":
        result = await handleStorage(action, spec);
        break;
      case "database":
        result = await handleDatabase(action, spec);
        break;
      case "serverless":
        result = await handleServerless(action, spec);
        break;
      case "cdn":
        result = await handleCdn(action, spec);
        break;
      case "dns":
        result = await handleDns(action, spec);
        break;
      case "load-balancer":
        result = await handleLoadBalancer(action, spec);
        break;
      case "security":
        result = await handleSecurity(action, spec);
        break;
      case "gateway":
        result = await handleGateway(action, spec);
        break;
      case "secrets":
        result = await handleSecrets(action, spec);
        break;
      case "observability":
        result = await handleObservability(action, spec);
        break;
      case "orchestration":
        result = await handleOrchestration(action, spec);
        break;
      case "ai":
        result = await handleAi(action, spec);
        break;
      case "container":
        result = await handleContainer(action, spec);
        break;
      case "gap":
        result = await handleGap(action, spec);
        break;
```

- [ ] **Step 3: Update the `default:` error message** to include all 14 new intents

- [ ] **Step 4: Commit**
```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(engine): wire up 14 new intents in dispatch switch"
```

---

## Task 9: Add Manifest Entries (v3)

**Files:**
- Modify: `supabase/functions/uidi-engine/manifest.json`

All new entries use `execution.type: "rest-proxy"` so they fall through to the new handler functions (same pattern as existing network/compute entries). Provider = `"aws"` for all (only AWS services in v3 eval suite).

- [ ] **Step 1: Bump version and add entries**

Update `"version": "2"` → `"version": "3"`.

Add one entry per intent × action combination. Template for each:

```json
{
  "intent": "<intent>",
  "action": "<action>",
  "provider": "aws",
  "execution": {
    "type": "rest-proxy",
    "config": {
      "method": "POST",
      "url_template": "https://<service>.{{region}}.amazonaws.com/",
      "headers": { "Content-Type": "application/json" }
    }
  },
  "signing": {
    "strategy": "AWS_SIGV4",
    "signed_headers": ["host", "x-amz-date"],
    "service": "<signingService>",
    "region_required": true
  },
  "enforcement": {
    "inject": {},
    "default": {},
    "required_keys": ["region"]
  }
}
```

Entries to add (54 total — one per intent/action/aws; gap has only discover+destroy = 2, all others have 4 actions each = 13×4 + 2 = 54):

| Intent | Actions | Signing Service | Required Keys (beyond region) |
|--------|---------|----------------|-------------------------------|
| storage | deploy, discover, destroy, status | s3 / ec2 | region, resource_type |
| database | deploy, discover, destroy, status | rds / dynamodb / elasticache | region, resource_type |
| serverless | deploy, discover, destroy, status | lambda | region, resource_type |
| cdn | deploy, discover, destroy, status | cloudfront | (region not required — global) |
| dns | deploy, discover, destroy, status | route53 | (global) |
| load-balancer | deploy, discover, destroy, status | elasticloadbalancing | region |
| security | deploy, discover, destroy, status | iam | region, resource_type |
| gateway | deploy, discover, destroy, status | apigateway / ec2 | region, resource_type |
| secrets | deploy, discover, destroy, status | secretsmanager | region, resource_type |
| observability | deploy, discover, destroy, status | monitoring | region, resource_type |
| orchestration | deploy, discover, destroy, status | states | region, resource_type |
| ai | deploy, discover, destroy, status | bedrock | region |
| container | deploy, discover, destroy, status | ecs | region |
| gap | discover, destroy | ec2 | region, resource_type |

Note: `cdn` and `dns` use `"region_required": false` and `signed_headers: ["host", "x-amz-date"]`. Since the actual URL resolution happens in the handler (not via url_template expansion), the url_template is a documentation placeholder.

- [ ] **Step 2: Verify entry count in test**

Update `src/test/manifest-engine.test.ts` line that asserts `entries.length === 69` to match the new count.

- [ ] **Step 3: Commit**
```bash
git add supabase/functions/uidi-engine/manifest.json src/test/manifest-engine.test.ts
git commit -m "feat(manifest): v3 — add 56 new entries for 14 intent categories"
```

---

## Task 10: Update Tests

**Files:**
- Modify: `src/test/manifest-engine.test.ts`
- Modify: `src/test/manifest-router.test.ts`

- [ ] **Step 1: Update entry count assertion in manifest-engine.test.ts**

Change `expect(entries).toHaveLength(69)` to `expect(entries).toHaveLength(123)` (69 + 54).

- [ ] **Step 2: Add intent validation tests** in manifest-engine.test.ts

```typescript
test("new intents pass IntentSchema validation", () => {
  const newIntents = [
    "storage", "database", "serverless", "cdn", "dns", "load-balancer",
    "security", "gateway", "secrets", "observability", "orchestration",
    "ai", "container", "gap",
  ];
  for (const intent of newIntents) {
    expect(() => IntentSchema.parse(intent)).not.toThrow();
  }
});
```

- [ ] **Step 3: Add router smoke tests** in manifest-router.test.ts

```typescript
test("all 14 new intents have at least one manifest entry", () => {
  const newIntents = [
    "storage", "database", "serverless", "cdn", "dns", "load-balancer",
    "security", "gateway", "secrets", "observability", "orchestration",
    "ai", "container", "gap",
  ];
  for (const intent of newIntents) {
    const entry = MANIFEST.entries.find(e => e.intent === intent);
    expect(entry).toBeDefined();
  }
});

test("storage/deploy/aws entry requires region", () => {
  const op = prepareOperation("storage", "deploy", "aws", { region: "us-east-1", resource_type: "s3", bucket_name: "test-bucket" });
  expect(op).not.toBeInstanceOf(ManifestError);
});

test("gap/discover/aws entry requires region and resource_type", () => {
  const missing = prepareOperation("gap", "discover", "aws", {});
  expect(missing).toBeInstanceOf(ManifestError);
  expect((missing as ManifestError).code).toBe("MISSING_REQUIRED_KEY");
});
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run src/test/ 2>&1
```
Expected: all tests pass.

- [ ] **Step 5: Commit**
```bash
git add src/test/manifest-engine.test.ts src/test/manifest-router.test.ts
git commit -m "test(manifest): update entry count, add v3 intent validation and router smoke tests"
```

---

## Verification Checklist

Before closing this plan, verify each test prompt category works end-to-end:

- [ ] **STORAGE**: `{ intent: "storage", action: "deploy", spec: { resource_type: "s3", bucket_name: "prod-assets", region: "us-east-1", object_lock: true } }` → no `Unknown intent` error
- [ ] **DATABASE**: `{ intent: "database", action: "deploy", spec: { resource_type: "rds", db_identifier: "db-prod-01", region: "us-east-1", username: "admin", password: "s3cur3pass" } }` → no `Unknown intent`
- [ ] **SERVERLESS**: `{ intent: "serverless", action: "deploy", spec: { resource_type: "lambda", function_name: "process-orders", region: "us-east-1", ... } }` → no `Unknown intent`
- [ ] **CDN**: `{ intent: "cdn", action: "discover", spec: {} }` → no `Unknown intent`
- [ ] **DNS**: `{ intent: "dns", action: "discover", spec: { region: "us-east-1" } }` → no `Unknown intent`
- [ ] **LOAD BALANCER**: `{ intent: "load-balancer", action: "discover", spec: { region: "us-east-1" } }` → no `Unknown intent`
- [ ] **SECURITY**: `{ intent: "security", action: "discover", spec: { resource_type: "iam", region: "us-east-1" } }` → no `Unknown intent`
- [ ] **GATEWAY**: `{ intent: "gateway", action: "discover", spec: { resource_type: "api-gateway", region: "us-east-1" } }` → no `Unknown intent`
- [ ] **SECRETS**: `{ intent: "secrets", action: "discover", spec: { resource_type: "secrets-manager", region: "us-east-1" } }` → no `Unknown intent`
- [ ] **OBSERVABILITY**: `{ intent: "observability", action: "discover", spec: { resource_type: "alarm", region: "us-east-1" } }` → no `Unknown intent`
- [ ] **ORCHESTRATION**: `{ intent: "orchestration", action: "discover", spec: { resource_type: "step-functions", region: "us-east-1" } }` → no `Unknown intent`
- [ ] **AI**: `{ intent: "ai", action: "discover", spec: { region: "us-east-1" } }` → no `Unknown intent`
- [ ] **CONTAINER**: `{ intent: "container", action: "discover", spec: { region: "us-east-1" } }` → no `Unknown intent`
- [ ] **GAP**: `{ intent: "gap", action: "discover", spec: { resource_type: "snapshots", region: "us-east-1" } }` → no `Unknown intent`
