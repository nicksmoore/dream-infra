# Universal Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the SDK Capability Manifest from 28 `rest-proxy` entries (3 intents) to 69 entries (all 9 intents) via a discriminated `execution` block, making `manifest.json` the Constitutional Document for all Project Naawi operations.

**Architecture:** A new `execution` discriminated union in `ManifestEntry` holds type-specific config inside `execution.config`, giving free TypeScript narrowing. The engine (`manifest-engine.ts`) is simplified to return `PreparedOperation` (full entry + resolved spec) instead of a flattened `PreparedRequest`. HTTP template resolution moves to a new `buildRestRequest()` helper in `index.ts`. Non-`rest-proxy` execution types return `202 Accepted` stubs pending Sub-Project 2 worker implementation.

**Tech Stack:** TypeScript, Zod 3, Vitest, Deno Edge Functions, `supabase/functions/uidi-engine/`

**Spec:** `docs/superpowers/specs/2026-03-26-universal-manifest-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/functions/uidi-engine/manifest-types.ts` | **Modify** | Add 7 execution config schemas, `ExecutionSchema`, `PreparedOperation`; update `IntentSchema`, `ProviderSchema`, `ManifestEntrySchema` |
| `supabase/functions/uidi-engine/manifest.json` | **Rewrite** | 28 migrated entries + 41 new entries = 69 total; version `"2"` (includes k8s-api entry with K8s Deployment guardrails) |
| `supabase/functions/uidi-engine/manifest-engine.ts` | **Modify** | Rename `prepareRequest→prepareOperation`, simplify `hydrate()`, add `buildRestRequest()` (pure, Vitest-importable) |
| `supabase/functions/uidi-engine/index.ts` | **Modify** | Remove `tryManifestPrepare` + 3 fast-paths; add intent normalization, `response202()`, unified dispatch (rest-proxy falls through) |
| `src/test/manifest-engine.test.ts` | **Modify** | Update schema tests for v2 manifest; update engine tests for `PreparedOperation` return type |
| `src/test/manifest-router.test.ts` | **Create** | Tests unified dispatch: rest-proxy→buildRestRequest, non-rest-proxy→202, NOT_FOUND→fall-through |

---

## Task 1: Update `manifest-types.ts`

**Files:**
- Modify: `supabase/functions/uidi-engine/manifest-types.ts`

- [ ] **Step 1.1: Replace the entire file with the updated schema**

Replace `supabase/functions/uidi-engine/manifest-types.ts` with:

```typescript
import { z } from "zod"; // bare specifier; deno.json maps this to npm:zod@3

// ── Primitive enums ──────────────────────────────────────────────────────────

export const SigningStrategySchema = z.enum([
  "AWS_SIGV4",
  "OCI_RSA_V1",
  "GCP_OAUTH2",
  "AZURE_BEARER",
]);
export type SigningStrategy = z.infer<typeof SigningStrategySchema>;

export const IntentSchema = z.enum([
  "network", "compute", "k8s",
  "ansible", "reconcile", "inventory",
  "sre-supreme", "naawi", "dolt",
]);
export type Intent = z.infer<typeof IntentSchema>;

export const ActionSchema = z.enum(["deploy", "destroy", "discover", "status"]);
export type Action = z.infer<typeof ActionSchema>;

export const ProviderSchema = z.enum(["aws", "oci", "gcp", "azure", "naawi-internal"]);
export type Provider = z.infer<typeof ProviderSchema>;

// ── Enforcement gradient ─────────────────────────────────────────────────────

export const EnforcementSchema = z.object({
  inject: z.record(z.unknown()),
  default: z.record(z.unknown()),
  required_keys: z.array(z.string()),
});
export type Enforcement = z.infer<typeof EnforcementSchema>;

// ── Signing metadata (rest-proxy only) ──────────────────────────────────────

export const SigningMetadataSchema = z
  .object({
    strategy: SigningStrategySchema,
    signed_headers: z.array(z.string()).min(1).refine(
      (arr) => new Set(arr).size === arr.length,
      { message: "signed_headers must not contain duplicates" },
    ),
    service: z.string().optional(),
    region_required: z.boolean(),
  })
  .superRefine((val, ctx) => {
    if (val.strategy === "AWS_SIGV4" && !val.service) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "service is required when strategy is AWS_SIGV4",
        path: ["service"],
      });
    }
  });
export type SigningMetadata = z.infer<typeof SigningMetadataSchema>;

// ── Execution config schemas (one per execution type) ────────────────────────

export const RestProxyConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url_template: z.string().min(1),      // uses {{placeholder}} syntax
  headers: z.record(z.string()),
  body_template: z.string().optional(), // uses {{placeholder}} syntax
});

export const AnsibleConfigSchema = z.object({
  playbook_path: z.string().min(1),
  extra_vars_template: z.string(),      // JSON string with {{placeholder}} tokens
  ssm_document: z.string().optional(),
});

export const K8sConfigSchema = z.object({
  api_version: z.string().min(1),
  resource_kind: z.string().min(1),
  namespace_template: z.string().min(1),
  resource_template: z.string().min(1), // K8s manifest JSON with {{placeholders}}
});

export const ReconcileConfigSchema = z.object({
  sub_intents: z.array(z.string()).min(1),
  drift_tolerance_seconds: z.number().int().positive(),
  auto_remediate: z.boolean(),
});

export const InternalQueryConfigSchema = z.object({
  scan_providers: z.array(z.string()).min(1),
  scan_regions: z.array(z.string()),    // empty = all regions
  resource_types: z.array(z.string()).min(1),
});

export const StateManagerConfigSchema = z.object({
  branch: z.string().min(1),
  table: z.string().min(1),
  operation: z.enum(["read", "write", "diff", "branch"]),
});

export const AgentCoordinatorConfigSchema = z.object({
  autonomy_level: z.enum(["full-auto", "request-approval", "dry-run"]),
  allowed_tools: z.array(z.string()).min(1),
  max_actions_per_run: z.number().int().positive(),
  forbidden_patterns: z.array(z.string()),
});

// ── Execution discriminated union ─────────────────────────────────────────────

export const RetryPolicySchema = z.enum(["exponential", "linear", "none"]);

export const ExecutionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rest-proxy"),        timeout_ms: z.number().default(30000),  retry_policy: RetryPolicySchema.default("none"),        config: RestProxyConfigSchema }),
  z.object({ type: z.literal("ssm-ansible"),       timeout_ms: z.number().default(60000),  retry_policy: RetryPolicySchema.default("exponential"), config: AnsibleConfigSchema }),
  z.object({ type: z.literal("k8s-api"),           timeout_ms: z.number().default(30000),  retry_policy: RetryPolicySchema.default("exponential"), config: K8sConfigSchema }),
  z.object({ type: z.literal("meta-reconcile"),    timeout_ms: z.number().default(60000),  retry_policy: RetryPolicySchema.default("none"),        config: ReconcileConfigSchema }),
  z.object({ type: z.literal("internal-query"),    timeout_ms: z.number().default(15000),  retry_policy: RetryPolicySchema.default("none"),        config: InternalQueryConfigSchema }),
  z.object({ type: z.literal("state-manager"),     timeout_ms: z.number().default(10000),  retry_policy: RetryPolicySchema.default("none"),        config: StateManagerConfigSchema }),
  z.object({ type: z.literal("agent-coordinator"), timeout_ms: z.number().default(120000), retry_policy: RetryPolicySchema.default("exponential"), config: AgentCoordinatorConfigSchema }),
]);
export type Execution = z.infer<typeof ExecutionSchema>;

// ── Manifest entry ───────────────────────────────────────────────────────────

export const ManifestEntrySchema = z.object({
  intent: IntentSchema,
  action: ActionSchema,
  provider: ProviderSchema,
  execution: ExecutionSchema,
  signing: SigningMetadataSchema.optional(), // required iff execution.type === "rest-proxy"
  enforcement: EnforcementSchema,
}).superRefine((val, ctx) => {
  if (val.execution.type === "rest-proxy" && !val.signing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signing is required for rest-proxy entries", path: ["signing"] });
  }
  if (val.execution.type !== "rest-proxy" && val.signing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signing is not applicable for non-rest-proxy entries", path: ["signing"] });
  }
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

// ── Top-level manifest ────────────────────────────────────────────────────────

export const ManifestSchema = z.object({
  version: z.string().min(1),
  generated_at: z.string().datetime(),
  entries: z.array(ManifestEntrySchema).min(1),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ── Engine error ─────────────────────────────────────────────────────────────

export type ManifestErrorCode =
  | "NOT_FOUND"
  | "MISSING_REQUIRED_KEY"
  | "UNRESOLVED_PLACEHOLDER"
  | "SCHEMA_INVALID";

export class ManifestError extends Error {
  constructor(
    public readonly code: ManifestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManifestError";
  }
}

// ── PreparedOperation (engine return type) ───────────────────────────────────

/** Returned by prepareOperation(). Contains the full entry + resolved spec. */
export interface PreparedOperation {
  entry: ManifestEntry;
  resolved_spec: Record<string, unknown>; // after default-fill + inject applied
  manifest_version: string;
}

// ── PreparedRequest (signer contract, rest-proxy only) ───────────────────────

/** Built by buildRestRequest() in index.ts from a PreparedOperation with execution.type === "rest-proxy". */
export interface PreparedRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body: string | null;
  signing: {
    strategy: SigningStrategy;
    signed_headers: string[];
    service?: string;
    region?: string;
  };
  manifest_version: string;
}
```

- [ ] **Step 1.2: Run tsc to confirm no errors**

```bash
cd /Users/nickmoore/project-naawi && npx tsc --noEmit -p tsconfig.app.json
```

Expected: Errors in `manifest-engine.ts` (references `entry.request` which no longer exists on `ManifestEntry`) and `index.ts` (references `prepareRequest`). Errors in the types file itself: none.

- [ ] **Step 1.3: Commit types**

```bash
git add supabase/functions/uidi-engine/manifest-types.ts
git commit -m "feat(manifest): expand types for universal execution schema (v2)"
```

---

## Task 2: Write failing tests for the new schema

**Files:**
- Modify: `src/test/manifest-engine.test.ts`

- [ ] **Step 2.1: Replace the schema validation describe block**

Replace the existing `describe("ManifestSchema — validation", ...)` block (the first 5 tests) with:

```typescript
import { describe, it, expect } from "vitest";
import { ManifestSchema } from "../../supabase/functions/uidi-engine/manifest-types";
import rawManifest from "../../supabase/functions/uidi-engine/manifest.json";

describe("ManifestSchema — validation", () => {
  it("parses the bundled manifest without errors", () => {
    const result = ManifestSchema.safeParse(rawManifest);
    if (!result.success) {
      console.error(result.error.format());
    }
    expect(result.success).toBe(true);
  });

  it("manifest has version 2", () => {
    const result = ManifestSchema.safeParse(rawManifest);
    expect(result.success).toBe(true);
    expect((result as any).data?.version).toBe("2");
  });

  it("manifest has exactly 69 entries", () => {
    const result = ManifestSchema.safeParse(rawManifest);
    expect(result.success).toBe(true);
    expect((result as any).data?.entries.length).toBe(69);
  });

  it("rejects a manifest with an unknown provider", () => {
    const bad = {
      ...rawManifest,
      entries: [{ ...(rawManifest.entries as any[])[0], provider: "alibaba" }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a rest-proxy entry missing signing block", () => {
    const entry = (rawManifest.entries as any[]).find(e => e.execution?.type === "rest-proxy");
    const bad = {
      ...rawManifest,
      entries: [{ ...entry, signing: undefined }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-rest-proxy entry that has a signing block", () => {
    const entry = (rawManifest.entries as any[]).find(e => e.execution?.type !== "rest-proxy");
    if (!entry) return; // skip if no internal entries exist yet
    const bad = {
      ...rawManifest,
      entries: [{ ...entry, signing: { strategy: "AWS_SIGV4", signed_headers: ["host"], service: "ec2", region_required: true } }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an entry with an unknown action", () => {
    const bad = {
      ...rawManifest,
      entries: [{ ...(rawManifest.entries as any[])[0], action: "create" }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an entry with intent 'eks' (renamed to k8s)", () => {
    const bad = {
      ...rawManifest,
      entries: [{ ...(rawManifest.entries as any[])[0], intent: "eks" }],
    };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a manifest with zero entries", () => {
    expect(ManifestSchema.safeParse({ ...rawManifest, entries: [] }).success).toBe(false);
  });
});
```

Keep the existing `describeEngine("manifest-engine — unit tests", ...)` block exactly as-is for now. It will be updated in Task 5.

- [ ] **Step 2.2: Run tests to confirm new schema tests FAIL**

```bash
npx vitest run src/test/manifest-engine.test.ts
```

Expected: Schema tests fail (manifest is still v1 format). Engine tests may pass or fail — OK either way.

- [ ] **Step 2.3: Commit failing tests**

```bash
git add src/test/manifest-engine.test.ts
git commit -m "test(manifest): update schema validation tests for v2 (failing — manifest not yet migrated)"
```

---

## Task 3: Rewrite `manifest.json` (69 entries, version "2")

**Files:**
- Rewrite: `supabase/functions/uidi-engine/manifest.json`

- [ ] **Step 3.1: Replace manifest.json with the complete v2 manifest**

Replace `supabase/functions/uidi-engine/manifest.json` entirely with the following. Note key migration changes:
- `"request": {...}` → `"execution": { "type": "rest-proxy", "config": {...} }`
- `{placeholder}` → `{{placeholder}}` in all template strings
- `"intent": "eks"` → `"intent": "k8s"` (8 entries)
- New entries added for: network/status, compute/destroy, compute/status, k8s/destroy, k8s/status (cloud), plus all 20 internal entries

```json
{
  "version": "2",
  "generated_at": "2026-03-26T00:00:00.000Z",
  "entries": [
    {
      "intent": "network", "action": "deploy", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/?Action=CreateVpc&CidrBlock={{cidrBlock}}&Version=2016-11-15",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" }
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "ec2", "region_required": true },
      "enforcement": { "inject": { "cidrBlock": "10.0.0.0/16" }, "default": {}, "required_keys": ["region"] }
    },
    {
      "intent": "network", "action": "deploy", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/vcns",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"compartmentId\":\"{{compartmentId}}\",\"cidrBlock\":\"{{cidrBlock}}\",\"isIpv6Enabled\":{{isIpv6Enabled}}}"
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date", "x-content-sha256"], "region_required": true },
      "enforcement": { "inject": { "isIpv6Enabled": false, "cidrBlock": "10.0.0.0/16" }, "default": {}, "required_keys": ["region", "compartmentId"] }
    },
    {
      "intent": "network", "action": "deploy", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{projectId}}/global/networks",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"name\":\"{{networkName}}\",\"autoCreateSubnetworks\":{{autoCreateSubnetworks}},\"routingConfig\":{\"routingMode\":\"{{routingMode}}\"}}"
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": { "autoCreateSubnetworks": false, "routingMode": "REGIONAL" }, "default": {}, "required_keys": ["projectId", "networkName"] }
    },
    {
      "intent": "network", "action": "deploy", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "PUT",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Network/virtualNetworks/{{vnetName}}?api-version=2023-05-01",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"location\":\"{{location}}\",\"properties\":{\"addressSpace\":{\"addressPrefixes\":{{addressPrefixes}}}}}"
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": { "addressPrefixes": ["10.1.0.0/16"] }, "default": {}, "required_keys": ["subscriptionId", "resourceGroup", "vnetName", "location"] }
    },
    {
      "intent": "network", "action": "discover", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://ec2.{{region}}.amazonaws.com/?Action=DescribeVpcs&Version=2016-11-15",
        "headers": {}
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "ec2", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region"] }
    },
    {
      "intent": "network", "action": "discover", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/vcns?compartmentId={{compartmentId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "compartmentId"] }
    },
    {
      "intent": "network", "action": "discover", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{projectId}}/global/networks",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId"] }
    },
    {
      "intent": "network", "action": "discover", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/providers/Microsoft.Network/virtualNetworks?api-version=2023-05-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId"] }
    },
    {
      "intent": "network", "action": "destroy", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/?Action=DeleteVpc&VpcId={{vpcId}}&Version=2016-11-15",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" }
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "ec2", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "vpcId"] }
    },
    {
      "intent": "network", "action": "destroy", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/vcns/{{vcnId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "vcnId"] }
    },
    {
      "intent": "network", "action": "destroy", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{projectId}}/global/networks/{{networkName}}",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId", "networkName"] }
    },
    {
      "intent": "network", "action": "destroy", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Network/virtualNetworks/{{vnetName}}?api-version=2023-05-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId", "resourceGroup", "vnetName"] }
    },
    {
      "intent": "network", "action": "status", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://ec2.{{region}}.amazonaws.com/?Action=DescribeVpcs&VpcId={{vpcId}}&Version=2016-11-15",
        "headers": {}
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "ec2", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "vpcId"] }
    },
    {
      "intent": "network", "action": "status", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/vcns/{{vcnId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "vcnId"] }
    },
    {
      "intent": "network", "action": "status", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{projectId}}/global/networks/{{networkName}}",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId", "networkName"] }
    },
    {
      "intent": "network", "action": "status", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Network/virtualNetworks/{{vnetName}}?api-version=2023-05-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId", "resourceGroup", "vnetName"] }
    },
    {
      "intent": "compute", "action": "deploy", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/?Action=RunInstances&Version=2016-11-15",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" },
        "body_template": "ImageId={{imageId}}&InstanceType={{instanceType}}&MinCount=1&MaxCount=1&SubnetId={{subnetId}}"
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date", "content-type"], "service": "ec2", "region_required": true },
      "enforcement": { "inject": {}, "default": { "instanceType": "t3.micro" }, "required_keys": ["region", "imageId", "subnetId"] }
    },
    {
      "intent": "compute", "action": "deploy", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/instances",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"compartmentId\":\"{{compartmentId}}\",\"shape\":\"{{shape}}\",\"availabilityDomain\":\"{{availabilityDomain}}\",\"sourceDetails\":{\"sourceType\":\"image\",\"imageId\":\"{{imageId}}\"}}"
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date", "x-content-sha256"], "region_required": true },
      "enforcement": { "inject": {}, "default": { "shape": "VM.Standard.E4.Flex" }, "required_keys": ["region", "compartmentId", "availabilityDomain", "imageId"] }
    },
    {
      "intent": "compute", "action": "deploy", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{projectId}}/zones/{{zone}}/instances",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"name\":\"{{instanceName}}\",\"machineType\":\"zones/{{zone}}/machineTypes/{{machineType}}\",\"disks\":[{\"boot\":true,\"initializeParams\":{\"sourceImage\":\"{{sourceImage}}\"}}],\"networkInterfaces\":[{\"network\":\"{{network}}\"}]}"
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": { "machineType": "n2-standard-2" }, "required_keys": ["projectId", "zone", "instanceName", "sourceImage", "network"] }
    },
    {
      "intent": "compute", "action": "deploy", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "PUT",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Compute/virtualMachines/{{vmName}}?api-version=2023-07-01",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"location\":\"{{location}}\",\"properties\":{\"hardwareProfile\":{\"vmSize\":\"{{vmSize}}\"},\"storageProfile\":{\"imageReference\":{\"id\":\"{{imageId}}\"}},\"networkProfile\":{\"networkInterfaces\":[{\"id\":\"{{nicId}}\"}]}}}"
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": { "vmSize": "Standard_D2s_v3" }, "required_keys": ["subscriptionId", "resourceGroup", "vmName", "location", "imageId", "nicId"] }
    },
    {
      "intent": "compute", "action": "discover", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://ec2.{{region}}.amazonaws.com/?Action=DescribeInstances&Version=2016-11-15",
        "headers": {}
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "ec2", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region"] }
    },
    {
      "intent": "compute", "action": "discover", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/instances?compartmentId={{compartmentId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "compartmentId"] }
    },
    {
      "intent": "compute", "action": "discover", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{projectId}}/zones/{{zone}}/instances",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId", "zone"] }
    },
    {
      "intent": "compute", "action": "discover", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/providers/Microsoft.Compute/virtualMachines?api-version=2023-07-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId"] }
    },
    {
      "intent": "compute", "action": "destroy", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/?Action=TerminateInstances&InstanceId.1={{instanceId}}&Version=2016-11-15",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" }
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "ec2", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "instanceId"] }
    },
    {
      "intent": "compute", "action": "destroy", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/instances/{{instanceId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "instanceId"] }
    },
    {
      "intent": "compute", "action": "destroy", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{projectId}}/zones/{{zone}}/instances/{{instanceName}}",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId", "zone", "instanceName"] }
    },
    {
      "intent": "compute", "action": "destroy", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Compute/virtualMachines/{{vmName}}?api-version=2023-07-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId", "resourceGroup", "vmName"] }
    },
    {
      "intent": "compute", "action": "status", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://ec2.{{region}}.amazonaws.com/?Action=DescribeInstanceStatus&InstanceId.1={{instanceId}}&Version=2016-11-15",
        "headers": {}
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "ec2", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "instanceId"] }
    },
    {
      "intent": "compute", "action": "status", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/instances/{{instanceId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "instanceId"] }
    },
    {
      "intent": "compute", "action": "status", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{projectId}}/zones/{{zone}}/instances/{{instanceName}}",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId", "zone", "instanceName"] }
    },
    {
      "intent": "compute", "action": "status", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Compute/virtualMachines/{{vmName}}/instanceView?api-version=2023-07-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId", "resourceGroup", "vmName"] }
    },
    {
      "intent": "k8s", "action": "deploy", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://eks.{{region}}.amazonaws.com/clusters",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"name\":\"{{clusterName}}\",\"roleArn\":\"{{roleArn}}\",\"resourcesVpcConfig\":{\"subnetIds\":{{subnetIds}},\"securityGroupIds\":{{securityGroupIds}}}}"
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date", "content-type"], "service": "eks", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "clusterName", "roleArn", "subnetIds", "securityGroupIds"] }
    },
    {
      "intent": "k8s", "action": "deploy", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://containerengine.{{region}}.oraclecloud.com/20180222/clusters",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"compartmentId\":\"{{compartmentId}}\",\"name\":\"{{clusterName}}\",\"vcnId\":\"{{vcnId}}\",\"kubernetesVersion\":\"{{kubernetesVersion}}\"}"
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date", "x-content-sha256"], "region_required": true },
      "enforcement": { "inject": {}, "default": { "kubernetesVersion": "v1.29.1" }, "required_keys": ["region", "compartmentId", "clusterName", "vcnId"] }
    },
    {
      "intent": "k8s", "action": "deploy", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "POST",
        "url_template": "https://container.googleapis.com/v1/projects/{{projectId}}/zones/{{zone}}/clusters",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"cluster\":{\"name\":\"{{clusterName}}\",\"nodePools\":[{\"name\":\"default-pool\",\"config\":{\"machineType\":\"{{machineType}}\"},\"initialNodeCount\":{{initialNodeCount}}}]}}"
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": { "machineType": "n2-standard-4", "initialNodeCount": 3 }, "required_keys": ["projectId", "zone", "clusterName"] }
    },
    {
      "intent": "k8s", "action": "deploy", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "PUT",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.ContainerService/managedClusters/{{clusterName}}?api-version=2024-01-01",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"location\":\"{{location}}\",\"properties\":{\"kubernetesVersion\":\"{{kubernetesVersion}}\",\"dnsPrefix\":\"{{dnsPrefix}}\",\"agentPoolProfiles\":[{\"name\":\"agentpool\",\"count\":{{nodeCount}},\"vmSize\":\"{{vmSize}}\"}]}}"
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": { "vmSize": "Standard_D4s_v3", "nodeCount": 3, "kubernetesVersion": "1.29" }, "required_keys": ["subscriptionId", "resourceGroup", "clusterName", "location", "dnsPrefix"] }
    },
    {
      "intent": "k8s", "action": "discover", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://eks.{{region}}.amazonaws.com/clusters",
        "headers": {}
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "eks", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region"] }
    },
    {
      "intent": "k8s", "action": "discover", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://containerengine.{{region}}.oraclecloud.com/20180222/clusters?compartmentId={{compartmentId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "compartmentId"] }
    },
    {
      "intent": "k8s", "action": "discover", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://container.googleapis.com/v1/projects/{{projectId}}/zones/{{zone}}/clusters",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId", "zone"] }
    },
    {
      "intent": "k8s", "action": "discover", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/providers/Microsoft.ContainerService/managedClusters?api-version=2024-01-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId"] }
    },
    {
      "intent": "k8s", "action": "destroy", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://eks.{{region}}.amazonaws.com/clusters/{{clusterName}}",
        "headers": {}
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "eks", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "clusterName"] }
    },
    {
      "intent": "k8s", "action": "destroy", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://containerengine.{{region}}.oraclecloud.com/20180222/clusters/{{clusterId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "clusterId"] }
    },
    {
      "intent": "k8s", "action": "destroy", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://container.googleapis.com/v1/projects/{{projectId}}/zones/{{zone}}/clusters/{{clusterName}}",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId", "zone", "clusterName"] }
    },
    {
      "intent": "k8s", "action": "destroy", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "DELETE",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.ContainerService/managedClusters/{{clusterName}}?api-version=2024-01-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId", "resourceGroup", "clusterName"] }
    },
    {
      "intent": "k8s", "action": "status", "provider": "aws",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://eks.{{region}}.amazonaws.com/clusters/{{clusterName}}",
        "headers": {}
      }},
      "signing": { "strategy": "AWS_SIGV4", "signed_headers": ["host", "x-amz-date"], "service": "eks", "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "clusterName"] }
    },
    {
      "intent": "k8s", "action": "status", "provider": "oci",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://containerengine.{{region}}.oraclecloud.com/20180222/clusters/{{clusterId}}",
        "headers": {}
      }},
      "signing": { "strategy": "OCI_RSA_V1", "signed_headers": ["host", "date"], "region_required": true },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["region", "clusterId"] }
    },
    {
      "intent": "k8s", "action": "status", "provider": "gcp",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://container.googleapis.com/v1/projects/{{projectId}}/zones/{{zone}}/clusters/{{clusterName}}",
        "headers": {}
      }},
      "signing": { "strategy": "GCP_OAUTH2", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["projectId", "zone", "clusterName"] }
    },
    {
      "intent": "k8s", "action": "status", "provider": "azure",
      "execution": { "type": "rest-proxy", "config": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.ContainerService/managedClusters/{{clusterName}}?api-version=2024-01-01",
        "headers": {}
      }},
      "signing": { "strategy": "AZURE_BEARER", "signed_headers": ["authorization"], "region_required": false },
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["subscriptionId", "resourceGroup", "clusterName"] }
    },
    {
      "intent": "ansible", "action": "deploy", "provider": "naawi-internal",
      "execution": { "type": "ssm-ansible", "config": {
        "playbook_path": "playbooks/deploy.yml",
        "extra_vars_template": "{\"target_host\":\"{{target_host}}\",\"env\":\"{{env}}\"}"
      }},
      "enforcement": { "inject": { "ansible_user": "naawi_admin" }, "default": { "env": "production" }, "required_keys": ["target_host"] }
    },
    {
      "intent": "ansible", "action": "destroy", "provider": "naawi-internal",
      "execution": { "type": "ssm-ansible", "config": {
        "playbook_path": "playbooks/destroy.yml",
        "extra_vars_template": "{\"target_host\":\"{{target_host}}\"}"
      }},
      "enforcement": { "inject": { "ansible_user": "naawi_admin" }, "default": {}, "required_keys": ["target_host"] }
    },
    {
      "intent": "ansible", "action": "status", "provider": "naawi-internal",
      "execution": { "type": "ssm-ansible", "config": {
        "playbook_path": "playbooks/status.yml",
        "extra_vars_template": "{\"target_host\":\"{{target_host}}\"}"
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": ["target_host"] }
    },
    {
      "intent": "ansible", "action": "discover", "provider": "naawi-internal",
      "execution": { "type": "ssm-ansible", "config": {
        "playbook_path": "playbooks/discover.yml",
        "extra_vars_template": "{\"scan_pattern\":\"{{scan_pattern}}\"}"
      }},
      "enforcement": { "inject": {}, "default": { "scan_pattern": "*" }, "required_keys": [] }
    },
    {
      "intent": "reconcile", "action": "deploy", "provider": "naawi-internal",
      "execution": { "type": "meta-reconcile", "config": {
        "sub_intents": ["network", "compute", "k8s"],
        "drift_tolerance_seconds": 300,
        "auto_remediate": false
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "reconcile", "action": "discover", "provider": "naawi-internal",
      "execution": { "type": "meta-reconcile", "config": {
        "sub_intents": ["network", "compute", "k8s"],
        "drift_tolerance_seconds": 600,
        "auto_remediate": false
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "reconcile", "action": "status", "provider": "naawi-internal",
      "execution": { "type": "meta-reconcile", "config": {
        "sub_intents": ["network", "compute", "k8s"],
        "drift_tolerance_seconds": 60,
        "auto_remediate": false
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "sre-supreme", "action": "deploy", "provider": "naawi-internal",
      "execution": { "type": "agent-coordinator", "config": {
        "autonomy_level": "request-approval",
        "allowed_tools": ["prepareOperation", "dolt.writeResource", "dolt.queryResource"],
        "max_actions_per_run": 10,
        "forbidden_patterns": ["DELETE.*production", "DROP TABLE"]
      }},
      "enforcement": { "inject": { "max_tokens_per_run": 5000 }, "default": { "autonomy_level": "request-approval" }, "required_keys": [] }
    },
    {
      "intent": "sre-supreme", "action": "discover", "provider": "naawi-internal",
      "execution": { "type": "agent-coordinator", "config": {
        "autonomy_level": "full-auto",
        "allowed_tools": ["prepareOperation", "dolt.queryResource"],
        "max_actions_per_run": 50,
        "forbidden_patterns": []
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "sre-supreme", "action": "status", "provider": "naawi-internal",
      "execution": { "type": "agent-coordinator", "config": {
        "autonomy_level": "full-auto",
        "allowed_tools": ["dolt.queryResource", "dolt.getHistory"],
        "max_actions_per_run": 20,
        "forbidden_patterns": []
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "naawi", "action": "deploy", "provider": "naawi-internal",
      "execution": { "type": "agent-coordinator", "config": {
        "autonomy_level": "request-approval",
        "allowed_tools": ["prepareOperation", "dolt.writeResource"],
        "max_actions_per_run": 5,
        "forbidden_patterns": ["rm -rf", "DROP TABLE", "DELETE.*main"]
      }},
      "enforcement": { "inject": { "require_engram_alignment": true }, "default": {}, "required_keys": [] }
    },
    {
      "intent": "naawi", "action": "status", "provider": "naawi-internal",
      "execution": { "type": "agent-coordinator", "config": {
        "autonomy_level": "full-auto",
        "allowed_tools": ["dolt.queryResource", "dolt.getHistory"],
        "max_actions_per_run": 10,
        "forbidden_patterns": []
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "dolt", "action": "deploy", "provider": "naawi-internal",
      "execution": { "type": "state-manager", "config": {
        "branch": "main",
        "table": "resources",
        "operation": "write"
      }},
      "enforcement": { "inject": {}, "default": { "branch": "main" }, "required_keys": ["resource_id"] }
    },
    {
      "intent": "dolt", "action": "discover", "provider": "naawi-internal",
      "execution": { "type": "state-manager", "config": {
        "branch": "main",
        "table": "resources",
        "operation": "read"
      }},
      "enforcement": { "inject": {}, "default": { "branch": "main" }, "required_keys": [] }
    },
    {
      "intent": "dolt", "action": "status", "provider": "naawi-internal",
      "execution": { "type": "state-manager", "config": {
        "branch": "main",
        "table": "resources",
        "operation": "diff"
      }},
      "enforcement": { "inject": {}, "default": { "branch": "main" }, "required_keys": [] }
    },
    {
      "intent": "inventory", "action": "discover", "provider": "naawi-internal",
      "execution": { "type": "internal-query", "config": {
        "scan_providers": ["aws", "oci", "gcp", "azure"],
        "scan_regions": [],
        "resource_types": ["vpc", "instance", "cluster"]
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "inventory", "action": "discover", "provider": "aws",
      "execution": { "type": "internal-query", "config": {
        "scan_providers": ["aws"],
        "scan_regions": [],
        "resource_types": ["vpc", "instance", "cluster", "s3", "lambda"]
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "inventory", "action": "discover", "provider": "oci",
      "execution": { "type": "internal-query", "config": {
        "scan_providers": ["oci"],
        "scan_regions": [],
        "resource_types": ["vcn", "instance", "cluster"]
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "inventory", "action": "discover", "provider": "gcp",
      "execution": { "type": "internal-query", "config": {
        "scan_providers": ["gcp"],
        "scan_regions": [],
        "resource_types": ["network", "instance", "cluster", "bucket"]
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "inventory", "action": "discover", "provider": "azure",
      "execution": { "type": "internal-query", "config": {
        "scan_providers": ["azure"],
        "scan_regions": [],
        "resource_types": ["vnet", "vm", "aks", "storage"]
      }},
      "enforcement": { "inject": {}, "default": {}, "required_keys": [] }
    },
    {
      "intent": "k8s", "action": "deploy", "provider": "naawi-internal",
      "execution": { "type": "k8s-api", "config": {
        "api_version": "apps/v1",
        "resource_kind": "Deployment",
        "namespace_template": "{{namespace}}",
        "resource_template": "{\"apiVersion\":\"apps/v1\",\"kind\":\"Deployment\",\"metadata\":{\"name\":\"{{deploymentName}}\",\"namespace\":\"{{namespace}}\"},\"spec\":{\"replicas\":{{replicas}},\"selector\":{\"matchLabels\":{\"app\":\"{{deploymentName}}\"}},\"template\":{\"metadata\":{\"labels\":{\"app\":\"{{deploymentName}}\"}},\"spec\":{\"containers\":[{\"name\":\"{{deploymentName}}\",\"image\":\"{{image}}\"}]}}}}"
      }},
      "enforcement": {
        "inject": {
          "topologySpreadConstraints": [{"maxSkew": 1, "topologyKey": "kubernetes.io/hostname", "whenUnsatisfiable": "DoNotSchedule"}],
          "securityContext": {"runAsNonRoot": true}
        },
        "default": { "replicas": 2 },
        "required_keys": ["namespace", "deploymentName", "image"]
      }
    }
  ]
}
```

- [ ] **Step 3.2: Run schema validation tests**

```bash
npx vitest run src/test/manifest-engine.test.ts --reporter=verbose 2>&1 | head -40
```

Expected: The 9 schema tests now PASS. The engine tests may fail (engine still uses old API). That is expected at this stage.

- [ ] **Step 3.3: Verify entry count**

```bash
node -e "const m = require('./supabase/functions/uidi-engine/manifest.json'); console.log('entries:', m.entries.length, '| version:', m.version)"
```

Expected: `entries: 69 | version: 2`

- [ ] **Step 3.4: Commit manifest**

```bash
git add supabase/functions/uidi-engine/manifest.json
git commit -m "feat(manifest): migrate to v2 schema with 69 entries covering all 9 intents"
```

---

## Task 4: Write failing engine tests for `PreparedOperation` (TDD: red phase)

**Files:**
- Modify: `src/test/manifest-engine.test.ts`

These tests call `prepareOperation()` and assert on `PreparedOperation` shape. They will FAIL until Task 5 implements the engine.

- [ ] **Step 4.1: Replace the `describeEngine` block with tests for the new API**

Replace the entire `describeEngine("manifest-engine — unit tests", ...)` block (everything after the schema tests) with the `describe("manifest-engine — unit tests", ...)` block from Task 5's Step 5.1. These tests call `engine.prepareOperation()` (not yet implemented) so they will fail. Add `beforeEach` import at top of file if not already present.

- [ ] **Step 4.2: Run tests to confirm they FAIL**

```bash
npx vitest run src/test/manifest-engine.test.ts
```

Expected: Engine tests fail with "prepareOperation is not a function" or type errors. Schema tests still pass.

- [ ] **Step 4.3: Commit failing tests**

```bash
git add src/test/manifest-engine.test.ts
git commit -m "test(manifest): write failing engine tests for PreparedOperation API (red)"
```

---

## Task 5: Update `manifest-engine.ts`

**Files:**
- Modify: `supabase/functions/uidi-engine/manifest-engine.ts`

- [ ] **Step 5.1: Replace the entire file**

Replace `supabase/functions/uidi-engine/manifest-engine.ts` with:

```typescript
import { ManifestEntry, ManifestError, ManifestSchema, PreparedOperation, PreparedRequest } from "./manifest-types.ts";
import rawManifest from "./manifest.json" assert { type: "json" };

// ── Boot-time validation ──────────────────────────────────────────────────────

const parseResult = ManifestSchema.safeParse(rawManifest);
if (!parseResult.success) {
  throw new ManifestError(
    "SCHEMA_INVALID",
    `Bundled manifest failed validation: ${parseResult.error.message}`,
  );
}
const MANIFEST = parseResult.data;

// ── lookup ────────────────────────────────────────────────────────────────────

/**
 * Finds the manifest entry for a (intent, action, provider) triple.
 * Returns ManifestError NOT_FOUND if no entry matches.
 */
export function lookup(
  intent: string,
  action: string,
  provider: string,
): ManifestEntry | ManifestError {
  const entry = MANIFEST.entries.find(
    (e) => e.intent === intent && e.action === action && e.provider === provider,
  );
  if (!entry) {
    return new ManifestError(
      "NOT_FOUND",
      `No manifest entry for (${intent}, ${action}, ${provider})`,
    );
  }
  return entry;
}

// ── enforce ───────────────────────────────────────────────────────────────────

/**
 * Applies defaults and validates required_keys.
 * Order: default-fill → validate required_keys.
 * Returns enriched spec or ManifestError MISSING_REQUIRED_KEY.
 */
export function enforce(
  userSpec: Record<string, unknown>,
  entry: ManifestEntry,
): Record<string, unknown> | ManifestError {
  const spec = { ...entry.enforcement.default, ...userSpec };

  for (const key of entry.enforcement.required_keys) {
    if (!(key in spec) || spec[key] === undefined || spec[key] === null) {
      return new ManifestError(
        "MISSING_REQUIRED_KEY",
        `Required key "${key}" is missing from spec for (${entry.intent}, ${entry.action}, ${entry.provider})`,
      );
    }
  }

  return spec;
}

// ── hydrate ───────────────────────────────────────────────────────────────────

/**
 * Applies enforcement.inject (inject always wins) and returns the resolved spec.
 * Template resolution is handled by buildRestRequest() in index.ts for rest-proxy entries.
 */
export function hydrate(
  entry: ManifestEntry,
  enforced: Record<string, unknown>,
): Record<string, unknown> {
  return { ...enforced, ...entry.enforcement.inject };
}

// ── prepareOperation ──────────────────────────────────────────────────────────

/**
 * End-to-end: lookup → enforce → hydrate.
 * Returns PreparedOperation containing the full entry + resolved spec.
 */
export function prepareOperation(
  intent: string,
  action: string,
  provider: string,
  userSpec: Record<string, unknown>,
): PreparedOperation | ManifestError {
  const entry = lookup(intent, action, provider);
  if (entry instanceof ManifestError) return entry;

  const enforced = enforce(userSpec, entry);
  if (enforced instanceof ManifestError) return enforced;

  const resolved_spec = hydrate(entry, enforced);

  return {
    entry,
    resolved_spec,
    manifest_version: MANIFEST.version,
  };
}

// ── buildRestRequest ──────────────────────────────────────────────────────────
// Pure function: PreparedOperation (rest-proxy) → PreparedRequest for signing.
// Lives here (not in index.ts) so it can be imported by Vitest tests without
// pulling in Deno-specific APIs from index.ts.

export function buildRestRequest(op: PreparedOperation): PreparedRequest | ManifestError {
  const execution = op.entry.execution as { type: "rest-proxy"; config: { method: string; url_template: string; headers: Record<string, string>; body_template?: string } };
  const cfg = execution.config;
  const spec = op.resolved_spec;
  const PLACEHOLDER_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  const UNRESOLVED_RE = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/;

  function resolveTemplate(tmpl: string): string {
    return tmpl.replace(PLACEHOLDER_RE, (_, key) => {
      const value = spec[key];
      if (value === undefined) return `{{${key}}}`;
      if (Array.isArray(value)) return JSON.stringify(value);
      if (typeof value === "boolean") return value ? "true" : "false";
      if (typeof value === "number") return String(value);
      return String(value);
    });
  }

  const url = resolveTemplate(cfg.url_template);
  if (UNRESOLVED_RE.test(url)) {
    const unresolved = url.match(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g)?.join(", ") ?? "";
    return new ManifestError("UNRESOLVED_PLACEHOLDER", `Unresolved placeholders in url_template: ${unresolved}`);
  }

  let body: string | null = null;
  if (cfg.body_template) {
    body = resolveTemplate(cfg.body_template);
    if (UNRESOLVED_RE.test(body)) {
      const unresolved = body.match(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g)?.join(", ") ?? "";
      return new ManifestError("UNRESOLVED_PLACEHOLDER", `Unresolved placeholders in body_template: ${unresolved}`);
    }
  }

  const signing = op.entry.signing!;
  const signingBlock: PreparedRequest["signing"] = {
    strategy: signing.strategy,
    signed_headers: [...signing.signed_headers],
    ...(signing.service ? { service: signing.service } : {}),
    ...(signing.region_required ? { region: String(spec["region"] ?? "") } : {}),
  };

  return {
    method: cfg.method as PreparedRequest["method"],
    url,
    headers: { ...cfg.headers },
    body,
    signing: signingBlock,
    manifest_version: op.manifest_version,
  };
}
```

- [ ] **Step 5.2: Run tsc**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: Errors only in `index.ts` (still importing `prepareRequest`). `manifest-engine.ts` itself: zero errors.

- [ ] **Step 5.3: Run engine tests to confirm they now PASS**

```bash
npx vitest run src/test/manifest-engine.test.ts
```

Expected: All engine tests pass (the failing tests from Task 4 are now green). Schema tests also pass.

- [ ] **Step 5.4: Commit engine**

```bash
git add supabase/functions/uidi-engine/manifest-engine.ts
git commit -m "feat(manifest): simplify engine to prepareOperation returning PreparedOperation"
```

---

## Task 6: Write failing router and `buildRestRequest` tests (TDD: red phase)

**Files:**
- Create: `src/test/manifest-router.test.ts`

These tests import `buildRestRequest` from `manifest-engine.ts` (added as an export in Task 5). The dispatch tests verify all 9 intents are reachable via the engine. Tests will be partially failing (buildRestRequest tests) until Task 5 is complete.

- [ ] **Step 6.1: Write the router + buildRestRequest tests**

> **Note on architecture:** `buildRestRequest` will be added to `manifest-engine.ts` (Task 5) rather than `index.ts`, because `index.ts` uses Deno-specific APIs (`Deno.serve`, `Deno.env`) that cannot be imported in Vitest. Keeping `buildRestRequest` in the engine file keeps it pure, testable, and importable.

Create `src/test/manifest-router.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ManifestError } from "../../supabase/functions/uidi-engine/manifest-types";
import * as engine from "../../supabase/functions/uidi-engine/manifest-engine";
// buildRestRequest is exported from manifest-engine.ts (added in Task 5)
import { buildRestRequest } from "../../supabase/functions/uidi-engine/manifest-engine";

describe("manifest dispatch — integration (all 9 intents)", () => {
  it("prepareOperation returns rest-proxy entry for network/deploy/aws", () => {
    const op = engine.prepareOperation("network", "deploy", "aws", { region: "us-east-1" });
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("rest-proxy");
  });

  it("prepareOperation returns ssm-ansible entry for ansible/deploy/naawi-internal", () => {
    const op = engine.prepareOperation("ansible", "deploy", "naawi-internal", { target_host: "10.0.0.1" });
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("ssm-ansible");
  });

  it("prepareOperation returns k8s-api entry for k8s/deploy/naawi-internal (Deployment guardrails)", () => {
    const op = engine.prepareOperation("k8s", "deploy", "naawi-internal", { namespace: "default", deploymentName: "api", image: "nginx:latest" });
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("k8s-api");
    expect((op as any).resolved_spec["topologySpreadConstraints"]).toBeDefined();
    expect((op as any).resolved_spec["securityContext"]).toMatchObject({ runAsNonRoot: true });
  });

  it("prepareOperation returns agent-coordinator for sre-supreme/deploy/naawi-internal", () => {
    const op = engine.prepareOperation("sre-supreme", "deploy", "naawi-internal", {});
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("agent-coordinator");
  });

  it("prepareOperation returns state-manager for dolt/deploy/naawi-internal", () => {
    const op = engine.prepareOperation("dolt", "deploy", "naawi-internal", { resource_id: "res-001" });
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("state-manager");
  });

  it("prepareOperation returns internal-query for inventory/discover/aws", () => {
    const op = engine.prepareOperation("inventory", "discover", "aws", {});
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("internal-query");
  });

  it("prepareOperation returns meta-reconcile for reconcile/deploy/naawi-internal", () => {
    const op = engine.prepareOperation("reconcile", "deploy", "naawi-internal", {});
    expect(op).not.toBeInstanceOf(ManifestError);
    expect((op as any).entry.execution.type).toBe("meta-reconcile");
  });

  it("NOT_FOUND for eks (legacy — should use k8s after normalizeIntent)", () => {
    const op = engine.prepareOperation("eks", "deploy", "aws", { region: "us-east-1" });
    expect(op).toBeInstanceOf(ManifestError);
    expect((op as any).code).toBe("NOT_FOUND");
  });

  it("all 9 intents have at least one manifest entry", () => {
    const intents = ["network", "compute", "k8s", "ansible", "reconcile", "inventory", "sre-supreme", "naawi", "dolt"];
    for (const intent of intents) {
      const providers = ["aws", "naawi-internal"];
      const actions = ["discover", "deploy"];
      let found = false;
      for (const provider of providers) {
        for (const action of actions) {
          const op = engine.prepareOperation(intent, action, provider, {});
          if (!(op instanceof ManifestError)) { found = true; break; }
        }
        if (found) break;
      }
      expect(found, `Intent "${intent}" has no manifest entry`).toBe(true);
    }
  });
});

describe("buildRestRequest — template resolution", () => {
  it("resolves {{placeholders}} in url_template for network/deploy/aws", () => {
    const op = engine.prepareOperation("network", "deploy", "aws", { region: "us-east-1" }) as any;
    const req = buildRestRequest(op);
    expect(req).not.toBeInstanceOf(ManifestError);
    expect((req as any).url).toContain("us-east-1");
    expect((req as any).url).not.toContain("{{");
  });

  it("returns ManifestError UNRESOLVED_PLACEHOLDER when spec is missing required placeholder", () => {
    const op = engine.prepareOperation("network", "deploy", "aws", { region: "us-east-1" }) as any;
    const badOp = { ...op, resolved_spec: {} }; // strip resolved_spec to simulate unresolved
    const req = buildRestRequest(badOp);
    expect(req).toBeInstanceOf(ManifestError);
    expect((req as any).code).toBe("UNRESOLVED_PLACEHOLDER");
  });

  it("resolves boolean inject value isIpv6Enabled:false into body_template", () => {
    const op = engine.prepareOperation("network", "deploy", "oci", { region: "us-ashburn-1", compartmentId: "ocid1.test" }) as any;
    const req = buildRestRequest(op);
    expect(req).not.toBeInstanceOf(ManifestError);
    expect((req as any).body).toContain('"isIpv6Enabled":false');
  });

  it("returns null body for GET requests with no body_template", () => {
    const op = engine.prepareOperation("network", "discover", "aws", { region: "us-east-1" }) as any;
    const req = buildRestRequest(op);
    expect(req).not.toBeInstanceOf(ManifestError);
    expect((req as any).body).toBeNull();
  });
});
```

- [ ] **Step 6.2: Run tests to confirm they FAIL**

```bash
npx vitest run src/test/manifest-router.test.ts
```

Expected: Tests fail — `buildRestRequest` is not yet exported from `manifest-engine.ts` (added in Task 5... wait: Task 5 runs BEFORE Task 6, so `buildRestRequest` will already be implemented). The **engine dispatch tests** (9 intents) will pass; the **buildRestRequest tests** will FAIL because `buildRestRequest` is not yet exported. Run anyway to verify the current failure state before Task 7 finishes any remaining wiring.

- [ ] **Step 6.3: Commit failing tests**

```bash
git add src/test/manifest-router.test.ts
git commit -m "test(manifest): add router dispatch and buildRestRequest tests (partial red)"
```

---

## Task 7: Update `index.ts`

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts`

- [ ] **Step 7.1: Update the import block at the top**

Find lines 1-5 (the manifest-related imports). Replace:
```typescript
import type { PreparedRequest } from "./manifest-types.ts";
import { prepareRequest } from "./manifest-engine.ts";
```

With:
```typescript
import type { PreparedRequest, PreparedOperation } from "./manifest-types.ts";
import { ManifestError, buildRestRequest } from "./manifest-engine.ts";
import { prepareOperation } from "./manifest-engine.ts";
```

- [ ] **Step 7.2: Remove `tryManifestPrepare` helper**

Find and delete the entire `tryManifestPrepare` function (~lines 384–401):
```typescript
function tryManifestPrepare(
  intent: string,
  action: string,
  provider: string,
  spec: Record<string, unknown>,
): PreparedRequest | null {
  const result = prepareRequest(intent, action, provider, spec);
  if (result instanceof Error) {
    if ((result as any).code === "NOT_FOUND") return null;
    throw result;
  }
  return result;
}
```

- [ ] **Step 7.3: Remove the three discover fast-path blocks**

Find and delete these three blocks inside their respective handler functions:

In `handleCompute` (around line 816):
```typescript
  // ── Manifest-engine fast-path for discover ───────────────────────────────
  if (action === "discover") {
    const prepared = tryManifestPrepare("compute", "discover", provider, spec as Record<string, unknown>);
    if (prepared) {
      return ok("compute", action, "Manifest-prepared discover request", { ... });
    }
    // Falls through to legacy handler if no manifest entry
  }
```

Find the equivalent blocks in `handleNetwork` and `handleEks` and delete them too.

- [ ] **Step 7.4: Add `normalizeIntent` and `response202` (NOT `buildRestRequest` — moved to engine in Task 5)**

After the imports and before the first function definition, add:

```typescript
// ── Intent name normalization ─────────────────────────────────────────────────
// Map legacy intent names to canonical v2 names (backwards compat for API callers)
function normalizeIntent(intent: string): string {
  if (intent === "eks" || intent === "kubernetes") return "k8s";
  return intent;
}

// ── response202 ───────────────────────────────────────────────────────────────
// Stub response for non-rest-proxy intents (workers implemented in Sub-Project 2+)
function response202(op: PreparedOperation): EngineResponse {
  return ok(op.entry.intent, op.entry.action,
    `Guardrails validated. Worker for '${op.entry.execution.type}' is in development.`,
    { manifest_version: op.manifest_version, resolved_spec: op.resolved_spec, execution_type: op.entry.execution.type }
  );
}
```

- [ ] **Step 7.5: Add the unified dispatch to the main request handler**

Read the code around line 4200-4280 to find the main dispatch point (the function that calls `handleNetwork`, `handleCompute`, `handleEks`, etc.). Add the unified manifest dispatch BEFORE the intent switch/if chain:

```typescript
  // ── Manifest-engine unified dispatch ────────────────────────────────────────
  // Sub-Project 1b: validate + stamp manifest_version for ALL entries.
  // rest-proxy entries: fall through to legacy signing handlers (unchanged behavior).
  // non-rest-proxy entries: return 202 stub (workers in Sub-Project 2+).
  const normalizedIntent = normalizeIntent(intent);
  const provider = ((spec.provider as string) || "aws").toLowerCase();
  const op = prepareOperation(normalizedIntent, action, provider, spec as Record<string, unknown>);

  if (!(op instanceof ManifestError)) {
    // Stamp manifest_version for Dolt (replaces hardcoded "0" in dolt.writeResource calls)
    (spec as any)._manifest_version = op.manifest_version;

    if (op.entry.execution.type !== "rest-proxy") {
      // Non-rest-proxy: no legacy handler exists. Return 202 stub.
      return response202(op);
    }
    // rest-proxy: fall through to existing legacy handler (handles signing + HTTP)
    // The legacy handler benefits from the validated spec and manifest_version stamp above.
  } else if (op.code !== "NOT_FOUND") {
    // MISSING_REQUIRED_KEY or SCHEMA_INVALID — surface as error before hitting legacy handler
    return err(normalizedIntent, action, op.message);
  }
  // NOT_FOUND or rest-proxy: fall through to legacy handler chain
```

**IMPORTANT**: Read the actual structure of the main dispatch handler before adding this code. The key requirement is that this block runs BEFORE the intent-specific handlers, and both NOT_FOUND AND rest-proxy fall through to the existing handler chain unchanged.

- [ ] **Step 7.6: Update `dolt.writeResource()` call to use `_manifest_version`**

Find the `dolt.writeResource(` call (~line 4281). Update `manifest_version: "0"` to:
```typescript
manifest_version: (spec as any)._manifest_version ?? "0",
```

- [ ] **Step 7.7: Run tsc**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: Zero errors. Fix any remaining type errors before proceeding.

- [ ] **Step 7.8: Run full test suite including router tests**

```bash
npx vitest run src/test/
```

Expected: All tests pass — 20 in manifest-engine, router tests (dispatch + buildRestRequest), dolt-integration, others.

- [ ] **Step 7.9: Commit**

```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(manifest): replace discover fast-paths with unified dispatch in index.ts"
```

---

## Task 8: Final Verification

**Files:** No new changes — verification only

- [ ] **Step 8.1: Full test suite**

```bash
npx vitest run src/test/
```

Expected: All tests pass. Count total and report.

- [ ] **Step 8.2: Engram alignment check**

```bash
npm run check:engram
```

Expected: **Exit 0** — the new `k8s/deploy/naawi-internal` entry (Task 3) has `topologySpreadConstraints` and `securityContext` in `enforcement.inject`, satisfying the `.engram` K8s standards that previously caused exit 1.

- [ ] **Step 8.3: TypeScript check — app code**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: Zero errors.

- [ ] **Step 8.4: TypeScript check — Deno modules**

```bash
npx tsc --noEmit supabase/functions/uidi-engine/manifest-types.ts supabase/functions/uidi-engine/manifest-engine.ts supabase/functions/uidi-engine/dolt-client.ts --moduleResolution node --target esnext --module commonjs --strict --esModuleInterop
```

Expected: Zero errors.

- [ ] **Step 8.5: Final commit (if any fixes needed)**

If any issues were found and fixed in steps 8.1–8.4:
```bash
git add -A
git commit -m "chore(manifest): final verification fixes for universal manifest"
```

If no fixes needed, skip this step.

- [ ] **Step 8.6: Report**

Summarize:
- Total test count (pass/fail)
- Engram alignment result
- tsc results
- Git log of new commits on `feat/engram-logic`
