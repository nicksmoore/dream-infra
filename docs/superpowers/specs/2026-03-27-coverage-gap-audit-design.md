# Coverage Gap Audit — Design Spec

**Date:** 2026-03-27
**Status:** Approved (rev 2)
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

- Discover live AWS network resources via direct `@aws-sdk` calls (VPCs, Security Groups, Subnets)
- Determine management status by cross-referencing the Supabase `resource_state` table (Naawi's Dolt-backed state store)
- Validate compliance against rules derived from `manifest.json` `enforcement.inject` values
- Assign each resource to Q1–Q4 and return a synchronous `AuditReport`
- Render the quadrant breakdown in `AuditMatrix.tsx`
- Starting scope: `intent: network`, `provider: aws`, single `region` per request

## Non-Goals

- Async / polling audit (deferred to Sub-Project 2b — no 202+audit_id in this iteration)
- Auto-remediation of Q2/Q4 resources (deferred)
- Non-AWS providers on first pass
- Intents other than `network` on first pass
- Cross-region batch scanning (single region per request)

---

## Architecture

Two runtimes, one manifest JSON file.

```
Browser
  └── POST /api/audit { intent: "network", provider: "aws", region: "us-east-1" }
        │
        ▼
Vercel Node.js — api/audit.ts
  ├── 1. validate request body (intent, provider, region required)
  ├── 2. check AWS credentials env vars (fail fast if missing)
  ├── 3. call @aws-sdk/client-ec2: DescribeVpcs, DescribeSecurityGroups, DescribeSubnets
  ├── 4. for each resource: check Supabase resource_state table → is_managed
  ├── 5. run engram-validator with rules from manifest.json enforcement.inject → violations[]
  ├── 6. assign quadrant via toQuadrant(is_managed, is_compliant)
  └── 7. return 200 AuditReport (synchronous — async path deferred to Sub-Project 2b)

Deno uidi-engine (unchanged)
  └── deploy / destroy / status operations — untouched
```

**Manifest as single source of truth:** `supabase/functions/uidi-engine/manifest.json` is the canonical data file. `api/audit.ts` imports it as raw JSON and runs a local `lookup()` to extract `enforcement.inject` values for the `engram-validator`. It does NOT import `manifest-engine.ts` (Deno TypeScript — incompatible runtime).

**No shared package needed:** the only manifest data the audit handler needs is the `enforcement.inject` record for each entry. A three-line local lookup on the JSON is sufficient.

---

## Required Environment Variables

`api/audit.ts` will fail fast (HTTP 500) if any of these are missing:

| Variable | Purpose |
|----------|---------|
| `AWS_ACCESS_KEY_ID` | AWS credential |
| `AWS_SECRET_ACCESS_KEY` | AWS credential |
| `AWS_SESSION_TOKEN` | AWS credential (optional — only for assumed roles) |
| `SUPABASE_URL` | Supabase project URL (for resource_state lookup) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase auth (server-side) |

---

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `api/audit.ts` | Create | Vercel handler — orchestrates scan, returns `AuditReport` |
| `src/types/audit.ts` | Create | `ResourceFinding`, `AuditReport`, `AuditResponse`, `Quadrant` |
| `src/lib/uidi-auditor.ts` | Create | Pure TS: AWS SDK responses + Supabase state → `ResourceFinding[]` |
| `src/lib/engram-validator.ts` | Create | Pure TS: resource JSON + inject rules → `EngramViolation[]` |
| `src/components/AuditMatrix.tsx` | Create | 4-quadrant gap matrix UI — accepts mock or real `AuditReport` |
| `src/test/uidi-auditor.test.ts` | Create | Unit tests with mocked AWS SDK responses |
| `src/test/engram-validator.test.ts` | Create | Unit tests per rule (CIDR, SG port 22, subnet containment) |

---

## Data Contract

```typescript
// src/types/audit.ts

export type Quadrant = 'Q1' | 'Q2' | 'Q3' | 'Q4';
export type FindingStatus = 'classified' | 'scan-error' | 'not-supported';

export interface EngramViolation {
  rule: string;          // e.g. "cidrBlock must be 10.0.0.0/16"
  message: string;       // e.g. "Found 172.16.0.0/12, expected 10.0.0.0/16"
}

export interface ResourceFinding {
  id: string;                              // e.g. vpc-0a1b2c3d
  name?: string;                           // Value of Name tag
  intent: string;                          // network | compute | k8s
  provider: 'aws' | 'oci' | 'gcp' | 'azure';
  resource_type: string;                   // vpc | security-group | subnet
  region: string;                          // e.g. us-east-1
  status: FindingStatus;                   // classified | scan-error | not-supported
  is_managed: boolean;                     // true if found in Supabase resource_state
  quadrant?: Quadrant;                     // absent if status !== 'classified'
  violations: EngramViolation[];           // empty = compliant; failing rules only
  raw_resource?: Record<string, unknown>;  // raw AWS SDK response; populated for Q2 + Q4 only
  discovered_at: string;                   // ISO 8601
}

export interface AuditReport {
  intent: string;
  provider: string;
  region: string;
  started_at: string;
  completed_at: string;
  findings: ResourceFinding[];
  summary: {
    Q1: number; Q2: number; Q3: number; Q4: number;
    errors: number;        // findings with status === 'scan-error'
    not_supported: number; // findings with status === 'not-supported'
  };
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
// is_compliant = violations.length === 0
```

---

## Discovery: What the Manifest Backs vs. What Doesn't Need It

The `network/discover/aws` manifest entry resolves the VPC DescribeVpcs URL. Security Groups and Subnets are called directly from the AWS SDK in `uidi-auditor.ts` — they have no manifest discover entry and do not need one. The manifest is the deployment router; the auditor owns its own discovery calls.

| Resource type | How discovered | Manifest-backed? |
|---|---|---|
| VPC | `ec2:DescribeVpcs` | Yes (URL from manifest entry) |
| Security Group | `ec2:DescribeSecurityGroups` | No — direct SDK call |
| Subnet | `ec2:DescribeSubnets` | No — direct SDK call |

---

## `engram-validator.ts` — Interface and Rules

Pure function. No side effects. Rules read from `manifest.json` `enforcement.inject` — not hardcoded. This ensures the validator and the deployer use identical standards.

```typescript
// Inject values are extracted from manifest entries at validator init time
export interface EngramRuleSet {
  resourceType: string;
  rules: Array<{
    name: string;
    validate: (resource: Record<string, unknown>, inject: Record<string, unknown>) => EngramViolation | null;
  }>;
}

export function validateResource(
  resource: Record<string, unknown>,
  resourceType: string,
  inject: Record<string, unknown>,  // from manifest enforcement.inject for this entry
): EngramViolation[];
```

**Rules for network/aws (first pass):**

| Resource | Rule | Source of expected value |
|---|---|---|
| VPC | `cidrBlock` must match inject value | `manifest.json` network/deploy/aws inject.cidrBlock |
| Security Group | No inbound rule allows `0.0.0.0/0` on port 22 | Hardcoded (no inject equivalent) |
| Subnet | CIDR must be contained within its VPC's CIDR | Derived from VPC finding |

Note: the `.engram` VPC module stanza (`cidr = "10.100.0.0/16"`) applies to Terraform module defaults and is not used by this validator. The manifest `enforcement.inject.cidrBlock` (`10.0.0.0/16`) is authoritative for the audit.

---

## `AuditMatrix.tsx` — UI Layout

Four-quadrant grid, color-coded by action urgency. CTA buttons render as **disabled stubs** in this iteration — remediation/import wiring is deferred.

| Quadrant | Color | Label | CTA (stub) |
|---|---|---|---|
| Q1 | Green | Golden Path | — |
| Q2 | Amber | Snowflake | Remediate (disabled) |
| Q3 | Blue | Shadow IT | Import (disabled) |
| Q4 | Red | Risk Zone | Isolate (disabled) |

Each cell shows the count of resources. Clicking opens a detail drawer with `ResourceFinding[]` for that quadrant. Q2 and Q4 findings include `raw_resource` for diff display.

The component accepts a single `AuditReport` prop and is fully renderable from a mock fixture — enabling parallel frontend development before the backend lands.

---

## Error Handling

| Condition | Behavior |
|---|---|
| Missing AWS credentials env var | HTTP 500 `{ error: "missing-aws-credentials" }` — abort before any SDK call |
| AWS SDK call fails for one resource type | `ResourceFinding` with `status: 'scan-error'`, `violations: []`, no `quadrant`; counted in `summary.errors` |
| Supabase unreachable | `is_managed` defaults to `false`, `ResourceFinding` gains violation `{ rule: "dolt-check", message: "Supabase unavailable — managed status unverified" }`. `AuditReport` gains top-level `warning: "state-check-degraded"` |
| Unsupported intent (e.g., compute) | `ResourceFinding` with `status: 'not-supported'`; counted in `summary.not_supported` |
| `.engram` file unreadable | HTTP 500 `{ error: "engram-read-failed" }` — abort |
| Manifest JSON unreadable | HTTP 500 `{ error: "manifest-read-failed" }` — abort |

---

## Testing Strategy

**`engram-validator.test.ts`**
- One pass + one fail test per rule (CIDR, SG port 22, subnet containment)
- Parse-error path: malformed resource JSON → validator returns appropriate violation
- Inject-value-driven test: CIDR standard read from mock manifest inject, not hardcoded

**`uidi-auditor.test.ts`**
- `toQuadrant()`: all four cases (2×2 truth table)
- Mock `DescribeVpcs` response → correct `ResourceFinding[]` output
- Dolt-unavailable path: `is_managed` defaults to `false`, degraded warning present
- `not_yet_supported` sentinel returned for compute intent without throwing
- `summary` aggregation: correct Q1–Q4 counts and `errors` count from mixed findings
- `raw_resource` populated only for Q2 + Q4 findings

**`AuditMatrix.test.tsx`**
- Render test against mock `AuditReport` fixture (snapshot or RTL assertion)
- Confirms CTA buttons render as disabled for Q2/Q3/Q4
