// eval-engine/test-suite.ts
// Standalone test runner — exercises the full generator → evaluator loop.
// Writes TestReport to evalDolt. NOT a Supabase Edge Function entry point.

import { evalDolt, type TestReport } from "./dolt-client.ts";
import type { EvalResult, EvalRequest, EvalResponse } from "./prompts.ts";
import { GOLDEN_PATH_REGISTRY, type GoldenPathId } from "../../../../src/lib/golden-path.ts";

// ─── NL probes ───

const NL_PROBES = [
  { probe: "spin up a global dashboard for our marketing team", expectedArchetype: "EDGE_STATIC_SPA" },
  { probe: "i need microservices on kubernetes with a service mesh", expectedArchetype: "SERVICE_MESH" },
  { probe: "build me an event pipeline that processes async payments", expectedArchetype: "EVENT_PIPELINE" },
  { probe: "deploy a three-tier app with postgres and a load balancer", expectedArchetype: "THREE_TIER" },
  // NOTE: FINTECH_PCI is not a supported archetype; INTERNAL_API is the best-guess mapping.
  // Update if classifier returns a different archetype for this probe on first run.
  { probe: "give me a fintech stack that's PCI compliant", expectedArchetype: "INTERNAL_API" },
] as const;

// ─── Helpers ───

function makeEvalErrorResult(
  deploymentId: string,
  archetype: string,
  errorMessage: string,
): EvalResult {
  return {
    deploymentId,
    archetype,
    status: "eval_error",
    score: 0,
    passed: false,
    iteration: 1,
    criteria: {
      completeness: { score: 0, findings: [] },
      security: { score: 0, findings: [] },
      slo: { score: 0, findings: [] },
      resourceBounds: { score: 0, findings: [] },
    },
    errorMessage,
  };
}

async function callEvalEngine(
  evalEngineUrl: string,
  serviceKey: string,
  request: EvalRequest,
): Promise<EvalResult> {
  try {
    const res = await fetch(evalEngineUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const text = await res.text();
      return makeEvalErrorResult(
        request.deploymentId,
        request.archetype,
        `eval-engine ${res.status}: ${text.slice(0, 200)}`,
      );
    }

    const data = await res.json() as EvalResponse;
    return data.finalResult;
  } catch (e) {
    return makeEvalErrorResult(
      request.deploymentId,
      request.archetype,
      `eval-engine fetch error: ${String(e)}`,
    );
  }
}

async function callUidiEngine(
  uidiEngineUrl: string,
  serviceKey: string,
  intent: string,
  awsCredentials: EvalRequest["awsCredentials"],
): Promise<{ deploymentId: string; archetype: string } | null> {
  try {
    const res = await fetch(uidiEngineUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ intent, awsCredentials }),
    });

    if (!res.ok) return null;

    const data = await res.json() as Record<string, any>;
    if (!data.deploymentId || !data.archetype) return null;
    return { deploymentId: data.deploymentId, archetype: data.archetype };
  } catch {
    return null;
  }
}

// ─── Main export ───

export async function runTestSuite(config: {
  evalEngineUrl: string;
  uidiEngineUrl: string;
  supabaseServiceKey: string;
  awsCredentials: EvalRequest["awsCredentials"];
}): Promise<TestReport> {
  const runId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // ── Golden path probes (18 total) ──
  const goldenPathResults: Array<{ templateId: string; result: EvalResult }> = [];

  for (const template of GOLDEN_PATH_REGISTRY) {
    const deploymentId = `deploy_${Date.now()}_${template.id}`;
    const request: EvalRequest = {
      deploymentId,
      archetype: template.id,
      templateId: template.id,
      originalIntent: template.name,
      awsCredentials: config.awsCredentials,
      isTestRun: true,
    };

    const result = await callEvalEngine(config.evalEngineUrl, config.supabaseServiceKey, request);
    goldenPathResults.push({ templateId: template.id, result });
  }

  // ── NL probes (5 total) ──
  const nlResults: Array<{ probe: string; result: EvalResult }> = [];

  for (const { probe, expectedArchetype } of NL_PROBES) {
    // Step 1: call uidi-engine to get a deploymentId + archetype
    const uidiResult = await callUidiEngine(
      config.uidiEngineUrl,
      config.supabaseServiceKey,
      probe,
      config.awsCredentials,
    );

    if (!uidiResult) {
      nlResults.push({
        probe,
        result: makeEvalErrorResult(
          `deploy_${Date.now()}_unknown`,
          "unknown",
          "uidi-engine call failed or returned no deploymentId/archetype",
        ),
      });
      continue;
    }

    // Step 2: call eval-engine
    const request: EvalRequest = {
      deploymentId: uidiResult.deploymentId,
      archetype: uidiResult.archetype,
      originalIntent: probe,
      awsCredentials: config.awsCredentials,
      isTestRun: true,
      expectedArchetype,
    };

    const result = await callEvalEngine(config.evalEngineUrl, config.supabaseServiceKey, request);
    nlResults.push({ probe, result });
  }

  // ── Compute summary ──
  const gpPassed = goldenPathResults.filter(r => r.result.status === "passed").length;
  const gpEvalErrors = goldenPathResults.filter(r => r.result.status === "eval_error").length;
  const nlPassed = nlResults.filter(r => r.result.status === "passed").length;
  const nlEvalErrors = nlResults.filter(r => r.result.status === "eval_error").length;

  const nlClassifiable = 5 - nlEvalErrors;
  const nlClassificationAccuracy: number | null = nlClassifiable === 0
    ? null
    : nlResults.filter(r => r.result.nlClassificationCorrect === true).length / nlClassifiable;

  const report: TestReport = {
    runId,
    timestamp,
    goldenPathResults,
    nlResults,
    summary: {
      goldenPathPassRate: gpPassed / 18,
      goldenPathEvalErrors: gpEvalErrors,
      nlPassRate: nlPassed / 5,
      nlClassificationAccuracy,
      nlEvalErrors,
    },
  };

  await evalDolt.writeTestReport(report, `Test run ${runId}`);
  return report;
}
