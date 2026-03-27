# Coverage Gap Audit — Design Spec

**Date:** 2026-03-27
**Status:** Approved
**Sub-Project:** Naawi Discovery / Gap Analysis (Sub-Project 2a)

---

## Problem

The Universal Manifest (v2) governs how Naawi deploys infrastructure. It does not answer: *what already exists in AWS, and is it governed?* Resources deployed outside Naawi (manual console clicks, legacy scripts, shadow IT) are invisible to the manifest and untested against `.engram` guardrails. This creates four classes of cloud reality:

| | Managed by Naawi | Unmanaged |
|---|---|---|
| **Compliant** | Q1: Golden Path | Q3: Shadow IT |
| **Non-Compliant** | Q2: Snowflake | Q4: Risk Zone |

This spec defines the system that discovers live AWS resources, classifies each into Q1–Q4, and surfaces the result in a Coverage Gap Matrix UI.

---

## Goals

- Discover live AWS resources via existing `action: discover` manifest entries
- Determine management status by cross-referencing Dolt `resource_state` table
- Validate compliance against `.engram` guardrail rules
- Assign each resource to Q1–Q4 and return a structured `AuditReport`
- Render the quadrant breakdown in `AuditMatrix.tsx`
- Starting scope: `intent: network`, `provider: aws` only

## Non-Goals

- Real-time / streaming audit (deferred to Sub-Project 2b)
- Auto-remediation of Q2/Q4 resources (deferred)
- Non-AWS providers on first pass
- Audit of intents other than `network` on first pass

---

## Architecture

Two runtimes, one manifest.

```
Browser
  └── POST /api/audit { intent: "network", provider: "aws" }
        │
        ▼
Vercel Node.js — api/audit.ts
  ├── 1. generate audit_id (before any AWS calls)
  ├── 2. return HTTP 202 { audit_id } immediately (async) — OR —
  │      return full AuditReport synchronously for small scans
  ├── 3. resolve discover entries via prepareOperation() [shared manifest-engine]
  ├── 4. call @aws-sdk: DescribeVpcs, DescribeSecurityGroups, DescribeSubnets
  ├── 5. diff against Dolt resource_state → is_managed per resource
  ├── 6. run engram-validator.ts → EngramFinding[] per resource
  ├── 7. assign quadrant via toQuadrant(is_managed, is_compliant)
  └── 8. write AuditReport to Dolt audit_logs; return to caller

Deno uidi-engine (unchanged)
  └── deploy / destroy / status operations — untouched
```

**Manifest as single source of truth:** `supabase/functions/uidi-engine/manifest.json` is imported by both runtimes. No copy, no sync needed. Vercel resolves the path at build time via `tsconfig` path alias or relative import.

---

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `api/audit.ts` | Create | Vercel handler — orchestrates scan, returns 202 + AuditReport |
| `src/types/audit.ts` | Create | `ResourceFinding`, `AuditReport`, `AuditResponse`, `Quadrant` |
| `src/lib/uidi-auditor.ts` | Create | Pure TS delta engine: AWS response + Dolt state → `ResourceFinding[]` |
| `src/lib/engram-validator.ts` | Create | Parses `.engram`, validates a resource object → `EngramFinding[]` |
| `src/components/AuditMatrix.tsx` | Create | 4-quadrant gap matrix UI component |
| `src/test/uidi-auditor.test.ts` | Create | Unit tests with mocked AWS SDK responses |
| `src/test/engram-validator.test.ts` | Create | Unit tests for each `.engram` rule |

---

## Data Contract

```typescript
// src/types/audit.ts

export type Quadrant = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface EngramFinding {
  rule: string;          // e.g. "cidrBlock must be 10.0.0.0/16"
  status: 'pass' | 'fail';
  message?: string;      // e.g. "Found 172.16.0.0/12, expected 10.0.0.0/16"
}

export interface ResourceFinding {
  id: string;                              // e.g. vpc-0a1b2c3d
  name?: string;                           // Value of Name tag
  intent: string;                          // network | compute | k8s
  provider: 'aws' | 'oci' | 'gcp' | 'azure';
  resource_type: string;                   // vpc | security-group | subnet
  is_managed: boolean;                     // true if found in Dolt resource_state
  is_compliant: boolean;                   // true if all engram findings pass
  quadrant: Quadrant;                      // derived from is_managed × is_compliant
  findings: EngramFinding[];
  raw_resource?: Record<string, unknown>;  // raw AWS SDK response (optional, for diff UI)
  discovered_at: string;                   // ISO 8601
}

export interface AuditReport {
  audit_id: string;                        // UUID, generated before scan begins
  intent: string;
  provider: string;
  started_at: string;
  completed_at?: string;
  findings: ResourceFinding[];
  summary: Record<Quadrant, number>;       // { Q1: 2, Q2: 1, Q3: 3, Q4: 0 }
}

export interface AuditResponse {
  audit_id: string;
  status: 'accepted' | 'complete';
  report?: AuditReport;                    // present if synchronous / small scan
}
```

**Quadrant derivation** — pure, deterministic:

```typescript
export function toQuadrant(managed: boolean, compliant: boolean): Quadrant {
  if (managed && compliant)   return 'Q1';
  if (managed && !compliant)  return 'Q2';
  if (!managed && compliant)  return 'Q3';
  return 'Q4';
}
```

---

## Starting Scope: Network / AWS

Three resource types on first pass:

| AWS API call | Resource type | `.engram` rules checked |
|---|---|---|
| `ec2:DescribeVpcs` | `vpc` | `cidrBlock === "10.0.0.0/16"` |
| `ec2:DescribeSecurityGroups` | `security-group` | no inbound rule with `0.0.0.0/0` on port 22 |
| `ec2:DescribeSubnets` | `subnet` | CIDR contained within VPC CIDR |

All other intents (`compute`, `k8s`, etc.) return a `not_yet_supported` finding rather than erroring. This prevents a broken UI while the audit scope expands in subsequent iterations.

---

## `engram-validator.ts` — Interface

Pure function. No side effects. Importable by both the Vercel handler and Vitest.

```typescript
export interface EngramRule {
  rule: string;
  validate: (resource: Record<string, unknown>) => EngramFinding;
}

export function validateResource(
  resource: Record<string, unknown>,
  resourceType: string,
): EngramFinding[];
```

Rules are registered per `resourceType`. Adding a new rule = adding one entry to a registry map. No changes to the caller.

---

## `AuditMatrix.tsx` — UI Layout

Four-quadrant grid, color-coded by action urgency:

| Quadrant | Color | Label | CTA |
|---|---|---|---|
| Q1 | Green | Golden Path | — |
| Q2 | Amber | Snowflake | Remediate |
| Q3 | Blue | Shadow IT | Import |
| Q4 | Red | Risk Zone | Isolate |

Each cell shows the count of resources in that quadrant. Clicking a cell opens a detail drawer with the `ResourceFinding[]` list, the `findings[]` for each, and (if present) a raw diff from `raw_resource`.

The component accepts a single `AuditReport` prop and is fully renderable from mock data — enabling parallel UI development before the backend is live.

---

## Error Handling

| Condition | Behavior |
|---|---|
| AWS SDK call fails | `ResourceFinding` with `findings: [{ rule: "aws-discovery", status: "fail", message: err.message }]`, quadrant omitted |
| Dolt unreachable | `is_managed` defaults to `false`, finding flagged with `dolt-unavailable` warning |
| `.engram` parse error | 500 returned with `{ error: "engram-parse-failed" }` — audit aborted |
| Intent not in manifest | `not_yet_supported` finding, no quadrant assigned |

---

## Testing Strategy

- `engram-validator.test.ts`: one test per rule (VPC CIDR, SG port 22, subnet containment) with pass and fail cases
- `uidi-auditor.test.ts`: mock AWS SDK responses, assert correct `ResourceFinding[]` output and quadrant assignment
- No integration tests against real AWS in CI — use `@aws-sdk/client-ec2` mock via `vi.mock()`
