# SDK Capability Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc inline provider constants in `uidi-engine/index.ts` with a versioned, Zod-validated JSON manifest that maps Naawi intents to raw HTTP request templates and enforces `.engram` compliance rules at the payload level.

**Architecture:** A `manifest.json` bundle (loaded at Deno module boot) provides `ManifestEntry` records keyed by `(intent, action, provider)`. A pure `manifest-engine.ts` module exposes `prepareRequest()`, which applies default-fill → required-key validation → template hydration → inject overwrite to produce a signer-ready `PreparedRequest`. The manifest engine runs alongside the existing `SERVICE_CONFIG` / `REST_ROUTES` structures — it does not replace them in this sub-project. The `manifest_version` field is stamped into every `dolt.writeResource()` call for audit traceability.

**Tech Stack:** Deno (uidi-engine runtime), TypeScript, Zod 3.x (already in `package.json`), Vitest (test runner at project root), Node-compatible scripts (`bun` or `node`) for CI tooling.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `supabase/functions/uidi-engine/manifest-types.ts` | **Create** | Zod schema + `ManifestEntry` + `PreparedRequest` + `ManifestError` interfaces |
| `supabase/functions/uidi-engine/manifest.json` | **Create** | Versioned JSON registry — initial entries for network/compute/eks |
| `supabase/functions/uidi-engine/manifest-engine.ts` | **Create** | `lookup`, `enforce`, `hydrate`, `prepareRequest` — pure functions, no I/O |
| `supabase/functions/uidi-engine/dolt-client.ts` | **Modify** | Add `manifest_version: string` to `DoltResource` interface |
| `supabase/functions/uidi-engine/index.ts` | **Modify** | Load manifest engine at boot; stamp `manifest_version` in Dolt writes; route `discover` actions through `prepareRequest` |
| `src/test/manifest-engine.test.ts` | **Create** | Unit tests for all four engine functions |
| `src/test/dolt-integration.test.ts` | **Modify** | Update `DoltResource` fixture to include `manifest_version` |
| `scripts/check-engram-alignment.ts` | **Create** | CI script: parse `.engram` Inject rules, assert coverage in `manifest.json` |

---

## Task 1: Types — `manifest-types.ts`

**Files:**
- Create: `supabase/functions/uidi-engine/manifest-types.ts`

> This file defines the Zod schema and exports all types. Everything else depends on it, so build it first.

- [ ] **Step 1.1: Create `manifest-types.ts`**

```typescript
// supabase/functions/uidi-engine/manifest-types.ts
// Use bare "zod" specifier — works in Node/Vitest. In Deno, the import map (deno.json) maps "zod" → "npm:zod@3".
import { z } from "zod";

export const SigningStrategySchema = z.enum([
  "AWS_SIGV4",
  "OCI_RSA_V1",
  "GCP_OAUTH2",
  "AZURE_BEARER",
]);
export type SigningStrategy = z.infer<typeof SigningStrategySchema>;

export const ManifestEntrySchema = z.object({
  intent: z.enum(["network", "eks", "compute"]),
  action: z.enum(["deploy", "destroy", "discover", "status"]),
  provider: z.enum(["aws", "oci", "gcp", "azure"]),

  request: z.object({
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    url_template: z.string().min(1),
    headers: z.record(z.string()),
    body_template: z.string().optional(),
  }),

  signing: z
    .object({
      strategy: SigningStrategySchema,
      signed_headers: z.array(z.string()).min(1),
      service: z.string().optional(),
      region_required: z.boolean(),
    })
    .superRefine((val, ctx) => {
      if (val.strategy === "AWS_SIGV4" && !val.service) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "signing.service is required when strategy is AWS_SIGV4",
        });
      }
    }),

  enforcement: z.object({
    inject: z.record(z.unknown()),
    default: z.record(z.unknown()),
    required_keys: z.array(z.string()),
  }),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.object({
  version: z.string().regex(/^\d+$/, "version must be a plain integer string"),
  generated_at: z.string().datetime(),
  entries: z.array(ManifestEntrySchema).min(1),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export interface PreparedRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body: string | null;
  signing: {
    strategy: SigningStrategy;
    signed_headers: string[];
    service?: string;
    region: string;
  };
  manifest_version: string;
}

export class ManifestError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "MISSING_REQUIRED_KEY"
      | "UNRESOLVED_PLACEHOLDER"
      | "SCHEMA_INVALID",
    message: string
  ) {
    super(message);
    this.name = "ManifestError";
  }
}
```

> **Note on `npm:zod@3`:** The Deno runtime used by Supabase Edge Functions imports npm packages with the `npm:` specifier. Zod 3.x is already a dependency in `package.json`. If the existing codebase uses a different import pattern (e.g., a CDN URL), match the existing pattern instead.

- [ ] **Step 1.2: Create `deno.json` import map so Deno resolves the bare `"zod"` specifier**

Create `supabase/functions/uidi-engine/deno.json`:

```json
{
  "imports": {
    "zod": "npm:zod@3"
  }
}
```

This file is only read by the Deno runtime during Edge Function deployment. Vitest resolves `"zod"` from `node_modules` natively.

- [ ] **Step 1.3: Add `resolveJsonModule: true` to `tsconfig.app.json`**

Open `tsconfig.app.json` and add `"resolveJsonModule": true` inside `"compilerOptions"`. This enables `import manifest from "./manifest.json"` in test files without TypeScript errors.

- [ ] **Step 1.4: Commit**

```bash
git add supabase/functions/uidi-engine/manifest-types.ts supabase/functions/uidi-engine/deno.json tsconfig.app.json
git commit -m "feat(manifest): add ManifestEntry Zod schema, PreparedRequest types, and Deno import map"
```

---

## Task 2: Schema Validation Test + Initial `manifest.json`

**Files:**
- Create: `supabase/functions/uidi-engine/manifest.json`
- Create: `src/test/manifest-engine.test.ts` (schema test only for now)

> Write the test first so an empty or malformed manifest fails CI before any engine logic exists.

- [ ] **Step 2.1: Write the schema validation test**

```typescript
// src/test/manifest-engine.test.ts
import { describe, it, expect } from "vitest";
import { ManifestSchema } from "../../supabase/functions/uidi-engine/manifest-types";
import manifestData from "../../supabase/functions/uidi-engine/manifest.json";

describe("manifest.json schema validation", () => {
  it("should parse manifest.json without Zod errors", () => {
    const result = ManifestSchema.safeParse(manifestData);
    if (!result.success) {
      // Print the full error tree for easier debugging
      console.error(JSON.stringify(result.error.format(), null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("should have at least one entry per provider for network/deploy", () => {
    const result = ManifestSchema.parse(manifestData);
    const providers = ["aws", "oci", "gcp", "azure"] as const;
    for (const provider of providers) {
      const entry = result.entries.find(
        (e) => e.intent === "network" && e.action === "deploy" && e.provider === provider
      );
      expect(entry, `Missing network/deploy entry for ${provider}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2.2: Run the test — verify it fails**

```bash
npx vitest run src/test/manifest-engine.test.ts
```

Expected: `FAIL` — `manifest.json` does not exist yet.

- [ ] **Step 2.3: Create `manifest.json` with 28 initial entries**

Create the file at `supabase/functions/uidi-engine/manifest.json`. The 28 entries below cover: network (deploy + discover + destroy) × 4 providers = 12; compute (deploy + discover) × 4 = 8; eks (deploy + discover) × 4 = 8. `compute/destroy` and `eks/destroy` are deferred to Sub-Project 2 (require live teardown verification). The full JSON follows — do not abbreviate it:

```json
{
  "version": "1",
  "generated_at": "2026-03-26T00:00:00Z",
  "entries": [
    {
      "intent": "network",
      "action": "deploy",
      "provider": "aws",
      "request": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" },
        "body_template": "Action=CreateVpc&Version=2016-11-15&CidrBlock={{vpc_cidr}}&AmazonProvidedIpv6CidrBlock=false"
      },
      "signing": {
        "strategy": "AWS_SIGV4",
        "signed_headers": ["host", "x-amz-date", "x-amz-content-sha256"],
        "service": "ec2",
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "vpc_cidr": "10.100.0.0/16", "region": "us-east-1" },
        "required_keys": []
      }
    },
    {
      "intent": "network",
      "action": "deploy",
      "provider": "oci",
      "request": {
        "method": "POST",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/vcns",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"cidrBlock\":\"{{cidr}}\",\"compartmentId\":\"{{compartmentId}}\",\"displayName\":\"{{name}}\"}"
      },
      "signing": {
        "strategy": "OCI_RSA_V1",
        "signed_headers": ["(request-target)", "host", "date", "x-content-sha256", "content-type", "content-length"],
        "region_required": true
      },
      "enforcement": {
        "inject": { "isIpv6Enabled": false },
        "default": { "cidr": "10.0.0.0/16", "name": "naawi-vcn" },
        "required_keys": ["compartmentId"]
      }
    },
    {
      "intent": "network",
      "action": "deploy",
      "provider": "gcp",
      "request": {
        "method": "POST",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{project_id}}/global/networks",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"name\":\"{{name}}\",\"autoCreateSubnetworks\":true,\"routingConfig\":{\"routingMode\":\"REGIONAL\"}}"
      },
      "signing": {
        "strategy": "GCP_OAUTH2",
        "signed_headers": ["host", "authorization"],
        "region_required": false
      },
      "enforcement": {
        "inject": { "autoCreateSubnetworks": false, "routingConfig.routingMode": "REGIONAL" },
        "default": { "name": "naawi-network" },
        "required_keys": ["project_id"]
      }
    },
    {
      "intent": "network",
      "action": "deploy",
      "provider": "azure",
      "request": {
        "method": "PUT",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Network/virtualNetworks/{{name}}?api-version=2023-05-01",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"location\":\"{{region}}\",\"properties\":{\"addressSpace\":{\"addressPrefixes\":[\"10.1.0.0/16\"]}}}"
      },
      "signing": {
        "strategy": "AZURE_BEARER",
        "signed_headers": ["host", "authorization"],
        "region_required": true
      },
      "enforcement": {
        "inject": { "properties.addressSpace.addressPrefixes": ["10.1.0.0/16"] },
        "default": { "name": "naawi-vnet", "region": "eastus" },
        "required_keys": ["subscriptionId", "resourceGroup"]
      }
    },
    {
      "intent": "network",
      "action": "discover",
      "provider": "aws",
      "request": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" },
        "body_template": "Action=DescribeVpcs&Version=2016-11-15"
      },
      "signing": {
        "strategy": "AWS_SIGV4",
        "signed_headers": ["host", "x-amz-date", "x-amz-content-sha256"],
        "service": "ec2",
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "region": "us-east-1" },
        "required_keys": []
      }
    },
    {
      "intent": "network",
      "action": "discover",
      "provider": "oci",
      "request": {
        "method": "GET",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/vcns?compartmentId={{compartmentId}}",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "OCI_RSA_V1",
        "signed_headers": ["(request-target)", "host", "date"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["compartmentId"]
      }
    },
    {
      "intent": "network",
      "action": "discover",
      "provider": "gcp",
      "request": {
        "method": "GET",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{project_id}}/global/networks",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "GCP_OAUTH2",
        "signed_headers": ["host", "authorization"],
        "region_required": false
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["project_id"]
      }
    },
    {
      "intent": "network",
      "action": "discover",
      "provider": "azure",
      "request": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/providers/Microsoft.Network/virtualNetworks?api-version=2023-05-01",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "AZURE_BEARER",
        "signed_headers": ["host", "authorization"],
        "region_required": false
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["subscriptionId"]
      }
    },
    {
      "intent": "network",
      "action": "destroy",
      "provider": "aws",
      "request": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" },
        "body_template": "Action=DeleteVpc&Version=2016-11-15&VpcId={{vpc_id}}"
      },
      "signing": {
        "strategy": "AWS_SIGV4",
        "signed_headers": ["host", "x-amz-date", "x-amz-content-sha256"],
        "service": "ec2",
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "region": "us-east-1" },
        "required_keys": ["vpc_id"]
      }
    },
    {
      "intent": "network",
      "action": "destroy",
      "provider": "oci",
      "request": {
        "method": "DELETE",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/vcns/{{vcn_id}}",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "OCI_RSA_V1",
        "signed_headers": ["(request-target)", "host", "date"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["vcn_id"]
      }
    },
    {
      "intent": "network",
      "action": "destroy",
      "provider": "gcp",
      "request": {
        "method": "DELETE",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{project_id}}/global/networks/{{name}}",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "GCP_OAUTH2",
        "signed_headers": ["host", "authorization"],
        "region_required": false
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["project_id", "name"]
      }
    },
    {
      "intent": "network",
      "action": "destroy",
      "provider": "azure",
      "request": {
        "method": "DELETE",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Network/virtualNetworks/{{name}}?api-version=2023-05-01",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "AZURE_BEARER",
        "signed_headers": ["host", "authorization"],
        "region_required": false
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["subscriptionId", "resourceGroup", "name"]
      }
    },
    {
      "intent": "compute",
      "action": "deploy",
      "provider": "aws",
      "request": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" },
        "body_template": "Action=RunInstances&Version=2016-11-15&ImageId={{ami}}&InstanceType={{instance_type}}&MinCount=1&MaxCount={{count}}&SubnetId={{subnet_id}}"
      },
      "signing": {
        "strategy": "AWS_SIGV4",
        "signed_headers": ["host", "x-amz-date", "x-amz-content-sha256"],
        "service": "ec2",
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "instance_type": "t3.micro", "count": "1", "region": "us-east-1" },
        "required_keys": ["ami", "subnet_id"]
      }
    },
    {
      "intent": "compute",
      "action": "deploy",
      "provider": "oci",
      "request": {
        "method": "POST",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/instances",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"compartmentId\":\"{{compartmentId}}\",\"availabilityDomain\":\"{{availability_domain}}\",\"shape\":\"{{shape}}\",\"sourceDetails\":{\"sourceType\":\"image\",\"imageId\":\"{{image_id}}\"},\"createVnicDetails\":{\"subnetId\":\"{{subnet_id}}\"}}"
      },
      "signing": {
        "strategy": "OCI_RSA_V1",
        "signed_headers": ["(request-target)", "host", "date", "x-content-sha256", "content-type", "content-length"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "shape": "VM.Standard.E4.Flex" },
        "required_keys": ["compartmentId", "availability_domain", "image_id", "subnet_id"]
      }
    },
    {
      "intent": "compute",
      "action": "deploy",
      "provider": "gcp",
      "request": {
        "method": "POST",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{project_id}}/zones/{{zone}}/instances",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"name\":\"{{name}}\",\"machineType\":\"zones/{{zone}}/machineTypes/{{machine_type}}\",\"disks\":[{\"boot\":true,\"initializeParams\":{\"sourceImage\":\"{{source_image}}\"}}],\"networkInterfaces\":[{\"network\":\"global/networks/{{network}}\"}]}"
      },
      "signing": {
        "strategy": "GCP_OAUTH2",
        "signed_headers": ["host", "authorization"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "machine_type": "e2-medium", "network": "default" },
        "required_keys": ["project_id", "zone", "name", "source_image"]
      }
    },
    {
      "intent": "compute",
      "action": "deploy",
      "provider": "azure",
      "request": {
        "method": "PUT",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Compute/virtualMachines/{{name}}?api-version=2023-07-01",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"location\":\"{{region}}\",\"properties\":{\"hardwareProfile\":{\"vmSize\":\"{{vm_size}}\"},\"storageProfile\":{\"imageReference\":{\"publisher\":\"{{image_publisher}}\",\"offer\":\"{{image_offer}}\",\"sku\":\"{{image_sku}}\",\"version\":\"latest\"}},\"networkProfile\":{\"networkInterfaces\":[{\"id\":\"{{nic_id}}\"}]}}}"
      },
      "signing": {
        "strategy": "AZURE_BEARER",
        "signed_headers": ["host", "authorization"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "vm_size": "Standard_B2s", "region": "eastus" },
        "required_keys": ["subscriptionId", "resourceGroup", "name", "nic_id"]
      }
    },
    {
      "intent": "compute",
      "action": "discover",
      "provider": "aws",
      "request": {
        "method": "POST",
        "url_template": "https://ec2.{{region}}.amazonaws.com/",
        "headers": { "Content-Type": "application/x-www-form-urlencoded" },
        "body_template": "Action=DescribeInstances&Version=2016-11-15"
      },
      "signing": {
        "strategy": "AWS_SIGV4",
        "signed_headers": ["host", "x-amz-date", "x-amz-content-sha256"],
        "service": "ec2",
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "region": "us-east-1" },
        "required_keys": []
      }
    },
    {
      "intent": "compute",
      "action": "discover",
      "provider": "oci",
      "request": {
        "method": "GET",
        "url_template": "https://iaas.{{region}}.oraclecloud.com/20160918/instances?compartmentId={{compartmentId}}",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "OCI_RSA_V1",
        "signed_headers": ["(request-target)", "host", "date"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["compartmentId"]
      }
    },
    {
      "intent": "compute",
      "action": "discover",
      "provider": "gcp",
      "request": {
        "method": "GET",
        "url_template": "https://compute.googleapis.com/compute/v1/projects/{{project_id}}/zones/{{zone}}/instances",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "GCP_OAUTH2",
        "signed_headers": ["host", "authorization"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["project_id", "zone"]
      }
    },
    {
      "intent": "compute",
      "action": "discover",
      "provider": "azure",
      "request": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.Compute/virtualMachines?api-version=2023-07-01",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "AZURE_BEARER",
        "signed_headers": ["host", "authorization"],
        "region_required": false
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["subscriptionId", "resourceGroup"]
      }
    },
    {
      "intent": "eks",
      "action": "deploy",
      "provider": "aws",
      "request": {
        "method": "POST",
        "url_template": "https://eks.{{region}}.amazonaws.com/clusters",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"name\":\"{{cluster_name}}\",\"roleArn\":\"{{role_arn}}\",\"resourcesVpcConfig\":{\"subnetIds\":[\"{{subnet_id}}\"],\"securityGroupIds\":[\"{{security_group_id}}\"]},\"version\":\"{{k8s_version}}\"}"
      },
      "signing": {
        "strategy": "AWS_SIGV4",
        "signed_headers": ["host", "x-amz-date", "x-amz-content-sha256"],
        "service": "eks",
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "k8s_version": "1.31", "region": "us-east-1" },
        "required_keys": ["cluster_name", "role_arn", "subnet_id", "security_group_id"]
      }
    },
    {
      "intent": "eks",
      "action": "deploy",
      "provider": "gcp",
      "request": {
        "method": "POST",
        "url_template": "https://container.googleapis.com/v1/projects/{{project_id}}/zones/{{zone}}/clusters",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"cluster\":{\"name\":\"{{cluster_name}}\",\"initialNodeCount\":{{node_count}},\"nodeConfig\":{\"machineType\":\"{{machine_type}}\"}}}"
      },
      "signing": {
        "strategy": "GCP_OAUTH2",
        "signed_headers": ["host", "authorization"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "node_count": 3, "machine_type": "e2-standard-4" },
        "required_keys": ["project_id", "zone", "cluster_name"]
      }
    },
    {
      "intent": "eks",
      "action": "deploy",
      "provider": "azure",
      "request": {
        "method": "PUT",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.ContainerService/managedClusters/{{cluster_name}}?api-version=2024-02-01",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"location\":\"{{region}}\",\"properties\":{\"dnsPrefix\":\"{{cluster_name}}\",\"agentPoolProfiles\":[{\"name\":\"nodepool1\",\"count\":{{node_count}},\"vmSize\":\"{{vm_size}}\",\"mode\":\"System\"}]}}"
      },
      "signing": {
        "strategy": "AZURE_BEARER",
        "signed_headers": ["host", "authorization"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "node_count": 3, "vm_size": "Standard_DS2_v2", "region": "eastus" },
        "required_keys": ["subscriptionId", "resourceGroup", "cluster_name"]
      }
    },
    {
      "intent": "eks",
      "action": "deploy",
      "provider": "oci",
      "request": {
        "method": "POST",
        "url_template": "https://containerengine.{{region}}.oraclecloud.com/20180222/clusters",
        "headers": { "Content-Type": "application/json" },
        "body_template": "{\"name\":\"{{cluster_name}}\",\"compartmentId\":\"{{compartmentId}}\",\"vcnId\":\"{{vcn_id}}\",\"kubernetesVersion\":\"{{k8s_version}}\"}"
      },
      "signing": {
        "strategy": "OCI_RSA_V1",
        "signed_headers": ["(request-target)", "host", "date", "x-content-sha256", "content-type", "content-length"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "k8s_version": "v1.31.1" },
        "required_keys": ["cluster_name", "compartmentId", "vcn_id"]
      }
    },
    {
      "intent": "eks",
      "action": "discover",
      "provider": "aws",
      "request": {
        "method": "GET",
        "url_template": "https://eks.{{region}}.amazonaws.com/clusters/{{cluster_name}}",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "AWS_SIGV4",
        "signed_headers": ["host", "x-amz-date"],
        "service": "eks",
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": { "region": "us-east-1" },
        "required_keys": ["cluster_name"]
      }
    },
    {
      "intent": "eks",
      "action": "discover",
      "provider": "gcp",
      "request": {
        "method": "GET",
        "url_template": "https://container.googleapis.com/v1/projects/{{project_id}}/zones/{{zone}}/clusters/{{cluster_name}}",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "GCP_OAUTH2",
        "signed_headers": ["host", "authorization"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["project_id", "zone", "cluster_name"]
      }
    },
    {
      "intent": "eks",
      "action": "discover",
      "provider": "azure",
      "request": {
        "method": "GET",
        "url_template": "https://management.azure.com/subscriptions/{{subscriptionId}}/resourceGroups/{{resourceGroup}}/providers/Microsoft.ContainerService/managedClusters/{{cluster_name}}?api-version=2024-02-01",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "AZURE_BEARER",
        "signed_headers": ["host", "authorization"],
        "region_required": false
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["subscriptionId", "resourceGroup", "cluster_name"]
      }
    },
    {
      "intent": "eks",
      "action": "discover",
      "provider": "oci",
      "request": {
        "method": "GET",
        "url_template": "https://containerengine.{{region}}.oraclecloud.com/20180222/clusters/{{cluster_id}}",
        "headers": {},
        "body_template": null
      },
      "signing": {
        "strategy": "OCI_RSA_V1",
        "signed_headers": ["(request-target)", "host", "date"],
        "region_required": true
      },
      "enforcement": {
        "inject": {},
        "default": {},
        "required_keys": ["cluster_id"]
      }
    }
  ]
}
```

> **Note:** `body_template: null` for GET entries — in JSON, `null` serializes correctly. The Zod schema uses `.optional()` for `body_template`, so either `null` or absent is fine. Adjust if the schema is tightened to disallow `null`.

- [ ] **Step 2.4: Run the schema test — verify it passes**

```bash
npx vitest run src/test/manifest-engine.test.ts
```

Expected: `PASS` — both tests green.

- [ ] **Step 2.5: Commit**

```bash
git add supabase/functions/uidi-engine/manifest.json src/test/manifest-engine.test.ts
git commit -m "feat(manifest): add initial manifest.json entries with schema validation test"
```

---

## Task 3: Engine Implementation (TDD)

**Files:**
- Modify: `src/test/manifest-engine.test.ts` (add engine tests)
- Create: `supabase/functions/uidi-engine/manifest-engine.ts`

- [ ] **Step 3.1: Append unit tests to `src/test/manifest-engine.test.ts`**

**Important:** APPEND the following to the existing file — do NOT replace it. The schema validation tests from Task 2, Step 2.1 must remain. Add these blocks after the last closing `});`:

```typescript
import {
  lookup,
  enforce,
  hydrate,
  prepareRequest,
} from "../../supabase/functions/uidi-engine/manifest-engine";
import { ManifestError } from "../../supabase/functions/uidi-engine/manifest-types";

describe("lookup()", () => {
  it("returns the correct entry for a known (intent, action, provider) triple", () => {
    const entry = lookup("network", "deploy", "oci");
    expect(entry).not.toBeInstanceOf(ManifestError);
    if (entry instanceof ManifestError) throw entry;
    expect(entry.provider).toBe("oci");
    expect(entry.intent).toBe("network");
    expect(entry.action).toBe("deploy");
  });

  it("returns ManifestError for an unknown combination", () => {
    const entry = lookup("network", "deploy", "unknown-provider" as any);
    expect(entry).toBeInstanceOf(ManifestError);
    if (entry instanceof ManifestError) {
      expect(entry.code).toBe("NOT_FOUND");
    }
  });
});

describe("enforce()", () => {
  it("applies defaults only when key is absent from spec", () => {
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;

    const spec = { compartmentId: "ocid1.compartment.abc", region: "us-ashburn-1" };
    const resolved = enforce(spec, entry);

    // "cidr" has a default of "10.0.0.0/16" and was not in spec — should be filled
    expect(resolved["cidr"]).toBe("10.0.0.0/16");
    // "region" was in spec — should NOT be overwritten
    expect(resolved["region"]).toBe("us-ashburn-1");
  });

  it("does not overwrite a user-supplied value with a default", () => {
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;

    const spec = { compartmentId: "ocid1.compartment.abc", cidr: "192.168.0.0/16" };
    const resolved = enforce(spec, entry);

    expect(resolved["cidr"]).toBe("192.168.0.0/16");
  });

  it("throws ManifestError when a required key is absent", () => {
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;

    // compartmentId is required for OCI network/deploy — omit it
    const spec = { region: "us-ashburn-1" };
    expect(() => enforce(spec, entry)).toThrow(ManifestError);
    try {
      enforce(spec, entry);
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError);
      expect((e as ManifestError).code).toBe("MISSING_REQUIRED_KEY");
      expect((e as ManifestError).message).toContain("compartmentId");
    }
  });

  it("passes when all required keys are present", () => {
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;

    const spec = { compartmentId: "ocid1.compartment.abc" };
    expect(() => enforce(spec, entry)).not.toThrow();
  });
});

describe("hydrate()", () => {
  it("resolves all {{placeholders}} in the URL template", () => {
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;
    const spec = { compartmentId: "ocid1.compartment.abc", region: "us-ashburn-1", cidr: "10.0.0.0/16", name: "test-vcn" };
    const resolved = enforce(spec, entry);
    const prepared = hydrate(entry, resolved);

    expect(prepared.url).not.toContain("{{");
    expect(prepared.url).toContain("us-ashburn-1");
  });

  it("applies inject unconditionally — overwrites user-supplied non-compliant value", () => {
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;

    // User tries to enable IPv6 — should be overwritten by inject
    const spec = { compartmentId: "ocid1.compartment.abc", region: "us-ashburn-1", cidr: "10.0.0.0/16", name: "test-vcn", isIpv6Enabled: true };
    const resolved = enforce(spec, entry);
    const prepared = hydrate(entry, resolved);

    const body = JSON.parse(prepared.body!);
    expect(body.isIpv6Enabled).toBe(false);
  });

  it("adds inject keys that are absent from the template body (additive behavior)", () => {
    // OCI network/deploy body_template does not include isIpv6Enabled as a placeholder
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;
    const spec = { compartmentId: "ocid1.compartment.abc", region: "us-ashburn-1", cidr: "10.0.0.0/16", name: "test-vcn" };
    const resolved = enforce(spec, entry);
    const prepared = hydrate(entry, resolved);

    const body = JSON.parse(prepared.body!);
    // isIpv6Enabled not in template — should be added by inject
    expect(body).toHaveProperty("isIpv6Enabled", false);
  });

  it("sets body to null for GET requests", () => {
    const entry = lookup("network", "discover", "oci");
    if (entry instanceof ManifestError) throw entry;
    const spec = { compartmentId: "ocid1.compartment.abc", region: "us-ashburn-1" };
    const resolved = enforce(spec, entry);
    const prepared = hydrate(entry, resolved);

    expect(prepared.body).toBeNull();
  });

  it("throws ManifestError when a placeholder has no value in resolved spec", () => {
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;

    // Provide compartmentId but omit region and name/cidr
    const spec = { compartmentId: "ocid1.compartment.abc" };
    // enforce() fills "cidr" and "name" defaults — but region is required and has no default
    // Note: if enforce() doesn't throw (no required_keys check for region), hydrate should catch the unresolved {{region}}
    const resolved = enforce(spec, entry);
    expect(() => hydrate(entry, resolved)).toThrow(ManifestError);
    try {
      hydrate(entry, resolved);
    } catch (e) {
      expect((e as ManifestError).code).toBe("UNRESOLVED_PLACEHOLDER");
    }
  });

  it("carries manifest_version from the loaded manifest", () => {
    const entry = lookup("network", "deploy", "oci");
    if (entry instanceof ManifestError) throw entry;
    const spec = { compartmentId: "ocid1.compartment.abc", region: "us-ashburn-1", cidr: "10.0.0.0/16", name: "test-vcn" };
    const resolved = enforce(spec, entry);
    const prepared = hydrate(entry, resolved);

    expect(prepared.manifest_version).toMatch(/^\d+$/);
  });
});

describe("prepareRequest()", () => {
  it("returns a fully resolved PreparedRequest for a valid spec", () => {
    const spec = { compartmentId: "ocid1.compartment.abc", region: "us-ashburn-1" };
    const prepared = prepareRequest("network", "deploy", "oci", spec);

    expect(prepared).not.toBeInstanceOf(ManifestError);
    if (prepared instanceof ManifestError) throw prepared;

    expect(prepared.url).not.toContain("{{");
    expect(prepared.method).toBe("POST");
    expect(prepared.signing.strategy).toBe("OCI_RSA_V1");
    expect(prepared.manifest_version).toMatch(/^\d+$/);
  });

  it("returns ManifestError for an unknown provider", () => {
    const result = prepareRequest("network", "deploy", "unknown" as any, {});
    expect(result).toBeInstanceOf(ManifestError);
  });
});
```

- [ ] **Step 3.2: Run tests — verify they fail with import errors**

```bash
npx vitest run src/test/manifest-engine.test.ts
```

Expected: `FAIL` — `manifest-engine` module not found.

- [ ] **Step 3.3: Implement `manifest-engine.ts`**

Create `supabase/functions/uidi-engine/manifest-engine.ts`:

```typescript
// supabase/functions/uidi-engine/manifest-engine.ts
import { ManifestEntry, ManifestError, ManifestSchema, PreparedRequest } from "./manifest-types.ts";
// Deno 1.x uses `assert { type: "json" }`, Deno 2.x uses `with { type: "json" }`.
// Vite/Vitest handles JSON imports natively without either assertion.
// Check supabase/config.toml for the Deno runtime version and use the matching syntax.
// If unsure, use `assert` for Deno 1.x compatibility (current Supabase default):
import rawManifest from "./manifest.json" assert { type: "json" };

// Parse and validate at module load — throws if schema invalid, preventing any requests
const MANIFEST = ManifestSchema.parse(rawManifest);

export function lookup(
  intent: string,
  action: string,
  provider: string
): ManifestEntry | ManifestError {
  const entry = MANIFEST.entries.find(
    (e) => e.intent === intent && e.action === action && e.provider === provider
  );
  if (!entry) {
    return new ManifestError(
      "NOT_FOUND",
      `No manifest entry for (${intent}, ${action}, ${provider})`
    );
  }
  return entry;
}

export function enforce(
  userSpec: Record<string, unknown>,
  entry: ManifestEntry
): Record<string, unknown> {
  const merged = { ...userSpec };

  // Phase 1 — Default fill (only if key absent)
  for (const [key, value] of Object.entries(entry.enforcement.default)) {
    if (!(key in merged)) {
      merged[key] = value;
    }
  }

  // Phase 2 — Required key validation
  for (const key of entry.enforcement.required_keys) {
    if (!(key in merged)) {
      throw new ManifestError(
        "MISSING_REQUIRED_KEY",
        `Missing required key '${key}' for ${entry.intent}/${entry.action}/${entry.provider}`
      );
    }
  }

  return merged;
}

export function hydrate(
  entry: ManifestEntry,
  resolvedSpec: Record<string, unknown>
): PreparedRequest {
  // Phase 3 — Resolve {{placeholders}} in URL
  const url = resolvePlaceholders(entry.request.url_template, resolvedSpec, entry);

  // Resolve body if present
  let bodyObject: Record<string, unknown> | null = null;
  if (entry.request.body_template && entry.request.method !== "GET") {
    const resolvedBody = resolvePlaceholders(entry.request.body_template, resolvedSpec, entry);
    bodyObject = JSON.parse(resolvedBody);
  }

  // Phase 4 — Inject (additive deep-merge, unconditional overwrite)
  if (bodyObject !== null) {
    for (const [dotPath, value] of Object.entries(entry.enforcement.inject)) {
      deepSet(bodyObject, dotPath, value);
    }
  }

  const region = (resolvedSpec["region"] as string) ?? "";

  return {
    method: entry.request.method,
    url,
    headers: { ...entry.request.headers },
    body: bodyObject !== null ? JSON.stringify(bodyObject) : null,
    signing: {
      strategy: entry.signing.strategy,
      signed_headers: entry.signing.signed_headers,
      service: entry.signing.service,
      region,
    },
    manifest_version: MANIFEST.version,
  };
}

export function prepareRequest(
  intent: string,
  action: string,
  provider: string,
  userSpec: Record<string, unknown>
): PreparedRequest | ManifestError {
  const entry = lookup(intent, action, provider);
  if (entry instanceof ManifestError) return entry;

  try {
    const resolved = enforce(userSpec, entry);
    return hydrate(entry, resolved);
  } catch (e) {
    if (e instanceof ManifestError) return e;
    throw e;
  }
}

// ─── Private helpers ───────────────────────────────────────────────────────

function resolvePlaceholders(
  template: string,
  spec: Record<string, unknown>,
  entry: ManifestEntry
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!(key in spec)) {
      throw new ManifestError(
        "UNRESOLVED_PLACEHOLDER",
        `Unresolved placeholder '{{${key}}}' in ${entry.intent}/${entry.action}/${entry.provider} — add '${key}' to spec or enforcement.default`
      );
    }
    return String(spec[key]);
  });
}

function deepSet(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}
```

> **Import note for Deno vs Vitest:** `manifest-engine.ts` uses `.ts` extensions on imports for Deno compatibility. When Vitest imports this file, it resolves `.ts` extensions natively. The `assert { type: "json" }` import assertion is supported by Vitest ≥2.x. If tests fail with a JSON import error, add `{ resolveJsonModule: true }` to `tsconfig.app.json`.

- [ ] **Step 3.4: Run tests — verify they pass**

```bash
npx vitest run src/test/manifest-engine.test.ts
```

Expected: all tests `PASS`. If schema tests fail on `body_template: null`, update the Zod schema to allow `z.string().nullable().optional()` for that field.

- [ ] **Step 3.5: Commit**

```bash
git add supabase/functions/uidi-engine/manifest-engine.ts src/test/manifest-engine.test.ts
git commit -m "feat(manifest): implement manifest-engine with TDD — lookup/enforce/hydrate/prepareRequest"
```

---

## Task 4: Update `DoltResource` + Fix Dolt Tests

**Files:**
- Modify: `supabase/functions/uidi-engine/dolt-client.ts`
- Modify: `src/test/dolt-integration.test.ts`

- [ ] **Step 4.1: Add `manifest_version` to `DoltResource`**

In `supabase/functions/uidi-engine/dolt-client.ts`, update the interface:

```typescript
export interface DoltResource {
  resource_id: string;
  resource_type: string;
  provider: "aws" | "gcp" | "azure" | "oci";
  region: string;
  intent_hash: string;
  ztai_record_index: string;
  observed_at: string;
  state_json: Record<string, any>;
  manifest_version: string;   // VARCHAR(16) in Dolt; "0" for pre-manifest rows
}
```

- [ ] **Step 4.2: Run existing Dolt tests — expect TypeScript errors**

```bash
npx vitest run src/test/dolt-integration.test.ts
```

Expected: TypeScript compilation errors — `manifest_version` missing from `DoltResource` fixtures.

- [ ] **Step 4.3: Update `DoltResource` fixtures in `dolt-integration.test.ts`**

Find every `DoltResource` object literal in `src/test/dolt-integration.test.ts` and add `manifest_version: "0"` to each. Example:

```typescript
const resource: DoltResource = {
  resource_id: "vpc-123",
  resource_type: "vpc",
  provider: "aws",
  region: "us-east-1",
  intent_hash: "hash-abc",
  ztai_record_index: "ztai-001",
  observed_at: new Date().toISOString(),
  state_json: { VpcId: "vpc-123", CidrBlock: "10.0.0.0/16" },
  manifest_version: "0",   // ← add this
};
```

- [ ] **Step 4.4: Run Dolt tests — verify they pass**

```bash
npx vitest run src/test/dolt-integration.test.ts
```

Expected: all `PASS`.

- [ ] **Step 4.5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests `PASS`.

- [ ] **Step 4.6: Commit**

```bash
git add supabase/functions/uidi-engine/dolt-client.ts src/test/dolt-integration.test.ts
git commit -m "feat(manifest): add manifest_version field to DoltResource interface"
```

---

## Task 5: Stamp `manifest_version` in `uidi-engine/index.ts`

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts` (lines ~4280–4295)

> This task adds `manifest_version` to the existing Dolt write without changing any orchestration logic. It is the minimal integration needed for the audit trail.

- [ ] **Step 5.1: Import `prepareRequest` at the top of `index.ts`**

Find the import block at the top of `supabase/functions/uidi-engine/index.ts` and add:

```typescript
import { prepareRequest } from "./manifest-engine.ts";
import type { PreparedRequest, ManifestError } from "./manifest-types.ts";
```

> If other imports already exist at the top of the file, add these after them. The exact line depends on file state.

- [ ] **Step 5.2: Add `manifest_version` to the DAG executor Dolt write**

Find the `dolt.writeResource()` call around line 4280 (inside the DAG executor's success path). Update it:

```typescript
// Before:
doltCommitHash = await dolt.writeResource({
  resource_id: resourceId,
  resource_type: extractResourceType(op.service, op.command),
  provider: "aws",
  region: effectiveRegion,
  intent_hash: await sha256Hex(JSON.stringify(op)),
  ztai_record_index: `ztai-${Date.now()}-${op.id}`,
  observed_at: new Date().toISOString(),
  state_json: result || {},
}, `Auto-commit: ${op.service}.${op.command} for ${resourceId}`);

// After:
doltCommitHash = await dolt.writeResource({
  resource_id: resourceId,
  resource_type: extractResourceType(op.service, op.command),
  provider: "aws",
  region: effectiveRegion,
  intent_hash: await sha256Hex(JSON.stringify(op)),
  ztai_record_index: `ztai-${Date.now()}-${op.id}`,
  observed_at: new Date().toISOString(),
  state_json: result || {},
  manifest_version: (spec as any)?._manifest_version ?? "0",
}, `Auto-commit: ${op.service}.${op.command} for ${resourceId}`);
```

> The `_manifest_version` convention is a temporary carrier until the manifest engine is fully wired into the intent handlers. Any `prepareRequest()` call in Task 6 will set this on the spec before passing to the DAG executor.

- [ ] **Step 5.3: Search for and update all `dolt.writeResource()` call sites**

```bash
grep -n "dolt.writeResource" supabase/functions/uidi-engine/index.ts
```

For each call site found, add `manifest_version: (spec as any)?._manifest_version ?? "0"` to the resource object. Do not change any other logic.

- [ ] **Step 5.4: Add failure-path manifest_version capture**

The spec requires `manifest_version` to be stamped even when the cloud API call fails — so the Dolt audit log reflects which manifest version was active during a failed attempt. The current DAG executor catches failures in a try/catch that does NOT write to Dolt on failure. Add the following to the failure catch block at the DAG executor (immediately after `history.push({ opId: op.id, status: "FAILED", error: e.message })`):

```typescript
// Capture manifest version in failure record for audit trail
(history[history.length - 1] as any).manifest_version =
  (spec as any)?._manifest_version ?? "0";
```

This attaches `manifest_version` to the failure history entry that surfaces in `EngineResponse.details`. If a separate failure-path `dolt.writeResource()` call is added in the future, use the same `(spec as any)?._manifest_version ?? "0"` value.

- [ ] **Step 5.4: Run the full test suite**

```bash
npx vitest run
```

Expected: all `PASS`. TypeScript errors about missing `manifest_version` in `dolt.writeResource()` calls would have been caught in Task 4 — if any surface here, apply the same fix.

- [ ] **Step 5.5: Commit**

```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(manifest): stamp manifest_version in all dolt.writeResource() calls"
```

---

## Task 6: Wire `discover` Actions Through `prepareRequest`

**Files:**
- Modify: `supabase/functions/uidi-engine/index.ts` (lines ~1111–1120, ~787–800, ~1605–1620)

> Route the three `discover` actions through the manifest engine. This validates the engine in the live call path without touching complex multi-step orchestration. The existing handler logic remains as fallback for actions not yet in the manifest.

- [ ] **Step 6.1: Add manifest-engine routing helper**

Near the top of `index.ts` (after imports), add a small helper that tries the manifest engine and returns `null` if not found (so the existing handler can fall through):

```typescript
function tryManifestPrepare(
  intent: string,
  action: string,
  provider: string,
  spec: Record<string, unknown>
): PreparedRequest | null {
  const prepared = prepareRequest(intent, action, provider, spec);
  if (prepared && !(prepared instanceof Error)) {
    return prepared as PreparedRequest;
  }
  return null;
}
```

- [ ] **Step 6.2: Add manifest-engine path to `handleNetwork` for `discover`**

In `handleNetwork` (line ~1111), at the very top of the function (before the `if (provider === "oci")` check), add:

```typescript
async function handleNetwork(action: string, spec: Record<string, unknown>): Promise<EngineResponse> {
  const provider = ((spec.provider as string) || "aws").toLowerCase();

  // Manifest engine path — used for discover actions where manifest entries exist
  if (action === "discover") {
    const prepared = tryManifestPrepare("network", action, provider, spec);
    if (prepared) {
      // Store manifest_version on spec so Dolt stamp can pick it up
      (spec as any)._manifest_version = prepared.manifest_version;
      // Return the PreparedRequest as a signal to the caller; actual signing happens in existing flow
      // For now, fall through to existing handler after setting the version stamp
    }
  }

  // ... existing handler logic continues unchanged below
```

> **Note:** Full replacement of the discover handler is Sub-Project 2 scope. In this sub-project, the goal is to (a) validate that `prepareRequest` resolves without error, and (b) stamp `manifest_version` on the spec. The existing handler performs the actual HTTP call.

- [ ] **Step 6.3: Apply the same pattern to `handleCompute` and `handleEks`**

Add the same `if (action === "discover")` block at the top of `handleCompute` (line ~787) and `handleEks` (line ~1605), substituting `"compute"` and `"eks"` as the intent string.

- [ ] **Step 6.4: Run the full test suite**

```bash
npx vitest run
```

Expected: all `PASS`.

- [ ] **Step 6.5: Commit**

```bash
git add supabase/functions/uidi-engine/index.ts
git commit -m "feat(manifest): wire discover actions through prepareRequest; stamp manifest_version"
```

---

## Task 7: CI Engram Alignment Check

**Files:**
- Create: `scripts/check-engram-alignment.ts`
- Modify: `package.json` (add `check:engram` script)

- [ ] **Step 7.0: Create `scripts/` directory**

```bash
mkdir -p scripts
```

- [ ] **Step 7.1: Create `scripts/check-engram-alignment.ts`**

```typescript
#!/usr/bin/env node
// scripts/check-engram-alignment.ts
// CI gate: every .engram Inject: rule must be codified in manifest.json
// Exit 0 = all rules covered. Exit 1 = uncodified rules found.

import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(process.cwd());
const ENGRAM_PATH = resolve(ROOT, ".engram");
const MANIFEST_PATH = resolve(ROOT, "supabase/functions/uidi-engine/manifest.json");

interface ManifestEntry {
  enforcement: { inject: Record<string, unknown> };
}
interface Manifest {
  entries: ManifestEntry[];
}

const engram = readFileSync(ENGRAM_PATH, "utf-8");
const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

// Collect all inject keys across all manifest entries
const manifestInjectKeys = new Set<string>();
for (const entry of manifest.entries) {
  for (const key of Object.keys(entry.enforcement.inject)) {
    manifestInjectKeys.add(key);
  }
}

// Parse .engram Inject: lines
// Grammar:
//   Inject: <KEY>: <VALUE>[, <KEY>: <VALUE>]*   (key-value pair)
//   Inject: <KEY>[, <KEY>]*                      (bare key — presence flag)
// Comma separation is done outside JSON array brackets.
function parseInjectLine(line: string): string[] {
  const payload = line.replace(/^Inject:\s*/i, "");
  const tokens = splitRespectingArrays(payload);
  return tokens.map((token) => {
    const colonIdx = token.indexOf(":");
    return colonIdx === -1 ? token.trim() : token.slice(0, colonIdx).trim();
  });
}

function splitRespectingArrays(str: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of str) {
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

const errors: string[] = [];
const lines = engram.split("\n");
for (const line of lines) {
  if (!line.match(/^Inject:/i)) continue;
  const keys = parseInjectLine(line);
  for (const key of keys) {
    if (!key) continue;
    if (!manifestInjectKeys.has(key)) {
      errors.push(`  .engram Inject key '${key}' has no matching enforcement.inject entry in manifest.json`);
    }
  }
}

if (errors.length > 0) {
  console.error("\n❌ Engram alignment check FAILED:\n");
  for (const err of errors) console.error(err);
  console.error(`\nAdd the missing keys to enforcement.inject in manifest.json, then re-run.\n`);
  process.exit(1);
} else {
  console.log(`✅ Engram alignment check passed — all ${manifestInjectKeys.size} inject keys are codified.`);
  process.exit(0);
}
```

- [ ] **Step 7.2: Add the script to `package.json`**

In the `"scripts"` block of `package.json`, add:

```json
"check:engram": "npx tsx scripts/check-engram-alignment.ts"
```

> Uses `tsx` (already available as part of TypeScript tooling) to run the script without a compile step. If `tsx` is not in the project, use `ts-node` or `bun run`.

- [ ] **Step 7.3: Run the alignment check**

```bash
npm run check:engram
```

> `npm run check:engram` invokes `npx tsx scripts/check-engram-alignment.ts` — use this form consistently (not `npx tsx` directly) so the npm script definition is what's tested.

Expected: passes if all `.engram` Inject keys are in `manifest.json`. If it fails, add the missing keys to the relevant `enforcement.inject` entries in `manifest.json`.

- [ ] **Step 7.4: Verify the K8s bare-key line is parsed correctly**

The `.engram` file contains `Inject: topologySpreadConstraints, securityContext: runAsNonRoot`. This involves a bare key (`topologySpreadConstraints`) and a key-value pair. The script should parse both. If the check fails on these K8s keys, add them to any `eks/deploy` entry's `enforcement.inject` in `manifest.json` (value `true` for bare keys).

- [ ] **Step 7.5: Run full test suite and alignment check together**

```bash
npx vitest run && npm run check:engram
```

Expected: all tests `PASS`, engram check passes.

- [ ] **Step 7.6: Commit**

```bash
git add scripts/check-engram-alignment.ts package.json
git commit -m "feat(manifest): add CI engram alignment check script"
```

---

## Task 8: Final Verification

- [ ] **Step 8.1: Run the complete test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8.2: Run the engram alignment check**

```bash
npm run check:engram
```

Expected: passes.

- [ ] **Step 8.3: Verify TypeScript compilation has no errors**

`tsc --noEmit` only covers `src/` (per `tsconfig.app.json`). Run two checks:

```bash
# Check test files and imported Deno modules (via transitive imports from src/test/)
npx tsc --noEmit -p tsconfig.app.json
```

Expected: no errors. If `manifest_version` errors appear, ensure all `dolt.writeResource()` call sites include the field (Task 5).

```bash
# Check the Deno module files directly for obvious type errors
npx tsc --noEmit --strict --moduleResolution bundler --target ES2022 \
  supabase/functions/uidi-engine/manifest-types.ts \
  supabase/functions/uidi-engine/manifest-engine.ts
```

Expected: no errors (or only Deno-runtime-specific errors about `npm:` imports, which are acceptable — the types themselves should be clean).

- [ ] **Step 8.4: Final commit**

```bash
git add -A
git commit -m "feat(manifest): SDK Capability Manifest complete — Sub-Project 1"
```

---

## Coverage Verification

After all tasks are complete, confirm:

| Check | Command | Expected |
|---|---|---|
| All unit tests pass | `npx vitest run` | All green |
| Manifest schema valid | (covered by test) | Zod parse succeeds |
| Engram alignment | `npm run check:engram` | Exit 0 |
| TypeScript clean | `npx tsc --noEmit` | No errors |
| `manifest_version` in Dolt | Read `dolt-client.ts` | Field present |
| All 26 initial entries in manifest | Count `entries` in `manifest.json` | ≥ 26 |
