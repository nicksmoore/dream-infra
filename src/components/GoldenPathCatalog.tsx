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
} from "lucide-react";

export type CloudProvider = "aws" | "gcp" | "azure";

export interface GoldenPathEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  providers: CloudProvider[];
  tier: "Classic" | "Hardened" | "AI-Ops";
  sloAvailability: number;
  estimatedDeployMin: number;
  estimatedMonthlyCost: string;
  resources: Record<CloudProvider, string[]>;
  jitScope: string[];
  tags: string[];
}

const CATALOG: GoldenPathEntry[] = [
  {
    id: "vpc-foundation",
    name: "VPC / Network Foundation",
    description: "Production-grade virtual network with tiered subnets, NAT, flow logs, and security groups.",
    icon: "🌐",
    providers: ["aws", "gcp", "azure"],
    tier: "Classic",
    sloAvailability: 99.99,
    estimatedDeployMin: 4,
    estimatedMonthlyCost: "$50–150",
    resources: {
      aws: ["VPC", "Subnets", "NAT-GW", "IGW", "Flow Logs", "NACLs"],
      gcp: ["VPC Network", "Subnets", "Cloud NAT", "Cloud Router", "Flow Logs"],
      azure: ["VNet", "Subnets", "NAT Gateway", "NSGs", "Flow Logs"],
    },
    jitScope: ["ec2:CreateVpc", "ec2:CreateSubnet", "ec2:CreateNatGateway"],
    tags: ["networking", "foundation", "multi-az"],
  },
  {
    id: "container-platform",
    name: "Container Platform (K8s)",
    description: "Managed Kubernetes with node pools, IRSA/Workload Identity, and ingress controller.",
    icon: "🐳",
    providers: ["aws", "gcp", "azure"],
    tier: "Classic",
    sloAvailability: 99.9,
    estimatedDeployMin: 15,
    estimatedMonthlyCost: "$200–800",
    resources: {
      aws: ["EKS", "Node Groups", "ALB Ingress", "IRSA", "EBS CSI"],
      gcp: ["GKE", "Node Pools", "Ingress", "Workload Identity", "PD CSI"],
      azure: ["AKS", "Node Pools", "AGIC", "Managed Identity", "Disk CSI"],
    },
    jitScope: ["eks:CreateCluster", "ec2:RunInstances", "iam:CreateRole"],
    tags: ["kubernetes", "containers", "compute"],
  },
  {
    id: "serverless-api",
    name: "Serverless API",
    description: "Functions + API Gateway + least-privilege IAM. Zero servers, auto-scaling by default.",
    icon: "⚡",
    providers: ["aws", "gcp", "azure"],
    tier: "Classic",
    sloAvailability: 99.9,
    estimatedDeployMin: 3,
    estimatedMonthlyCost: "$5–200",
    resources: {
      aws: ["Lambda", "API Gateway", "IAM Roles", "CloudWatch Logs"],
      gcp: ["Cloud Functions", "API Gateway", "IAM", "Cloud Logging"],
      azure: ["Azure Functions", "API Management", "Managed Identity", "App Insights"],
    },
    jitScope: ["lambda:CreateFunction", "apigateway:CreateRestApi"],
    tags: ["serverless", "api", "functions"],
  },
  {
    id: "static-cdn",
    name: "Static Site + CDN",
    description: "Object storage origin with global CDN, TLS, and origin shielding. Perfect for SPAs.",
    icon: "🚀",
    providers: ["aws", "gcp", "azure"],
    tier: "Classic",
    sloAvailability: 99.95,
    estimatedDeployMin: 5,
    estimatedMonthlyCost: "$10–100",
    resources: {
      aws: ["S3", "CloudFront", "ACM", "Route 53", "OAC"],
      gcp: ["Cloud Storage", "Cloud CDN", "Cloud Load Balancing", "SSL Cert"],
      azure: ["Blob Storage", "Azure CDN", "Front Door", "App Service Cert"],
    },
    jitScope: ["s3:CreateBucket", "cloudfront:CreateDistribution"],
    tags: ["static", "cdn", "spa", "frontend"],
  },
  {
    id: "three-tier-app",
    name: "Enterprise 3-Tier",
    description: "Load Balancer → Compute (ASG/MIG) → Managed DB + Cache. Multi-AZ by default.",
    icon: "🏗️",
    providers: ["aws", "gcp", "azure"],
    tier: "Classic",
    sloAvailability: 99.9,
    estimatedDeployMin: 12,
    estimatedMonthlyCost: "$300–2000",
    resources: {
      aws: ["ALB", "ASG", "RDS (Multi-AZ)", "ElastiCache", "VPC"],
      gcp: ["Cloud LB", "MIG", "Cloud SQL (HA)", "Memorystore", "VPC"],
      azure: ["App Gateway", "VMSS", "Azure SQL (HA)", "Azure Cache", "VNet"],
    },
    jitScope: ["rds:CreateDBInstance", "elasticache:CreateCacheCluster"],
    tags: ["enterprise", "database", "cache", "compute"],
  },
  {
    id: "event-pipeline",
    name: "Event-Driven Pipeline",
    description: "Message queue → Functions → Data store with DLQ, retries, and exactly-once semantics.",
    icon: "📨",
    providers: ["aws", "gcp", "azure"],
    tier: "Classic",
    sloAvailability: 99.9,
    estimatedDeployMin: 5,
    estimatedMonthlyCost: "$20–500",
    resources: {
      aws: ["SQS", "Lambda", "DynamoDB", "EventBridge", "DLQ"],
      gcp: ["Pub/Sub", "Cloud Functions", "Firestore", "Eventarc", "DLQ"],
      azure: ["Service Bus", "Azure Functions", "Cosmos DB", "Event Grid", "DLQ"],
    },
    jitScope: ["sqs:CreateQueue", "lambda:CreateFunction", "dynamodb:CreateTable"],
    tags: ["events", "async", "queue", "pipeline"],
  },
  {
    id: "fintech-pci",
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
    tags: ["compliance", "pci", "fintech", "zero-trust"],
  },
  {
    id: "service-mesh",
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
    tags: ["mesh", "mtls", "observability", "microservices"],
  },
  {
    id: "ml-training",
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
    tags: ["ml", "gpu", "training", "ai"],
  },
  {
    id: "disaster-recovery",
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
    tags: ["dr", "multi-region", "failover", "resilience"],
  },
];

const PROVIDER_LABELS: Record<CloudProvider, { label: string; color: string }> = {
  aws: { label: "AWS", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  gcp: { label: "GCP", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  azure: { label: "Azure", color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
};

const TIER_COLORS: Record<string, string> = {
  Classic: "border-primary/30 text-primary",
  Hardened: "border-amber-500/30 text-amber-400",
  "AI-Ops": "border-violet-500/30 text-violet-400",
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
            placeholder="Search golden paths…"
            className="pl-9 h-9 text-sm glass-panel border-border/50"
          />
        </div>
        <Tabs value={tierFilter} onValueChange={setTierFilter}>
          <TabsList className="glass-panel border-0 p-0.5 h-8">
            <TabsTrigger value="all" className="text-[10px] h-7 px-3 rounded-md">All</TabsTrigger>
            <TabsTrigger value="Classic" className="text-[10px] h-7 px-3 rounded-md">Classic</TabsTrigger>
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
            className="glass-panel border-border/40 hover:border-primary/40 transition-all group cursor-pointer"
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
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{entry.description}</p>
                  </div>
                </div>
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
