import { supabase } from "@/integrations/supabase/client";

// ===== MCP Tool Types =====
export type TerraformResourceType = "vpc" | "subnet" | "security_group" | "internet_gateway" | "nat_gateway" | "route_table" | "ec2_instance" | "eks_cluster" | "eks_node_group" | "iam_role" | "iam_policy" | "s3_bucket" | "rds_instance" | "ebs_volume" | "elastic_ip" | "load_balancer";

export interface TerraformResource {
  id: string;
  type: TerraformResourceType;
  name: string;
  config: Record<string, unknown>;
  dependsOn?: string[];
}

export interface TerraformStack {
  id: string;
  name: string;
  environment: string;
  region: string;
  resources: TerraformResource[];
  status: "draft" | "planning" | "planned" | "applying" | "applied" | "failed" | "destroyed";
  planOutput?: string;
  applyOutput?: string;
  error?: string;
  createdAt: Date;
}

export interface McpToolCall {
  method: string;
  params: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: string;
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

// ===== Resource Templates =====
export const RESOURCE_TEMPLATES: Record<TerraformResourceType, { label: string; icon: string; category: string; defaultConfig: Record<string, unknown> }> = {
  vpc: {
    label: "VPC",
    icon: "Network",
    category: "Networking",
    defaultConfig: { cidr_block: "10.0.0.0/16", enable_dns_support: true, enable_dns_hostnames: true },
  },
  subnet: {
    label: "Subnet",
    icon: "Network",
    category: "Networking",
    defaultConfig: { cidr_block: "10.0.1.0/24", availability_zone: "a", map_public_ip_on_launch: false },
  },
  security_group: {
    label: "Security Group",
    icon: "Shield",
    category: "Networking",
    defaultConfig: { description: "Managed by IDI Console", ingress_rules: [], egress_rules: [{ from_port: 0, to_port: 0, protocol: "-1", cidr_blocks: ["0.0.0.0/0"] }] },
  },
  internet_gateway: {
    label: "Internet Gateway",
    icon: "Globe",
    category: "Networking",
    defaultConfig: {},
  },
  nat_gateway: {
    label: "NAT Gateway",
    icon: "ArrowUpDown",
    category: "Networking",
    defaultConfig: { connectivity_type: "public" },
  },
  route_table: {
    label: "Route Table",
    icon: "Route",
    category: "Networking",
    defaultConfig: { routes: [] },
  },
  ec2_instance: {
    label: "EC2 Instance",
    icon: "Server",
    category: "Compute",
    defaultConfig: { instance_type: "t3.micro", ami: "amazon-linux-2023" },
  },
  eks_cluster: {
    label: "EKS Cluster",
    icon: "Container",
    category: "Kubernetes",
    defaultConfig: { kubernetes_version: "1.29", endpoint_public_access: true, endpoint_private_access: true },
  },
  eks_node_group: {
    label: "EKS Node Group",
    icon: "Layers",
    category: "Kubernetes",
    defaultConfig: { instance_types: ["t3.medium"], desired_size: 2, min_size: 1, max_size: 4, capacity_type: "ON_DEMAND" },
  },
  iam_role: {
    label: "IAM Role",
    icon: "UserCog",
    category: "Security",
    defaultConfig: { assume_role_policy: "" },
  },
  iam_policy: {
    label: "IAM Policy",
    icon: "FileKey",
    category: "Security",
    defaultConfig: { policy_document: "" },
  },
  s3_bucket: {
    label: "S3 Bucket",
    icon: "Database",
    category: "Storage",
    defaultConfig: { versioning: true, encryption: "AES256", block_public_access: true },
  },
  rds_instance: {
    label: "RDS Instance",
    icon: "Database",
    category: "Database",
    defaultConfig: { engine: "postgres", engine_version: "16", instance_class: "db.t3.micro", allocated_storage: 20, multi_az: false },
  },
  ebs_volume: {
    label: "EBS Volume",
    icon: "HardDrive",
    category: "Storage",
    defaultConfig: { size: 20, type: "gp3", encrypted: true },
  },
  elastic_ip: {
    label: "Elastic IP",
    icon: "Globe",
    category: "Networking",
    defaultConfig: { domain: "vpc" },
  },
  load_balancer: {
    label: "Load Balancer",
    icon: "Split",
    category: "Networking",
    defaultConfig: { type: "application", internal: false, idle_timeout: 60 },
  },
};

export const RESOURCE_CATEGORIES = [
  { key: "Networking", label: "Networking", types: ["vpc", "subnet", "security_group", "internet_gateway", "nat_gateway", "route_table", "elastic_ip", "load_balancer"] as TerraformResourceType[] },
  { key: "Compute", label: "Compute", types: ["ec2_instance"] as TerraformResourceType[] },
  { key: "Kubernetes", label: "Kubernetes", types: ["eks_cluster", "eks_node_group"] as TerraformResourceType[] },
  { key: "Security", label: "Security", types: ["iam_role", "iam_policy"] as TerraformResourceType[] },
  { key: "Storage", label: "Storage & DB", types: ["s3_bucket", "rds_instance", "ebs_volume"] as TerraformResourceType[] },
];

// ===== MCP Client (legacy, kept for direct MCP fallback) =====
export async function callMcp(method: string, params: Record<string, unknown> = {}): Promise<McpResponse> {
  const { data, error } = await supabase.functions.invoke("terraform-mcp-proxy", {
    body: { method, params, id: crypto.randomUUID() },
  });

  if (error) {
    throw new Error(`MCP proxy error: ${error.message}`);
  }

  return data as McpResponse;
}

// ===== High-level MCP operations =====
export async function mcpListTools(): Promise<unknown> {
  const res = await callMcp("tools/list");
  if (res.error) throw new Error(res.error.message);
  return res.result;
}

export async function mcpCallTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await callMcp("tools/call", { name: toolName, arguments: args });
  if (res.error) throw new Error(res.error.message);
  return res.result;
}

// ===== n8n Orchestrator =====
export const N8N_WORKFLOW_ID = "2On52H83RF3fqNPT";

export interface UidiOrchestratorRequest {
  intent: "terraform" | "kubernetes" | "ansible";
  action: string;
  spec: Record<string, unknown>;
}

export interface UidiOrchestratorResponse {
  status: "success" | "error";
  platform?: string;
  message?: string;
  error?: string;
  details?: unknown;
  timestamp?: string;
}

export function buildOrchestratorMessage(request: UidiOrchestratorRequest): string {
  return JSON.stringify({
    intent: request.intent,
    action: request.action,
    spec: request.spec,
  });
}

// ===== Stack Builder Helpers =====
export function generateStackHcl(stack: TerraformStack): string {
  const lines: string[] = [
    `# Stack: ${stack.name}`,
    `# Environment: ${stack.environment}`,
    `# Region: ${stack.region}`,
    `# Generated by IDI Console`,
    "",
    "terraform {",
    '  required_version = ">= 1.5"',
    "  required_providers {",
    "    aws = {",
    '      source  = "hashicorp/aws"',
    '      version = "~> 5.0"',
    "    }",
    "  }",
    "}",
    "",
    "provider \"aws\" {",
    `  region = "${stack.region}"`,
    "",
    "  default_tags {",
    "    tags = {",
    `      Environment = "${stack.environment}"`,
    '      ManagedBy   = "IDI-Console"',
    `      Stack       = "${stack.name}"`,
    "    }",
    "  }",
    "}",
    "",
  ];

  for (const resource of stack.resources) {
    const tfType = getTerraformType(resource.type);
    lines.push(`resource "${tfType}" "${resource.name}" {`);
    for (const [key, value] of Object.entries(resource.config)) {
      if (value === undefined || value === null || value === "") continue;
      lines.push(`  ${key} = ${formatHclValue(value)}`);
    }
    if (resource.dependsOn?.length) {
      const deps = resource.dependsOn.map(d => {
        const dep = stack.resources.find(r => r.id === d);
        return dep ? `${getTerraformType(dep.type)}.${dep.name}` : d;
      });
      lines.push(`  depends_on = [${deps.join(", ")}]`);
    }
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

function getTerraformType(type: TerraformResourceType): string {
  const map: Record<TerraformResourceType, string> = {
    vpc: "aws_vpc",
    subnet: "aws_subnet",
    security_group: "aws_security_group",
    internet_gateway: "aws_internet_gateway",
    nat_gateway: "aws_nat_gateway",
    route_table: "aws_route_table",
    ec2_instance: "aws_instance",
    eks_cluster: "aws_eks_cluster",
    eks_node_group: "aws_eks_node_group",
    iam_role: "aws_iam_role",
    iam_policy: "aws_iam_policy",
    s3_bucket: "aws_s3_bucket",
    rds_instance: "aws_db_instance",
    ebs_volume: "aws_ebs_volume",
    elastic_ip: "aws_eip",
    load_balancer: "aws_lb",
  };
  return map[type];
}

function formatHclValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(formatHclValue).join(", ")}]`;
  return JSON.stringify(value);
}

// ===== Preset Stacks =====
export interface StackPreset {
  id: string;
  name: string;
  description: string;
  resources: Omit<TerraformResource, "id">[];
}

export const STACK_PRESETS: StackPreset[] = [
  {
    id: "vpc-basic",
    name: "Basic VPC",
    description: "VPC with public/private subnets, IGW, and NAT",
    resources: [
      { type: "vpc", name: "main", config: { cidr_block: "10.0.0.0/16", enable_dns_support: true, enable_dns_hostnames: true } },
      { type: "internet_gateway", name: "main", config: {}, dependsOn: [] },
      { type: "subnet", name: "public_a", config: { cidr_block: "10.0.1.0/24", availability_zone: "a", map_public_ip_on_launch: true } },
      { type: "subnet", name: "public_b", config: { cidr_block: "10.0.2.0/24", availability_zone: "b", map_public_ip_on_launch: true } },
      { type: "subnet", name: "private_a", config: { cidr_block: "10.0.10.0/24", availability_zone: "a", map_public_ip_on_launch: false } },
      { type: "subnet", name: "private_b", config: { cidr_block: "10.0.11.0/24", availability_zone: "b", map_public_ip_on_launch: false } },
      { type: "elastic_ip", name: "nat", config: { domain: "vpc" } },
      { type: "nat_gateway", name: "main", config: { connectivity_type: "public" } },
      { type: "security_group", name: "default", config: { description: "Default SG", ingress_rules: [], egress_rules: [{ from_port: 0, to_port: 0, protocol: "-1", cidr_blocks: ["0.0.0.0/0"] }] } },
    ],
  },
  {
    id: "eks-cluster",
    name: "EKS Cluster",
    description: "EKS cluster with managed node group and IAM roles",
    resources: [
      { type: "iam_role", name: "eks_cluster", config: { assume_role_policy: "eks.amazonaws.com" } },
      { type: "iam_role", name: "eks_nodes", config: { assume_role_policy: "ec2.amazonaws.com" } },
      { type: "eks_cluster", name: "main", config: { kubernetes_version: "1.29", endpoint_public_access: true, endpoint_private_access: true } },
      { type: "eks_node_group", name: "workers", config: { instance_types: ["t3.medium"], desired_size: 2, min_size: 1, max_size: 4, capacity_type: "ON_DEMAND" } },
    ],
  },
  {
    id: "web-app",
    name: "Web App Stack",
    description: "EC2 + ALB + RDS + S3 for a typical web application",
    resources: [
      { type: "security_group", name: "alb", config: { description: "ALB Security Group", ingress_rules: [{ from_port: 80, to_port: 80, protocol: "tcp", cidr_blocks: ["0.0.0.0/0"] }, { from_port: 443, to_port: 443, protocol: "tcp", cidr_blocks: ["0.0.0.0/0"] }], egress_rules: [{ from_port: 0, to_port: 0, protocol: "-1", cidr_blocks: ["0.0.0.0/0"] }] } },
      { type: "security_group", name: "app", config: { description: "App Security Group" } },
      { type: "security_group", name: "db", config: { description: "DB Security Group" } },
      { type: "load_balancer", name: "main", config: { type: "application", internal: false, idle_timeout: 60 } },
      { type: "ec2_instance", name: "app", config: { instance_type: "t3.small", ami: "amazon-linux-2023" } },
      { type: "rds_instance", name: "main", config: { engine: "postgres", engine_version: "16", instance_class: "db.t3.micro", allocated_storage: 20, multi_az: false } },
      { type: "s3_bucket", name: "assets", config: { versioning: true, encryption: "AES256", block_public_access: true } },
    ],
  },
];
