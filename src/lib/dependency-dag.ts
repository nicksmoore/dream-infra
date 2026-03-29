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

  // ── L0 additions ──────────────────────────────────────────────────────────
  { resource: "Placement Group",              level: 0, dependsOn: [],                                    category: "compute" },
  { resource: "IAM Role",                     level: 0, dependsOn: [],                                    category: "iam" },
  { resource: "Direct Connect Connection",    level: 0, dependsOn: [],                                    category: "networking" },
  { resource: "LAG",                          level: 0, dependsOn: [],                                    category: "networking" },

  // ── Storage ───────────────────────────────────────────────────────────────
  { resource: "S3 Bucket",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "EBS Volume",                   level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "EBS Snapshot",                 level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "EFS Filesystem",               level: 1, dependsOn: ["Subnets", "Security Group"],         category: "storage" },
  { resource: "S3 Bucket (Glacier Class)",    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Glacier Vault",                level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Lifecycle Rule",               level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "FSx File System",              level: 1, dependsOn: ["Subnets", "Security Group"],         category: "storage" },
  { resource: "Storage Gateway",              level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Backup Vault",                 level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Vault Lock Policy",            level: 2, dependsOn: ["Glacier Vault"],                     category: "storage" },
  { resource: "FSx Backup",                   level: 2, dependsOn: ["FSx File System"],                   category: "storage" },
  { resource: "Data Repository Association",  level: 2, dependsOn: ["FSx File System"],                   category: "storage" },
  { resource: "File Share (NFS/SMB)",         level: 2, dependsOn: ["Storage Gateway"],                   category: "storage" },
  { resource: "Volume Gateway",               level: 2, dependsOn: ["Storage Gateway"],                   category: "storage" },
  { resource: "Tape Gateway",                 level: 2, dependsOn: ["Storage Gateway"],                   category: "storage" },
  { resource: "Backup Plan",                  level: 2, dependsOn: ["Backup Vault"],                      category: "storage" },
  { resource: "Backup Selection",             level: 2, dependsOn: ["Backup Vault"],                      category: "storage" },
  { resource: "Vault Lock",                   level: 2, dependsOn: ["Backup Vault"],                      category: "storage" },
  { resource: "Shared Storage (FSx)",         level: 1, dependsOn: ["Subnets"],                           category: "storage" },
  { resource: "Local S3",                     level: 1, dependsOn: ["Outpost"],                           category: "storage" },

  // ── Database ──────────────────────────────────────────────────────────────
  { resource: "RDS Instance",                 level: 1, dependsOn: ["Subnets", "Security Group"],         category: "database" },
  { resource: "DynamoDB Table",               level: 1, dependsOn: [],                                    category: "database" },
  { resource: "ElastiCache Replication Group",level: 1, dependsOn: ["Subnets"],                           category: "database" },
  { resource: "Neptune Cluster",              level: 1, dependsOn: ["Subnets", "Security Group"],         category: "database" },
  { resource: "Neptune Instance",             level: 2, dependsOn: ["Neptune Cluster"],                   category: "database" },
  { resource: "DocumentDB Cluster",           level: 1, dependsOn: ["Subnets", "Security Group"],         category: "database" },
  { resource: "DocumentDB Instance",          level: 2, dependsOn: ["DocumentDB Cluster"],                category: "database" },
  { resource: "Keyspace",                     level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Table",                        level: 2, dependsOn: ["Keyspace"],                          category: "database" },
  { resource: "Point-in-Time Recovery",       level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Timestream Database",          level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Timestream Table",             level: 2, dependsOn: ["Timestream Database"],               category: "database" },
  { resource: "Retention Policy",             level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Aurora DSQL Cluster",          level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Multi-Region Link",            level: 1, dependsOn: [],                                    category: "database" },
  { resource: "MemoryDB Cluster",             level: 1, dependsOn: ["Subnets"],                           category: "database" },
  { resource: "ACL",                          level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Subnet Group",                 level: 1, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "Parameter Group",              level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Redshift Cluster",             level: 1, dependsOn: ["Subnets", "Security Group"],         category: "database" },
  { resource: "Redshift Serverless Namespace",level: 1, dependsOn: [],                                    category: "database" },
  { resource: "OpenSearch Domain",            level: 1, dependsOn: ["Subnets", "Security Group"],         category: "database" },

  // ── Compute ───────────────────────────────────────────────────────────────
  { resource: "Lambda Function",              level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "App Runner Service",           level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "ECS Fargate Cluster",          level: 2, dependsOn: ["Subnets", "Security Group"],         category: "compute" },
  { resource: "Batch Compute Environment",    level: 1, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "Job Queue",                    level: 2, dependsOn: ["Batch Compute Environment"],         category: "compute" },
  { resource: "Job Definition",               level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Beanstalk Application",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Beanstalk Environment",        level: 2, dependsOn: ["Beanstalk Application"],             category: "compute" },
  { resource: "ASG",                          level: 2, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "EC2 Instances",                level: 2, dependsOn: ["Subnets", "Security Group"],         category: "compute" },
  { resource: "Auto Scaling Group",           level: 2, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "Launch Template",              level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Launch Configuration",         level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Scaling Policy",               level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Scheduled Action",             level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Lightsail Instance",           level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Lightsail Database",           level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Lightsail Container Service",  level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Static IP",                    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Outpost",                      level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Outpost Subnet",               level: 1, dependsOn: ["Outpost"],                           category: "compute" },
  { resource: "Local EC2 Instances",          level: 2, dependsOn: ["Outpost"],                           category: "compute" },
  { resource: "PCS Cluster",                  level: 1, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "Compute Fleet",                level: 2, dependsOn: ["PCS Cluster"],                       category: "compute" },
  { resource: "Image Pipeline",               level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Image Recipe",                 level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Infrastructure Configuration", level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Distribution Configuration",   level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "EMR Cluster",                  level: 1, dependsOn: ["Subnets", "Security Group"],         category: "compute" },
  { resource: "MWAA Environment",             level: 1, dependsOn: ["Subnets"],                           category: "compute" },

  // ── Containers / K8s ──────────────────────────────────────────────────────
  { resource: "ECR Repository",               level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Lifecycle Policy",             level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Replication Configuration",    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Pull-Through Cache Rule",      level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "ROSA Cluster",                 level: 2, dependsOn: ["Subnets", "Security Group", "IAM Roles"], category: "orchestration" },
  { resource: "Machine Pools",                level: 2, dependsOn: ["ROSA Cluster"],                      category: "orchestration" },
  { resource: "Identity Provider",            level: 1, dependsOn: [],                                    category: "iam" },
  { resource: "Network (PrivateLink)",        level: 1, dependsOn: ["VPC"],                               category: "networking" },

  // ── Networking ────────────────────────────────────────────────────────────
  { resource: "Elastic IP",                   level: 1, dependsOn: [],                                    category: "networking" },
  { resource: "ALB / NLB",                    level: 2, dependsOn: ["Subnets", "Security Group"],         category: "compute" },
  { resource: "Route 53 Hosted Zone",         level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "Route 53 Record",              level: 2, dependsOn: ["Route 53 Hosted Zone"],              category: "edge" },
  { resource: "VPC Interface Endpoint",       level: 1, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "VPC Endpoint (Interface)",     level: 1, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "VPC Endpoint (Gateway)",       level: 1, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "Endpoint Service",             level: 1, dependsOn: [],                                    category: "networking" },
  { resource: "Endpoint Connection",          level: 2, dependsOn: [],                                    category: "networking" },
  { resource: "Virtual Interface",            level: 1, dependsOn: [],                                    category: "networking" },
  { resource: "Direct Connect Gateway",       level: 1, dependsOn: [],                                    category: "networking" },
  { resource: "Cloud Map Namespace",          level: 1, dependsOn: [],                                    category: "networking" },
  { resource: "Network Firewall",             level: 1, dependsOn: ["VPC"],                               category: "networking" },
  { resource: "Accelerator",                  level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "Listener",                     level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "Endpoint Group",               level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "API Gateway (HTTP)",           level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Mesh",                         level: 2, dependsOn: ["EKS"],                               category: "orchestration" },
  { resource: "Virtual Service",              level: 2, dependsOn: ["Mesh"],                              category: "orchestration" },
  { resource: "Virtual Node",                 level: 2, dependsOn: ["Mesh"],                              category: "orchestration" },
  { resource: "Virtual Router",               level: 2, dependsOn: ["Mesh"],                              category: "orchestration" },
  { resource: "Virtual Gateway",              level: 2, dependsOn: ["Mesh"],                              category: "orchestration" },
  { resource: "Service",                      level: 2, dependsOn: [],                                    category: "networking" },
  { resource: "Service Instance",             level: 2, dependsOn: [],                                    category: "networking" },

  // ── Security / IAM ────────────────────────────────────────────────────────
  { resource: "WAF Web ACL",                  level: 2, dependsOn: [],                                    category: "edge" },
  { resource: "GuardDuty Detector",           level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Security Hub",                 level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "CloudTrail Trail",             level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Config Recorder",              level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Config Rule",                  level: 2, dependsOn: ["Config Recorder"],                   category: "observability" },
  { resource: "Configuration Recorder",       level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Conformance Pack",             level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Remediation Configuration",    level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "KMS CMK",                      level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Secrets Manager Secret",       level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Private CA",                   level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "ACM Certificate",              level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "CloudHSM Cluster",             level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Firewall Manager Policy",      level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "Firewall Rule Group",          level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "Security Lake",                level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Shield Advanced Protection",   level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "Shield Response Team",         level: 1, dependsOn: [],                                    category: "edge" },
  { resource: "Macie Classification Job",     level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Detective Graph",              level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Inspector Assessment",         level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Assessment",                   level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Audit Manager Assessment",     level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Signer Profile",               level: 1, dependsOn: [],                                    category: "iam" },
  { resource: "IAM Identity Center Instance", level: 1, dependsOn: [],                                    category: "iam" },
  { resource: "Verified Permissions Policy Store", level: 1, dependsOn: [],                               category: "iam" },
  { resource: "Directory Service Directory",  level: 1, dependsOn: ["Subnets"],                           category: "networking" },
  { resource: "RAM Resource Share",           level: 1, dependsOn: [],                                    category: "iam" },

  // ── Observability ─────────────────────────────────────────────────────────
  { resource: "CloudWatch Alarm",             level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "CloudWatch Log Group",         level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "X-Ray Group",                  level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "X-Ray Sampling Rule",          level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "FIS Experiment Template",      level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "FIS Experiment",               level: 2, dependsOn: ["FIS Experiment Template"],           category: "observability" },
  { resource: "Grafana Workspace",            level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Prometheus Workspace",         level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Alert Manager",                level: 2, dependsOn: [],                                    category: "observability" },
  { resource: "Rule Groups",                  level: 2, dependsOn: ["Prometheus Workspace"],               category: "observability" },
  { resource: "Notification Preferences",     level: 1, dependsOn: [],                                    category: "observability" },

  // ── Serverless / Integration / Messaging ──────────────────────────────────
  { resource: "Step Functions State Machine", level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "EventBridge Bus",              level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "SSM Parameter",                level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "SNS Topic",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "SQS Queue",                    level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "SQS DLQ",                      level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "AppFlow Flow",                 level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Data Firehose Delivery Stream",level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Kinesis Stream",               level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Kinesis Video Stream",         level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Amazon MQ Broker",             level: 1, dependsOn: ["Subnets"],                           category: "storage" },
  { resource: "MSK Cluster",                  level: 1, dependsOn: ["Subnets", "Security Group"],         category: "storage" },
  { resource: "Managed Flink Application",    level: 1, dependsOn: [],                                    category: "compute" },

  // ── Managed Blockchain ────────────────────────────────────────────────────
  { resource: "Blockchain Network",           level: 1, dependsOn: ["VPC"],                               category: "compute" },
  { resource: "Blockchain Member",            level: 2, dependsOn: ["Blockchain Network"],                category: "compute" },
  { resource: "Blockchain Node",              level: 2, dependsOn: ["Blockchain Member"],                 category: "compute" },
  { resource: "AMB Access Endpoint",          level: 2, dependsOn: ["Blockchain Network"],                category: "compute" },

  // ── Quantum / Space ───────────────────────────────────────────────────────
  { resource: "Braket Quantum Task",          level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Braket Hybrid Job",            level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Braket Notebook Instance",     level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Ground Station Mission Profile",level: 1, dependsOn: [],                                   category: "compute" },
  { resource: "Ground Station Config",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Ground Station Contact",       level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Dataflow Endpoint Group",      level: 1, dependsOn: [],                                    category: "networking" },

  // ── Cost / Financial ──────────────────────────────────────────────────────
  { resource: "Budget",                       level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Cost Anomaly Monitor",         level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Billing Conductor Pricing Rule",level: 1, dependsOn: [],                                   category: "compute" },
  { resource: "Marketplace Subscription",     level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Savings Plan",                 level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "EBS Recommendations",          level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "EC2 Recommendations",          level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Lambda Recommendations",       level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Compute Optimizer Enrollment", level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Recommendation",               level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Trusted Advisor Check",        level: 1, dependsOn: [],                                    category: "observability" },

  // ── Customer Enablement ───────────────────────────────────────────────────
  { resource: "Support Plan",                 level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "re:Post Private Space",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "IQ Project",                   level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Activate Credits",             level: 1, dependsOn: [],                                    category: "compute" },

  // ── ML / AI ───────────────────────────────────────────────────────────────
  { resource: "Bedrock Provisioned Throughput",level: 1, dependsOn: [],                                   category: "compute" },
  { resource: "Foundation Models",            level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Bedrock Agent",                level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Knowledge Base",               level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Guardrail",                    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Action Group",                 level: 2, dependsOn: ["Bedrock Agent"],                     category: "compute" },
  { resource: "SageMaker Domain",             level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Notebook Instance",            level: 2, dependsOn: ["SageMaker Domain"],                  category: "compute" },
  { resource: "Training Job",                 level: 2, dependsOn: ["SageMaker Domain"],                  category: "compute" },
  { resource: "Model",                        level: 2, dependsOn: ["SageMaker Domain"],                  category: "compute" },
  { resource: "Endpoint",                     level: 2, dependsOn: ["Model"],                             category: "compute" },
  { resource: "Model Customization Job",      level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Feature Group",                level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Forecast Predictor",           level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Personalize Campaign",         level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Rekognition Collection",       level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Comprehend Endpoint",          level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Translate Terminology",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Transcribe Vocabulary",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Textract Adapter",             level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Fraud Detector",               level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Entity Resolution Workflow",   level: 1, dependsOn: [],                                    category: "compute" },

  // ── Analytics ─────────────────────────────────────────────────────────────
  { resource: "Glue Job",                     level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Glue Database",                level: 1, dependsOn: [],                                    category: "database" },
  { resource: "Glue Crawler",                 level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Athena Workgroup",             level: 1, dependsOn: [],                                    category: "database" },
  { resource: "QuickSight Dashboard",         level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Lake Formation Data Lake",     level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "DataZone Domain",              level: 1, dependsOn: [],                                    category: "compute" },

  // ── App / Platform Services ───────────────────────────────────────────────
  { resource: "Cognito User Pool",            level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Cognito Identity Pool",        level: 2, dependsOn: ["Cognito User Pool"],                 category: "compute" },
  { resource: "Amplify App",                  level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Amplify Branch",               level: 2, dependsOn: ["Amplify App"],                       category: "compute" },
  { resource: "AppSync API",                  level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Lex Bot",                      level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Connect Instance",             level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Pinpoint Application",         level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "SES Email Identity",           level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "SES Configuration Set",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "CloudSearch Domain",           level: 1, dependsOn: [],                                    category: "database" },
  { resource: "CloudFront Distribution",      level: 2, dependsOn: [],                                    category: "edge" },

  // ── Developer Tools ───────────────────────────────────────────────────────
  { resource: "CodeBuild Project",            level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "CodeDeploy Application",       level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "CodePipeline",                 level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "CodeArtifact Repository",      level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "CodeCommit Repository",        level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "CodeCatalyst Space",           level: 1, dependsOn: [],                                    category: "compute" },

  // ── Management / Governance ───────────────────────────────────────────────
  { resource: "Organization",                 level: 1, dependsOn: [],                                    category: "iam" },
  { resource: "Organizational Unit",          level: 2, dependsOn: ["Organization"],                      category: "iam" },
  { resource: "Account",                      level: 2, dependsOn: ["Organization"],                      category: "iam" },
  { resource: "Service Control Policy",       level: 2, dependsOn: ["Organization"],                      category: "iam" },
  { resource: "Landing Zone",                 level: 1, dependsOn: [],                                    category: "iam" },
  { resource: "Enrolled Account",             level: 2, dependsOn: ["Landing Zone"],                      category: "iam" },
  { resource: "Account Factory",              level: 2, dependsOn: ["Landing Zone"],                      category: "iam" },
  { resource: "Control (Guardrail)",          level: 1, dependsOn: [],                                    category: "iam" },
  { resource: "Stack",                        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Stack Set",                    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "StackSet Instance",            level: 2, dependsOn: ["Stack Set"],                         category: "compute" },
  { resource: "Change Set",                   level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Portfolio",                    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Product",                      level: 2, dependsOn: ["Portfolio"],                         category: "compute" },
  { resource: "Launch Constraint",            level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Provisioned Product",          level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Resilience Policy",            level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Application",                  level: 2, dependsOn: ["Resilience Policy"],                  category: "observability" },
  { resource: "Organizational View",          level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Auto Scaling Group",           level: 2, dependsOn: ["Subnets"],                           category: "compute" },
  { resource: "Scaling Policy",               level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Scheduled Action",             level: 2, dependsOn: [],                                    category: "compute" },

  // ── Migration / Transfer ──────────────────────────────────────────────────
  { resource: "Migration Hub",                level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Application Migration Service",level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "DMS Replication Instance",     level: 1, dependsOn: ["Subnets", "Security Group"],         category: "database" },
  { resource: "DMS Endpoint",                 level: 1, dependsOn: [],                                    category: "database" },
  { resource: "DMS Task",                     level: 2, dependsOn: ["DMS Replication Instance"],          category: "database" },
  { resource: "Transfer Family Server",       level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "DataSync Agent",               level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "DataSync Task",                level: 2, dependsOn: ["DataSync Agent"],                    category: "compute" },
  { resource: "Snow Family Job",              level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "M2 Application",               level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "M2 Environment",               level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "DRS Source Server",            level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Replication Set",              level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Recovery Instance",            level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "Response Plan",                level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Escalation Plan",              level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Contact",                      level: 1, dependsOn: [],                                    category: "compute" },

  // ── Media Services ────────────────────────────────────────────────────────
  { resource: "MediaLive Channel",            level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "MediaPackage Channel",         level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "MediaConvert Job Template",    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "MediaConnect Flow",            level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "IVS Channel",                  level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Polly Lexicon",                level: 1, dependsOn: [],                                    category: "compute" },

  // ── IoT ───────────────────────────────────────────────────────────────────
  { resource: "IoT Thing",                    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "IoT Rule",                     level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "IoT Policy",                   level: 1, dependsOn: [],                                    category: "iam" },
  { resource: "IoT Events Detector",          level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Greengrass Core Device",       level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "SiteWise Gateway",             level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "FleetWise Campaign",           level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "TwinMaker Workspace",          level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Device Defender Audit",        level: 1, dependsOn: [],                                    category: "observability" },
  { resource: "Device Farm Project",          level: 1, dependsOn: [],                                    category: "compute" },

  // ── GameLift ──────────────────────────────────────────────────────────────
  { resource: "GameLift Fleet",               level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "GameLift Game Session Queue",  level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "GameLift Matchmaking Config",  level: 2, dependsOn: [],                                    category: "compute" },
  { resource: "GameLift Streams Application", level: 1, dependsOn: [],                                    category: "compute" },

  // ── End-User Computing ────────────────────────────────────────────────────
  { resource: "WorkSpace",                    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "WorkDocs Site",                level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "WorkMail Organization",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "WorkSpaces Directory",         level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "WorkSpaces Pool",              level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Secure Browser Portal",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Wickr Network",                level: 1, dependsOn: [],                                    category: "compute" },

  // ── Healthcare / Life Sciences ────────────────────────────────────────────
  { resource: "HealthImaging Data Store",     level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "HealthLake Data Store",        level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Omics Sequence Store",         level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Omics Workflow",               level: 1, dependsOn: [],                                    category: "compute" },

  // ── Specialized / Other ───────────────────────────────────────────────────
  { resource: "Supply Chain Instance",        level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Deadline Cloud Farm",          level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Clean Room Collaboration",     level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Data Exchange Data Set",       level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Location Service Map",         level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Location Service Geofence",    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Payment Cryptography Key",     level: 1, dependsOn: [],                                    category: "storage" },
  { resource: "Chime SDK Voice Connector",    level: 1, dependsOn: [],                                    category: "compute" },
  { resource: "Pipeline",                     level: 1, dependsOn: [],                                    category: "compute" },
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
