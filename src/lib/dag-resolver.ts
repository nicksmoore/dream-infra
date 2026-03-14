/**
 * Declarative DAG Resolver
 * 
 * Replaces hardcoded output threading with declarative input/output mappings.
 * Each step declares what it produces (outputs) and what it consumes (inputs).
 * The resolver auto-wires values between steps at execution time.
 */

// ───── Types ─────

export interface DagStepIO {
  /** Map of local key → source expression: "stepId.path.to.value" */
  inputs?: Record<string, string>;
  /** Keys this step is expected to produce in result.details */
  outputs?: string[];
}

export interface DagStep {
  id: string;
  name: string;
  description: string;
  intent: string;
  action: string;
  spec: Record<string, unknown>;
  io: DagStepIO;
  /** Step IDs that must complete before this step runs */
  dependsOn: string[];
  /** Reverse action for rollback — defaults to "destroy" */
  rollbackAction?: string;
  /** Keys from outputs needed to build the rollback spec */
  rollbackSpec?: Record<string, string>;
  status: "pending" | "running" | "done" | "error" | "rolled_back";
  output?: string;
  result?: unknown;
}

// ───── Resolver ─────

/**
 * Resolves a step's spec by injecting values from prior step outputs.
 * Input expressions use dot-notation: "eks-vpc.subnet_ids" → stepOutputs["eks-vpc"].subnet_ids
 */
export function resolveStepInputs(
  step: DagStep,
  stepOutputs: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  const resolved = { ...step.spec };

  if (!step.io.inputs) return resolved;

  for (const [specKey, sourceExpr] of Object.entries(step.io.inputs)) {
    const dotIdx = sourceExpr.indexOf(".");
    if (dotIdx === -1) continue;

    const sourceStepId = sourceExpr.slice(0, dotIdx);
    const sourcePath = sourceExpr.slice(dotIdx + 1);

    const sourceOutput = stepOutputs[sourceStepId];
    if (!sourceOutput) continue;

    const value = getNestedValue(sourceOutput, sourcePath);
    if (value !== undefined && value !== null) {
      // Handle array coercion: if value isn't an array but key ends with _ids, wrap it
      if (specKey.endsWith("_ids") && !Array.isArray(value)) {
        resolved[specKey] = [value];
      } else {
        resolved[specKey] = value;
      }
    }
  }

  return resolved;
}

/**
 * Builds a rollback spec from step outputs for destroying created resources.
 */
export function buildRollbackSpec(
  step: DagStep,
  stepOutputs: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  const spec: Record<string, unknown> = {};

  // Always include region from original spec
  if (step.spec.region) spec.region = step.spec.region;

  // If rollbackSpec mapping is defined, use it
  if (step.rollbackSpec) {
    const myOutput = stepOutputs[step.id] || {};
    for (const [key, sourcePath] of Object.entries(step.rollbackSpec)) {
      const value = getNestedValue(myOutput, sourcePath);
      if (value !== undefined) spec[key] = value;
    }
  }

  return spec;
}

/**
 * Returns steps in execution order respecting dependencies.
 * Steps with no unmet dependencies can run in parallel (returned in same tier).
 */
export function getExecutionOrder(steps: DagStep[]): DagStep[][] {
  const completed = new Set<string>();
  const remaining = [...steps];
  const tiers: DagStep[][] = [];

  while (remaining.length > 0) {
    const tier = remaining.filter(s => 
      s.dependsOn.every(dep => completed.has(dep))
    );

    if (tier.length === 0) {
      // Circular dependency or missing step — push all remaining as final tier
      tiers.push(remaining.splice(0));
      break;
    }

    for (const s of tier) {
      completed.add(s.id);
      remaining.splice(remaining.indexOf(s), 1);
    }

    tiers.push(tier);
  }

  return tiers;
}

/**
 * Returns completed steps in reverse order for rollback.
 */
export function getRollbackOrder(steps: DagStep[]): DagStep[] {
  return [...steps]
    .filter(s => s.status === "done")
    .reverse();
}

// ───── Helpers ─────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
