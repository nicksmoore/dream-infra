// eval-engine/index.ts
// HTTP entry point — owns the eval loop (up to 3 iterations).
// Called after every deployment; calls uidi-engine for retries on failure.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { inspectDeployment } from "./aws-inspector.ts";
import { scoreDeployment } from "./scorer.ts";
import { type EvalRequest, type EvalResponse, type EvalResult } from "./prompts.ts";
// Golden path types inlined to avoid cross-boundary import from src/
// Edge functions cannot import from the frontend codebase
interface GoldenPathTemplateSubset {
  id: string;
  requiredResources: string[];
  scaffolding: {
    networkPolicies: string;
    observability: { serviceMonitor: boolean; goldenSignals: boolean };
    resilience: { pdb: boolean; hpa: boolean };
    security: {
      vaultIntegration: boolean;
      imdsv2Only: boolean;
      encryptionAtRest: boolean;
      securityContext: boolean;
    };
  };
  sloTarget: { availability: number; p99LatencyMs: number; requiresHealthCheck: boolean; requiresAlerts: boolean };
  resourceCeiling: { maxCpuMillicores: number; maxMemoryMb: number; maxInstances: number; maxMonthlyBudgetUsd: number };
}

// Template registry is resolved at runtime via a lookup call to the frontend registry.
// For now, eval-engine operates with the synthetic NL template for all deployments
// until a shared registry module is extracted to a common Deno-compatible path.
const GOLDEN_PATH_REGISTRY: GoldenPathTemplateSubset[] = [];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ITERATIONS = 3;
const PASS_THRESHOLD = 75;

// Synthetic template for NL deployments (no known template spec)
const NL_SYNTHETIC_TEMPLATE: Pick<
  GoldenPathTemplate,
  "requiredResources" | "scaffolding" | "sloTarget" | "resourceCeiling"
> = {
  requiredResources: [],
  scaffolding: {
    networkPolicies: "permissive",
    observability: { serviceMonitor: false, goldenSignals: false },
    resilience: { pdb: false, hpa: false },
    security: {
      vaultIntegration: false,
      imdsv2Only: false,
      encryptionAtRest: false,
      securityContext: false,
    },
  },
  sloTarget: { availability: 99.0, p99LatencyMs: 1000, requiresHealthCheck: false, requiresAlerts: false },
  resourceCeiling: { maxCpuMillicores: 64000, maxMemoryMb: 131072, maxInstances: 100, maxMonthlyBudgetUsd: 10000 },
};

function makeEvalError(
  deploymentId: string,
  archetype: string,
  iteration: number,
  errorMessage: string,
): EvalResult {
  return {
    deploymentId,
    archetype,
    status: "eval_error",
    score: 0,
    passed: false,
    iteration,
    criteria: {
      completeness: { score: 0, findings: [] },
      security: { score: 0, findings: [] },
      slo: { score: 0, findings: [] },
      resourceBounds: { score: 0, findings: [] },
    },
    errorMessage,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json() as EvalRequest;

    // Validate required fields
    const { deploymentId, archetype, originalIntent, awsCredentials, isTestRun, expectedArchetype, templateId } = body;
    if (!deploymentId || !archetype || !originalIntent || !awsCredentials) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: deploymentId, archetype, originalIntent, awsCredentials" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const isNl = !templateId;

    const template = templateId
      ? (GOLDEN_PATH_REGISTRY.find((t: GoldenPathTemplateSubset) => t.id === templateId) ?? NL_SYNTHETIC_TEMPLATE)
      : NL_SYNTHETIC_TEMPLATE;

    const allIterations: EvalResult[] = [];
    let currentDeploymentId = deploymentId;

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      // 1. Inspect live AWS state
      let inspection;
      try {
        inspection = await inspectDeployment(
          currentDeploymentId,
          archetype,
          template.requiredResources,
          awsCredentials,
          template.scaffolding.security,
        );
      } catch (e) {
        const errResult = makeEvalError(
          currentDeploymentId,
          archetype,
          iteration,
          `Inspector failed: ${String(e)}`,
        );
        allIterations.push(errResult);
        break;
      }

      // 2. Score
      const result = scoreDeployment(
        inspection,
        template,
        iteration,
        isNl,
        isTestRun ?? false,
        expectedArchetype,
      );
      allIterations.push(result);

      // 3. Exit conditions
      if (result.status === "eval_error") break;
      if (result.passed) break;
      if (iteration === MAX_ITERATIONS) break;

      // 4. Retry: call uidi-engine with correction prompt prepended to intent.
      // NOTE: uidi-engine's actual ExecuteRequest takes a structured intent enum + spec object,
      // not a free-text string. This call uses the "naawi" intent path (natural-language gateway)
      // and passes the corrections as context. The exact field contract for conveying corrections
      // is a known dependency on uidi-engine's API — see spec Risk Notes and ADR-003.
      // This is a best-effort hint; uidi-engine may or may not use it for additive re-deployment.
      const uidiUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/uidi-engine`;
      const correctionIntent = `${result.corrections}\n\n${originalIntent}`;

      let retryResponse;
      try {
        retryResponse = await fetch(uidiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            intent: "naawi",
            action: "execute",
            spec: {
              naturalLanguageIntent: correctionIntent,
              archetype,
              awsCredentials,
              priorDeploymentId: currentDeploymentId,
            },
          }),
        });
      } catch (e) {
        const errResult = makeEvalError(
          currentDeploymentId,
          archetype,
          iteration + 1,
          `uidi-engine retry call failed: ${String(e)}`,
        );
        allIterations.push(errResult);
        break;
      }

      if (!retryResponse.ok) {
        const text = await retryResponse.text();
        const errResult = makeEvalError(
          currentDeploymentId,
          archetype,
          iteration + 1,
          `uidi-engine returned ${retryResponse.status}: ${text.slice(0, 200)}`,
        );
        allIterations.push(errResult);
        break;
      }

      const retryData = await retryResponse.json() as Record<string, any>;
      currentDeploymentId = retryData.deploymentId ?? currentDeploymentId;
    }

    const finalResult = allIterations[allIterations.length - 1];
    const response: EvalResponse = { finalResult, allIterations };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
