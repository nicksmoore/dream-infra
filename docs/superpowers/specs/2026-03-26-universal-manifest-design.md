# Universal Manifest — Design Spec
*Sub-Project 1b: Full Intent Coverage*

---

## Understanding Summary

- **What:** Expand the SDK Capability Manifest schema from 28 `rest-proxy` entries covering 3 intents to 68 entries covering all 9 UIDI engine intents via a discriminated `execution` block
- **Why:** Make `manifest.json` the "Constitutional Document" for Project Naawi — every intent, every guardrail, unified and auditable via Dolt regardless of execution method
- **Who:** The `uidi-engine` edge function and all downstream execution workers
- **Constraints:** Schema + data only (Sub-Project 1b); workers for non-`rest-proxy` types return `202 Accepted` stubs; existing cloud operations must not regress; manifest version bumped to `"2"`
- **Non-goals:** Implementing K8s, Ansible, Reconcile, Inventory, Dolt, SRE-Supreme, or Naawi workers (Sub-Projects 2+); UI changes

---

## Architecture

### Core Pattern: Discriminated `execution` Block

Every `ManifestEntry` gains an `execution` block that discriminates on `type`. Type-specific config lives inside `execution.config` — a Zod `discriminatedUnion` that gives automatic TypeScript narrowing. A single small `superRefine` on `ManifestEntrySchema` enforces the cross-field rule that `signing` is required for `rest-proxy` entries and absent for all others (this is a cross-object constraint that `discriminatedUnion` alone cannot express).

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
├── signing      : optional — only present for rest-proxy entries; enforced by superRefine
└── enforcement  : inject | default | required_keys  (universal across all types)
```

### External API Vocabulary Normalization

The existing `index.ts` `ExecuteRequest` interface accepts `intent: "eks"` and `intent: "kubernetes"` from callers. These are normalized to `"k8s"` before manifest lookup — callers are not broken:

```typescript
// At router entry, before prepareOperation():
const normalizedIntent = intent === "eks" || intent === "kubernetes" ? "k8s" : intent;
```

### Thin Router Pattern

The unified dispatch replaces the three intent-specific `discover` fast-paths. It sits at the router entry point, before intent-specific handler functions are called:

```typescript
// Normalize legacy intent names
const normalizedIntent = intent === "eks" || intent === "kubernetes" ? "k8s" : intent;

const op = prepareOperation(normalizedIntent, action, provider, spec);
if (op instanceof ManifestError && op.code === "NOT_FOUND") {
  // No manifest entry — fall through to legacy handler (backwards compat)
} else if (op instanceof ManifestError) {
  return errorResponse(op);
} else {
  // Stamp manifest_version into Dolt resource write (replaces existing writeResource call)
  // dolt.writeResource() is called as before; op.manifest_version replaces hardcoded "0"
  if (op.entry.execution.type === "rest-proxy") {
    return await signAndFetch(op);   // see buildRestRequest() below
  }
  return response202({
    message: `Guardrails validated. Worker for '${op.entry.execution.type}' is in development.`,
    manifest_version: op.manifest_version,
    resolved_spec: op.resolved_spec,
  });
}
```

**What is removed from `index.ts`:**
- The `tryManifestPrepare()` helper function (lines ~384–401)
- The three `discover` fast-path blocks inside `handleNetwork` (line ~1157), `handleCompute` (line ~816), `handleEks` (line ~1668)
- The `import { prepareRequest }` line — replaced by `import { prepareOperation }`

**Dolt audit:** `dolt.writeResource()` is called as before in the success path. `op.manifest_version` replaces the hardcoded `"0"` stamp from Sub-Project 1a. No new Dolt client methods are needed.

### `signAndFetch` and `buildRestRequest`

The `signAndFetch()` function in `index.ts` receives a `PreparedOperation` and builds a `PreparedRequest` before signing. A new `buildRestRequest()` helper (in `index.ts`, not the engine) handles this translation for `rest-proxy` entries:

```typescript
function buildRestRequest(op: PreparedOperation): PreparedRequest | ManifestError {
  // op.entry.execution is narrowed to rest-proxy variant by the caller's type guard
  const cfg = (op.entry.execution as { type: "rest-proxy"; config: RestProxyConfig }).config;
  const spec = op.resolved_spec;

  // Resolve {{placeholder}} tokens
  const resolveTemplate = (tmpl: string) =>
    tmpl.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, k) => {
      const v = spec[k];
      if (v === undefined) return `{{${k}}}`;
      return Array.isArray(v) ? JSON.stringify(v) : String(v);
    });

  const url = resolveTemplate(cfg.url_template);
  if (/\{\{[^}]+\}\}/.test(url)) {
    return new ManifestError("UNRESOLVED_PLACEHOLDER", `Unresolved tokens in url_template: ${url}`);
  }

  const body = cfg.body_template ? resolveTemplate(cfg.body_template) : null;

  return {
    method: cfg.method,
    url,
    headers: { ...cfg.headers },
    body,
    signing: {
      strategy: op.entry.signing!.strategy,
      signed_headers: [...op.entry.signing!.signed_headers],
      ...(op.entry.signing!.service ? { service: op.entry.signing!.service } : {}),
      ...(op.entry.signing!.region_required ? { region: String(spec["region"] ?? "") } : {}),
    },
    manifest_version: op.manifest_version,
  };
}
```

`PreparedRequest` interface is retained in `manifest-types.ts` for use by `buildRestRequest` and the signing functions. It is no longer returned by `manifest-engine.ts` functions — only by `buildRestRequest` in `index.ts`.

---

## Schema Design

### Updated Enums

```typescript
IntentSchema  = z.enum(["network","compute","k8s","ansible","reconcile","inventory","sre-supreme","naawi","dolt"])
ActionSchema  = z.enum(["deploy","destroy","status","discover"])
ProviderSchema = z.enum(["aws","oci","gcp","azure","naawi-internal"])
```

Note: `eks` is renamed to `k8s` — intent vocabulary is workload-type, not cloud service name. External callers using `"eks"` or `"kubernetes"` are normalized at the router layer, not in the schema.

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
  extra_vars_template: z.string(),       // JSON string with {{placeholder}} tokens
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

`timeout_ms` and `retry_policy` use Zod `.default()`. In `manifest.json` entries these fields may be omitted — Zod fills in the default during `ManifestSchema.parse()`. Implementers MUST omit them in JSON (not include them as `null`) for the default to apply.

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

The `discriminatedUnion` on `execution.type` handles type-narrowing within the `execution` block. A single `superRefine` on the entry handles the cross-object `signing` presence rule — this cannot be expressed inside the union alone because `signing` is a sibling of `execution`, not inside it.

```typescript
ManifestEntrySchema = z.object({
  intent: IntentSchema,
  action: ActionSchema,
  provider: ProviderSchema,
  execution: ExecutionSchema,
  signing: SigningMetadataSchema.optional(),  // required iff execution.type === "rest-proxy"
  enforcement: EnforcementSchema,
}).superRefine((val, ctx) => {
  if (val.execution.type === "rest-proxy" && !val.signing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "signing is required for rest-proxy entries", path: ["signing"] });
  }
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

### PreparedOperation (replaces PreparedRequest as engine return type)

```typescript
interface PreparedOperation {
  entry: ManifestEntry;
  resolved_spec: Record<string, unknown>;  // after default-fill + inject applied
  manifest_version: string;
}
```

`PreparedRequest` is **retained** in `manifest-types.ts` for use by `buildRestRequest()` and the cloud signing functions. It is no longer returned by `manifest-engine.ts` — only by `buildRestRequest()` in `index.ts`.

---

## Placeholder Syntax Migration

All `_template` fields migrate from `{single-brace}` to `{{double-brace}}`:

- **Before:** `"https://ec2.{region}.amazonaws.com/?Action=CreateVpc"`
- **After:** `"https://ec2.{{region}}.amazonaws.com/?Action=CreateVpc"`

Engine regex change in `manifest-engine.ts`: `/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g` → `/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g`

The identical regex is used in `buildRestRequest()` in `index.ts`.

This eliminates the existing identifier-form workaround for JSON brace false-positives.

---

## Entry Coverage

### Cloud Provider Intents (48 entries, provider = aws | oci | gcp | azure)

| Intent | Actions | Count | Execution Type |
|--------|---------|-------|----------------|
| network | deploy, discover, destroy, status | 16 | rest-proxy |
| compute | deploy, discover, destroy, status | 16 | rest-proxy |
| k8s | deploy, discover, destroy, status | 16 | rest-proxy (EKS/OKE/GKE/AKS cluster APIs) |

### Internal Intents (20 entries, provider = naawi-internal unless noted)

| Intent | Actions | Count | Execution Type | Note |
|--------|---------|-------|----------------|------|
| ansible | deploy, destroy, status, discover | 4 | ssm-ansible | |
| reconcile | deploy, discover, status | 3 | meta-reconcile | |
| sre-supreme | deploy, discover, status | 3 | agent-coordinator | |
| naawi | deploy, status | 2 | agent-coordinator | no destroy (safety) |
| dolt | deploy, discover, status | 3 | state-manager | no destroy (branch safety) |
| inventory | discover × naawi-internal | 1 | internal-query | cross-cloud scan |
| inventory | discover × aws, oci, gcp, azure | 4 | internal-query | per-provider scan |

**Total: 68 entries. Manifest version: `"2"`.**

"Dangerous" combos (`naawi × destroy`, `dolt × destroy`) are excluded from 1b. The `agent-coordinator` / `state-manager` scaffold with `autonomy_level: "request-approval"` provides the path for future implementation.

---

## Migration Strategy for Existing 28 Entries

1. **`request` block moves into `execution.config`**: Top-level `request` is removed; content becomes `execution.config`
2. **`execution` block added**: `{ type: "rest-proxy", config: <former request> }` — omit `timeout_ms` and `retry_policy` to use schema defaults
3. **`eks` → `k8s`**: All 8 eks entries get `intent: "k8s"`
4. **`{{double-brace}}` migration**: All `{placeholder}` tokens in `url_template` and `body_template` become `{{placeholder}}`
5. **Version bump**: `manifest.json` `version` field changes from `"1"` to `"2"`
6. **`ProviderSchema` update**: Add `"naawi-internal"` to the enum in `manifest-types.ts` before writing new internal entries

---

## Engine Changes (`manifest-engine.ts`)

| Function | Change |
|----------|--------|
| `prepareRequest()` | Renamed to `prepareOperation()`, returns `PreparedOperation \| ManifestError` |
| `hydrate()` | Simplified: applies defaults + inject, returns `resolved_spec` only. Placeholder resolution and signing-block construction move to `buildRestRequest()` in `index.ts` |
| `lookup()` | No change |
| `enforce()` | No change |
| Placeholder regex | Updated to `{{double-brace}}` (used only for unresolved-token detection in `enforce`; actual resolution is in `buildRestRequest`) |

---

## Router Changes (`index.ts`)

**Removed:**
- `tryManifestPrepare()` helper (~lines 384–401)
- Three `discover` fast-path blocks inside `handleNetwork` (~line 1157), `handleCompute` (~line 816), `handleEks` (~line 1668)
- `import { prepareRequest }` — replaced by `import { prepareOperation }`

**Added:**
- `import { prepareOperation }` from `./manifest-engine.ts`
- Intent normalization: `"eks"` | `"kubernetes"` → `"k8s"` before lookup
- Unified dispatch block at router entry (before intent routing)
- `buildRestRequest(op: PreparedOperation): PreparedRequest | ManifestError` helper
- `response202(payload)` helper

**Unchanged:**
- All legacy handler functions (`handleNetwork`, `handleCompute`, `handleEks`, etc.) — they remain as fallbacks for `NOT_FOUND` cases
- `dolt.writeResource()` call site — just updates `manifest_version` from `"0"` to `op.manifest_version`

---

## Testing Strategy

| File | Change |
|------|--------|
| `manifest-engine.test.ts` | Schema tests: updated for v2 manifest (68 entries, new enum values); engine tests: updated for `PreparedOperation` return type from `prepareOperation()` |
| `manifest-router.test.ts` (new) | Tests unified dispatch in `index.ts`: `rest-proxy` entry → `buildRestRequest` called and returns valid `PreparedRequest`; non-`rest-proxy` entry → 202 stub body contains `manifest_version` and `resolved_spec`; `NOT_FOUND` → falls through without error response |
| `dolt-integration.test.ts` | No changes |
| `check-engram-alignment.ts` | Located at `scripts/check-engram-alignment.ts`. After this sub-project, K8s `enforcement.inject` entries for `topologySpreadConstraints` and `securityContext` cause the script to exit 0 (currently exits 1 for those 2 keys) |

**`manifest-router.test.ts` mock contract:** Tests mock `buildRestRequest` (to avoid needing live signing) and assert on the `response202` shape. The `signAndFetch` function is not called directly in router tests — the test boundary is at the dispatch switch, not the signing layer.

---

## Decision Log

| Decision | Alternatives | Rationale |
|----------|-------------|-----------|
| Execution-nested config (`execution.config`) | Top-level flat sub-objects + superRefine | Free TypeScript discriminated union narrowing within the execution block; only one small cross-object `superRefine` needed (for `signing` presence) |
| `PreparedOperation` as engine return; `PreparedRequest` retained for signing | Retire `PreparedRequest` entirely | Engine is a resolution layer; `PreparedRequest` is still the correct contract for signing functions; `buildRestRequest()` bridges the two |
| `buildRestRequest()` in `index.ts`, not engine | Put in engine | Keeps `manifest-engine.ts` execution-type-agnostic; HTTP concerns belong in the transport layer |
| `{{double-brace}}` placeholder syntax | Keep `{single-brace}` | Eliminates JSON brace false-positives; aligns with Mustache/Handlebars standard |
| Intent normalization at router (`"eks"`/`"kubernetes"` → `"k8s"`) | Rename in schema only | External callers not broken; schema stays clean |
| `naawi-internal` as provider value | New top-level field for internal intents | Keeps schema uniform; provider field always present and meaningful |
| Exclude `naawi × destroy`, `dolt × destroy` | Include with `request-approval` autonomy | Out of scope for 1b; scaffold exists for future |
| Workers return `202 Accepted` stub | Throw error for unimplemented types | Graceful degradation; stub includes `manifest_version` + `resolved_spec` for debugging |
| Single `manifest.json` file | Split by intent | Single source of truth; 68 entries is manageable |
| Manifest version `"2"` | Keep `"1"` | Breaking schema change warrants version bump; Dolt records distinguishable |
| `timeout_ms`/`retry_policy` omitted from `manifest.json` (use schema defaults) | Explicit in every entry | DRY; schema defaults are the canonical values; explicit inclusion would be redundant noise |
