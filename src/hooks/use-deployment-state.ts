/**
 * Deployment State Persistence Hook
 * 
 * Saves/restores deployment state to the database so deployments
 * survive hard browser refreshes.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DagStep } from "@/lib/dag-resolver";

interface DeploymentRecord {
  id: string;
  status: string;
  steps: DagStep[];
  step_outputs: Record<string, Record<string, unknown>>;
  plan_result: unknown;
  workload_type: string;
  region: string;
  environment: string;
}

export function useDeploymentState() {
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [restoredState, setRestoredState] = useState<DeploymentRecord | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Try to restore the most recent active deployment on mount
  useEffect(() => {
    async function restore() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setIsRestoring(false); return; }

        const { data } = await supabase
          .from("deployments")
          .select("*")
          .eq("user_id", user.id)
          .in("status", ["running", "planning", "partial_failure"])
          .order("updated_at", { ascending: false })
          .limit(1) as any;

        if (data?.[0]) {
          setDeploymentId(data[0].id);
          setRestoredState({
            id: data[0].id,
            status: data[0].status,
            steps: data[0].steps as DagStep[],
            step_outputs: data[0].step_outputs as Record<string, Record<string, unknown>>,
            plan_result: data[0].plan_result,
            workload_type: data[0].workload_type,
            region: data[0].region,
            environment: data[0].environment,
          });
        }
      } catch (e) {
        console.warn("Failed to restore deployment state:", e);
      } finally {
        setIsRestoring(false);
      }
    }
    restore();
  }, []);

  const createDeployment = useCallback(async (
    workloadType: string,
    region: string,
    environment: string,
    steps: DagStep[],
    planResult: unknown,
  ): Promise<string | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Serialize steps without React elements (icon)
      const serializable = steps.map(s => ({ ...s, icon: undefined }));

      const { data, error } = await supabase
        .from("deployments")
        .insert({
          user_id: user.id,
          stack_name: `${workloadType}-${environment}`,
          workload_type: workloadType,
          region,
          environment,
          status: "running",
          steps: serializable as any,
          step_outputs: {} as any,
          plan_result: planResult as any,
        })
        .select("id")
        .single() as any;

      if (error) throw error;
      setDeploymentId(data.id);
      return data.id;
    } catch (e) {
      console.warn("Failed to create deployment record:", e);
      return null;
    }
  }, []);

  const saveProgress = useCallback((
    id: string,
    steps: DagStep[],
    stepOutputs: Record<string, Record<string, unknown>>,
    status: string = "running",
  ) => {
    // Debounce saves to avoid excessive writes
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const serializable = steps.map(s => ({ ...s, icon: undefined }));
        await supabase
          .from("deployments")
          .update({
            steps: serializable as any,
            step_outputs: stepOutputs as any,
            status,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", id) as any;
      } catch (e) {
        console.warn("Failed to save deployment progress:", e);
      }
    }, 500);
  }, []);

  const completeDeployment = useCallback(async (id: string, status: "completed" | "failed" | "rolled_back") => {
    try {
      await supabase
        .from("deployments")
        .update({ status, updated_at: new Date().toISOString() } as any)
        .eq("id", id) as any;
      setDeploymentId(null);
    } catch (e) {
      console.warn("Failed to complete deployment:", e);
    }
  }, []);

  const clearRestoredState = useCallback(() => setRestoredState(null), []);

  return {
    deploymentId,
    restoredState,
    isRestoring,
    createDeployment,
    saveProgress,
    completeDeployment,
    clearRestoredState,
  };
}
