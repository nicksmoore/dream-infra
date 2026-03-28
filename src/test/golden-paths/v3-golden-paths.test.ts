import { describe, it, expect, test } from "vitest";
import { ManifestError } from "../../../supabase/functions/uidi-engine/manifest-types";
import { prepareOperation } from "../../../supabase/functions/uidi-engine/manifest-engine";
import { V3_GOLDEN_FIXTURES } from "./v3-intent-fixtures";

// ── Intent alias normalisation (mirrors index.ts normalizeIntent) ─────────────
function normalizeIntent(intent: string): string {
  if (intent === "eks" || intent === "kubernetes") return "k8s";
  if (intent === "load-balancer") return "loadbalancer";
  if (intent === "gap") return "gap-analysis";
  return intent;
}

const CANONICAL_V3_INTENTS = [
  "storage", "database", "serverless", "cdn", "dns", "loadbalancer",
  "security", "gateway", "secrets", "observability", "orchestration",
  "ai", "container", "gap-analysis",
] as const;

// ── Sanity: 14 canonical intents are all in the manifest ─────────────────────

test("all 14 canonical v3 intents resolve to at least one manifest entry", () => {
  for (const intent of CANONICAL_V3_INTENTS) {
    // Try each of the four actions; pass if any succeeds
    const actions = ["deploy", "discover", "destroy", "status"];
    const found = actions.some(action => {
      const result = prepareOperation(intent, action, "aws", { region: "us-east-1" });
      return !(result instanceof ManifestError) || result.code !== "NOT_FOUND";
    });
    expect(found, `Intent "${intent}" has zero manifest entries across all actions`).toBe(true);
  }
});

// ── Alias normalisation ────────────────────────────────────────────────────────

describe("normalizeIntent — alias mapping", () => {
  it("load-balancer → loadbalancer", () => {
    expect(normalizeIntent("load-balancer")).toBe("loadbalancer");
  });

  it("gap → gap-analysis", () => {
    expect(normalizeIntent("gap")).toBe("gap-analysis");
  });

  it("loadbalancer passes through unchanged", () => {
    expect(normalizeIntent("loadbalancer")).toBe("loadbalancer");
  });

  it("gap-analysis passes through unchanged", () => {
    expect(normalizeIntent("gap-analysis")).toBe("gap-analysis");
  });

  it("other v3 intents are not mutated", () => {
    for (const intent of CANONICAL_V3_INTENTS) {
      expect(normalizeIntent(intent)).toBe(intent);
    }
  });
});

// ── Golden Path fixtures ───────────────────────────────────────────────────────

describe("V3 golden path fixtures — manifest resolution", () => {
  for (const fixture of V3_GOLDEN_FIXTURES) {
    if (!fixture.expectsManifestEntry) continue;

    it(fixture.label, () => {
      const canonical = normalizeIntent(fixture.intent);
      const result = prepareOperation(canonical, fixture.action, "aws", fixture.spec);

      // Should not be NOT_FOUND — a manifest entry must exist
      if (result instanceof ManifestError && result.code === "NOT_FOUND") {
        throw new Error(
          `No manifest entry for (${canonical}, ${fixture.action}, aws). ` +
          `Original intent: "${fixture.intent}"`
        );
      }

      // A MISSING_REQUIRED_KEY error is acceptable only if the spec deliberately
      // omits a field — for these fixtures all required fields ARE provided,
      // so this would indicate a spec/manifest mismatch.
      if (result instanceof ManifestError && result.code === "MISSING_REQUIRED_KEY") {
        throw new Error(
          `Spec is missing a required key for (${canonical}, ${fixture.action}, aws): ${result.message}\n` +
          `Spec provided: ${JSON.stringify(fixture.spec)}`
        );
      }

      // SCHEMA_INVALID would be a bug in the manifest itself
      expect(result).not.toBeInstanceOf(ManifestError);
    });
  }
});
