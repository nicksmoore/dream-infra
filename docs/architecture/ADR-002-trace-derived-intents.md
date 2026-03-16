# ADR-002: Trace-Derived Intent Taxonomy

## Status
ACCEPTED

## Context
Project Naawi's initial "Golden Path" implementation relied on a static registry of intent templates (`GOLDEN_PATH_REGISTRY`). While effective for bootstrapping, this approach introduces three critical risks:

1.  **Intent Drift:** Static definitions diverge from evolving infrastructure realities (e.g., Fargate pricing changes vs. EKS).
2.  **Organizational Capture:** Conflicting incentives between Ops, Dev, and Platform teams lead to "design by committee" rather than technical merit.
3.  **The Abstraction Trap:** Validating execution (Riemannian manifolds, TEE attestation) doesn't solve the semantic problem of *what* an intent means.

## Decision
We are pivoting from a **Prescriptive (Declared)** taxonomy to a **Descriptive (Derived)** taxonomy.

**Intents will be synthesized from observed SDK behavior, not written by hand.**

### key Components

1.  **Deterministic Execution Engine (DEE):**
    *   Captures raw SDK calls and their outcomes.
    *   Provides the ground truth of "what happened."

2.  **Zero-Trust Audit Immutable (ZTAI) Log:**
    *   Stores a complete execution trace of every successful operation.
    *   Serves as the training dataset for pattern recognition.

3.  **Reliable Model Consistency Metric (RMCM):**
    *   **Old Role:** Pre-execution validation check.
    *   **New Role:** The feedback mechanism. It scores observed patterns based on coherence and historical success rates.
    *   **Governance:** The "Dry-Run Invariant" replaces the PR review. An intent is promoted if it produces coherent execution traces across N stress tests.

## Architecture Change

### 1. The Pattern Synthesizer
A new subsystem will analyze ZTAI logs to identify clusters of successful execution traces. These clusters become "Emergent Patterns."

*   **Input:** ZTAI Execution Logs (List of SDK Calls + Context)
*   **Process:** Clustering based on resource graphs and dependency topology.
*   **Output:** `GoldenPathTemplate` candidates.

### 2. The Dynamic Registry
The `GOLDEN_PATH_REGISTRY` constant in `src/lib/golden-path.ts` moves from being the *source of truth* to being a *cache* or *bootstrap* set. The system will eventually pull patterns dynamically from the Synthesizer.

### 3. Deprecation Policy
Patterns are not deprecated by human decision. If a pattern stops producing successful execution traces (low RMCM score), it is automatically suspended from the Golden Path library.

## Consequences
*   **Positive:** Removes "design by committee." The infrastructure's actual behavior dictates the "correct" patterns.
*   **Positive:** Solves intent drift. If the infrastructure changes, the successful traces change, and the pattern definition updates automatically.
*   **Negative:** Initial complexity in building the Pattern Synthesizer.
*   **Negative:** Requires a "cold start" period where the system must run enough operations to learn patterns (hence keeping the static registry for V1).

## Implementation Plan
1.  Define `ExecutionTrace` and `EmergentPattern` interfaces in `src/lib/trace-patterns.ts`.
2.  Implement a mock `PatternSynthesizer` to demonstrate the clustering logic.
3.  Update `src/lib/golden-path.ts` to mark the static registry as "Bootstrap Only."
