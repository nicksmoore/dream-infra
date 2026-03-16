import { describe, it, expect, beforeEach } from "vitest";
import {
  policyRegistry,
  CAPACITY_TIERS,
  hydrateGoldenPathCeiling,
  getCurrentCapacityTier,
  escalateViaIntent,
} from "../lib/policy-registry";
import { GOLDEN_PATH_REGISTRY, runSafetyGate } from "../lib/golden-path";

describe("Policy Registry — PRD: Intent-Driven State Authority & Resource Hydration", () => {
  // ─── §3.1: Resource Ceiling Hydration ───

  describe("Resource Ceiling Hydration Logic (PRD §3.1)", () => {
    it("should hydrate standard-vpc with non-zero defaults for dev environment", () => {
      const vpc = GOLDEN_PATH_REGISTRY.find(t => t.id === "standard-vpc")!;
      const { template, tierName } = hydrateGoldenPathCeiling(vpc, "dev");

      expect(template.resourceCeiling.maxCpuMillicores).toBeGreaterThan(0);
      expect(template.resourceCeiling.maxMemoryMb).toBeGreaterThan(0);
      expect(template.resourceCeiling.maxInstances).toBeGreaterThan(0);
      expect(tierName).toBe("Developer Small");
    });

    it("should hydrate standard-vpc with production-grade defaults for prod environment", () => {
      const vpc = GOLDEN_PATH_REGISTRY.find(t => t.id === "standard-vpc")!;
      const { template, tierName } = hydrateGoldenPathCeiling(vpc, "prod");

      expect(template.resourceCeiling.maxCpuMillicores).toBeGreaterThanOrEqual(8000);
      expect(template.resourceCeiling.maxMemoryMb).toBeGreaterThanOrEqual(32768);
      expect(tierName).toBe("Production");
    });

    it("should match PRD capacity tier table: Default/Sandbox → 1000m CPU, 2048MB", () => {
      const tier = CAPACITY_TIERS["sandbox"];
      expect(tier.ceiling.maxCpuMillicores).toBe(1000);
      expect(tier.ceiling.maxMemoryMb).toBe(2048);
      expect(tier.ceiling.maxInstances).toBe(2);
    });

    it("should match PRD capacity tier table: High-Performance → 4000m+ CPU, 16GB+", () => {
      const tier = CAPACITY_TIERS["high-performance"];
      expect(tier.ceiling.maxCpuMillicores).toBeGreaterThanOrEqual(4000);
      expect(tier.ceiling.maxMemoryMb).toBeGreaterThanOrEqual(16384);
      expect(tier.ceiling.maxInstances).toBeGreaterThanOrEqual(10);
    });

    it("should match PRD capacity tier table: Legacy/Locked → 0m CPU, 0MB", () => {
      const tier = CAPACITY_TIERS["legacy-locked"];
      expect(tier.ceiling.maxCpuMillicores).toBe(0);
      expect(tier.ceiling.maxMemoryMb).toBe(0);
      expect(tier.ceiling.maxInstances).toBe(0);
    });

    it("should never hydrate to zero for any standard Golden Path in dev/staging/prod", () => {
      for (const env of ["dev", "staging", "prod"]) {
        for (const gp of GOLDEN_PATH_REGISTRY) {
          const { template } = hydrateGoldenPathCeiling(gp, env);
          expect(
            template.resourceCeiling.maxCpuMillicores,
            `${gp.id} in ${env} should have non-zero CPU`
          ).toBeGreaterThan(0);
          expect(
            template.resourceCeiling.maxMemoryMb,
            `${gp.id} in ${env} should have non-zero Memory`
          ).toBeGreaterThan(0);
        }
      }
    });
  });

  // ─── §3.2: Mandatory Dolt State Commit ───

  describe("Mandatory Dolt State Commit (PRD §3.2)", () => {
    it("should HALT when no dolt_commit_hash is present", () => {
      const vpc = GOLDEN_PATH_REGISTRY.find(t => t.id === "standard-vpc")!;
      const { template } = hydrateGoldenPathCeiling(vpc, "dev");

      const report = runSafetyGate(template, {
        cpuMillicores: 500,
        memoryMb: 1024,
        environment: "dev",
        // NOTE: No doltCommitRef provided
      });

      expect(report.halted).toBe(true);
      const doltCheck = report.results.find(r => r.id === "dolt-state-authority");
      expect(doltCheck).toBeDefined();
      expect(doltCheck!.passed).toBe(false);
      expect(doltCheck!.severity).toBe("error");
    });

    it("should PASS when dolt_commit_hash is present", () => {
      const vpc = GOLDEN_PATH_REGISTRY.find(t => t.id === "standard-vpc")!;
      const { template } = hydrateGoldenPathCeiling(vpc, "dev");

      const report = runSafetyGate(template, {
        cpuMillicores: 500,
        memoryMb: 1024,
        environment: "dev",
        doltCommitRef: "dolt_abc123_xyz",
      });

      const doltCheck = report.results.find(r => r.id === "dolt-state-authority");
      expect(doltCheck).toBeDefined();
      expect(doltCheck!.passed).toBe(true);
    });

    it("should block on zero-value ceilings with descriptive error", () => {
      const vpc = GOLDEN_PATH_REGISTRY.find(t => t.id === "standard-vpc")!;
      // Simulate un-hydrated template with zero ceilings
      const unhydrated = {
        ...vpc,
        resourceCeiling: { maxCpuMillicores: 0, maxMemoryMb: 0, maxInstances: 0, maxMonthlyBudgetUsd: 0 },
      };

      const report = runSafetyGate(unhydrated, {
        doltCommitRef: "dolt_abc123",
        environment: "dev",
      });

      expect(report.halted).toBe(true);
      const zeroCeilingCheck = report.results.find(r => r.id === "zero-ceiling-guard");
      expect(zeroCeilingCheck).toBeDefined();
      expect(zeroCeilingCheck!.passed).toBe(false);
      expect(zeroCeilingCheck!.message).toContain("zero-value resource ceilings");
    });
  });

  // ─── §3.3: Natural Language Limit Escalation ───

  describe("Natural Language Limit Escalation (PRD §3.3)", () => {
    it("should parse 'Escalate this VPC to the Developer-Large capacity tier'", () => {
      const result = escalateViaIntent(
        "Escalate this VPC to the Developer-Large capacity tier",
        "standard-vpc",
        "dev",
        "nick"
      );

      expect(result.success).toBe(true);
      expect(result.newTier?.id).toBe("developer-large");
      expect(result.record?.doltCommitHash).toBeTruthy();
      expect(result.record?.resolvedBy).toBe("nlp");
    });

    it("should parse 'Upgrade to production tier'", () => {
      const result = escalateViaIntent(
        "Upgrade to production tier",
        "standard-vpc",
        "dev",
        "nick"
      );

      expect(result.success).toBe(true);
      expect(result.newTier?.id).toBe("production");
    });

    it("should parse 'I need high-performance resources'", () => {
      const result = escalateViaIntent(
        "I need high-performance resources for this ML pipeline",
        "ml-training",
        "dev",
        "nick"
      );

      expect(result.success).toBe(true);
      expect(result.newTier?.id).toBe("high-performance");
    });

    it("should require approval for production+ tiers when no authorizer", () => {
      const result = escalateViaIntent(
        "Upgrade to production tier",
        "standard-vpc",
        "dev"
        // NOTE: no authorizedBy
      );

      expect(result.success).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("should log every escalation with a Dolt commit hash", () => {
      // Use a fresh path+env combo that hasn't been escalated by prior tests
      const result = escalateViaIntent(
        "Escalate this to staging tier",
        "general-compute",
        "dev",
        "nick"  // Staging tier requires team-lead approval
      );

      expect(result.success).toBe(true);
      expect(result.record?.doltCommitHash).toMatch(/^dolt_/);
      expect(result.record?.fromTier).toBeDefined();
      expect(result.record?.toTier).toBe("staging");
    });

    it("should re-hydrate Golden Path after escalation", () => {
      const vpc = GOLDEN_PATH_REGISTRY.find(t => t.id === "standard-vpc")!;

      // Escalate to high-performance
      escalateViaIntent(
        "I need high-performance resources",
        "standard-vpc",
        "staging",
        "admin"
      );

      // Re-hydrate should reflect the override
      const { template, tierName } = hydrateGoldenPathCeiling(vpc, "staging");
      expect(tierName).toBe("High-Performance");
      expect(template.resourceCeiling.maxCpuMillicores).toBeGreaterThanOrEqual(16000);
    });
  });
});
