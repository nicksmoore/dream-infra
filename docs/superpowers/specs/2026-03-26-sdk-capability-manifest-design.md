# SDK Capability Manifest — Design Spec

**Date:** 2026-03-26
**Status:** Approved — ready for implementation
**Author:** Nick Moore (Aura Solutions)
**Sub-Project:** 1 of 3 (SDK Drift Resilience System)

---

## Problem

Project Naawi maps natural language intent to raw HTTP calls across AWS, GCP, Azure, and OCI. The execution layer currently embeds provider-specific request construction inline inside `multi-cloud-proxy.ts` and per-provider handler functions. This creates two drift risks:

1. **Code drift** — when a provider changes an endpoint, parameter name, or signing requirement, the fix requires TypeScript refactoring across multiple handler files.
2. **Engram drift** — the `.engram` compliance rules (e.g., "OCI VCNs must have IPv6 disabled") have no automated link to the HTTP layer. A rule can exist in `.engram` and be silently absent from the actual request body.

---

## Scope

### In scope
- `manifest.json` — versioned, bundled JSON registry of intent-to-HTTP templates
- `manifest-types.ts` — Zod schema and TypeScript interfaces
- `manifest-engine.ts` — `lookup`, `enforce`, `hydrate`, `prepareRequest` pure utility functions
- `PreparedRequest` contract consumed by the existing Universal Signer (unchanged)
- Manifest version stamped into every Dolt write (success and failure)
- `scripts/check-engram-alignment.ts` — CI script asserting every `.engram` Inject rule is codified in `manifest.json`
- Initial manifest entries: 4 providers × 3 intents (network, compute, eks) × create/read/update/delete where applicable

### Out of scope
- New intents beyond network, compute, eks
- SDK Sentinel automation (Sub-Project 2)
- Engram Drift Monitor (Sub-Project 3)
- Changes to signing implementations
- New `.engram` rules or policy changes
- Dolt schema migrations beyond adding `manifest_version` column

---

## Decision Log

| Decision | Alternatives Considered | Rationale |
|---|---|---|
| JSON + Zod + TS interface (Approach B) | TypeScript const array (A), per-provider JSON files (C) | JSON is the natural format for HTTP templates; Sentinel automation can generate JSON without producing TS source; Zod catches schema drift at boot |
| Compiled bundle at deploy time | Dolt inline query per request, cache at cold start | Supabase Edge Functions are ephemeral; bundling makes code and data an atomic deploy unit; eliminates hot-path Dolt dependency |
| Integer string version (`"42"`) | Git SHA, timestamp | Human-readable in Dolt audit queries during incidents; avoids "v42" vs "42" inconsistency via Zod regex |
| Inject/Default distinction preserved | Flatten into single `default_values` map | Inject is a compliance override (non-negotiable); Default fills intent gaps (user can override); collapsing them loses the enforcement gradient |
| `required_keys` as pre-flight gate | Let cloud provider return 400/403 | Typed, actionable error before any network call; preserves the "Zero-SDK stability" principle |
| `signed_headers` explicit per entry | Derive from strategy at signing time | Keeps the signer a dumb pipe; provider-specific header list changes require only a manifest update, not TypeScript refactoring |

---

## Architecture

### File Structure

```
src/lib/
  manifest.json           ← the declarative registry (versioned)
  manifest-types.ts       ← Zod schema + ManifestEntry + PreparedRequest interfaces
  manifest-engine.ts      ← lookup / enforce / hydrate / prepareRequest (pure functions)

scripts/
  check-engram-alignment.ts  ← CI: asserts .engram Inject rules exist in manifest.json
```

### The `.engram` / Manifest Boundary

| Layer | Responsibility | Example |
|---|---|---|
| `.engram` | Policy declaration — provider-agnostic, human-readable | `[Intent: POST /vcns] Inject: isIpv6Enabled: false` |
| `manifest.json` | Execution translation — provider-specific HTTP encoding | `enforcement.inject: { "isIpv6Enabled": false }` for OCI network/create |

Every `.engram` `Inject:` rule must have a corresponding `enforcement.inject` entry in `manifest.json`. The CI alignment check enforces this. Rules in `.engram` with no manifest entry fail the build.

### Data Schema

#### Top-Level Manifest

```typescript
interface Manifest {
  version: string;        // matches /^\d+$/ — integer string, incremented on every manifest-touching merge
  generated_at: string;   // ISO 8601
  entries: ManifestEntry[];
}
```

#### ManifestEntry

```typescript
type SigningStrategy = 'AWS_SIGV4' | 'OCI_RSA_V1' | 'GCP_OAUTH2' | 'AZURE_BEARER';

interface ManifestEntry {
  intent: 'network' | 'eks' | 'compute';
  action: 'create' | 'read' | 'update' | 'delete';
  provider: 'aws' | 'oci' | 'gcp' | 'azure';

  request: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    url_template: string;           // double-brace Mustache: "https://iaas.{{region}}.oraclecloud.com/20160918/vcns"
    headers: Record<string, string>; // static headers; signer appends Authorization
    body_template?: string;         // stringified JSON with {{placeholders}}
  };

  signing: {
    strategy: SigningStrategy;
    signed_headers: string[];       // ordered list for canonical string construction; required for all strategies
    service?: string;               // required when strategy === 'AWS_SIGV4' (e.g. "ec2")
    region_required: boolean;
  };

  enforcement: {
    inject: Record<string, unknown>;    // dot-notation keys; applied post-hydration; unconditional overwrite
    default: Record<string, unknown>;   // dot-notation keys; applied pre-hydration; only if key absent in spec
    required_keys: string[];            // validated before hydration; missing key = hard rejection, no network call
  };
}
```

**Zod validation rules:**
- `signed_headers` must be non-empty when `strategy === 'OCI_RSA_V1'`
- `signing.service` must be present when `strategy === 'AWS_SIGV4'`
- `enforcement.inject` and `enforcement.default` keys must match `/^[\w]+(\.\w+)*$/` (dot-notation, no spaces)
- `version` must match `/^\d+$/`

#### PreparedRequest (Signer Contract)

```typescript
interface PreparedRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;                          // fully resolved; no placeholders remain
  headers: Record<string, string>;      // static headers only; signer appends Authorization
  body: string | null;                  // serialized JSON with inject applied
  signing: {
    strategy: SigningStrategy;
    signed_headers: string[];
    service?: string;
    region: string;                     // resolved from spec at engine time
  };
  manifest_version: string;            // carried through for Dolt stamping
}
```

The signer receives a `PreparedRequest`, adds the `Authorization` header, and returns the modified object. It touches nothing else.

### Engine API

All four functions are pure (no I/O, no side effects). Exported individually for unit testing and future Sentinel tooling.

```
lookup(intent, action, provider) → ManifestEntry | ManifestError
enforce(userSpec, entry)         → ResolvedSpec   // applies default, validates required_keys
hydrate(entry, resolvedSpec)     → PreparedRequest // resolves templates, applies inject
prepareRequest(intent, action, provider, userSpec) → PreparedRequest | ManifestError
```

#### Enforcement Ordering (The Guardrail Sandwich)

```
1. enforce() — apply enforcement.default to userSpec (fills intent gaps; user can override)
2. enforce() — validate enforcement.required_keys against merged spec (hard reject if missing)
3. hydrate() — resolve {{placeholders}} in url_template and body_template
4. hydrate() — apply enforcement.inject to final body (unconditional compliance overwrite)
```

This ordering guarantees:
- Defaults are available as placeholder values before template resolution
- Required keys are caught before any network call
- Inject is the final word — a user cannot pass a non-compliant value that survives to the wire

**Template resolution:** ~10-line regex replace, no external template library. Variables resolved in order: (1) provider credentials from caller's spec, (2) `enforcement.default` values.

### Integration with `multi-cloud-proxy.ts`

**Current pattern (before):**
```typescript
async function handleNetwork(action: string, spec: Record<string, unknown>) {
  switch (spec.provider) {
    case 'oci': return ociNetwork(action, spec);  // builds URL, body, calls signer inline
    case 'gcp': return gcpNetwork(action, spec);
    // ...
  }
}
```

**New pattern (after):**
```typescript
async function handleNetwork(action: string, spec: Record<string, unknown>) {
  const prepared = prepareRequest('network', action, spec.provider as Provider, spec);
  if (prepared instanceof ManifestError) throw prepared;
  const signed = await sign(prepared);          // existing signer, unchanged
  return fetch(signed.url, { ... });            // existing fetch, unchanged
}
```

The `switch` block is eliminated. Provider-specific body construction moves into `manifest.json`. Signer implementations are untouched.

### Boot Validation

At module load time, `manifest-engine.ts` imports `manifest.json`, runs the Zod parse, and throws synchronously if validation fails. In Supabase Edge Functions, a module-level throw prevents the function from serving any requests — it never enters a partial-failure state where it accepts traffic but sends malformed cloud calls.

### Dolt Integration

The `manifest_version` field from `PreparedRequest` is written to Dolt on every `resource_state` upsert — both success and failure paths. This enables:

```sql
-- "Which resources were provisioned using the manifest version active before the OCI breaking change?"
SELECT * FROM resource_state WHERE manifest_version = '42' AND provider = 'oci' AND intent = 'network';
```

Manifest version is a human-readable integer string to support readable queries during live incidents.

---

## Testing

Three layers, all credential-free and runnable in CI:

### Unit Tests (`manifest-engine.test.ts`)
- `lookup` returns correct entry for valid (intent, action, provider) triple
- `lookup` returns typed `ManifestError` for unknown combination
- `enforce` applies defaults only when key absent in spec
- `enforce` rejects with typed error when `required_keys` entry is missing
- `hydrate` resolves all `{{placeholders}}` in url and body
- `hydrate` applies inject unconditionally (overrides user-supplied value)
- `prepareRequest` end-to-end: raw spec in → `PreparedRequest` out with correct `manifest_version`

100% branch coverage on `enforce` and `hydrate` — these contain the compliance-critical logic.

### Schema Validation Test
Load `manifest.json`, run Zod parse, assert no errors. Runs in CI on every PR that touches `manifest.json` or `manifest-types.ts`.

### Engram Alignment Check (`scripts/check-engram-alignment.ts`)
Reads `.engram` line by line, parses each `[Intent: ...]` + `Inject:` pair, asserts at least one matching `enforcement.inject` entry exists in `manifest.json` for that rule. Fails the build if any `.engram` Inject rule is uncodified. ~50 lines, no new dependencies.

**No integration tests against live cloud APIs in this sub-project.** Live verification is the responsibility of the Sentinel (Sub-Project 2), which runs manifest entries against sandbox accounts as part of the `last_verified` workflow.

---

## Initial Coverage

Manifest entries to be created as part of this sub-project:

| Intent | Action | Providers |
|---|---|---|
| network | create | aws, oci, gcp, azure |
| network | read | aws, oci, gcp, azure |
| network | delete | aws, oci, gcp, azure |
| compute | create | aws, oci, gcp, azure |
| compute | read | aws, oci, gcp, azure |
| eks | create | aws (EKS), gcp (GKE), azure (AKS), oci (OKE) |

Entries for `update` actions are deferred to Sub-Project 2 — update semantics require read-then-patch patterns that should be validated with live API calls.

---

## Risks

| Risk | Mitigation |
|---|---|
| `manifest.json` grows unwieldy as intent coverage expands | Per-provider split (Approach C) is the upgrade path; `manifest-engine.ts` API is unchanged by that refactor |
| Dot-notation `inject` keys don't cover all Azure nested property trees | Validate with an actual Azure VNet create call early in implementation; extend notation if needed |
| Zod boot validation rejects a valid manifest due to overly strict regex | Start with permissive key regex, tighten after initial entries are verified |
| `.engram` Inject rules use informal syntax that's hard to parse reliably | The alignment script targets the current 26-line format; document the format constraint in `.engram` header comments |
