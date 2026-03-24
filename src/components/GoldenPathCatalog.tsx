import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  ChevronRight,
  Shield,
  Clock,
  DollarSign,
  Cloud,
  Layers,
  Lock,
  Eye,
  FileCheck,
} from "lucide-react";

export type CloudProvider = "aws" | "gcp" | "azure";

export interface PreflightStep {
  id: string;
  name: string;
  description: string;
}

export interface GoldenPathEntry {
  id: string;
  intentId: string; // PRD: naawi.gold.v1.* taxonomy
  name: string;
  description: string;
  icon: string;
  providers: CloudProvider[];
  tier: "Foundation" | "Standard" | "Hardened" | "AI-Ops";
  sloAvailability: number;
  estimatedDeployMin: number;
  estimatedMonthlyCost: string;
  resources: Record<CloudProvider, string[]>;
  jitScope: string[];
  jitTtl: string; // per-layer TTL range
  rmcmThreshold: number; // minimum coherence score
  preflightSteps: PreflightStep[];
  doltTables: string[]; // Dolt schema tables written
  tags: string[];
  status: "v1.0 — Specification complete" | "v1.0 — Planned (Phase 2)" | "v1.0 — Planned (Phase 3)";
}

const PREFLIGHT_STANDARD: PreflightStep[] = [
  { id: "P-1", name: "Parameter Validation", description: "Server-side validation. CIDR overlap check against Dolt." },
  { id: "P-2", name: "Dolt State Read", description: "RMCM queries existing resources. Zero AWS API calls." },
  { id: "P-3", name: "RMCM Dependency Graph", description: "Per-layer coherence scores. Environment thresholds." },
  { id: "P-4", name: "JIT Credential Pre-check", description: "STS AssumeRole capability check. No credentials vended." },
  { id: "P-5", name: "Dry-Run (Shared Closure)", description: "Structured diff via Patent §4.8 shared closure." },
  { id: "P-6", name: "PREFLIGHT_COMPLETE", description: "Overall coherence, cost delta, JIT TTL. ZTAI record." },
];

const CATALOG: GoldenPathEntry[] = [
  {
    id: "vpc-foundation",
    intentId: "naawi.gold.v1.VpcFoundation",
    name: "VPC Foundation",
    description: "VPC + Subnets + IGW + NAT GW + Route Tables + SG. Multi-AZ, JIT per-layer credentials. The dependency root for all subsequent Golden Paths.",
    icon: "🌐",
    providers: ["aws", "gcp", "azure"],
    tier: "Foundation",
    sloAvailability: 99.99,
    estimatedDeployMin: 4,
    estimatedMonthlyCost: "$50–150",
    resources: {
      aws: ["VPC", "Subnets (×4)", "IGW", "NAT-GW", "Route Tables", "Security Group"],
      gcp: ["VPC Network", "Subnets", "Cloud NAT", "Cloud Router", "Firewall Rules"],
      azure: ["VNet", "Subnets", "NAT Gateway", "NSGs", "Route Tables"],
    },
    jitScope: ["ec2:CreateVpc", "ec2:CreateSubnet", "ec2:CreateNatGateway", "ec2:CreateSecurityGroup"],
    jitTtl: "1–5 min per layer",
    rmcmThreshold: 95,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "vpc_attrs", "subnet_attrs", "nat_gateway_attrs", "security_group_attrs", "route_table_attrs", "resource_raw", "ztai_refs"],
    tags: ["networking", "foundation", "multi-az", "layer-0"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "web-standard",
    intentId: "naawi.gold.v1.WebStandard",
    name: "Web Standard",
    description: "ALB + ECS Fargate + RDS Aurora Serverless v2. Auto-scaling compute with managed database.",
    icon: "🏗️",
    providers: ["aws", "gcp", "azure"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 12,
    estimatedMonthlyCost: "$300–2000",
    resources: {
      aws: ["VPC (dep)", "Subnets (×4)", "Security Group", "RDS Aurora Serverless v2", "ALB", "ECS Fargate"],
      gcp: ["Cloud LB", "Cloud Run", "Cloud SQL (HA)", "VPC (dep)"],
      azure: ["App Gateway", "Container Apps", "Azure SQL (HA)", "VNet (dep)"],
    },
    jitScope: ["ecs:CreateService", "rds:CreateDBCluster", "elasticloadbalancing:CreateLoadBalancer"],
    jitTtl: "3–8 min per layer",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["web", "compute", "database", "standard"],
    status: "v1.0 — Planned (Phase 2)",
  },
  {
    id: "event-driven",
    intentId: "naawi.gold.v1.EventDriven",
    name: "Event-Driven Pipeline",
    description: "Lambda + SQS + DynamoDB. Serverless async with DLQ, retries, and exactly-once semantics.",
    icon: "📨",
    providers: ["aws", "gcp", "azure"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 5,
    estimatedMonthlyCost: "$20–500",
    resources: {
      aws: ["SQS", "Lambda", "DynamoDB", "EventBridge", "DLQ"],
      gcp: ["Pub/Sub", "Cloud Functions", "Firestore", "Eventarc", "DLQ"],
      azure: ["Service Bus", "Azure Functions", "Cosmos DB", "Event Grid", "DLQ"],
    },
    jitScope: ["sqs:CreateQueue", "lambda:CreateFunction", "dynamodb:CreateTable"],
    jitTtl: "2–5 min per layer",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["events", "async", "serverless", "pipeline"],
    status: "v1.0 — Planned (Phase 2)",
  },
  {
    id: "secure-edge",
    intentId: "naawi.gold.v1.SecureEdge",
    name: "Secure Edge",
    description: "CloudFront + WAF + Intent-based API Gateway. Global CDN with edge security and TLS.",
    icon: "🛡️",
    providers: ["aws", "gcp", "azure"],
    tier: "Hardened",
    sloAvailability: 99.95,
    estimatedDeployMin: 8,
    estimatedMonthlyCost: "$100–1000",
    resources: {
      aws: ["CloudFront", "WAF", "API Gateway", "ACM", "S3 Origin"],
      gcp: ["Cloud CDN", "Cloud Armor", "API Gateway", "SSL Cert", "GCS Origin"],
      azure: ["Front Door", "WAF Policy", "API Management", "App Service Cert"],
    },
    jitScope: ["cloudfront:CreateDistribution", "wafv2:CreateWebACL"],
    jitTtl: "3–6 min per layer",
    rmcmThreshold: 92,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["cdn", "waf", "edge", "security"],
    status: "v1.0 — Planned (Phase 2)",
  },
  {
    id: "container-platform",
    intentId: "naawi.gold.v1.ContainerPlatform",
    name: "Container Platform (K8s)",
    description: "Managed Kubernetes with node pools, IRSA/Workload Identity, and ingress controller.",
    icon: "🐳",
    providers: ["aws", "gcp", "azure"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 15,
    estimatedMonthlyCost: "$200–800",
    resources: {
      aws: ["EKS", "Node Groups", "ALB Ingress", "IRSA", "EBS CSI"],
      gcp: ["GKE", "Node Pools", "Ingress", "Workload Identity", "PD CSI"],
      azure: ["AKS", "Node Pools", "AGIC", "Managed Identity", "Disk CSI"],
    },
    jitScope: ["eks:CreateCluster", "ec2:RunInstances", "iam:CreateRole"],
    jitTtl: "5–15 min per layer",
    rmcmThreshold: 88,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["kubernetes", "containers", "compute"],
    status: "v1.0 — Planned (Phase 2)",
  },
  {
    id: "serverless-api",
    intentId: "naawi.gold.v1.ServerlessApi",
    name: "Serverless API",
    description: "Functions + API Gateway + least-privilege IAM. Zero servers, auto-scaling by default.",
    icon: "⚡",
    providers: ["aws", "gcp", "azure"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 3,
    estimatedMonthlyCost: "$5–200",
    resources: {
      aws: ["Lambda", "API Gateway", "IAM Roles", "CloudWatch Logs"],
      gcp: ["Cloud Functions", "API Gateway", "IAM", "Cloud Logging"],
      azure: ["Azure Functions", "API Management", "Managed Identity", "App Insights"],
    },
    jitScope: ["lambda:CreateFunction", "apigateway:CreateRestApi"],
    jitTtl: "2–4 min per layer",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["serverless", "api", "functions"],
    status: "v1.0 — Planned (Phase 2)",
  },
  {
    id: "fintech-pci",
    intentId: "naawi.gold.v1.FintechPci",
    name: "Fintech / PCI-DSS",
    description: "Payment-grade infra: Vault integration, mTLS, zero-trust network, encryption everywhere.",
    icon: "🏦",
    providers: ["aws", "gcp", "azure"],
    tier: "Hardened",
    sloAvailability: 99.99,
    estimatedDeployMin: 20,
    estimatedMonthlyCost: "$1000–5000",
    resources: {
      aws: ["EKS", "RDS", "KMS", "Secrets Manager", "VPC (zero-trust)", "WAF"],
      gcp: ["GKE", "Cloud SQL", "Cloud KMS", "Secret Manager", "VPC-SC"],
      azure: ["AKS", "Azure SQL", "Key Vault", "VNet (zero-trust)", "WAF"],
    },
    jitScope: ["kms:CreateKey", "secretsmanager:CreateSecret"],
    jitTtl: "3–10 min per layer",
    rmcmThreshold: 98,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["compliance", "pci", "fintech", "zero-trust"],
    status: "v1.0 — Planned (Phase 3)",
  },
  {
    id: "service-mesh",
    intentId: "naawi.gold.v1.ServiceMesh",
    name: "Service Mesh",
    description: "Managed mesh with mTLS, circuit breakers, retries, and distributed tracing.",
    icon: "🕸️",
    providers: ["aws", "gcp", "azure"],
    tier: "Hardened",
    sloAvailability: 99.9,
    estimatedDeployMin: 15,
    estimatedMonthlyCost: "$400–3000",
    resources: {
      aws: ["EKS", "App Mesh", "X-Ray", "ALB", "Cloud Map"],
      gcp: ["GKE", "Anthos Service Mesh", "Cloud Trace", "Cloud LB"],
      azure: ["AKS", "OSM / Istio", "App Insights", "App Gateway"],
    },
    jitScope: ["appmesh:CreateMesh", "eks:UpdateClusterConfig"],
    jitTtl: "5–12 min per layer",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["mesh", "mtls", "observability", "microservices"],
    status: "v1.0 — Planned (Phase 3)",
  },
  {
    id: "ml-training",
    intentId: "naawi.gold.v1.MlTraining",
    name: "ML Training Pipeline",
    description: "GPU compute with spot/preemptible instances, checkpointing, and cost guardrails.",
    icon: "🧠",
    providers: ["aws", "gcp", "azure"],
    tier: "AI-Ops",
    sloAvailability: 95.0,
    estimatedDeployMin: 10,
    estimatedMonthlyCost: "$500–10000",
    resources: {
      aws: ["EC2 (GPU)", "S3", "EBS", "CloudWatch GPU Metrics", "Spot Fleet"],
      gcp: ["Compute (GPU)", "GCS", "Persistent Disk", "Vertex AI", "Preemptible VMs"],
      azure: ["NC-series VMs", "Blob Storage", "Managed Disks", "Azure ML", "Spot VMs"],
    },
    jitScope: ["ec2:RunInstances", "s3:CreateBucket"],
    jitTtl: "5–15 min per layer",
    rmcmThreshold: 85,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["ml", "gpu", "training", "ai"],
    status: "v1.0 — Planned (Phase 3)",
  },
  {
    id: "disaster-recovery",
    intentId: "naawi.gold.v1.DisasterRecovery",
    name: "Multi-Region DR",
    description: "Active-passive replication with automated failover, RTO < 15min, RPO < 1min.",
    icon: "🛡️",
    providers: ["aws", "gcp", "azure"],
    tier: "Hardened",
    sloAvailability: 99.999,
    estimatedDeployMin: 25,
    estimatedMonthlyCost: "$2000–10000",
    resources: {
      aws: ["Route53 ARC", "RDS Global", "S3 Cross-Region", "EKS (multi-region)", "DynamoDB Global Tables"],
      gcp: ["Cloud DNS", "Cloud SQL (cross-region)", "GCS Dual-Region", "GKE Multi-Cluster"],
      azure: ["Traffic Manager", "Azure SQL Geo-Replication", "Blob Geo-Redundant", "AKS Fleet"],
    },
    jitScope: ["route53:CreateHealthCheck", "rds:CreateGlobalCluster"],
    jitTtl: "5–20 min per layer",
    rmcmThreshold: 98,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["dr", "multi-region", "failover", "resilience"],
    status: "v1.0 — Planned (Phase 3)",
  },
  {
    id: "openclaw-cloud",
    intentId: "naawi.gold.v1.OpenClawCloud",
    name: "OpenClaw Cloud Deployment (GP2)",
    description: "Production topology for always-on operation: Linux VPS gateway (systemd) + macOS node (OpenClaw.app) connected over Tailscale WebSocket. No public ports. Nix-managed, reproducible, agent-first.",
    icon: "🦞",
    providers: ["aws", "gcp", "azure"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 10,
    estimatedMonthlyCost: "$20–100",
    resources: {
      aws: ["EC2 (VPS Gateway)", "Tailscale Tailnet", "Nix Flake", "systemd Service", "OpenClaw.app Node"],
      gcp: ["Compute Engine (VPS Gateway)", "Tailscale Tailnet", "Nix Flake", "systemd Service", "OpenClaw.app Node"],
      azure: ["Linux VM (VPS Gateway)", "Tailscale Tailnet", "Nix Flake", "systemd Service", "OpenClaw.app Node"],
    },
    jitScope: ["ec2:RunInstances", "ec2:CreateSecurityGroup"],
    jitTtl: "3–8 min per layer",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["openclaw", "agent-first", "tailscale", "nix", "macos", "gateway"],
    status: "v1.0 — Specification complete",
  },
];

const PROVIDER_LABELS: Record<CloudProvider, { label: string; color: string }> = {
  aws: { label: "AWS", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  gcp: { label: "GCP", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  azure: { label: "Azure", color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
};

const TIER_COLORS: Record<string, string> = {
  Foundation: "border-primary/30 text-primary",
  Standard: "border-emerald-500/30 text-emerald-400",
  Hardened: "border-amber-500/30 text-amber-400",
  "AI-Ops": "border-violet-500/30 text-violet-400",
};

const STATUS_COLORS: Record<string, string> = {
  "v1.0 — Specification complete": "text-emerald-400",
  "v1.0 — Planned (Phase 2)": "text-amber-400",
  "v1.0 — Planned (Phase 3)": "text-muted-foreground",
};

interface GoldenPathCatalogProps {
  onSelect: (entry: GoldenPathEntry, provider: CloudProvider) => void;
}

export function GoldenPathCatalog({ onSelect }: GoldenPathCatalogProps) {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [providerFilter, setProviderFilter] = useState<CloudProvider | "all">("all");

  const filtered = CATALOG.filter((entry) => {
    if (tierFilter !== "all" && entry.tier !== tierFilter) return false;
    if (providerFilter !== "all" && !entry.providers.includes(providerFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.intentId.toLowerCase().includes(q) ||
        entry.tags.some((t) => t.includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search golden paths by name, intent ID, or tag…"
            className="pl-9 h-9 text-sm glass-panel border-border/50"
          />
        </div>
        <Tabs value={tierFilter} onValueChange={setTierFilter}>
          <TabsList className="glass-panel border-0 p-0.5 h-8">
            <TabsTrigger value="all" className="text-[10px] h-7 px-3 rounded-md">All</TabsTrigger>
            <TabsTrigger value="Foundation" className="text-[10px] h-7 px-3 rounded-md">Foundation</TabsTrigger>
            <TabsTrigger value="Standard" className="text-[10px] h-7 px-3 rounded-md">Standard</TabsTrigger>
            <TabsTrigger value="Hardened" className="text-[10px] h-7 px-3 rounded-md">Hardened</TabsTrigger>
            <TabsTrigger value="AI-Ops" className="text-[10px] h-7 px-3 rounded-md">AI-Ops</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={providerFilter} onValueChange={(v) => setProviderFilter(v as CloudProvider | "all")}>
          <TabsList className="glass-panel border-0 p-0.5 h-8">
            <TabsTrigger value="all" className="text-[10px] h-7 px-3 rounded-md">All</TabsTrigger>
            <TabsTrigger value="aws" className="text-[10px] h-7 px-3 rounded-md">AWS</TabsTrigger>
            <TabsTrigger value="gcp" className="text-[10px] h-7 px-3 rounded-md">GCP</TabsTrigger>
            <TabsTrigger value="azure" className="text-[10px] h-7 px-3 rounded-md">Azure</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((entry) => (
          <Card
            key={entry.id}
            className="glass-panel border-border/40 hover:border-primary/40 transition-all group"
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{entry.icon}</span>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-foreground">{entry.name}</span>
                      <Badge variant="outline" className={`text-[8px] uppercase tracking-widest ${TIER_COLORS[entry.tier]}`}>
                        {entry.tier}
                      </Badge>
                    </div>
                    <code className="text-[10px] font-mono text-primary/70 block mt-0.5">{entry.intentId}</code>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{entry.description}</p>
                  </div>
                </div>
              </div>

              {/* RMCM + JIT + Dolt indicators */}
              <div className="flex items-center gap-2 flex-wrap text-[9px]">
                <Badge variant="outline" className="gap-1 font-mono border-primary/20 text-primary">
                  <Eye className="h-2.5 w-2.5" /> RMCM ≥{entry.rmcmThreshold}%
                </Badge>
                <Badge variant="outline" className="gap-1 font-mono border-amber-500/20 text-amber-400">
                  <Lock className="h-2.5 w-2.5" /> JIT {entry.jitTtl}
                </Badge>
                <Badge variant="outline" className="gap-1 font-mono border-emerald-500/20 text-emerald-400">
                  <FileCheck className="h-2.5 w-2.5" /> {entry.doltTables.length} Dolt tables
                </Badge>
              </div>

              {/* Provider pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {entry.providers.map((p) => (
                  <Badge
                    key={p}
                    variant="outline"
                    className={`text-[9px] font-mono ${PROVIDER_LABELS[p].color}`}
                  >
                    {PROVIDER_LABELS[p].label}
                  </Badge>
                ))}
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3" /> {entry.sloAvailability}%
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> ~{entry.estimatedDeployMin}m
                </span>
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> {entry.estimatedMonthlyCost}
                </span>
                <span className={`ml-auto text-[9px] font-mono ${STATUS_COLORS[entry.status]}`}>
                  {entry.status}
                </span>
              </div>

              {/* Preflight summary */}
              <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                <span className="uppercase tracking-wider font-semibold">Preflight:</span>
                {entry.preflightSteps.map((step) => (
                  <Badge key={step.id} variant="secondary" className="text-[8px] font-mono px-1.5 py-0">
                    {step.id}
                  </Badge>
                ))}
              </div>

              {/* Deploy buttons per provider */}
              <div className="flex items-center gap-2 pt-1">
                {entry.providers.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant="outline"
                    className="flex-1 text-[10px] h-7 gap-1 hover:bg-primary/10 hover:text-primary hover:border-primary/40"
                    onClick={() => onSelect(entry, p)}
                  >
                    <Cloud className="h-3 w-3" />
                    Deploy → {PROVIDER_LABELS[p].label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Layers className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No golden paths match your filters.</p>
        </div>
      )}
    </div>
  );
}

export { CATALOG };
