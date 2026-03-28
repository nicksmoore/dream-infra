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

export type CloudProvider = "aws" | "gcp" | "azure" | "oci";

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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Foundation",
    sloAvailability: 99.99,
    estimatedDeployMin: 4,
    estimatedMonthlyCost: "$50–150",
    resources: {
      aws: ["VPC", "Subnets (×4)", "IGW", "NAT-GW", "Route Tables", "Security Group"],
      gcp: ["VPC Network", "Subnets", "Cloud NAT", "Cloud Router", "Firewall Rules"],
      azure: ["VNet", "Subnets", "NAT Gateway", "NSGs", "Route Tables"],
      oci: ["VCN", "Subnets (×4)", "IGW", "NAT Gateway", "Route Tables", "Security Lists"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 12,
    estimatedMonthlyCost: "$300–2000",
    resources: {
      aws: ["VPC (dep)", "Subnets (×4)", "Security Group", "RDS Aurora Serverless v2", "ALB", "ECS Fargate"],
      gcp: ["Cloud LB", "Cloud Run", "Cloud SQL (HA)", "VPC (dep)"],
      azure: ["App Gateway", "Container Apps", "Azure SQL (HA)", "VNet (dep)"],
      oci: ["VCN (dep)", "Subnets (×4)", "NSG", "Autonomous DB", "Load Balancer", "Container Instances"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 5,
    estimatedMonthlyCost: "$20–500",
    resources: {
      aws: ["IAM Roles", "SQS", "DLQ", "DynamoDB", "EventBridge", "Lambda"],
      gcp: ["Pub/Sub", "Cloud Functions", "Firestore", "Eventarc", "DLQ"],
      azure: ["Service Bus", "Azure Functions", "Cosmos DB", "Event Grid", "DLQ"],
      oci: ["Dynamic Groups", "Queue", "DLQ", "NoSQL DB", "Events", "Functions"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Hardened",
    sloAvailability: 99.95,
    estimatedDeployMin: 8,
    estimatedMonthlyCost: "$100–1000",
    resources: {
      aws: ["CloudFront", "WAF", "API Gateway", "ACM", "S3 Origin"],
      gcp: ["Cloud CDN", "Cloud Armor", "API Gateway", "SSL Cert", "GCS Origin"],
      azure: ["Front Door", "WAF Policy", "API Management", "App Service Cert"],
      oci: ["CDN", "WAF", "API Gateway", "Certificates", "Object Storage Origin"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 15,
    estimatedMonthlyCost: "$200–800",
    resources: {
      aws: ["VPC (dep)", "Subnets (×4)", "Security Group", "IAM Roles", "IRSA", "ALB", "EKS", "Node Groups", "ALB Ingress", "EBS CSI"],
      gcp: ["GKE", "Node Pools", "Ingress", "Workload Identity", "PD CSI"],
      azure: ["AKS", "Node Pools", "AGIC", "Managed Identity", "Disk CSI"],
      oci: ["VCN (dep)", "Subnets (×4)", "NSG", "Dynamic Groups", "OKE", "Node Pools", "LB Ingress", "Block Volume CSI"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 3,
    estimatedMonthlyCost: "$5–200",
    resources: {
      aws: ["Lambda", "API Gateway", "IAM Roles", "CloudWatch Logs"],
      gcp: ["Cloud Functions", "API Gateway", "IAM", "Cloud Logging"],
      azure: ["Azure Functions", "API Management", "Managed Identity", "App Insights"],
      oci: ["Functions", "API Gateway", "Dynamic Groups", "Logging"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Hardened",
    sloAvailability: 99.99,
    estimatedDeployMin: 20,
    estimatedMonthlyCost: "$1000–5000",
    resources: {
      aws: ["VPC (zero-trust)", "Subnets (×4)", "Security Group", "IAM Roles", "KMS", "Secrets Manager", "RDS", "EKS", "WAF"],
      gcp: ["GKE", "Cloud SQL", "Cloud KMS", "Secret Manager", "VPC-SC"],
      azure: ["AKS", "Azure SQL", "Key Vault", "VNet (zero-trust)", "WAF"],
      oci: ["OKE", "Autonomous DB", "Vault (KMS)", "Secrets", "VCN (zero-trust)", "WAF"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Hardened",
    sloAvailability: 99.9,
    estimatedDeployMin: 15,
    estimatedMonthlyCost: "$400–3000",
    resources: {
      aws: ["VPC (dep)", "Subnets (×4)", "Security Group", "IAM Roles", "Cloud Map", "X-Ray", "ALB", "EKS", "App Mesh"],
      gcp: ["GKE", "Anthos Service Mesh", "Cloud Trace", "Cloud LB"],
      azure: ["AKS", "OSM / Istio", "App Insights", "App Gateway"],
      oci: ["OKE", "OCI Service Mesh", "APM", "Load Balancer"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "AI-Ops",
    sloAvailability: 95.0,
    estimatedDeployMin: 10,
    estimatedMonthlyCost: "$500–10000",
    resources: {
      aws: ["VPC (dep)", "Subnets (×4)", "Security Group", "S3", "EBS", "EC2 (GPU)", "Spot Fleet", "CloudWatch GPU Metrics"],
      gcp: ["Compute (GPU)", "GCS", "Persistent Disk", "Vertex AI", "Preemptible VMs"],
      azure: ["NC-series VMs", "Blob Storage", "Managed Disks", "Azure ML", "Spot VMs"],
      oci: ["GPU Compute", "Object Storage", "Block Volumes", "Data Science", "Preemptible VMs"],
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
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Hardened",
    sloAvailability: 99.999,
    estimatedDeployMin: 25,
    estimatedMonthlyCost: "$2000–10000",
    resources: {
      aws: ["VPC (dep)", "Subnets (×4)", "Security Group", "IAM Roles", "RDS Global", "S3 Cross-Region", "DynamoDB Global Tables", "Route53 ARC", "EKS"],
      gcp: ["Cloud DNS", "Cloud SQL (cross-region)", "GCS Dual-Region", "GKE Multi-Cluster"],
      azure: ["Traffic Manager", "Azure SQL Geo-Replication", "Blob Geo-Redundant", "AKS Fleet"],
      oci: ["DNS Traffic Steering", "Autonomous DB (Data Guard)", "Object Storage (Cross-Region)", "OKE Multi-Region"],
    },
    jitScope: ["route53:CreateHealthCheck", "rds:CreateGlobalCluster"],
    jitTtl: "5–20 min per layer",
    rmcmThreshold: 98,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["dr", "multi-region", "failover", "resilience"],
    status: "v1.0 — Planned (Phase 3)",
  },
  // ── V3 Intent Golden Paths (AWS) ─────────────────────────────────────────────

  {
    id: "storage",
    intentId: "naawi.v3.storage",
    name: "Storage",
    description: "S3 buckets, EFS filesystems, and EBS volumes. Deploy with versioning, object lock, or encryption; discover, destroy, and check status.",
    icon: "🗂️",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.99,
    estimatedDeployMin: 1,
    estimatedMonthlyCost: "$5–500",
    resources: { aws: ["S3 Bucket", "EFS Filesystem", "EBS Volume"], gcp: [], azure: [], oci: [] },
    jitScope: ["s3:CreateBucket", "elasticfilesystem:CreateFileSystem", "ec2:CreateVolume"],
    jitTtl: "1–2 min",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["storage", "s3", "efs", "ebs"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "database",
    intentId: "naawi.v3.database",
    name: "Database",
    description: "RDS (Postgres/MySQL), DynamoDB tables, and ElastiCache Redis. Full deploy/discover/destroy/status lifecycle.",
    icon: "🛢️",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 8,
    estimatedMonthlyCost: "$50–2000",
    resources: { aws: ["RDS Instance", "DynamoDB Table", "ElastiCache Replication Group"], gcp: [], azure: [], oci: [] },
    jitScope: ["rds:CreateDBInstance", "dynamodb:CreateTable", "elasticache:CreateReplicationGroup"],
    jitTtl: "3–10 min",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["database", "rds", "dynamodb", "elasticache"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "serverless",
    intentId: "naawi.v3.serverless",
    name: "Serverless",
    description: "Lambda functions and App Runner services. Deploy from S3 or ECR, list, delete, and check configuration.",
    icon: "⚙️",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 2,
    estimatedMonthlyCost: "$5–500",
    resources: { aws: ["Lambda Function", "App Runner Service"], gcp: [], azure: [], oci: [] },
    jitScope: ["lambda:CreateFunction", "apprunner:CreateService"],
    jitTtl: "1–3 min",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["serverless", "lambda", "apprunner", "functions"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "cdn",
    intentId: "naawi.v3.cdn",
    name: "CDN",
    description: "CloudFront distributions. Create with custom origin, list all distributions, delete, or check deployment status.",
    icon: "🌍",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.95,
    estimatedDeployMin: 5,
    estimatedMonthlyCost: "$20–500",
    resources: { aws: ["CloudFront Distribution"], gcp: [], azure: [], oci: [] },
    jitScope: ["cloudfront:CreateDistribution", "cloudfront:DeleteDistribution"],
    jitTtl: "2–5 min",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["cdn", "cloudfront", "edge"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "dns",
    intentId: "naawi.v3.dns",
    name: "DNS",
    description: "Route 53 hosted zones. Create zones, list all, delete, or fetch zone details.",
    icon: "📡",
    providers: ["aws"],
    tier: "Foundation",
    sloAvailability: 99.99,
    estimatedDeployMin: 1,
    estimatedMonthlyCost: "$1–50",
    resources: { aws: ["Route 53 Hosted Zone"], gcp: [], azure: [], oci: [] },
    jitScope: ["route53:CreateHostedZone", "route53:DeleteHostedZone"],
    jitTtl: "1–2 min",
    rmcmThreshold: 92,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["dns", "route53", "networking"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "loadbalancer",
    intentId: "naawi.v3.loadbalancer",
    name: "Load Balancer",
    description: "Application and Network Load Balancers. Create with subnet config, list, delete by ARN, or check state.",
    icon: "⚖️",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.99,
    estimatedDeployMin: 3,
    estimatedMonthlyCost: "$20–200",
    resources: { aws: ["ALB / NLB"], gcp: [], azure: [], oci: [] },
    jitScope: ["elasticloadbalancing:CreateLoadBalancer", "elasticloadbalancing:DeleteLoadBalancer"],
    jitTtl: "2–4 min",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["loadbalancer", "alb", "nlb", "networking"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "security",
    intentId: "naawi.v3.security",
    name: "Security",
    description: "IAM roles, WAF Web ACLs, GuardDuty detectors, Security Hub, CloudTrail trails, and AWS Config recorders.",
    icon: "🛡️",
    providers: ["aws"],
    tier: "Hardened",
    sloAvailability: 99.99,
    estimatedDeployMin: 3,
    estimatedMonthlyCost: "$10–500",
    resources: { aws: ["IAM Role", "WAF Web ACL", "GuardDuty Detector", "Security Hub", "CloudTrail Trail", "Config Recorder"], gcp: [], azure: [], oci: [] },
    jitScope: ["iam:CreateRole", "wafv2:CreateWebACL", "guardduty:CreateDetector", "securityhub:EnableSecurityHub"],
    jitTtl: "1–5 min",
    rmcmThreshold: 98,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["security", "iam", "waf", "guardduty", "compliance"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "gateway",
    intentId: "naawi.v3.gateway",
    name: "Gateway",
    description: "API Gateway (HTTP APIs) and VPC Interface Endpoints. Create, list, delete, or describe.",
    icon: "🚪",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 2,
    estimatedMonthlyCost: "$10–300",
    resources: { aws: ["API Gateway (HTTP)", "VPC Interface Endpoint"], gcp: [], azure: [], oci: [] },
    jitScope: ["apigateway:POST", "ec2:CreateVpcEndpoint"],
    jitTtl: "1–3 min",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["gateway", "apigateway", "vpc-endpoint"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "secrets",
    intentId: "naawi.v3.secrets",
    name: "Secrets",
    description: "Secrets Manager secrets and KMS keys. Create, list, delete with recovery window, or describe.",
    icon: "🔐",
    providers: ["aws"],
    tier: "Hardened",
    sloAvailability: 99.99,
    estimatedDeployMin: 1,
    estimatedMonthlyCost: "$5–100",
    resources: { aws: ["Secrets Manager Secret", "KMS CMK"], gcp: [], azure: [], oci: [] },
    jitScope: ["secretsmanager:CreateSecret", "kms:CreateKey"],
    jitTtl: "1–2 min",
    rmcmThreshold: 98,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["secrets", "kms", "encryption", "security"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "observability",
    intentId: "naawi.v3.observability",
    name: "Observability",
    description: "CloudWatch alarms and log groups. Create alarms with thresholds, manage log groups with retention, list, delete, or check state.",
    icon: "📊",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 1,
    estimatedMonthlyCost: "$5–200",
    resources: { aws: ["CloudWatch Alarm", "CloudWatch Log Group"], gcp: [], azure: [], oci: [] },
    jitScope: ["cloudwatch:PutMetricAlarm", "logs:CreateLogGroup"],
    jitTtl: "1–2 min",
    rmcmThreshold: 88,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["observability", "cloudwatch", "alarms", "logs"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "orchestration",
    intentId: "naawi.v3.orchestration",
    name: "Orchestration",
    description: "Step Functions state machines, EventBridge event buses, and SSM Parameter Store. Full lifecycle management.",
    icon: "🎼",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 2,
    estimatedMonthlyCost: "$5–200",
    resources: { aws: ["Step Functions State Machine", "EventBridge Bus", "SSM Parameter"], gcp: [], azure: [], oci: [] },
    jitScope: ["states:CreateStateMachine", "events:CreateEventBus", "ssm:PutParameter"],
    jitTtl: "1–3 min",
    rmcmThreshold: 88,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["orchestration", "stepfunctions", "eventbridge", "ssm"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "ai",
    intentId: "naawi.v3.ai",
    name: "AI / ML",
    description: "Amazon Bedrock foundation model access and provisioned throughput. List models, provision capacity, or check status.",
    icon: "🤖",
    providers: ["aws"],
    tier: "AI-Ops",
    sloAvailability: 99.9,
    estimatedDeployMin: 5,
    estimatedMonthlyCost: "$100–10000",
    resources: { aws: ["Bedrock Provisioned Throughput", "Foundation Models"], gcp: [], azure: [], oci: [] },
    jitScope: ["bedrock:CreateProvisionedModelThroughput", "bedrock:ListFoundationModels"],
    jitTtl: "3–10 min",
    rmcmThreshold: 85,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["ai", "bedrock", "ml", "foundation-models"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "container",
    intentId: "naawi.v3.container",
    name: "Container",
    description: "ECS Fargate clusters with Container Insights. Create, list, delete by ARN, or describe cluster state.",
    icon: "📦",
    providers: ["aws"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 3,
    estimatedMonthlyCost: "$50–2000",
    resources: { aws: ["ECS Fargate Cluster"], gcp: [], azure: [], oci: [] },
    jitScope: ["ecs:CreateCluster", "ecs:DeleteCluster"],
    jitTtl: "2–5 min",
    rmcmThreshold: 90,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["container", "ecs", "fargate"],
    status: "v1.0 — Specification complete",
  },
  {
    id: "gap-analysis",
    intentId: "naawi.v3.gap-analysis",
    name: "Gap Analysis",
    description: "Audit and clean up orphaned resources: unused Elastic IPs, unattached EBS volumes, open security groups, dangling Route 53 records, and stale snapshots.",
    icon: "🔍",
    providers: ["aws"],
    tier: "Foundation",
    sloAvailability: 99.9,
    estimatedDeployMin: 1,
    estimatedMonthlyCost: "$0",
    resources: { aws: ["Elastic IP", "EBS Snapshot", "Security Group", "EBS Volume", "Route 53 Record"], gcp: [], azure: [], oci: [] },
    jitScope: ["ec2:DescribeAddresses", "ec2:DescribeSnapshots", "ec2:DescribeVolumes", "ec2:ReleaseAddress"],
    jitTtl: "1–2 min",
    rmcmThreshold: 85,
    preflightSteps: PREFLIGHT_STANDARD,
    doltTables: ["resources", "resource_raw", "ztai_refs"],
    tags: ["gap-analysis", "audit", "cleanup", "cost-optimization"],
    status: "v1.0 — Specification complete",
  },

  {
    id: "openclaw-cloud",
    intentId: "naawi.gold.v1.OpenClawCloud",
    name: "OpenClaw Cloud Deployment (GP2)",
    description: "Production topology for always-on operation: Linux VPS gateway (systemd) + macOS node (OpenClaw.app) connected over Tailscale WebSocket. No public ports. Nix-managed, reproducible, agent-first.",
    icon: "🦞",
    providers: ["aws", "gcp", "azure", "oci"],
    tier: "Standard",
    sloAvailability: 99.9,
    estimatedDeployMin: 10,
    estimatedMonthlyCost: "$20–100",
    resources: {
      aws: ["EC2 (VPS Gateway)", "Tailscale Tailnet", "Nix Flake", "systemd Service", "OpenClaw.app Node"],
      gcp: ["Compute Engine (VPS Gateway)", "Tailscale Tailnet", "Nix Flake", "systemd Service", "OpenClaw.app Node"],
      azure: ["Linux VM (VPS Gateway)", "Tailscale Tailnet", "Nix Flake", "systemd Service", "OpenClaw.app Node"],
      oci: ["Compute (VPS Gateway)", "Tailscale Tailnet", "Nix Flake", "systemd Service", "OpenClaw.app Node"],
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
  oci: { label: "OCI", color: "bg-red-500/10 text-red-400 border-red-500/20" },
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
            <TabsTrigger value="oci" className="text-[10px] h-7 px-3 rounded-md">OCI</TabsTrigger>
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
