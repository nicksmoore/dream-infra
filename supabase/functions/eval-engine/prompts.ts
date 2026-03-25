// eval-engine/prompts.ts
// Exports shared EvalResult types and builds correction prompt strings
// from CriterionScore findings arrays.

export interface CriterionScore {
  score: number;      // 0–100
  findings: string[]; // specific issues found
}

export interface EvalResult {
  deploymentId: string;              // "deploy_<ts>_<archetype>"
  archetype: string;
  status: "passed" | "failed" | "eval_error";
  score: number;                     // 0–100 weighted composite; 0 when status=eval_error
  passed: boolean;                   // status === "passed"
  iteration: number;                 // 1–3; owned by index.ts
  criteria: {
    completeness: CriterionScore;
    security: CriterionScore;
    slo: CriterionScore;
    resourceBounds: CriterionScore;
  };
  corrections?: string;              // present only when status=failed
  nlClassificationCorrect?: boolean; // NL deployments only
  errorMessage?: string;             // present when status=eval_error
}

export interface EvalRequest {
  deploymentId: string;
  archetype: string;
  templateId?: string;
  expectedArchetype?: string;
  originalIntent: string;
  awsCredentials: { accessKeyId: string; secretAccessKey: string; region: string };
  isTestRun?: boolean;
}

export interface EvalResponse {
  finalResult: EvalResult;
  allIterations: EvalResult[];
}

/**
 * Synthesizes a correction prompt from a failed EvalResult.
 * Prepends PRIOR_DEPLOYMENT and collects all criterion findings.
 * This string is prepended verbatim to the next uidi-engine invocation.
 */
export function buildCorrectionPrompt(result: EvalResult): string {
  const prefix = `PRIOR_DEPLOYMENT: ${result.deploymentId}.`;

  const allFindings: string[] = [];
  for (const criterion of [
    result.criteria.completeness,
    result.criteria.security,
    result.criteria.slo,
    result.criteria.resourceBounds,
  ]) {
    if (criterion.score < 100) {
      for (const finding of criterion.findings) {
        const normalized = finding.startsWith("MISSING:") ? finding : `MISSING: ${finding}`;
        allFindings.push(normalized);
      }
    }
  }

  if (allFindings.length === 0) {
    return `${prefix} No specific findings.`;
  }

  return `${prefix} ${allFindings.join(" ")}`;
}
