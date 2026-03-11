import { supabase } from "@/integrations/supabase/client";

// ───── Types ─────

export interface EngineRequest {
  intent: "terraform" | "kubernetes" | "ansible";
  action: "deploy" | "update" | "destroy" | "plan" | "apply" | "status";
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
}

// ───── Client ─────

export async function executeIntent(request: EngineRequest): Promise<EngineResponse> {
  const { data, error } = await supabase.functions.invoke("uidi-engine", {
    body: request,
  });

  if (error) {
    throw new Error(`Engine execution failed: ${error.message}`);
  }

  return data as EngineResponse;
}

// ───── Convenience helpers ─────

export async function terraformPlan(spec: {
  workspace_id: string;
  hcl?: string;
  region?: string;
  environment?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "terraform", action: "plan", spec });
}

export async function terraformApply(spec: {
  workspace_id: string;
  hcl?: string;
  region?: string;
  environment?: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "terraform", action: "apply", spec });
}

export async function terraformDestroy(spec: {
  workspace_id: string;
}): Promise<EngineResponse> {
  return executeIntent({ intent: "terraform", action: "destroy", spec });
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
