# Universal Manifest — Design Spec
*Sub-Project 1b: Full Intent Coverage*

---

## Understanding Summary

- **What:** Expand the SDK Capability Manifest schema from 28 `rest-proxy` entries covering 3 intents to ~68 entries covering all 9 UIDI engine intents via a discriminated `execution` block
- **Why:** Make `manifest.json` the "Constitutional Document" for Project Naawi — every intent, every guardrail, unified and auditable via Dolt regardless of execution method
- **Who:** The `uidi-engine` edge function and all downstream execution workers
- **Constraints:** Schema + data only (Sub-Project 1b); workers for non-`rest-proxy` types return `202 Accepted` stubs; existing cloud operations must not regress; manifest version bumped to `"2"`
- **Non-goals:** Implementing K8s, Ansible, Reconcile, Inventory, Dolt, SRE-Supreme, or Naawi workers (Sub-Projects 2+); UI changes

---

## Architecture

### Core Pattern: Discriminated `execution` Block

Every `ManifestEntry` gains an `execution` block that discriminates on `type`. Type-specific config lives inside `execution.config` — a Zod `discriminatedUnion` that gives automatic TypeScript narrowing with no `superRefine` overhead.

```
ManifestEntry
├── intent       : 9 values (network | compute | k8s | ansible | reconcile | inventory | sre-supreme | naawi | dolt)
├── action       : deploy | destroy | status | discover  (normalized across all intents)
├── provider     : aws | oci | gcp | azure | naawi-internal
├── execution    : discriminatedUnion on "type"
│   ├── type     : rest-proxy | ssm-ansible | k8s-api | meta-reconcile | internal-query | state-manager | agent-coordinator
│   ├── timeout_ms
│   ├── retry_policy
│   └── config   : type-specific schema (see below)
├── signing      : optional — only present for rest-proxy entries
└── enforcement  : inject | default | required_keys  (universal across all types)
```

### Thin Router Pattern

`index.ts` becomes a pure resolution + dispatch layer:

```typescript
const op = prepareOperation(intent, action, provider, spec);
if (op instanceof ManifestError) { return errorResponse(op); }

await dolt.log(op);  // unified audit for all execution types

switch (op.entry.execution.type) {
  case "rest-proxy": return await signAndFetch(op);
  default:           return response202(op);  // stub, worker pending
}
```

The 202 stub response includes `manifest_version` and `resolved_spec` for debuggability.

---

## Schema Design

### Updated Enums

```typescript
IntentSchema  = z.enum(["network","compute","k8s","ansible","reconcile","inventory","sre-supreme","naawi","dolt"])
ActionSchema  = z.enum(["deploy","destroy","status","discover"])
ProviderSchema = z.enum(["aws","oci","gcp","azure","naawi-internal"])
```

Note: `eks` is renamed to `k8s` — intent vocabulary is workload-type, not cloud service name.

### Execution Config Schemas (7 types)

```typescript
// rest-proxy — existing cloud HTTP calls
RestProxyConfigSchema = z.object({
  method: z.enum(["GET","POST","PUT","PATCH","DELETE"]),
  url_template: z.string().min(1),       // uses {{placeholder}} syntax
  headers: z.record(z.string()),
  body_template: z.string().optional(),  // uses {{placeholder}} syntax
})

// ssm-ansible — Ansible playbooks via SSM
AnsibleConfigSchema = z.object({
  playbook_path: z.string().min(1),
  extra_vars_template: z.string(),       // JSON with {{placeholder}} tokens
  ssm_document: z.string().optional(),
})

// k8s-api — raw Kubernetes API calls
K8sConfigSchema = z.object({
  api_version: z.string().min(1),        // e.g. "apps/v1"
  resource_kind: z.string().min(1),      // e.g. "Deployment"
  namespace_template: z.string().min(1), // e.g. "{{namespace}}"
  resource_template: z.string().min(1),  // full K8s manifest JSON with {{placeholders}}
})

// meta-reconcile — drift detection
ReconcileConfigSchema = z.object({
  sub_intents: z.array(z.string()).min(1),
  drift_tolerance_seconds: z.number().int().positive(),
  auto_remediate: z.boolean(),
})

// internal-query — inventory scanning
InternalQueryConfigSchema = z.object({
  scan_providers: z.array(z.string()).min(1),
  scan_regions: z.array(z.string()),     // empty = all regions
  resource_types: z.array(z.string()).min(1),
})

// state-manager — Dolt versioned state
StateManagerConfigSchema = z.object({
  branch: z.string().min(1),
  table: z.string().min(1),
  operation: z.enum(["read","write","diff","branch"]),
})

// agent-coordinator — SRE-Supreme, Naawi orchestration
AgentCoordinatorConfigSchema = z.object({
  autonomy_level: z.enum(["full-auto","request-approval","dry-run"]),
  allowed_tools: z.array(z.string()).min(1),
  max_actions_per_run: z.number().int().positive(),
  forbidden_patterns: z.array(z.string()),
})
```

### Execution Discriminated Union

```typescript
RetryPolicySchema = z.enum(["exponential","linear","none"])

ExecutionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rest-proxy"),        timeout_ms: z.number().default(30000),  retry_policy: RetryPolicySchema.default("none"),        config: RestProxyConfigSchema }),
  z.object({ type: z.literal("ssm-ansible"),       timeout_ms: z.number().default(60000),  retry_policy: RetryPolicySchema.default("exponential"), config: AnsibleConfigSchema }),
  z.object({ type: z.literal("k8s-api"),           timeout_ms: z.number().default(30000),  retry_policy: RetryPolicySchema.default("exponential"), config: K8sConfigSchema }),
  z.object({ type: z.literal("meta-reconcile"),    timeout_ms: z.number().default(60000),  retry_policy: RetryPolicySchema.default("none"),        config: ReconcileConfigSchema }),
  z.object({ type: z.literal("internal-query"),    timeout_ms: z.number().default(15000),  retry_policy: RetryPolicySchema.default("none"),        config: InternalQueryConfigSchema }),
  z.object({ type: z.literal("state-manager"),     timeout_ms: z.number().default(10000),  retry_policy: RetryPolicySchema.default("none"),        config: StateManagerConfigSchema }),
  z.object({ type: z.literal("agent-coordinator"), timeout_ms: z.number().default(120000), retry_policy: RetryPolicySchema.default("exponential"), config: AgentCoordinatorConfigSchema }),
])
```

### Updated ManifestEntrySchema

```typescript
ManifestEntrySchema = z.object({
  intent: IntentSchema,
  action: ActionSchema,
  provider: ProviderSchema,
  execution: ExecutionSchema,
  signing: SigningMetadataSchema.optional(),  // rest-proxy only
  enforcement: EnforcementSchema,
}).superRefine((val, ctx) => {
  // Enforce: rest-proxy entries MUST have signing
  if (val.execution.type === "rest-proxy" && !val.signing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signing is required for rest-proxy entries", path: ["signing"] });
  }
  // Enforce: non-rest-proxy entries MUST NOT have signing
  if (val.execution.type !== "rest-proxy" && val.signing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signing is not applicable for non-rest-proxy entries", path: ["signing"] });
  }
})
```

### Updated ManifestSchema

```typescript
ManifestSchema = z.object({
  version: z.string().min(1),           // "2" after this migration
  generated_at: z.string().datetime(),
  entries: z.array(ManifestEntrySchema).min(1),
})
```

### PreparedOperation (replaces PreparedRequest)

```typescript
interface PreparedOperation {
  entry: ManifestEntry;
  resolved_spec: Record<string, unknown>;  // after default-fill + inject applied
  manifest_version: string;
}
```

---

## Placeholder Syntax Migration

All `_template` fields migrate from `{single-brace}` to `{{double-brace}}`:

- **Before:** `"https://ec2.{region}.amazonaws.com/?Action=CreateVpc"`
- **After:** `"https://ec2.{{region}}.amazonaws.com/?Action=CreateVpc"`

Engine regex change: `/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g` → `/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g`

This eliminates the existing workaround for JSON brace false-positives.

---

## Entry Coverage

### Cloud Provider Intents (~48 entries, provider = aws | oci | gcp | azure)

| Intent | Actions | Count | Execution Type |
|--------|---------|-------|----------------|
| network | deploy, discover, destroy, status | 16 | rest-proxy |
| compute | deploy, discover, destroy, status | 16 | rest-proxy |
| k8s | deploy, discover, destroy, status | 16 | rest-proxy (EKS/OKE/GKE/AKS cluster APIs) |

### Internal Intents (~20 entries, provider = naawi-internal unless noted)

| Intent | Actions | Count | Execution Type | Note |
|--------|---------|-------|----------------|------|
| ansible | deploy, destroy, status, discover | 4 | ssm-ansible | |
| reconcile | deploy, discover, status | 3 | meta-reconcile | |
| sre-supreme | deploy, discover, status | 3 | agent-coordinator | |
| naawi | deploy, status | 2 | agent-coordinator | no destroy (safety) |
| dolt | deploy, discover, status | 3 | state-manager | no destroy (branch safety) |
| inventory | discover × naawi-internal | 1 | internal-query | cross-cloud scan |
| inventory | discover × aws, oci, gcp, azure | 4 | internal-query | per-provider scan |

**Total: ~68 entries. Manifest version: `"2"`.**

"Dangerous" combos (e.g. `naawi × destroy`, `dolt × destroy`) are excluded — not because they're impossible, but because they require a separate approval workflow beyond the current scope. If needed in future, the `agent-coordinator` execution type with `autonomy_level: "request-approval"` provides the scaffold.

---

## Migration Strategy for Existing 28 Entries

1. **`request` block moves into `execution.config`**: Top-level `request` is removed; content becomes `execution.config`
2. **`execution` block added**: `{ type: "rest-proxy", timeout_ms: 30000, retry_policy: "none", config: <former request> }`
3. **`eks` → `k8s`**: All 8 eks entries get `intent: "k8s"`
4. **`{{double-brace}}` migration**: All `{placeholder}` tokens in `url_template` and `body_template` become `{{placeholder}}`
5. **Version bump**: `manifest.json` `version` field changes from `"1"` to `"2"`

---

## Engine Changes (`manifest-engine.ts`)

| Function | Change |
|----------|--------|
| `prepareRequest()` | Renamed to `prepareOperation()`, returns `PreparedOperation \| ManifestError` |
| `hydrate()` | Simplified: applies defaults + inject to spec, returns `resolved_spec` only (no HTTP flattening) |
| `lookup()` | No change |
| `enforce()` | No change |
| Placeholder regex | Updated to `{{double-brace}}` |

---

## Router Changes (`index.ts`)

The three `discover` fast-paths (added in Sub-Project 1a Task 6) are **removed** and replaced by a single unified dispatch block:

```typescript
const op = prepareOperation(intent, action, provider, spec);
if (op instanceof ManifestError && op.code === "NOT_FOUND") {
  // fall through to legacy handler
} else if (op instanceof ManifestError) {
  return errorResponse(op);
} else {
  await dolt.log(op);
  if (op.entry.execution.type === "rest-proxy") {
    return await signAndFetch(op);
  }
  return response202({
    message: `Guardrails validated. Worker for '${op.entry.execution.type}' is in development.`,
    manifest_version: op.manifest_version,
    resolved_spec: op.resolved_spec,
  });
}
```

---

## Testing Strategy

| File | Change |
|------|--------|
| `manifest-engine.test.ts` | 5 schema tests updated for v2 manifest + new entry count; 11 engine tests updated for `PreparedOperation` return type |
| `dolt-integration.test.ts` | No changes |
| `manifest-router.test.ts` (new) | Tests unified dispatch: rest-proxy → signAndFetch called; non-rest-proxy → 202 stub with correct body; NOT_FOUND → fall-through |
| `check-engram-alignment.ts` | Runs clean after K8s entries cover `topologySpreadConstraints` + `securityContext` |

---

## Decision Log

| Decision | Alternatives | Rationale |
|----------|-------------|-----------|
| Execution-nested config (`execution.config`) | Top-level flat sub-objects + superRefine | Free TypeScript discriminated union narrowing; no manual validation overhead; cleaner worker handoff |
| `PreparedOperation` returns full `ManifestEntry` | Keep flat `PreparedRequest` per type | Engine is a resolution layer, not transport layer; avoids N×type-specific flattening functions |
| `{{double-brace}}` placeholder syntax | Keep `{single-brace}` | Eliminates JSON brace false-positives; aligns with Mustache/Handlebars industry standard |
| `eks` → `k8s` rename | Keep `eks` | Intent vocabulary should be workload-type (k8s), not cloud brand (EKS); provider field handles the cloud distinction |
| `naawi-internal` as provider value | New top-level field for internal intents | Keeps schema uniform; provider field always present and meaningful |
| Exclude `naawi × destroy`, `dolt × destroy` | Include with `request-approval` autonomy | Out of scope for 1b; `agent-coordinator` scaffold exists for future implementation |
| Workers return `202 Accepted` stub | Throw error for unimplemented types | Graceful degradation; stub response includes `manifest_version` + `resolved_spec` for debugging |
| Single `manifest.json` file | Split by intent | Single source of truth; 68 entries is manageable; splitting adds build complexity |
| Manifest version `"2"` | Keep `"1"` | Breaking schema change warrants version bump; Dolt records after deploy are distinguishable from v1 |
