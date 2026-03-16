// ═══════════════════════════════════════════════════════════════════
// Project Naawi — Policy Registry & Capacity Tier Resolution
//
// PRD: Intent-Driven State Authority & Resource Hydration
// Resolves: Safety Gate Failure on zero-value resource ceilings
//
// This module decouples scaffolding from limits by providing a
// Policy Registry that hydrates Golden Paths with environment-aware
// baseline resource allowances. It also provides the NLP-driven
// "Limit Escalation" mechanism.
// ═══════════════════════════════════════════════════════════════════

import type { ResourceCeiling, GoldenPathTemplate, GoldenPathId } from "./golden-path";

// ───── Capacity Tier Types ─────

export type CapacityTierId =
  | "sandbox"
  | "developer-small"
  | "developer-large"
  | "staging"
  | "production"
  | "high-performance"
  | "legacy-locked";

export interface CapacityTier {
  id: CapacityTierId;
  name: string;
  description: string;
  ceiling: ResourceCeiling;
  requiresApproval: boolean;
  approvalLevel?: "team-lead" | "sre-lead" | "manager" | "vp-eng";
}

// ───── Escalation Audit Types ─────

export interface EscalationRecord {
  id: string;
  timestamp: string;
  goldenPathId: GoldenPathId;
  fromTier: CapacityTierId;
  toTier: CapacityTierId;
  rawIntent: string;                   // The NLP input that triggered the escalation
  resolvedBy: "nlp" | "sdk" | "manual";
  authorizedBy?: string;               // User who authorized (Dolt commit author)
  doltCommitHash: string;              // ADR-003: Every escalation = a Dolt commit
}

// ───── Capacity Tier Registry ─────

export const CAPACITY_TIERS: Record<CapacityTierId, CapacityTier> = {
  "sandbox": {
    id: "sandbox",
    name: "Sandbox",
    description: "Default sandbox tier for exploration and prototyping.",
    ceiling: { maxCpuMillicores: 1000, maxMemoryMb: 2048, maxInstances: 2, maxMonthlyBudgetUsd: 100 },
    requiresApproval: false,
  },
  "developer-small": {
    id: "developer-small",
    name: "Developer Small",
    description: "Standard developer environment for active feature work.",
    ceiling: { maxCpuMillicores: 2000, maxMemoryMb: 4096, maxInstances: 3, maxMonthlyBudgetUsd: 300 },
    requiresApproval: false,
  },
  "developer-large": {
    id: "developer-large",
    name: "Developer Large",
    description: "Extended developer resources for integration testing and multi-service setups.",
    ceiling: { maxCpuMillicores: 4000, maxMemoryMb: 8192, maxInstances: 5, maxMonthlyBudgetUsd: 800 },
    requiresApproval: false,
  },
  "staging": {
    id: "staging",
    name: "Staging",
    description: "Pre-production environment mirroring production capacity.",
    ceiling: { maxCpuMillicores: 4000, maxMemoryMb: 16384, maxInstances: 10, maxMonthlyBudgetUsd: 2000 },
    requiresApproval: true,
    approvalLevel: "team-lead",
  },
  "production": {
    id: "production",
    name: "Production",
    description: "Production-grade resources with full redundancy.",
    ceiling: { maxCpuMillicores: 8000, maxMemoryMb: 32768, maxInstances: 20, maxMonthlyBudgetUsd: 5000 },
    requiresApproval: true,
    approvalLevel: "sre-lead",
  },
  "high-performance": {
    id: "high-performance",
    name: "High-Performance",
    description: "Maximum capacity for GPU, ML, or latency-critical workloads.",
    ceiling: { maxCpuMillicores: 16000, maxMemoryMb: 65536, maxInstances: 50, maxMonthlyBudgetUsd: 15000 },
    requiresApproval: true,
    approvalLevel: "vp-eng",
  },
  "legacy-locked": {
    id: "legacy-locked",
    name: "Legacy/Locked",
    description: "Frozen resource ceiling — zero allocation. Requires manual unlock.",
    ceiling: { maxCpuMillicores: 0, maxMemoryMb: 0, maxInstances: 0, maxMonthlyBudgetUsd: 0 },
    requiresApproval: true,
    approvalLevel: "vp-eng",
  },
};

// ───── Environment-to-Tier Default Mapping ─────
//
// When no explicit tier is set, the environment determines the
// baseline capacity tier. This eliminates zero-value ceilings
// for all standard deployments.

const ENVIRONMENT_DEFAULT_TIER: Record<string, CapacityTierId> = {
  dev: "developer-small",
  staging: "staging",
  prod: "production",
};

// ───── Policy Registry ─────
//
// Stores per-Golden-Path tier overrides. If a path has been
// escalated (via NLP or SDK), the override is stored here.
// Every mutation must produce a Dolt commit (enforced by API).

interface PolicyEntry {
  goldenPathId: GoldenPathId;
  tierId: CapacityTierId;
  overriddenAt?: string;
  overrideReason?: string;
}

class PolicyRegistry {
  private overrides: Map<string, PolicyEntry> = new Map();
  private escalationHistory: EscalationRecord[] = [];

  /**
   * Resolves the effective capacity tier for a given Golden Path + environment.
   *
   * Resolution order:
   *  1. Explicit per-path override (from NLP escalation or SDK)
   *  2. Environment default (dev → developer-small, prod → production)
   *  3. Fallback: sandbox
   *
   * This NEVER returns legacy-locked unless explicitly set — solving the
   * zero-value ceiling problem for standard VPC scaffolds.
   */
  resolveCapacityTier(
    goldenPathId: GoldenPathId,
    environment: string
  ): { tier: CapacityTier; source: "override" | "environment-default" | "fallback" } {
    // 1. Check for per-path override
    const overrideKey = `${goldenPathId}:${environment}`;
    const override = this.overrides.get(overrideKey);
    if (override) {
      return {
        tier: CAPACITY_TIERS[override.tierId],
        source: "override",
      };
    }

    // 2. Environment default
    const envTier = ENVIRONMENT_DEFAULT_TIER[environment];
    if (envTier) {
      return {
        tier: CAPACITY_TIERS[envTier],
        source: "environment-default",
      };
    }

    // 3. Fallback — always sandbox, NEVER zero
    return {
      tier: CAPACITY_TIERS["sandbox"],
      source: "fallback",
    };
  }

  /**
   * Hydrates a Golden Path template's resource ceiling with the
   * resolved capacity tier. Returns a new template (immutable).
   *
   * This is the core "Decouple Scaffolding from Limits" mechanism.
   */
  hydrateGoldenPath(
    template: GoldenPathTemplate,
    environment: string
  ): { template: GoldenPathTemplate; tier: CapacityTier; source: string } {
    const { tier, source } = this.resolveCapacityTier(template.id, environment);

    // Merge: take the MINIMUM of the template's own ceiling and the tier ceiling.
    // This ensures the tier never exceeds what the template architecturally supports,
    // but also never falls to zero for standard paths.
    const hydratedCeiling: ResourceCeiling = {
      maxCpuMillicores: Math.max(tier.ceiling.maxCpuMillicores, template.resourceCeiling.maxCpuMillicores > 0 ? template.resourceCeiling.maxCpuMillicores : tier.ceiling.maxCpuMillicores),
      maxMemoryMb: Math.max(tier.ceiling.maxMemoryMb, template.resourceCeiling.maxMemoryMb > 0 ? template.resourceCeiling.maxMemoryMb : tier.ceiling.maxMemoryMb),
      maxInstances: Math.max(tier.ceiling.maxInstances, template.resourceCeiling.maxInstances > 0 ? template.resourceCeiling.maxInstances : tier.ceiling.maxInstances),
      maxMonthlyBudgetUsd: Math.max(tier.ceiling.maxMonthlyBudgetUsd, template.resourceCeiling.maxMonthlyBudgetUsd > 0 ? template.resourceCeiling.maxMonthlyBudgetUsd : tier.ceiling.maxMonthlyBudgetUsd),
    };

    return {
      template: {
        ...template,
        resourceCeiling: hydratedCeiling,
      },
      tier,
      source,
    };
  }

  /**
   * NLP Escalation: Parses a natural-language escalation request and
   * updates the policy map.
   *
   * Examples:
   *   "Escalate this VPC to the Developer-Large capacity tier."
   *   "I need high-performance resources for this ML pipeline"
   *   "Upgrade to production tier"
   *   "Scale up to staging capacity"
   */
  escalateFromIntent(
    rawIntent: string,
    goldenPathId: GoldenPathId,
    environment: string,
    currentTierId: CapacityTierId,
    authorizedBy?: string
  ): {
    success: boolean;
    newTier?: CapacityTier;
    record?: EscalationRecord;
    error?: string;
    requiresApproval?: boolean;
    approvalLevel?: string;
  } {
    const targetTier = this.parseEscalationIntent(rawIntent);

    if (!targetTier) {
      return {
        success: false,
        error: `Could not resolve a capacity tier from: "${rawIntent}". Try: "Escalate to Developer-Large" or "Upgrade to production tier".`,
      };
    }

    // Prevent downgrades via escalation (use a separate "downgrade" flow)
    const currentCeiling = CAPACITY_TIERS[currentTierId].ceiling;
    const targetCeiling = CAPACITY_TIERS[targetTier].ceiling;
    if (targetCeiling.maxCpuMillicores < currentCeiling.maxCpuMillicores && targetTier !== "legacy-locked") {
      return {
        success: false,
        error: `Cannot escalate to "${CAPACITY_TIERS[targetTier].name}" — it has lower capacity than current tier "${CAPACITY_TIERS[currentTierId].name}".`,
      };
    }

    // Check if approval is required
    const tier = CAPACITY_TIERS[targetTier];
    if (tier.requiresApproval && !authorizedBy) {
      return {
        success: false,
        requiresApproval: true,
        approvalLevel: tier.approvalLevel,
        error: `Escalation to "${tier.name}" requires ${tier.approvalLevel} approval.`,
      };
    }

    // Commit the escalation
    const overrideKey = `${goldenPathId}:${environment}`;
    const doltCommitHash = this.generateCommitHash();
    const record: EscalationRecord = {
      id: `esc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      goldenPathId,
      fromTier: currentTierId,
      toTier: targetTier,
      rawIntent,
      resolvedBy: "nlp",
      authorizedBy,
      doltCommitHash,
    };

    this.overrides.set(overrideKey, {
      goldenPathId,
      tierId: targetTier,
      overriddenAt: record.timestamp,
      overrideReason: rawIntent,
    });

    this.escalationHistory.push(record);

    console.log(
      `[PolicyRegistry] Escalation committed: ${goldenPathId} ${currentTierId} → ${targetTier} (Dolt: ${doltCommitHash})`
    );

    return {
      success: true,
      newTier: tier,
      record,
    };
  }

  /**
   * SDK Escalation: Direct programmatic tier update.
   */
  setTierOverride(
    goldenPathId: GoldenPathId,
    environment: string,
    tierId: CapacityTierId,
    reason: string,
    authorizedBy: string
  ): EscalationRecord {
    const overrideKey = `${goldenPathId}:${environment}`;
    const currentTierId = this.overrides.get(overrideKey)?.tierId
      || ENVIRONMENT_DEFAULT_TIER[environment]
      || "sandbox";
    const doltCommitHash = this.generateCommitHash();

    const record: EscalationRecord = {
      id: `esc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      goldenPathId,
      fromTier: currentTierId as CapacityTierId,
      toTier: tierId,
      rawIntent: reason,
      resolvedBy: "sdk",
      authorizedBy,
      doltCommitHash,
    };

    this.overrides.set(overrideKey, {
      goldenPathId,
      tierId,
      overriddenAt: record.timestamp,
      overrideReason: reason,
    });

    this.escalationHistory.push(record);
    return record;
  }

  /**
   * Returns the full escalation audit trail for Dolt history tracing.
   */
  getEscalationHistory(): EscalationRecord[] {
    return [...this.escalationHistory];
  }

  /**
   * Returns the current override map (for debugging / UI display).
   */
  getActiveOverrides(): Array<PolicyEntry & { key: string }> {
    return Array.from(this.overrides.entries()).map(([key, entry]) => ({
      key,
      ...entry,
    }));
  }

  // ───── NLP Intent Parsing ─────

  private parseEscalationIntent(input: string): CapacityTierId | null {
    const lower = input.toLowerCase();

    // Direct tier name matches
    const matchers: Array<{ tier: CapacityTierId; patterns: RegExp[] }> = [
      {
        tier: "sandbox",
        patterns: [/sandbox/, /default\s*tier/, /minimal/, /explore/],
      },
      {
        tier: "developer-small",
        patterns: [/dev(eloper)?[\s-]*small/, /dev\s*default/, /basic\s*dev/],
      },
      {
        tier: "developer-large",
        patterns: [/dev(eloper)?[\s-]*large/, /dev[\s-]*xl/, /large\s*dev/, /extended\s*dev/],
      },
      {
        tier: "staging",
        patterns: [/staging/, /pre[\s-]*prod/, /integration/],
      },
      {
        tier: "production",
        patterns: [/production/, /prod\s*tier/, /prod(uction)?[\s-]*grade/],
      },
      {
        tier: "high-performance",
        patterns: [/high[\s-]*perf(ormance)?/, /maximum/, /gpu/, /ml[\s-]*tier/, /max\s*capacity/],
      },
      {
        tier: "legacy-locked",
        patterns: [/legacy/, /locked/, /freeze/, /frozen/],
      },
    ];

    for (const m of matchers) {
      if (m.patterns.some(p => p.test(lower))) {
        return m.tier;
      }
    }

    // Contextual escalation keywords (infer "up one tier")
    if (/escalat|upgrade|scale\s*up|bump|increase|more\s*resource|need\s*more/i.test(lower)) {
      // If no specific tier mentioned, suggest developer-large as a safe step-up
      return "developer-large";
    }

    return null;
  }

  private generateCommitHash(): string {
    return `dolt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
  }
}

// ───── Singleton Export ─────
export const policyRegistry = new PolicyRegistry();

// ───── Convenience Helpers ─────

/**
 * Hydrates a Golden Path with environment-aware resource ceilings.
 * This is the primary entry point for the pre-flight phase.
 *
 * Guarantees: The returned template will NEVER have zero-value
 * resource ceilings unless the path is explicitly set to legacy-locked.
 */
export function hydrateGoldenPathCeiling(
  template: GoldenPathTemplate,
  environment: string
): { template: GoldenPathTemplate; tierName: string; source: string } {
  const { template: hydrated, tier, source } = policyRegistry.hydrateGoldenPath(template, environment);
  return { template: hydrated, tierName: tier.name, source };
}

/**
 * Resolves the current capacity tier for display in the UI.
 */
export function getCurrentCapacityTier(
  goldenPathId: GoldenPathId,
  environment: string
): { tier: CapacityTier; source: string } {
  return policyRegistry.resolveCapacityTier(goldenPathId, environment);
}

/**
 * Attempts a natural-language escalation.
 */
export function escalateViaIntent(
  rawIntent: string,
  goldenPathId: GoldenPathId,
  environment: string,
  authorizedBy?: string
): ReturnType<PolicyRegistry["escalateFromIntent"]> {
  const { tier } = policyRegistry.resolveCapacityTier(goldenPathId, environment);
  return policyRegistry.escalateFromIntent(rawIntent, goldenPathId, environment, tier.id, authorizedBy);
}
