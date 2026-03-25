// eval-engine/scorer.ts
// Applies weighted criteria to an InspectionResult → EvalResult.

import { buildCorrectionPrompt, type CriterionScore, type EvalResult } from "./prompts.ts";
import type { InspectionResult } from "./aws-inspector.ts";
import type { GoldenPathTemplate } from "../../../../src/lib/golden-path.ts";

const PASS_THRESHOLD = 75;

// ─── Completeness ───

function scoreCompleteness(
  inspection: InspectionResult,
  requiredResources: string[],
): CriterionScore {
  if (requiredResources.length === 0) {
    return { score: 100, findings: [] };
  }

  const findings: string[] = [];
  let found = 0;

  for (const resource of requiredResources) {
    const r = resource.toLowerCase();
    const matched = Object.entries(inspection.resources).some(([type, info]) => {
      if (!info.exists) return false;
      // Fuzzy match: resource string contains type key or vice versa
      return r.includes(type) || type.includes(r.split("-")[0]);
    });

    if (matched) {
      found++;
    } else {
      findings.push(`${resource}`);
    }
  }

  const score = Math.round((found / requiredResources.length) * 100);
  return { score, findings };
}

// ─── Security posture ───

function scoreSecurity(
  inspection: InspectionResult,
  securitySpec: GoldenPathTemplate["scaffolding"]["security"],
): CriterionScore {
  const checks: Array<{ name: string; required: boolean; pass: () => boolean }> = [
    {
      name: "vaultIntegration",
      required: securitySpec.vaultIntegration,
      pass: () =>
        Object.values(inspection.resources).some(r => r.details.vaultIntegration === true),
    },
    {
      name: "imdsv2Only",
      required: securitySpec.imdsv2Only,
      pass: () => {
        const ec2 = inspection.resources["ec2"];
        if (!ec2?.exists) return false; // can't verify if no EC2
        return ec2.details.imdsv2Enforced === true;
      },
    },
    {
      name: "encryptionAtRest",
      required: securitySpec.encryptionAtRest,
      pass: () =>
        Object.values(inspection.resources).some(r => r.details.encryptionAtRest === true),
    },
    {
      name: "securityContext",
      required: securitySpec.securityContext,
      pass: () => {
        const eks = inspection.resources["eks"];
        if (!eks?.exists) return false;
        return typeof eks.details.securityGroupCount === "number" &&
          (eks.details.securityGroupCount as number) > 0;
      },
    },
  ];

  // Spec: denominator is always 4 (all four checks evaluated independently).
  // Only checks with required=true can fail; required=false checks always pass.
  const SECURITY_DENOMINATOR = 4;
  const findings: string[] = [];
  let passing = 0;

  for (const check of checks) {
    if (!check.required || check.pass()) {
      passing++;
    } else {
      findings.push(`${check.name} enforcement`);
    }
  }

  const score = Math.round((passing / SECURITY_DENOMINATOR) * 100);
  return { score, findings };
}

// ─── SLO conformance ───

function scoreSlo(
  inspection: InspectionResult,
  sloTarget: GoldenPathTemplate["sloTarget"],
): CriterionScore {
  const checks: Array<{ name: string; applicable: boolean; pass: () => boolean }> = [
    {
      name: "healthCheck",
      applicable: sloTarget.requiresHealthCheck,
      pass: () => {
        const elb = inspection.resources["elb"];
        const eks = inspection.resources["eks"];
        return (elb?.exists === true) || (eks?.exists === true);
      },
    },
    {
      name: "alerts",
      applicable: sloTarget.requiresAlerts,
      pass: () =>
        Object.values(inspection.resources).some(r => r.details.alertsConfigured === true),
    },
    {
      name: "multiAz",
      applicable: sloTarget.availability >= 99.9,
      pass: () => {
        const rds = inspection.resources["rds"];
        const ec2 = inspection.resources["ec2"];
        return (rds?.details.multiAz === true) ||
          (typeof ec2?.details.instanceCount === "number" && (ec2.details.instanceCount as number) > 1);
      },
    },
  ];

  const applicable = checks.filter(c => c.applicable);
  if (applicable.length === 0) return { score: 100, findings: [] };

  const findings: string[] = [];
  let passing = 0;

  for (const check of applicable) {
    if (check.pass()) {
      passing++;
    } else {
      findings.push(check.name);
    }
  }

  const score = Math.round((passing / applicable.length) * 100);
  return { score, findings };
}

// ─── Resource bounds ───

function scoreResourceBounds(
  inspection: InspectionResult,
  resourceCeiling: GoldenPathTemplate["resourceCeiling"],
): CriterionScore {
  // maxCpuMillicores and maxMemoryMb are advisory in v1 — not scored
  const findings: string[] = [];
  let passing = 0;

  // Check 1: maxInstances
  const ec2 = inspection.resources["ec2"];
  const instanceCount = ec2?.exists
    ? (typeof ec2.details.instanceCount === "number" ? (ec2.details.instanceCount as number) : 0)
    : 0;
  if (instanceCount <= resourceCeiling.maxInstances) {
    passing++;
  } else {
    findings.push(`instanceCount ${instanceCount} exceeds maxInstances ${resourceCeiling.maxInstances}`);
  }

  // Check 2: maxMonthlyBudgetUsd — billing data not available via inspection; always passes
  passing++;

  const score = Math.round((passing / 2) * 100);
  return { score, findings };
}

// ─── Main export ───

export function scoreDeployment(
  inspection: InspectionResult,
  template: Pick<GoldenPathTemplate,
    "requiredResources" | "scaffolding" | "sloTarget" | "resourceCeiling"
  > & { id?: string },
  iteration: number,
  isNl: boolean,
  isTestRun: boolean,
  expectedArchetype?: string,
): EvalResult {
  // Weights differ for NL vs golden path
  const weights = isNl
    ? { completeness: 0.50, security: 0.25, slo: 0.15, resourceBounds: 0.10 }
    : { completeness: 0.35, security: 0.30, slo: 0.20, resourceBounds: 0.15 };

  const completeness = scoreCompleteness(inspection, template.requiredResources);
  const security = scoreSecurity(inspection, template.scaffolding.security);
  const slo = scoreSlo(inspection, template.sloTarget);
  const resourceBounds = scoreResourceBounds(inspection, template.resourceCeiling);

  const score = Math.round(
    completeness.score * weights.completeness +
    security.score * weights.security +
    slo.score * weights.slo +
    resourceBounds.score * weights.resourceBounds,
  );

  const passed = score >= PASS_THRESHOLD;
  const status: EvalResult["status"] = passed ? "passed" : "failed";

  const result: EvalResult = {
    deploymentId: inspection.deploymentId,
    archetype: inspection.archetype,
    status,
    score,
    passed,
    iteration,
    criteria: { completeness, security, slo, resourceBounds },
  };

  if (!passed) {
    result.corrections = buildCorrectionPrompt(result);
  }

  if (isTestRun && expectedArchetype !== undefined) {
    result.nlClassificationCorrect = inspection.archetype === expectedArchetype;
  }

  return result;
}
