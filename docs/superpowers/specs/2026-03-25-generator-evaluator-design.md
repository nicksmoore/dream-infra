# Generator-Evaluator Loop — Design Spec
**Date:** 2026-03-25
**Status:** Approved
**Reference:** [Anthropic — Harness Design for Long-Running Apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

---

## Problem

Natural language deployments in Project Naawi fail silently. The `parse-intent` function classifies user intent into an archetype, and `uidi-engine` executes a DAG of AWS operations — but there is no agent that independently verifies what was actually deployed. Self-evaluation inside the generator is known to be unreliable (models praise their own output even when quality is poor). Golden path templates mostly work but have no automated verification either.

---

## Solution

Add a standalone `eval-engine` Supabase Edge Function that acts as a post-execution evaluator. It is called after every deployment with zero context from the generator session, inspects the live AWS state via read-only APIs, scores the result against concrete criteria derived from the `GoldenPathTemplate` schema, and feeds structured correction prompts back into `uidi-engine` if the deployment fails (up to 3 iterations).

---

## Architecture

```
User Intent
    │
    ▼
parse-intent (Generator ①)
    │  archetype + variables
    ▼
uidi-engine (Generator ②)
    │  executes DAG, writes result to Dolt
    ▼
eval-engine (Evaluator) ◄──────────────────┐
    │  AWS read APIs → inspect deployed     │
    │  state, score against template spec   │
    ▼                                       │
EvalResult { score, passed, corrections }  │
    │                                       │
    ├─ passed (score ≥ 75) ─► surface UI    │
    │                                       │
    └─ failed ──────────────────────────────┘
         correctionPrompt injected as
         prefix into next uidi-engine call
         (max 3 iterations)
```

**Key principle:** `eval-engine` receives only the deployment result and the expected template spec. It forms its own independent judgment — no shared context with the generator.

---

## File Structure

```
supabase/functions/eval-engine/
  index.ts          ← HTTP handler, runs the eval loop
  aws-inspector.ts  ← read-only AWS calls per resource type
  scorer.ts         ← applies weighted criteria → EvalResult
  prompts.ts        ← correction prompt templates
  test-suite.ts     ← standalone test runner (golden paths + NL probes)
```

---

## Grading Criteria

Four weighted criteria, sourced from existing `GoldenPathTemplate` fields:

| Criterion | Weight (Standard) | Weight (NL) | Source Field | What It Checks |
|---|---|---|---|---|
| Completeness | 35% | 50% | `requiredResources` | All declared resources exist in AWS |
| Security posture | 30% | 25% | `scaffolding.security` | IMDSv2, encryption-at-rest, vault integration |
| SLO conformance | 20% | 15% | `sloTarget` | Health checks, alerts, HA where required |
| Resource bounds | 15% | 10% | `resourceCeiling` | Instance counts/types within declared budget |

NL deployments weight Completeness higher (50%) because the most common failure mode is the generator omitting resources that weren't explicitly named in the prompt.

**Pass threshold:** score ≥ 75. Below this, the evaluator populates `corrections` and the loop retries.

---

## Data Schemas

### `EvalResult`

```typescript
interface EvalResult {
  deploymentId: string;
  archetype: string;
  score: number;                    // 0–100 weighted composite
  passed: boolean;                  // score >= 75
  iteration: number;                // 1–3
  criteria: {
    completeness: CriterionScore;
    security: CriterionScore;
    slo: CriterionScore;
    resourceBounds: CriterionScore;
  };
  corrections?: string;             // prompt fragment fed back to uidi-engine
  nlClassificationCorrect?: boolean; // NL deployments only
}

interface CriterionScore {
  score: number;       // 0–100
  findings: string[];  // specific issues found
}
```

---

## AWS Inspector

Calls only read-only AWS APIs, signed with the existing SigV4 pattern from `uidi-engine`:

| Service | API Called |
|---|---|
| EKS | `DescribeCluster` |
| S3 | `HeadBucket`, `GetBucketEncryption` |
| Lambda | `GetFunction` |
| RDS | `DescribeDBInstances` |
| ELBv2 | `DescribeLoadBalancers` |
| API Gateway V2 | `GetApis` |
| EC2 | `DescribeInstances` |

---

## Test Suite

Invoked separately from the live eval loop (`test-suite.ts`). Runs the full generator → evaluator loop for each probe and writes a `TestReport` to Dolt.

### Golden Path Probes (17 total)
All templates from `GoldenPathId` are exercised: `internal-worker`, `fintech-pci`, `global-spa`, `event-pipeline`, `service-mesh`, `three-tier`, `internal-api`, `edge-cache`, `ml-training`, `general-compute`, `gitops-canary`, `ephemeral-preview`, `serverless-fast-path`, `standard-vpc`, `observability-stack`, `secure-handshake`, `hardened-path`, `ai-ops-path`.

### NL Probes (5 total)
Deliberately varied phrasing to stress `parse-intent` classification:

```
"spin up a global dashboard for our marketing team"
"i need microservices on kubernetes with a service mesh"
"build me an event pipeline that processes async payments"
"deploy a three-tier app with postgres and a load balancer"
"give me a fintech stack that's PCI compliant"
```

Each NL probe is evaluated on two axes:
1. **Classification accuracy** — did `parse-intent` select the correct archetype?
2. **Deployment completeness** — did `uidi-engine` deploy all required resources?

### `TestReport` Schema

```typescript
interface TestReport {
  runId: string;
  timestamp: string;
  goldenPathResults: Array<{ templateId: string; result: EvalResult }>;
  nlResults: Array<{ probe: string; result: EvalResult }>;
  summary: {
    goldenPathPassRate: number;   // e.g. 0.94
    nlPassRate: number;
    nlClassificationAccuracy: number;
  };
}
```

---

## Error Handling

If `eval-engine` itself errors (AWS API failure, LLM timeout), it returns a special `eval_error` status. The deployment is not retried. The error is surfaced to the user with a clear message — the generator's output stands as-is.

---

## Out of Scope

- Modifying `parse-intent` or `uidi-engine` internals
- Real-time streaming of eval progress to the UI (future iteration)
- Automatic rollback on eval failure (user-initiated rollback already exists)
