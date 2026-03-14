/**
 * DAG Blueprints — Declarative step definitions for each workload type.
 * All output threading is defined via io.inputs/outputs — zero hardcoded refs.
 */

import type { DagStep } from "./dag-resolver";

export function buildCrossRegionPeeredSteps(environment: string): DagStep[] {
  return [
    {
      id: "data-vpc",
      name: "eu-central-1: Data VPC",
      description: "VPC 10.1.0.0/16 with private subnet in Frankfurt",
      intent: "network",
      action: "deploy",
      spec: { region: "eu-central-1", environment, name: `data-vpc-${environment}`, vpc_cidr: "10.1.0.0/16", az_count: 1, public_subnets: false },
      io: {
        outputs: ["vpc_id", "subnet_ids", "route_table_id", "security_group_id"],
      },
      dependsOn: [],
      rollbackAction: "destroy",
      rollbackSpec: { vpc_id: "vpc_id" },
      status: "pending",
    },
    {
      id: "eks-vpc",
      name: "us-east-1: EKS Management VPC",
      description: "VPC 10.0.0.0/16 with public + private subnets in N. Virginia",
      intent: "network",
      action: "deploy",
      spec: { region: "us-east-1", environment, name: `eks-vpc-${environment}`, vpc_cidr: "10.0.0.0/16", az_count: 3 },
      io: {
        outputs: ["vpc_id", "subnet_ids", "route_table_id", "security_group_id"],
      },
      dependsOn: [],
      rollbackAction: "destroy",
      rollbackSpec: { vpc_id: "vpc_id" },
      status: "pending",
    },
    {
      id: "vpc-peering",
      name: "VPC Peering: us-east-1 ↔ eu-central-1",
      description: "Cross-region peering connection with auto-accept + route propagation",
      intent: "network",
      action: "deploy",
      spec: { region: "us-east-1", peer_region: "eu-central-1", type: "vpc-peering" },
      io: {
        inputs: {
          requester_vpc_id: "eks-vpc.vpc_id",
          accepter_vpc_id: "data-vpc.vpc_id",
        },
        outputs: ["peering_connection_id"],
      },
      dependsOn: ["data-vpc", "eks-vpc"],
      rollbackAction: "destroy",
      rollbackSpec: { peering_connection_id: "peering_connection_id" },
      status: "pending",
    },
    {
      id: "peering-routes",
      name: "Route Tables: Cross-Region Routes",
      description: "Inject routes for 10.1.0.0/16 ↔ 10.0.0.0/16 via peering connection",
      intent: "network",
      action: "deploy",
      spec: { region: "us-east-1", peer_region: "eu-central-1", type: "peering-routes" },
      io: {
        inputs: {
          peering_connection_id: "vpc-peering.peering_connection_id",
          requester_route_table_id: "eks-vpc.route_table_id",
          accepter_route_table_id: "data-vpc.route_table_id",
        },
      },
      dependsOn: ["vpc-peering"],
      status: "pending",
    },
    {
      id: "eks-cluster",
      name: "us-east-1: EKS Cluster",
      description: "Managed Kubernetes cluster with route to eu-central-1 Data VPC (~10-15 min)",
      intent: "eks",
      action: "deploy",
      spec: { region: "us-east-1", environment, cluster_name: `eks-${environment}-cluster`, kubernetes_version: "1.29" },
      io: {
        inputs: {
          subnet_ids: "eks-vpc.subnet_ids",
          security_group_ids: "eks-vpc.security_group_id",
        },
        outputs: ["cluster_name", "cluster_arn", "endpoint"],
      },
      dependsOn: ["peering-routes"],
      rollbackAction: "destroy",
      rollbackSpec: { cluster_name: "cluster_name" },
      status: "pending",
    },
    {
      id: "eks-nodegroup",
      name: "us-east-1: EKS Node Group",
      description: "t3.medium managed node group (2 nodes)",
      intent: "eks",
      action: "add_nodegroup",
      spec: { region: "us-east-1", cluster_name: `eks-${environment}-cluster`, instance_types: ["t3.medium"], desired_size: 2, min_size: 1, max_size: 3 },
      io: {
        inputs: {
          cluster_name: "eks-cluster.cluster_name",
          subnet_ids: "eks-vpc.subnet_ids",
        },
        outputs: ["nodegroup_name"],
      },
      dependsOn: ["eks-cluster"],
      rollbackAction: "destroy",
      rollbackSpec: { cluster_name: "cluster_name", nodegroup_name: "nodegroup_name" },
      status: "pending",
    },
  ];
}

export function buildGenericSteps(
  resources: string[],
  region: string,
  environment: string,
  instanceType: string,
  os: string,
  workloadType: string,
): DagStep[] {
  const steps: DagStep[] = [];

  const hasNetwork = resources.some(r => ["vpc", "subnets", "nacls"].includes(r));
  const hasEks = resources.includes("eks");
  const hasEc2 = resources.includes("ec2");

  if (hasNetwork) {
    steps.push({
      id: "network",
      name: "Network Stack",
      description: "VPC, Subnets, Internet Gateway, Route Tables, NACLs, Security Group",
      intent: "network",
      action: "deploy",
      spec: { region, environment, name: `uidi-vpc-${environment}`, vpc_cidr: "10.0.0.0/16", az_count: 2 },
      io: { outputs: ["vpc_id", "subnet_ids", "security_group_id"] },
      dependsOn: [],
      rollbackAction: "destroy",
      rollbackSpec: { vpc_id: "vpc_id" },
      status: "pending",
    });
  }

  if (hasEks) {
    steps.push({
      id: "eks",
      name: "EKS Cluster",
      description: "Managed Kubernetes cluster — IAM role auto-provisioned (~10-15 min)",
      intent: "eks",
      action: "deploy",
      spec: { region, environment, cluster_name: `uidi-${environment}-cluster`, kubernetes_version: "1.29" },
      io: {
        inputs: hasNetwork ? {
          subnet_ids: "network.subnet_ids",
          security_group_ids: "network.security_group_id",
        } : {},
        outputs: ["cluster_name", "cluster_arn"],
      },
      dependsOn: hasNetwork ? ["network"] : [],
      rollbackAction: "destroy",
      rollbackSpec: { cluster_name: "cluster_name" },
      status: "pending",
    });
  }

  if (hasEc2) {
    steps.push({
      id: "ec2",
      name: "EC2 Instance",
      description: `${instanceType} running ${os}`,
      intent: "compute",
      action: "deploy",
      spec: { instance_type: instanceType, os, region, environment, name: `uidi-${environment}-instance`, count: 1 },
      io: {
        inputs: hasNetwork ? { subnet_id: "network.subnet_ids" } : {},
        outputs: ["instance_ids"],
      },
      dependsOn: hasNetwork ? ["network"] : [],
      rollbackAction: "destroy",
      rollbackSpec: { instance_ids: "instance_ids" },
      status: "pending",
    });
  }

  return steps;
}

export function buildSreStep(workloadType: string, region: string, environment: string): DagStep[] {
  return [{
    id: "sre-pattern",
    name: `SRE Supreme: ${workloadType.toUpperCase()}`,
    description: `Deploying professional-grade ${workloadType} pattern with SRE Moat features.`,
    intent: "sre-supreme",
    action: "deploy",
    spec: { workload_type: workloadType, region, environment, name: `sre-${workloadType}-${environment}`, intentText: workloadType },
    io: { outputs: ["resources_created"] },
    dependsOn: [],
    status: "pending",
  }];
}

export function buildNaawiSteps(operations: any[], region: string): DagStep[] {
  return operations.map(op => ({
    id: op.id,
    name: `${op.service}.${op.command}`,
    description: `Direct SDK call: ${op.id} (Risk: ${op.riskLevel})`,
    intent: "naawi",
    action: "execute",
    spec: { operations: [op], region },
    io: {},
    dependsOn: [],
    status: "pending" as const,
  }));
}
