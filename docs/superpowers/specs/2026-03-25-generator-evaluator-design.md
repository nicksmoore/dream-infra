# Generator-Evaluator Loop — Design Spec
**Date:** 2026-03-25
**Status:** Approved
**Reference:** [Anthropic — Harness Design for Long-Running Apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)

---

## Problem

Natural language deployments in Project Naawi fail silently. The `parse-intent` function classifies user intent into an archetype, and `uidi-engine` executes a DAG of AWS operations — but there is no agent that independently verifies what was actually deployed. Self-evaluation inside the generator is known to be unreliable (models praise their own output even when quality is poor). Golden path templates mostly work but have no automated verification either.

---

## Prerequisites

- **`credential-vault` credential forwarding** (in scope, must be verified): `credential-vault` must forward stored AWS credentials to `eval-engine` callers. This is the same role it plays for `uidi-engine` today, so no code changes are expected — but the forwarding path must be confirmed against `eval-engine`'s request contract before deployment. If changes are required, they are in scope for this implementation.

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
    │  executes DAG, writes result + deploymentId to Dolt
    ▼
eval-engine (Evaluator)               ◄─────────────────────┐
    │  AWS read APIs → inspect state                         │
    │  score against template spec                           │
    ▼                                                        │
EvalResult { status, score, corrections, iteration }        │
    │                                                        │
    ├─ status=eval_error ──► exit; surface error (no retry)  │
    │                                                        │
    ├─ passed (score ≥ 75) ──► surface success to UI         │
    │                                                        │
    ├─ failed + iteration < 3 ───────────────────────────────┘
    │       corrections + prior deploymentId prepended to
    │       fresh uidi-engine HTTP call (iteration++)
    │
    └─ failed + iteration = 3 ──► exit; surface failure to UI
                                  (see Risk Notes)
```

**Key principle:** `eval-engine` receives only the deployment result and the expected template spec. It forms its own independent judgment — no shared context with the generator.

**`index.ts` is the HTTP entry point of the `eval-engine` Supabase function.** It owns the retry loop and maintains iteration state across calls to the inner `scorer.ts` and `aws-inspector.ts` modules within a single function invocation. When the spec says "`eval-engine` is stateless," it means the inner scorer and inspector have no memory between separate HTTP invocations — `index.ts` itself does hold loop state for the duration of one request.

### `index.ts` Request / Response Contract

`index.ts` is the entry point for the eval-engine function and owns the retry loop.

**Request body (from caller — UI or test-suite):**
```typescript
interface EvalRequest {
  deploymentId: string;       // from uidi-engine response
  archetype: string;          // from parse-intent or golden path selection
  templateId?: GoldenPathId;  // present for golden path; absent for NL deployments
  expectedArchetype?: string; // present when isTestRun=true, for NL probes
  originalIntent: string;     // the original user prompt (NL) or template name (golden path)
  awsCredentials: { accessKeyId: string; secretAccessKey: string; region: string };
  isTestRun?: boolean;        // true when called from test-suite.ts
}
```

> **Credential flow note:** `awsCredentials` must **not** be sourced from the browser. The UI calls `eval-engine` server-side via the existing `credential-vault` Supabase function, which retrieves stored credentials and forwards them. The UI never holds raw AWS keys. This is the same pattern used by `uidi-engine` today.

**Response body (to caller):**
```typescript
interface EvalResponse {
  finalResult: EvalResult;    // result of the last iteration
  allIterations: EvalResult[]; // full history (1–3 entries)
}
```

---

## File Structure

```
supabase/functions/eval-engine/
  index.ts          ← HTTP handler, runs the eval loop
  aws-inspector.ts  ← read-only AWS calls per resource type
  scorer.ts         ← applies weighted criteria → EvalResult
  prompts.ts        ← correction prompt templates
  dolt-client.ts    ← Dolt writes for TestReport (test-suite.ts calls this)
  test-suite.ts     ← standalone test runner (golden paths + NL probes)
```

`dolt-client.ts` in `eval-engine` mirrors the pattern from `supabase/functions/uidi-engine/dolt-client.ts`. It owns only the `TestReport` write. The architecture note "writes result + deploymentId to Dolt" refers to `uidi-engine`'s existing `dolt-client.ts` — no change required there.

---

## Grading Criteria

Four weighted criteria, sourced from existing `GoldenPathTemplate` fields (authoritative schema: `src/lib/golden-path.ts`):

| Criterion | Weight (Standard) | Weight (NL) | Source Field | What It Checks |
|---|---|---|---|---|
| Completeness | 35% | 50% | `requiredResources` | All declared resources exist in AWS |
| Security posture | 30% | 25% | `scaffolding.security` | IMDSv2, encryption-at-rest, vault integration |
| SLO conformance | 20% | 15% | `sloTarget` | Health checks, alerts, HA where required |
| Resource bounds | 15% | 10% | `resourceCeiling` | Instance counts/types within declared budget |

NL deployments weight Completeness higher (50%) because the most common failure mode is the generator omitting resources that weren't explicitly named in the prompt. **The NL weight scheme persists across all retry iterations** — if an NL deployment fails and retries, the evaluator continues applying NL weights on iterations 2 and 3.

### Per-Criterion Scoring Rules

`scorer.ts` translates AWS inspector output into a 0–100 score for each criterion using the following rules:

| Criterion | Scoring Rule |
|---|---|
| **Completeness** | Proportional: `(resources found / resources declared in requiredResources) * 100`. Each missing resource reduces the score proportionally. |
| **Security posture** | Binary per check: each of the four security flags (`vaultIntegration`, `imdsv2Only`, `encryptionAtRest`, `securityContext`) is checked independently. Score = `(passing checks / 4) * 100`. Field names verified against `src/lib/golden-path.ts` `ScaffoldingSpec.security`. |
| **SLO conformance** | Binary per requirement: `requiresHealthCheck` and `requiresAlerts` each count as one check. If `availability ≥ 99.9`, multi-AZ is also checked. Score = `(passing checks / total applicable checks) * 100`. |
| **Resource bounds** | Binary per bound: `maxInstances` and `maxMonthlyBudgetUsd` from `ResourceCeiling` (`src/lib/golden-path.ts`) are checked against the discovered deployment. Score = `(passing checks / 2) * 100`. `maxCpuMillicores` and `maxMemoryMb` also exist on `ResourceCeiling` but are advisory in v1 — they do not contribute to the score and the denominator is always 2. |

A "check" that cannot be determined due to a missing AWS resource (e.g. can't inspect IMDSv2 if the instance doesn't exist) counts as a failure for that check.

**Pass threshold:** score ≥ 75 (empirically chosen). This is a starting point — it should be recalibrated after the first test suite run against known-good golden paths establishes a baseline.

---

## Data Schemas

### `EvalResult`

`deploymentId` is the ID returned by `uidi-engine` in its response payload (format: `deploy_<timestamp>_<archetype>`). `eval-engine` receives it as part of the `EvalRequest`. `archetype` is also passed in via `EvalRequest` — `eval-engine` does not infer it.

The `iteration` field is owned and incremented by `index.ts` (the loop controller). It is passed as an input field to each `eval-engine` HTTP call and echoed back in the result — `eval-engine` itself is stateless.

`corrections` is synthesized by `prompts.ts` from the `criteria.findings` arrays: it concatenates all non-empty `findings` strings across failing criteria into a structured prompt fragment (e.g. `"MISSING: S3 bucket encryption. MISSING: IMDSv2 enforcement on EC2 instances."`). This fragment is prepended verbatim to the next `uidi-engine` invocation's system prompt.

`nlClassificationCorrect` is set by `eval-engine` itself when `isTestRun: true` and `expectedArchetype` are both present in the `EvalRequest`. `eval-engine` compares the `archetype` field of the request (what `parse-intent` returned) against `expectedArchetype` and sets `nlClassificationCorrect` accordingly. When `isTestRun` is absent or false, `eval-engine` omits this field from `EvalResult`.

```typescript
interface EvalResult {
  deploymentId: string;             // from uidi-engine response: "deploy_<ts>_<archetype>"
  archetype: string;
  status: "passed" | "failed" | "eval_error";  // eval_error: evaluator itself failed
  score: number;                    // 0–100 weighted composite; 0 when status=eval_error
  passed: boolean;                  // status === "passed"
  iteration: number;                // 1–3; set by index.ts, echoed by eval-engine
  criteria: {
    completeness: CriterionScore;
    security: CriterionScore;
    slo: CriterionScore;
    resourceBounds: CriterionScore;
  };
  corrections?: string;             // present only when status=failed; absent when status=passed or eval_error
  nlClassificationCorrect?: boolean; // NL deployments only; absent for golden path deployments
  errorMessage?: string;            // present when status=eval_error
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

### Golden Path Probes (18 total)
All templates from `GoldenPathId` are exercised: `internal-worker`, `fintech-pci`, `global-spa`, `event-pipeline`, `service-mesh`, `three-tier`, `internal-api`, `edge-cache`, `ml-training`, `general-compute`, `gitops-canary`, `ephemeral-preview`, `serverless-fast-path`, `standard-vpc`, `observability-stack`, `secure-handshake`, `hardened-path`, `ai-ops-path`.

### NL Probes (5 total)
Deliberately varied phrasing to stress `parse-intent` classification. Each probe has a declared **expected archetype** used to populate `nlClassificationCorrect`:

| Probe | Expected Archetype |
|---|---|
| `"spin up a global dashboard for our marketing team"` | `EDGE_STATIC_SPA` |
| `"i need microservices on kubernetes with a service mesh"` | `SERVICE_MESH` |
| `"build me an event pipeline that processes async payments"` | `EVENT_PIPELINE` |
| `"deploy a three-tier app with postgres and a load balancer"` | `THREE_TIER` |
| `"give me a fintech stack that's PCI compliant"` | `INTERNAL_API` |

> **Note on probe #5:** `parse-intent` supports only five archetypes (`EDGE_STATIC_SPA`, `SERVICE_MESH`, `EVENT_PIPELINE`, `INTERNAL_API`, `THREE_TIER`). There is no `FINTECH_PCI` archetype — the expected mapping to `INTERNAL_API` is a best-guess based on the classifier's system prompt (which lists `INTERNAL_API` as covering "API gateway, internal tooling API, BFF, Postgres/Aurora-backed API"). This assumption has not been verified by running the classifier against this prompt. **Known uncertainty:** if the first test suite run shows the classifier returns a different archetype for this probe, the expected archetype mapping in `test-suite.ts` should be updated to match the classifier's actual behavior.

`nlClassificationCorrect` is set to `true` when `parse-intent`'s returned archetype matches the expected archetype in the table above. This mapping is stored as a constant in `test-suite.ts`. This field is **only populated during test suite runs** — it is absent on `EvalResult` objects produced during live deployments. `test-suite.ts` signals test mode to `eval-engine` via an `isTestRun: true` field in the request body; live callers omit this field.

Each NL probe is evaluated on two axes:
1. **Classification accuracy** — did `parse-intent` select the correct archetype?
2. **Deployment completeness** — did `uidi-engine` deploy all required resources?

### `TestReport` Schema

Derivation rules for summary fields:
- `goldenPathPassRate`: `status=passed` count / 18. `eval_error` counts as failure (also in `goldenPathEvalErrors`).
- `nlPassRate`: `status=passed` count / 5. `eval_error` counts as failure (also in `nlEvalErrors`).
- `nlClassificationAccuracy`: `nlClassificationCorrect===true` count / (5 − `nlEvalErrors`). **Intentionally uses a different denominator than `nlPassRate`**: pass rate treats eval errors as failures (they represent a deployment that did not succeed), while classification accuracy excludes them (the classifier cannot be graded when the evaluator itself failed to run). If all 5 are eval errors, this field is `null`.

```typescript
interface TestReport {
  runId: string;
  timestamp: string;
  goldenPathResults: Array<{ templateId: string; result: EvalResult }>;
  nlResults: Array<{ probe: string; result: EvalResult }>;
  summary: {
    goldenPathPassRate: number;          // status=passed / 18 (eval_error counts as failure)
    goldenPathEvalErrors: number;        // count of golden path results with status=eval_error
    nlPassRate: number;                  // status=passed / 5 (eval_error counts as failure)
    nlClassificationAccuracy: number | null; // true classifications / (5 - nlEvalErrors); null if all errored
    nlEvalErrors: number;                // count of NL results with status=eval_error
  };
}
```

---

## Error Handling

If `eval-engine` itself errors (AWS API failure, LLM timeout), it returns an `EvalResult` with `status: "eval_error"` and a populated `errorMessage`. The `score` is 0, `passed` is false, and `corrections` is absent. **`eval_error` exits the retry loop immediately, regardless of which iteration it occurs on.** No further `uidi-engine` calls are made. The generator's output from the most recent successful iteration (if any) stands as-is and the error is surfaced to the user. Iteration count up to that point is preserved in `EvalResponse.allIterations` for diagnostics.

---

## Risk Notes

**Partial deployment on retry failure.** Each retry iteration invokes `uidi-engine` as a fresh HTTP call. To allow `uidi-engine` to be aware of what was already deployed, `index.ts` passes the prior `deploymentId` as part of the `corrections` prefix (format: `"PRIOR_DEPLOYMENT: deploy_<ts>_<archetype>. MISSING: ..."`). `uidi-engine` may use this to attempt additive rather than full re-deployment, but this is a best-effort hint — it does not guarantee idempotent behavior. If all 3 iterations fail, the account may contain orphaned resources. Automatic rollback is out of scope — the user must manually trigger the existing rollback mechanism. This risk is accepted for the initial implementation.

---

## Out of Scope

- Modifying `parse-intent` or `uidi-engine` internals
- Real-time streaming of eval progress to the UI (future iteration)
- Automatic rollback on eval failure (user-initiated rollback already exists; multi-iteration partial deployment risk is documented above)
