/**
 * Infrastructure Dependency DAG
 * 
 * PRD §3.1: Enforces deployment order via Level 0 → Level 1 → Level 2 hierarchy.
 * Users cannot deploy higher-level resources without the foundation layer.
 */

export type DependencyLevel = 0 | 1 | 2;

export interface DependencyNode {
  resource: string;
  level: DependencyLevel;
  dependsOn: string[];   // resource IDs that must exist first
  category: "networking" | "iam" | "storage" | "database" | "compute" | "orchestration" | "edge" | "observability";
}

/**
 * AWS resource dependency graph — canonical mapping.
 * Level 0: Foundation (VPC, Subnets, IAM, SGs)
 * Level 1: Data/Services (RDS, DynamoDB, SQS, S3, etc.)
 * Level 2: Compute/Orchestration (EKS, ECS, Lambda, EC2 in orchestrated contexts)
 */
const AWS_DEPENDENCY_GRAPH: DependencyNode[] = [
  // ─── Level 0: Foundation ───
  { resource: "VPC",              level: 0, dependsOn: [],                    category: "networking" },
  { resource: "Subnets",          level: 0, dependsOn: ["VPC"],               category: "networking" },
  { resource: "Subnets (×4)",     level: 0, dependsOn: ["VPC"],               category: "networking" },
  { resource: "IGW",              level: 0, dependsOn: ["VPC"],               category: "networking" },
  { resource: "NAT-GW",          level: 0, dependsOn: ["Subnets"],           category: "networking" },
  { resource: "Route Tables",     level: 0, dependsOn: ["VPC", "IGW"],       category: "networking" },
  { resource: "Security Group",   level: 0, dependsOn: ["VPC"],               category: "networking" },
  { resource: "IAM Roles",        level: 0, dependsOn: [],                    category: "iam" },
  { resource: "IRSA",             level: 0, dependsOn: ["IAM Roles"],         category: "iam" },
  { resource: "VPC (dep)",        level: 0, dependsOn: [],                    category: "networking" },
  { resource: "VPC (zero-trust)", level: 0, dependsOn: [],                    category: "networking" },

  // ─── Level 1: Data & Services ───
  { resource: "RDS Aurora Serverless v2", level: 1, dependsOn: ["Subnets", "Security Group"], category: "database" },
  { resource: "RDS",              level: 1, dependsOn: ["Subnets", "Security Group"], category: "database" },
  { resource: "RDS Global",       level: 1, dependsOn: ["Subnets", "Security Group"], category: "database" },
  { resource: "DynamoDB",         level: 1, dependsOn: [],                    category: "database" },
  { resource: "DynamoDB Global Tables", level: 1, dependsOn: [],              category: "database" },
  { resource: "ElastiCache",      level: 1, dependsOn: ["Subnets"],           category: "database" },
  { resource: "SQS",              level: 1, dependsOn: [],                    category: "storage" },
  { resource: "DLQ",              level: 1, dependsOn: [],                    category: "storage" },
  { resource: "S3",               level: 1, dependsOn: [],                    category: "storage" },
  { resource: "S3 Origin",        level: 1, dependsOn: [],                    category: "storage" },
  { resource: "S3 Cross-Region",  level: 1, dependsOn: [],                    category: "storage" },
  { resource: "EBS",              level: 1, dependsOn: [],                    category: "storage" },
  { resource: "KMS",              level: 1, dependsOn: [],                    category: "storage" },
  { resource: "Secrets Manager",  level: 1, dependsOn: ["KMS"],              category: "storage" },
  { resource: "ACM",              level: 1, dependsOn: [],                    category: "edge" },
  { resource: "EventBridge",      level: 1, dependsOn: [],                    category: "storage" },
  { resource: "Cloud Map",        level: 1, dependsOn: ["VPC"],               category: "networking" },

  // ─── Level 2: Compute & Orchestration ───
  { resource: "EC2",              level: 2, dependsOn: ["Subnets", "Security Group"], category: "compute" },
  { resource: "EC2 (GPU)",        level: 2, dependsOn: ["Subnets", "Security Group"], category: "compute" },
  { resource: "EC2 (VPS Gateway)", level: 2, dependsOn: ["Security Group"],   category: "compute" },
  { resource: "EKS",              level: 2, dependsOn: ["Subnets", "Security Group", "IAM Roles"], category: "orchestration" },
  { resource: "Node Groups",      level: 2, dependsOn: ["EKS"],              category: "orchestration" },
  { resource: "ECS Fargate",      level: 2, dependsOn: ["Subnets", "Security Group"], category: "compute" },
  { resource: "Lambda",           level: 2, dependsOn: ["IAM Roles"],         category: "compute" },
  { resource: "ALB",              level: 2, dependsOn: ["Subnets", "Security Group"], category: "compute" },
  { resource: "ALB Ingress",      level: 2, dependsOn: ["EKS", "ALB"],       category: "compute" },
  { resource: "API Gateway",      level: 2, dependsOn: [],                    category: "compute" },
  { resource: "CloudFront",       level: 2, dependsOn: [],                    category: "edge" },
  { resource: "WAF",              level: 2, dependsOn: [],                    category: "edge" },
  { resource: "Route53 ARC",      level: 2, dependsOn: [],                    category: "edge" },
  { resource: "App Mesh",         level: 2, dependsOn: ["EKS"],              category: "orchestration" },
  { resource: "X-Ray",            level: 2, dependsOn: [],                    category: "observability" },
  { resource: "CloudWatch Logs",  level: 2, dependsOn: [],                    category: "observability" },
  { resource: "CloudWatch GPU Metrics", level: 2, dependsOn: [],              category: "observability" },
  { resource: "Spot Fleet",       level: 2, dependsOn: ["Subnets"],           category: "compute" },
  { resource: "EBS CSI",          level: 2, dependsOn: ["EKS"],              category: "orchestration" },
  { resource: "Event Source Mapping", level: 2, dependsOn: ["Lambda", "SQS"], category: "compute" },
];

// Normalize resource name for matching
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const GRAPH_INDEX = new Map<string, DependencyNode>();
AWS_DEPENDENCY_GRAPH.forEach(n => GRAPH_INDEX.set(normalize(n.resource), n));

/**
 * Look up a resource node in the dependency graph.
 */
export function findNode(resource: string): DependencyNode | null {
  return GRAPH_INDEX.get(normalize(resource)) ?? null;
}

/**
 * Given a list of resources for a Golden Path, returns them sorted by dependency level
 * with missing dependencies identified.
 */
export interface DependencyAnalysis {
  /** Resources sorted in execution order (level 0 → 1 → 2) */
  executionOrder: Array<{ resource: string; level: DependencyLevel; category: string }>;
  /** Dependencies required but not in the resource list */
  missingDependencies: Array<{ resource: string; level: DependencyLevel; requiredBy: string }>;
  /** Whether all Level 0 foundations are present */
  hasFoundation: boolean;
  /** Whether the path can proceed (no unresolvable missing deps) */
  canDeploy: boolean;
  /** Resources grouped by level */
  levels: Record<DependencyLevel, string[]>;
}

export function analyzeDependencies(resources: string[]): DependencyAnalysis {
  const normalizedSet = new Set(resources.map(normalize));
  const nodes: Array<{ resource: string; node: DependencyNode | null }> = resources.map(r => ({
    resource: r,
    node: findNode(r),
  }));

  const missing: DependencyAnalysis["missingDependencies"] = [];
  const seen = new Set<string>();

  // Check each resource's dependencies
  for (const { resource, node } of nodes) {
    if (!node) continue;
    for (const dep of node.dependsOn) {
      const depNorm = normalize(dep);
      // Use prefix match so "Subnets (×4)" satisfies a "Subnets" dependency
      const isSatisfied = [...normalizedSet].some(r => r.startsWith(depNorm));
      if (!isSatisfied && !seen.has(depNorm)) {
        const depNode = GRAPH_INDEX.get(depNorm);
        missing.push({
          resource: dep,
          level: depNode?.level ?? 0,
          requiredBy: resource,
        });
        seen.add(depNorm);
      }
    }
  }

  // Sort by level
  const sorted = [...nodes].sort((a, b) => {
    const la = a.node?.level ?? 0;
    const lb = b.node?.level ?? 0;
    return la - lb;
  });

  const levels: Record<DependencyLevel, string[]> = { 0: [], 1: [], 2: [] };
  for (const { resource, node } of sorted) {
    const level = node?.level ?? 0;
    levels[level].push(resource);
  }

  const hasFoundation = levels[0].length > 0 || resources.some(r => {
    const n = findNode(r);
    return n && n.level === 0;
  });

  // Can deploy if no critical missing deps (missing Level 0 blocks everything)
  const missingLevel0 = missing.filter(m => m.level === 0);
  const canDeploy = missingLevel0.length === 0;

  return {
    executionOrder: sorted.map(({ resource, node }) => ({
      resource,
      level: node?.level ?? 0,
      category: node?.category ?? "compute",
    })),
    missingDependencies: missing,
    hasFoundation,
    canDeploy,
    levels,
  };
}

/**
 * Returns remediation steps for missing dependencies.
 * PRD §3.3: Remediation must be executable actions, not simulated fixes.
 */
export function getRemediationSteps(analysis: DependencyAnalysis): Array<{
  resource: string;
  level: DependencyLevel;
  action: string;
  intent: string;
  priority: "critical" | "required" | "recommended";
}> {
  return analysis.missingDependencies
    .sort((a, b) => a.level - b.level)
    .map(dep => ({
      resource: dep.resource,
      level: dep.level,
      action: `deploy`,
      intent: dep.level === 0 ? "network" : "compute",
      priority: dep.level === 0 ? "critical" as const : "required" as const,
    }));
}
