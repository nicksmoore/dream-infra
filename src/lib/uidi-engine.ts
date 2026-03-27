import { invokeFunction } from "@/lib/api-client";

// ───── Types ─────

export interface EngineRequest {
  intent: "kubernetes" | "ansible" | "compute" | "network" | "eks" | "reconcile" | "inventory" | "sre-supreme" | "naawi";
  action: "deploy" | "update" | "destroy" | "plan" | "apply" | "status" | "discover" | "dry_run" | "add_nodegroup" | "reconcile" | "scan" | "nuke" | "execute" | "wait";
  spec: Record<string, unknown>;
  metadata?: { user?: string; project?: string };
}

export interface EngineResponse {
  status: "success" | "error" | "pending";
  intent: string;
  action: string;
  message?: string;
  error?: string;
  details?: unknown;
  timestamp: string;
  dolt_commit_ref?: string;   // ADR-003: Versioned state hash
  dolt_write_failed?: boolean; // Fallback indicator
}

// ───── Client ─────

export async function executeIntent(request: EngineRequest): Promise<EngineResponse> {
  const { data, error } = await invokeFunction("uidi-engine", {
    body: request,
  });

  if (error) {
    throw new Error(`Engine execution failed: ${error.message}`);
  }

  return data as EngineResponse;
}

// ───── Compute helpers ─────

export async function computeDeploy(spec: {
  instance_type?: string;
  os?: string;
  region?: string;
  count?: number;
  name?: string;
  environment?: string;
  client_token?: string;
  subnet_id?: string;
  key_name?: string;
  security_group_ids?: string[];
  user_data?: string;
  iam_instance_profile?: string;
  root_volume_size?: number;
  root_volume_type?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "compute", action: "deploy", spec });
}

export async function computeDiscover(spec: {
  region?: string;
  name?: string;
  environment?: string;
  client_token?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "compute", action: "discover", spec });
}

export async function computeDestroy(spec: {
  instance_ids?: string[];
  instance_id?: string;
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "compute", action: "destroy", spec });
}

// ───── Network helpers ─────

export async function networkDeploy(spec: {
  region?: string;
  environment?: string;
  name?: string;
  vpc_cidr?: string;
  az_count?: number;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "network", action: "deploy", spec });
}

export async function networkDiscover(spec: {
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "network", action: "discover", spec });
}

export async function networkDestroy(spec: {
  vpc_id: string;
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "network", action: "destroy", spec });
}

// ───── EKS helpers ─────

export async function eksDeploy(spec: {
  cluster_name?: string;
  role_arn: string;
  subnet_ids: string[];
  security_group_ids?: string[];
  kubernetes_version?: string;
  region?: string;
  environment?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "eks", action: "deploy", spec });
}

export async function eksDiscover(spec: {
  cluster_name?: string;
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "eks", action: "discover", spec });
}

export async function eksAddNodegroup(spec: {
  cluster_name: string;
  node_role_arn: string;
  subnet_ids: string[];
  instance_types?: string[];
  desired_size?: number;
  min_size?: number;
  max_size?: number;
  nodegroup_name?: string;
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "eks", action: "add_nodegroup", spec });
}

export async function eksDestroy(spec: {
  cluster_name: string;
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "eks", action: "destroy", spec });
}

export async function k8sDeploy(spec: {
  cluster_name: string;
  manifest: Record<string, unknown>;
  namespace?: string;
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "kubernetes", action: "deploy", spec });
}

export async function k8sDestroy(spec: {
  cluster_name: string;
  kind: string;
  name: string;
  namespace?: string;
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "kubernetes", action: "destroy", spec });
}

export async function ansibleRun(spec: {
  instance_id?: string;
  host?: string;
  commands?: string[];
  playbook?: string;
  region?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "ansible", action: "deploy", spec });
}

// ───── SRE-Supreme helpers ─────

export async function sreSupremeDeploy(spec: {
  workload_type: "global-spa" | "service-mesh" | "event-pipeline" | "internal-api" | "three-tier";
  name: string;
  region?: string;
  environment?: string;
  [key: string]: any;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "sre-supreme", action: "deploy", spec });
}

// ───── Naawi helpers ─────

export async function naawiPlan(spec: {
  operations: any[];
  region?: string;
  [key: string]: any;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "naawi", action: "plan", spec });
}

export async function naawiExecute(spec: {
  operations: any[];
  region?: string;
  [key: string]: any;
}, approved?: boolean): Promise<EngineResponse> {
  return executeIntent({ 
    intent: "naawi", 
    action: "execute", 
    spec,
    // @ts-ignore - approved is a top-level field in Naawi requests
    approved 
  });
}

// ───── Reconciliation helpers ─────

export interface ReconcileDesiredResources {
  network?: { name: string; vpc_cidr?: string; az_count?: number };
  eks?: { cluster_name: string; kubernetes_version?: string };
  compute?: { name: string; instance_type?: string; os?: string; count?: number };
}

export interface ReconcileReport {
  intent_hash: string;
  timestamp: string;
  region: string;
  environment: string;
  resources: Record<string, {
    exists: boolean;
    status: "match" | "drift" | "missing" | "orphan";
    live?: Record<string, unknown>;
    desired?: Record<string, unknown>;
    delta?: string[];
  }>;
  actions_taken: { resource: string; action: string; result: string }[];
  summary: { total: number; matched: number; drifted: number; missing: number; created: number; updated: number; failed: number };
}

export async function reconcile(spec: {
  environment: string;
  region: string;
  desired_resources: ReconcileDesiredResources;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "reconcile", action: "reconcile", spec });
}
