# SDK Capability Manifest — Design Spec

**Date:** 2026-03-26
**Status:** Approved — ready for implementation
**Author:** Nick Moore (Aura Solutions)
**Sub-Project:** 1 of 3 (SDK Drift Resilience System)

---

## Problem

Project Naawi maps natural language intent to raw HTTP calls across AWS, GCP, Azure, and OCI. The execution layer currently embeds provider-specific request construction directly inside `supabase/functions/uidi-engine/index.ts` as inline `SERVICE_CONFIG` records and `REST_ROUTES` tables. This creates two drift risks:

1. **Code drift** — when a provider changes an endpoint, parameter name, or signing requirement, the fix requires TypeScript refactoring inside the ~4500-line `index.ts`. There is no separation between routing logic and request shape data.
2. **Engram drift** — the `.engram` compliance rules (e.g., "OCI VCNs must have IPv6 disabled") have no automated link to the HTTP layer. A rule can exist in `.engram` and be silently absent from the actual request body.

---

## Scope

### In scope
- `manifest.json` — versioned, bundled JSON registry of intent-to-HTTP templates
- `manifest-types.ts` — Zod schema and TypeScript interfaces
- `manifest-engine.ts` — `lookup`, `enforce`, `hydrate`, `prepareRequest` pure utility functions
- `PreparedRequest` contract passed to the existing signer inside `uidi-engine/index.ts` (signer implementation unchanged)
- `manifest_version: string` field added to `DoltResource` interface in `dolt-client.ts`
- `manifest_version` written into every `dolt.writeResource()` call — both success and failure paths — inside `uidi-engine/index.ts`
- `scripts/check-engram-alignment.ts` — CI script asserting every `.engram` Inject rule is codified in `manifest.json`
- Initial manifest entries: 4 providers × 3 intents × applicable actions (see Initial Coverage)
- Migration of existing `.engram` rules into `enforcement.inject` entries

### Out of scope
- New intents beyond network, compute, eks
- SDK Sentinel automation (Sub-Project 2)
- Engram Drift Monitor (Sub-Project 3)
- Changes to signing implementations
- New `.engram` rules or policy changes
- Changes to `multi-cloud-proxy.ts` (Vercel thin proxy — not the dispatch layer)
- The `SERVICE_CONFIG` / `REST_ROUTES` tables in `uidi-engine/index.ts` are **not** deleted in this sub-project; the manifest engine runs alongside them. Full cutover is Sub-Project 2.

---

## Decision Log

| Decision | Alternatives Considered | Rationale |
|---|---|---|
| JSON + Zod + TS interface (Approach B) | TypeScript const array (A), per-provider JSON files (C) | JSON is the natural format for HTTP templates; Sentinel automation can generate JSON without producing TS source; Zod catches schema drift at boot |
| Compiled bundle at deploy time | Dolt inline query per request, cache at cold start | Supabase Edge Functions are ephemeral; bundling makes code and data an atomic deploy unit; eliminates hot-path Dolt dependency |
| Integer string version (`"42"`) | Git SHA, timestamp | Human-readable in Dolt audit queries during incidents; avoids "v42" vs "42" inconsistency via Zod regex |
| Inject/Default distinction preserved | Flatten into single `default_values` map | Inject is a compliance override (non-negotiable); Default fills intent gaps (user can override); collapsing them loses the enforcement gradient |
| `required_keys` as pre-flight gate | Let cloud provider return 400/403 | Typed, actionable error before any network call; preserves "Zero-SDK stability" |
| `signed_headers` explicit per entry | Derive from strategy at signing time | Keeps the signer a dumb pipe; header list changes require only a manifest update |
| Manifest action vocabulary maps to existing `EngineRequest.action` | Introduce new CRUD vocabulary | Avoids a translation layer; manifest is queryable with existing caller vocab without remapping |
| Additive inject (deep-merge into body) | Reject if inject key absent from template | Compliance rules should always apply; keys added by inject (not in template) are a feature, not an error |
| `manifest_version` is immutable audit field | Mutable current-state field | Rollback does not rewrite history; Dolt time-travel is the mechanism for historical audit |

---

## Architecture

### System Context

```
Browser/CLI
    │
    ▼
Vercel: api/handlers/multi-cloud-proxy.ts   ← thin proxy only, not modified
    │  forwards to AI_GATEWAY_URL (Supabase project URL)
    ▼
Supabase Edge Function: uidi-engine/index.ts   ← integration point
    │
    ├─ [current] SERVICE_CONFIG + REST_ROUTES (inline TS constants)
    │
    └─ [new] manifest-engine.ts
         │  reads manifest.json (bundled at deploy)
         │  returns PreparedRequest
         ▼
       existing signer (awsSignedRequest / ociSign / etc.)   ← unchanged
         │
         ▼
       Cloud Provider REST API
         │
         ▼
       dolt.writeResource()   ← manifest_version added here
```

`multi-cloud-proxy.ts` is a 31-line Vercel proxy that forwards the full request body to `AI_GATEWAY_URL`. It is not a dispatch layer and is not modified by this sub-project.

### File Structure

```
supabase/functions/uidi-engine/
  manifest.json           ← the declarative registry (versioned, bundled)
  manifest-types.ts       ← Zod schema + ManifestEntry + PreparedRequest interfaces
  manifest-engine.ts      ← lookup / enforce / hydrate / prepareRequest (pure functions)
  dolt-client.ts          ← DoltResource gains manifest_version field

scripts/
  check-engram-alignment.ts  ← CI: asserts .engram Inject rules exist in manifest.json
```

### The `.engram` / Manifest Boundary

| Layer | Responsibility | Example |
|---|---|---|
| `.engram` | Policy declaration — provider-agnostic, human-readable | `[Intent: POST /vcns]` / `Inject: isIpv6Enabled: false` |
| `manifest.json` | Execution translation — provider-specific HTTP encoding | `enforcement.inject: { "isIpv6Enabled": false }` for OCI network/deploy |

Every `.engram` `Inject:` line must have a corresponding `enforcement.inject` entry in at least one `manifest.json` entry. The CI alignment check enforces this. Uncodified Inject rules fail the build.

**`.engram` canonical parse grammar** (current file is 26 lines; this grammar applies to the existing format):

```
# Comments begin with #
[Intent: <HTTP_METHOD> <PATH>]   ← section header; one per rule group
Inject: <KEY>: <VALUE>[, <KEY>: <VALUE>]*   ← one or more key:value pairs, comma-separated
Default: <KEY> = <VALUE>         ← default assignment syntax
Append: <KEY>[, <KEY>]*          ← append (treated as Default in manifest)
```

Inject line key syntax has three forms:
- `<KEY>: <VALUE>` — standard key-value (dot-notation key; value is scalar, string, or JSON array literal)
- `<KEY>: <VALUE>, <KEY>: <VALUE>` — comma-separated multi-pair on a single Inject line
- `<KEY>` (bare, no colon) — presence flag; means "key must exist with any non-null value" (e.g., `topologySpreadConstraints` in the K8s rule)

The alignment script splits Inject tokens by comma first (respecting JSON array brackets), then for each token: if it contains `:`, the key is everything before the first `:` and the remainder is the value; if it contains no `:`, the whole token is a bare key. The script asserts a matching `enforcement.inject` entry exists for all forms. All Inject lines in `.engram` are parsed — including out-of-scope intents (e.g., K8s) — so the grammar must cover the full 26-line file. The Zod key regex (`/^[\w]+(\.[\w]+)*$/`) applies to key names only, not values.

### Action Vocabulary

The manifest uses the existing `EngineRequest.action` vocabulary from `uidi-engine.ts`. There is no CRUD translation layer.

| Manifest `action` | Meaning | HTTP equivalent |
|---|---|---|
| `deploy` | Create a new resource | POST / PUT |
| `destroy` | Delete a resource | DELETE |
| `discover` | Read / list resources | GET |
| `status` | Poll for async completion | GET (subset of discover) |
| `update` | Modify existing resource | PUT / PATCH (deferred to Sub-Project 2) |

The `action` field in `ManifestEntry` uses this vocabulary: `'deploy' | 'destroy' | 'discover' | 'status'`.

### Data Schema

#### Top-Level Manifest

```typescript
interface Manifest {
  version: string;        // matches /^\d+$/ — integer string, incremented on every manifest-touching merge to main
  generated_at: string;   // ISO 8601
  entries: ManifestEntry[];
}
```

#### ManifestEntry

```typescript
type SigningStrategy = 'AWS_SIGV4' | 'OCI_RSA_V1' | 'GCP_OAUTH2' | 'AZURE_BEARER';

interface ManifestEntry {
  intent: 'network' | 'eks' | 'compute';
  action: 'deploy' | 'destroy' | 'discover' | 'status';
  provider: 'aws' | 'oci' | 'gcp' | 'azure';

  request: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    url_template: string;            // double-brace Mustache: "https://iaas.{{region}}.oraclecloud.com/20160918/vcns"
    headers: Record<string, string>; // static headers; signer appends Authorization
    body_template?: string;          // stringified JSON with {{placeholders}}; absent for GET
  };

  signing: {
    strategy: SigningStrategy;
    signed_headers: string[];        // ordered list for canonical string construction; non-empty for all strategies
    service?: string;                // required when strategy === 'AWS_SIGV4' (e.g. "ec2")
    region_required: boolean;
  };

  enforcement: {
    inject: Record<string, unknown>;    // dot-notation keys; applied post-hydration; unconditional deep-merge (additive if key absent from template)
    default: Record<string, unknown>;   // dot-notation keys; applied pre-hydration; only if key absent in caller spec
    required_keys: string[];            // validated before hydration; missing key = hard rejection, no network call
  };
}
```

**Zod validation rules:**
- `signed_headers` must be non-empty (`min(1)`) for **all** strategies — it is required for canonical string construction regardless of provider
- `signing.service` must be present when `strategy === 'AWS_SIGV4'`
- `enforcement.inject` and `enforcement.default` key names must match `/^[\w]+(\.[\w]+)*$/` (dot-notation path, applied to the key name only — not the value)
- `version` must match `/^\d+$/`
- At least one entry must exist (`entries.min(1)`)

#### PreparedRequest (Signer Contract)

```typescript
interface PreparedRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;                          // fully resolved; no placeholders remain
  headers: Record<string, string>;      // static headers only; signer appends Authorization
  body: string | null;                  // serialized JSON with inject applied; null for GET
  signing: {
    strategy: SigningStrategy;
    signed_headers: string[];
    service?: string;
    region: string;                     // resolved from caller spec at engine time
  };
  manifest_version: string;            // carried through for Dolt stamping
}
```

The signer receives a `PreparedRequest`, adds the `Authorization` header, and returns it. It touches nothing else.

#### DoltResource (updated)

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
  manifest_version: string;   // NEW — VARCHAR(16) in Dolt; "0" as migration default for pre-manifest rows
}
```

Default value for pre-existing rows: `"0"` (sentinel meaning "provisioned before manifest system"). Column is nullable-in-practice via optional chaining in read paths; the interface marks it required for new writes.

### Engine API

All four functions are pure (no I/O, no side effects). Exported individually for unit testing and future Sentinel tooling.

```
lookup(intent, action, provider) → ManifestEntry | ManifestError
enforce(userSpec, entry)         → ResolvedSpec           // single call; two internal phases
hydrate(entry, resolvedSpec)     → PreparedRequest         // resolves templates, applies inject
prepareRequest(intent, action, provider, userSpec) → PreparedRequest | ManifestError
```

#### Enforcement Ordering (The Guardrail Sandwich)

`enforce()` is a **single function call** with two sequential internal phases:

```
enforce(userSpec, entry):
  Phase 1 — Default fill:
    for each key in entry.enforcement.default:
      if key not in userSpec: userSpec[key] = default[key]   // fills intent gaps; user can override
  Phase 2 — Required key validation:
    for each key in entry.enforcement.required_keys:
      if key not in merged spec: throw ManifestError("Missing required key: ${key}")
  return mergedSpec as ResolvedSpec

hydrate(entry, resolvedSpec):
  Phase 3 — Template resolution:
    url = replace {{placeholders}} in url_template using resolvedSpec
    body = replace {{placeholders}} in body_template using resolvedSpec
  Phase 4 — Inject:
    for each dotPath in entry.enforcement.inject:
      deepSet(bodyObject, dotPath, inject[dotPath])   // additive if key absent; overwrite if present
  return PreparedRequest { url, body: JSON.stringify(bodyObject), ..., manifest_version }
```

This ordering guarantees:
- Defaults are available before template resolution (Phase 3 has values for all placeholders)
- Required key failures surface before any signing or network call
- Inject is the final word — a user cannot pass a non-compliant value that survives to the wire
- Inject keys not present in `body_template` are added to the body object (deep-merge/additive behavior)

**Template resolution:** ~10-line regex replace, no external template library. Variables sourced from `resolvedSpec` (which includes merged defaults). Unresolved placeholders (no matching key in spec) produce a `ManifestError` before the request is dispatched.

### Integration with `uidi-engine/index.ts`

The manifest engine is introduced **alongside** the existing `SERVICE_CONFIG` / `REST_ROUTES` structures. This sub-project does not delete or replace them — it adds the manifest path and routes the three target intents through it.

**Before (current pattern for network/deploy on AWS):**
```typescript
// Inline in uidi-engine/index.ts — service config embedded in constant, body built inline
const config = SERVICE_CONFIG["EC2"];
const url = `https://${config.host(region)}`;
const body = buildEc2VpcBody(spec);  // inline construction
const result = await awsSignedRequest({ url, body, service: "ec2", ... });
await dolt.writeResource({ resource_id, ..., state_json: result });
```

**After (new pattern using manifest engine):**
```typescript
// Same handler, different path when manifest entry exists
const prepared = prepareRequest('network', 'deploy', 'aws', spec);
if (prepared instanceof ManifestError) throw prepared;
const signed = await awsSignedRequest(prepared);  // existing signer, signature unchanged
await dolt.writeResource({
  resource_id, ...,
  state_json: signed,
  manifest_version: prepared.manifest_version   // new field
});
```

The three intents (network, compute, eks) are routed through the manifest engine. Other intents continue using the existing inline construction.

### Dolt Integration

**Write call site:** `uidi-engine/index.ts`, at every `dolt.writeResource()` call (~line 4280 and failure path).

**Schema change:** `DoltResource.manifest_version: string` — added to the interface in `dolt-client.ts`. Default for pre-existing rows: `"0"`.

**Write behavior:**
- Success path: `manifest_version = prepared.manifest_version` (e.g., `"42"`)
- Failure path: same — stamped before the network call fails, using the version of the manifest that generated the `PreparedRequest`
- If the Dolt write itself fails: existing `dolt_write_failed = true` behavior is unchanged; `manifest_version` is lost along with the rest of the write (this is the current accepted risk for Dolt write failures)

**Audit query example:**
```sql
SELECT * FROM resource_state
WHERE manifest_version = '42' AND provider = 'oci' AND intent = 'network';
```

**Rollback behavior:** `manifest_version` is an **immutable audit field**. If manifest `v43` is deployed and then reverted to `v42`, rows written under `v43` retain `manifest_version = "43"`. They are not updated. Dolt time-travel (existing `dolt.diff()` / `dolt.getHistory()`) is the mechanism for historical audit of what was provisioned under a now-reverted version.

---

## Testing

Three layers, all credential-free and runnable in CI:

### Unit Tests (`manifest-engine.test.ts`)
- `lookup` returns correct entry for valid `(intent, action, provider)` triple
- `lookup` returns typed `ManifestError` for unknown combination
- `enforce` Phase 1: applies default only when key absent in spec; does not overwrite user-supplied value
- `enforce` Phase 2: rejects with typed `ManifestError` when `required_keys` entry is missing
- `hydrate` Phase 3: resolves all `{{placeholders}}` in url and body; throws `ManifestError` on unresolved placeholder
- `hydrate` Phase 4: applies inject unconditionally (overrides user-supplied non-compliant value); adds inject keys absent from template (additive behavior)
- `prepareRequest` end-to-end: raw spec in → `PreparedRequest` out with correct `manifest_version` from top-level manifest

100% branch coverage on `enforce` and `hydrate` — these contain the compliance-critical logic.

### Schema Validation Test
Load `manifest.json`, run Zod parse, assert no errors. Runs in CI on every PR touching `manifest.json` or `manifest-types.ts`.

### Engram Alignment Check (`scripts/check-engram-alignment.ts`)
Reads `.engram` line by line using the canonical parse grammar defined above. For each parsed `Inject:` key, asserts at least one `enforcement.inject` entry with a matching key exists in `manifest.json`. Fails the build if any `.engram` Inject rule is uncodified. ~50 lines, no new dependencies. `Default:` and `Append:` lines are parsed but not gated (informational only in this sub-project).

No integration tests against live cloud APIs in this sub-project. Live verification belongs to the Sentinel (Sub-Project 2).

---

## Initial Coverage

Actions scoped to what can be verified without live cloud calls. `update` and missing actions below are deferred to Sub-Project 2, which runs manifest entries against sandbox accounts.

| Intent | Action | Providers | Notes |
|---|---|---|---|
| network | deploy | aws, oci, gcp, azure | VPC / VCN / VNet creation |
| network | discover | aws, oci, gcp, azure | List / describe networks |
| network | destroy | aws, oci, gcp, azure | Delete network |
| compute | deploy | aws, oci, gcp, azure | Instance creation |
| compute | discover | aws, oci, gcp, azure | List / describe instances |
| compute | destroy | aws, oci, gcp, azure | Delete instance — deferred; destroy semantics vary by provider |
| eks | deploy | aws (EKS), gcp (GKE), azure (AKS), oci (OKE) | Cluster creation |
| eks | discover | aws, oci, gcp, azure | Describe cluster |
| eks | destroy | aws, oci, gcp, azure | Deferred to Sub-Project 2 (requires live teardown verification) |
| *.update | all | all | Deferred to Sub-Project 2 — requires read-then-patch and live API verification |

---

## Risks

| Risk | Mitigation |
|---|---|
| `manifest.json` grows unwieldy as intent coverage expands | Per-provider split (Approach C) is the upgrade path; `manifest-engine.ts` API is unchanged by that refactor |
| Dot-notation inject keys don't cover all Azure deeply nested property trees | Validate with an Azure VNet create call early in implementation; extend deep-merge logic if needed |
| Zod boot validation rejects a valid manifest due to overly strict regex | Regex applies to key names only, not values; validate against all 26 existing `.engram` lines before finalizing |
| `.engram` Inject rules use informal syntax — parser may miss edge cases | Canonical grammar is now defined above; alignment script tests against that grammar; `.engram` header comment will document the format |
| Full `SERVICE_CONFIG` cutover creates a large diff and potential regressions | Cutover is explicit non-goal of this sub-project; manifest runs alongside existing constants |
