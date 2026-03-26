/**
 * Infrastructure Dependency DAG — Multi-Cloud Edition
 *
 * PRD §3.1: Enforces deployment order via Level 0 → Level 1 → Level 2 hierarchy.
 * PRD §4.1: Each provider has an isolated graph. No shared mutable state.
 *
 * Extensibility: add a new provider by defining a constant array + one entry
 * in PROVIDER_GRAPHS. Zero changes to analyzeDependencies() required.
 */

export type DependencyLevel = 0 | 1 | 2;
export type Provider = "aws" | "oci" | "azure" | "gcp";

export interface DependencyNode {
  resource: string;
  level: DependencyLevel;
  dependsOn: string[];
  category: "networking" | "iam" | "storage" | "database" | "compute" | "orchestration" | "edge" | "observability";
}

export interface DependencyAnalysis {
  executionOrder: Array<{ resource: string; level: DependencyLevel; category: string }>;
  missingDependencies: Array<{ resource: string; level: DependencyLevel; requiredBy: string }>;
  hasFoundation: boolean;
  canDeploy: boolean;
  levels: Record<DependencyLevel, string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AWS
// ─────────────────────────────────────────────────────────────────────────────

const AWS_GRAPH: DependencyNode[] = [
  // L0 — Foundation
  { resource: "VPC",                    level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "VPC (dep)",              level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "VPC (zero-trust)",       level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "Subnets",                level: 0, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "Subnets (×4)",           level: 0, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "IGW",                    level: 0, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "NAT-GW",                 level: 0, dependsOn: ["Subnets"],                           category: "networking" },
  { resource: "Route Tables",           level: 0, dependsOn: ["VPC", "IGW"],                        category: "networking" },
  { resource: "Security Group",         level: 0, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "IAM Roles",              level: 0, dependsOn: [],                                    category: "iam" },
  { resource: "IRSA",                   level: 0, dependsOn: ["IAM Roles"],                         category: "iam" },
  { resource: "Tailscale Tailnet",      level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "Nix Flake",              level: 0, dependsOn: [],                                    category: "iam" },
  // L1 — Data & Services
  { resource: "RDS Aurora Serverless v2", level: 1, dependsOn: ["Subnets", "Security Group"],       category: "database" },
  { resource: "RDS",                    level: 1, dependsOn: ["Subnets", "Security Group"],         category: "database" },
  { resource: "RDS Global",             level: 1, dependsOn: ["Subnets", "Security Group"],         category: "database" },
  { resource: "DynamoDB",               level: 1, dependsOn: [],                                    category: "database" },
  { resource: "DynamoDB Global Tables", level: 1, dependsOn: [],                                    category: "database" },
  { resource: "ElastiCache",            level: 1, dependsOn: ["Subnets"],                           category: "database" },
  { resource: "SQS",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "DLQ",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "S3",                     level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "S3 Origin",              level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "S3 Cross-Region",        level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "EBS",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "KMS",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Secrets Manager",        level: 1, dependsOn: ["KMS"],                               category: "storage" },
  { resource: "ACM",                    level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "EventBridge",            level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Cloud Map",              level: 1, dependsOn: ["VPC"],                               category: "networking" },
  // L2 — Compute & Orchestration
  { resource: "EC2",                    level: 2, dependsOn: ["Subnets", "Security Group"],         category: "compute" },
  { resource: "EC2 (GPU)",              level: 2, dependsOn: ["Subnets", "Security Group"],         category: "compute" },
  { resource: "EC2 (VPS Gateway)",      level: 2, dependsOn: ["Tailscale Tailnet"],                 category: "compute" },
  { resource: "EKS",                    level: 2, dependsOn: ["Subnets", "Security Group", "IAM Roles"], category: "orchestration" },
  { resource: "Node Groups",            level: 2, dependsOn: ["EKS"],                               category: "orchestration" },
  { resource: "ECS Fargate",            level: 2, dependsOn: ["Subnets", "Security Group"],         category: "compute" },
  { resource: "Lambda",                 level: 2, dependsOn: ["IAM Roles"],                         category: "compute" },
  { resource: "ALB",                    level: 2, dependsOn: ["Subnets", "Security Group"],         category: "compute" },
  { resource: "ALB Ingress",            level: 2, dependsOn: ["EKS", "ALB"],                        category: "compute" },
  { resource: "API Gateway",            level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "CloudFront",             level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "WAF",                    level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "Route53 ARC",            level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "App Mesh",               level: 2, dependsOn: ["EKS"],                               category: "orchestration" },
  { resource: "X-Ray",                  level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "CloudWatch Logs",        level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "CloudWatch GPU Metrics", level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "Spot Fleet",             level: 2, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "EBS CSI",                level: 2, dependsOn: ["EKS"],                               category: "orchestration" },
  { resource: "Event Source Mapping",   level: 2, dependsOn: ["Lambda", "SQS"],                     category: "compute" },
  { resource: "systemd Service",        level: 1, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
  { resource: "OpenClaw.app Node",      level: 2, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
];

// ─────────────────────────────────────────────────────────────────────────────
// OCI
// ─────────────────────────────────────────────────────────────────────────────

const OCI_GRAPH: DependencyNode[] = [
  // L0 — Foundation
  { resource: "VCN",                    level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "VCN (dep)",              level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "VCN (zero-trust)",       level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "Subnets (×4)",           level: 0, dependsOn: ["VCN"],                               category: "networking" },
  { resource: "Subnets",                level: 0, dependsOn: ["VCN"],                               category: "networking" },
  { resource: "IGW",                    level: 0, dependsOn: ["VCN"],                               category: "networking" },
  { resource: "NAT Gateway",            level: 0, dependsOn: ["Subnets (×4)"],                      category: "networking" },
  { resource: "Route Tables",           level: 0, dependsOn: ["VCN", "IGW"],                        category: "networking" },
  { resource: "Security Lists",         level: 0, dependsOn: ["VCN"],                               category: "networking" },
  { resource: "NSG",                    level: 0, dependsOn: ["VCN"],                               category: "networking" },
  { resource: "NSGs",                   level: 0, dependsOn: ["VCN"],                               category: "networking" },
  { resource: "Dynamic Groups",         level: 0, dependsOn: [],                                    category: "iam" },
  { resource: "Tailscale Tailnet",      level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "Nix Flake",              level: 0, dependsOn: [],                                    category: "iam" },
  // L1 — Data & Services
  { resource: "Autonomous DB",          level: 1, dependsOn: ["Subnets (×4)", "NSG"],               category: "database" },
  { resource: "Autonomous DB (Data Guard)", level: 1, dependsOn: [],                                category: "database" },
  { resource: "NoSQL DB",               level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Queue",                  level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "DLQ",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Events",                 level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Vault (KMS)",            level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Secrets",                level: 1, dependsOn: ["Vault (KMS)"],                       category: "storage" },
  { resource: "Certificates",           level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "Object Storage",         level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Object Storage Origin",  level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Object Storage (Cross-Region)", level: 1, dependsOn: [],                             category: "storage" },
  { resource: "Block Volumes",          level: 1, dependsOn: [],                                    category: "storage" },
  // L2 — Compute & Orchestration
  { resource: "Load Balancer",          level: 2, dependsOn: ["Subnets (×4)", "NSG"],               category: "compute" },
  { resource: "Container Instances",    level: 2, dependsOn: ["Subnets (×4)", "NSG"],               category: "compute" },
  { resource: "OKE",                    level: 2, dependsOn: ["Subnets (×4)", "NSG", "Dynamic Groups"], category: "orchestration" },
  { resource: "Node Pools",             level: 2, dependsOn: ["OKE"],                               category: "orchestration" },
  { resource: "LB Ingress",             level: 2, dependsOn: ["OKE", "Load Balancer"],              category: "orchestration" },
  { resource: "Block Volume CSI",       level: 2, dependsOn: ["OKE"],                               category: "orchestration" },
  { resource: "Functions",              level: 2, dependsOn: ["Dynamic Groups"],                    category: "compute" },
  { resource: "API Gateway",            level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Logging",                level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "CDN",                    level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "WAF",                    level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "OCI Service Mesh",       level: 2, dependsOn: ["OKE"],                               category: "orchestration" },
  { resource: "APM",                    level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "GPU Compute",            level: 2, dependsOn: ["Subnets (×4)", "NSG"],               category: "compute" },
  { resource: "Data Science",           level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Preemptible VMs",        level: 2, dependsOn: ["Subnets (×4)"],                      category: "compute" },
  { resource: "DNS Traffic Steering",   level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "OKE Multi-Region",       level: 2, dependsOn: ["OKE"],                               category: "orchestration" },
  { resource: "Compute (VPS Gateway)",  level: 2, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
  { resource: "systemd Service",        level: 1, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
  { resource: "OpenClaw.app Node",      level: 2, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Azure
// ─────────────────────────────────────────────────────────────────────────────

const AZURE_GRAPH: DependencyNode[] = [
  // L0 — Foundation
  { resource: "VNet",                   level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "VNet (dep)",             level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "VNet (zero-trust)",      level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "Subnets",                level: 0, dependsOn: ["VNet"],                              category: "networking" },
  { resource: "NSGs",                   level: 0, dependsOn: ["VNet"],                              category: "networking" },
  { resource: "NSG",                    level: 0, dependsOn: ["VNet"],                              category: "networking" },
  { resource: "NAT Gateway",            level: 0, dependsOn: ["Subnets"],                           category: "networking" },
  { resource: "Route Tables",           level: 0, dependsOn: ["VNet"],                              category: "networking" },
  { resource: "Managed Identity",       level: 0, dependsOn: [],                                    category: "iam" },
  { resource: "Tailscale Tailnet",      level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "Nix Flake",              level: 0, dependsOn: [],                                    category: "iam" },
  // L1 — Data & Services
  { resource: "Azure SQL",              level: 1, dependsOn: ["Subnets"],                           category: "database" },
  { resource: "Azure SQL (HA)",         level: 1, dependsOn: ["Subnets"],                           category: "database" },
  { resource: "Azure SQL Geo-Replication", level: 1, dependsOn: [],                                 category: "database" },
  { resource: "Cosmos DB",              level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Service Bus",            level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "DLQ",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Event Grid",             level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Key Vault",              level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Blob Storage",           level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Blob Geo-Redundant",     level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Managed Disks",          level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "App Service Cert",       level: 1, dependsOn: [],                                    category: "edge" },
  // L2 — Compute & Orchestration
  { resource: "AKS",                    level: 2, dependsOn: ["Subnets", "NSGs", "Managed Identity"], category: "orchestration" },
  { resource: "Node Pools",             level: 2, dependsOn: ["AKS"],                               category: "orchestration" },
  { resource: "AGIC",                   level: 2, dependsOn: ["AKS"],                               category: "orchestration" },
  { resource: "Disk CSI",               level: 2, dependsOn: ["AKS"],                               category: "orchestration" },
  { resource: "Azure Functions",        level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "API Management",         level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "App Insights",           level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "Container Apps",         level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "App Gateway",            level: 2, dependsOn: ["Subnets", "NSGs"],                   category: "compute" },
  { resource: "Front Door",             level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "WAF Policy",             level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "WAF",                    level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "OSM / Istio",            level: 2, dependsOn: ["AKS"],                               category: "orchestration" },
  { resource: "NC-series VMs",          level: 2, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "Spot VMs",               level: 2, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "Azure ML",               level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Traffic Manager",        level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "AKS Fleet",              level: 2, dependsOn: ["AKS"],                               category: "orchestration" },
  { resource: "Linux VM (VPS Gateway)", level: 2, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
  { resource: "systemd Service",        level: 1, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
  { resource: "OpenClaw.app Node",      level: 2, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
];

// ─────────────────────────────────────────────────────────────────────────────
// GCP
// ─────────────────────────────────────────────────────────────────────────────

const GCP_GRAPH: DependencyNode[] = [
  // L0 — Foundation
  { resource: "VPC Network",            level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "VPC (dep)",              level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "VPC-SC",                 level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "Subnets",                level: 0, dependsOn: ["VPC Network"],                       category: "networking" },
  { resource: "Cloud Router",           level: 0, dependsOn: ["VPC Network"],                       category: "networking" },
  { resource: "Cloud NAT",              level: 0, dependsOn: ["Cloud Router"],                      category: "networking" },
  { resource: "Firewall Rules",         level: 0, dependsOn: ["VPC Network"],                       category: "networking" },
  { resource: "IAM",                    level: 0, dependsOn: [],                                    category: "iam" },
  { resource: "Workload Identity",      level: 0, dependsOn: [],                                    category: "iam" },
  { resource: "Tailscale Tailnet",      level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "Nix Flake",              level: 0, dependsOn: [],                                    category: "iam" },
  // L1 — Data & Services
  { resource: "Cloud SQL",              level: 1, dependsOn: ["Subnets"],                           category: "database" },
  { resource: "Cloud SQL (HA)",         level: 1, dependsOn: ["Subnets"],                           category: "database" },
  { resource: "Cloud SQL (cross-region)", level: 1, dependsOn: [],                                  category: "database" },
  { resource: "Firestore",              level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Pub/Sub",                level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "DLQ",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Eventarc",               level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Cloud KMS",              level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Secret Manager",         level: 1, dependsOn: ["Cloud KMS"],                         category: "storage" },
  { resource: "GCS",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "GCS Origin",             level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "GCS Dual-Region",        level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "SSL Cert",               level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "Persistent Disk",        level: 1, dependsOn: [],                                    category: "storage" },
  // L2 — Compute & Orchestration
  { resource: "Cloud Run",              level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Cloud LB",               level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Cloud CDN",              level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "Cloud Armor",            level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "API Gateway",            level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Cloud Functions",        level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Cloud Logging",          level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "GKE",                    level: 2, dependsOn: ["Subnets", "Workload Identity"],      category: "orchestration" },
  { resource: "Node Pools",             level: 2, dependsOn: ["GKE"],                               category: "orchestration" },
  { resource: "Ingress",                level: 2, dependsOn: ["GKE"],                               category: "orchestration" },
  { resource: "PD CSI",                 level: 2, dependsOn: ["GKE"],                               category: "orchestration" },
  { resource: "Anthos Service Mesh",    level: 2, dependsOn: ["GKE"],                               category: "orchestration" },
  { resource: "Cloud Trace",            level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "Vertex AI",              level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Compute (GPU)",          level: 2, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "Preemptible VMs",        level: 2, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "Cloud DNS",              level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "GKE Multi-Cluster",      level: 2, dependsOn: ["GKE"],                               category: "orchestration" },
  { resource: "Compute Engine (VPS Gateway)", level: 2, dependsOn: ["Tailscale Tailnet"],            category: "compute" },
  { resource: "systemd Service",        level: 1, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
  { resource: "OpenClaw.app Node",      level: 2, dependsOn: ["Tailscale Tailnet"],                  category: "compute" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Index builder — scoped per-provider, no cross-provider pollution
// ─────────────────────────────────────────────────────────────────────────────

function buildIndex(graph: DependencyNode[]): Map<string, DependencyNode> {
  const index = new Map<string, DependencyNode>();
  graph.forEach(n => index.set(normalize(n.resource), n));
  return index;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const AWS_INDEX   = buildIndex(AWS_GRAPH);
const OCI_INDEX   = buildIndex(OCI_GRAPH);
const AZURE_INDEX = buildIndex(AZURE_GRAPH);
const GCP_INDEX   = buildIndex(GCP_GRAPH);

/** PRD §4.1: Single dispatch point — no if/else in the analyzer. */
const PROVIDER_GRAPHS = new Map<Provider, Map<string, DependencyNode>>([
  ["aws",   AWS_INDEX],
  ["oci",   OCI_INDEX],
  ["azure", AZURE_INDEX],
  ["gcp",   GCP_INDEX],
]);

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Look up a resource node for the given provider. */
export function findNode(resource: string, provider: Provider = "aws"): DependencyNode | null {
  const index = PROVIDER_GRAPHS.get(provider) ?? AWS_INDEX;
  return index.get(normalize(resource)) ?? null;
}

/**
 * Analyze a resource list for the given provider.
 * Returns execution order, missing deps, and a canDeploy flag.
 * PRD §4.3: Lookup is scoped strictly to the active provider's graph —
 * no cross-provider key collisions possible.
 */
export function analyzeDependencies(resources: string[], provider: Provider = "aws"): DependencyAnalysis {
  const graphIndex = PROVIDER_GRAPHS.get(provider) ?? AWS_INDEX;
  const normalizedSet = new Set(resources.map(normalize));

  const nodes = resources.map(r => ({ resource: r, node: graphIndex.get(normalize(r)) ?? null }));

  const missing: DependencyAnalysis["missingDependencies"] = [];
  const seen = new Set<string>();

  for (const { resource, node } of nodes) {
    if (!node) continue;
    for (const dep of node.dependsOn) {
      const depNorm = normalize(dep);
      // Prefix match: "Subnets (×4)" satisfies a "Subnets" dependency
      const isSatisfied = [...normalizedSet].some(r => r.startsWith(depNorm));
      if (!isSatisfied && !seen.has(depNorm)) {
        const depNode = graphIndex.get(depNorm);
        missing.push({ resource: dep, level: depNode?.level ?? 0, requiredBy: resource });
        seen.add(depNorm);
      }
    }
  }

  const sorted = [...nodes].sort((a, b) => (a.node?.level ?? 0) - (b.node?.level ?? 0));

  const levels: Record<DependencyLevel, string[]> = { 0: [], 1: [], 2: [] };
  for (const { resource, node } of sorted) {
    levels[node?.level ?? 0].push(resource);
  }

  const hasFoundation = levels[0].length > 0;
  const canDeploy = missing.filter(m => m.level === 0).length === 0;

  return {
    executionOrder: sorted.map(({ resource, node }) => ({
      resource,
      level: (node?.level ?? 0) as DependencyLevel,
      category: node?.category ?? "compute",
    })),
    missingDependencies: missing,
    hasFoundation,
    canDeploy,
    levels,
  };
}

/**
 * Returns executable remediation steps for missing dependencies.
 * PRD §3.3: Actions, not simulated fixes.
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
      action: "deploy",
      intent: dep.level === 0 ? "network" : "compute",
      priority: dep.level === 0 ? "critical" as const : "required" as const,
    }));
}
