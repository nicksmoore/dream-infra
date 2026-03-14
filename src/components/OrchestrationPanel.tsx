import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { executeIntent, reconcile, naawiPlan, naawiExecute } from "@/lib/uidi-engine";
import type { EngineResponse, ReconcileReport } from "@/lib/uidi-engine";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { DeploymentDiagram } from "@/components/DeploymentDiagram";
import { ValidationPhase } from "@/components/ValidationPhase";
import { useDeploymentState } from "@/hooks/use-deployment-state";
import { resolveStepInputs, buildRollbackSpec, getExecutionOrder, getRollbackOrder } from "@/lib/dag-resolver";
import type { DagStep } from "@/lib/dag-resolver";
import { buildCrossRegionPeeredSteps, buildGenericSteps, buildSreStep, buildNaawiSteps } from "@/lib/dag-blueprints";
import {
  Loader2, CheckCircle2, XCircle, Circle, Rocket, Network, Server, Box,
  ShieldCheck, AlertTriangle, Eye, ShieldAlert, DollarSign, GitCompareArrows,
  RotateCcw, Trash2, Clock, Timer,
} from "lucide-react";

// ───── Props & Constants ─────

interface OrchestrationPanelProps {
  resources: string[];
  region: string;
  environment: string;
  workloadType?: string;
  instanceType?: string;
  os?: string;
  naawiOperations?: any[];
  onComplete?: () => void;
}

const SRE_PATTERNS = ["global-spa", "service-mesh", "event-pipeline", "internal-api", "three-tier", "edge-cache"] as const;

type PlanResult = {
  discovery?: Array<{ operationId: string; status: string; suggestedAction?: string }>;
  operations?: Array<{ id: string; service: string; command: string }>;
  risk_level?: "LOW" | "HIGH";
  requires_approval?: boolean;
  estimated_monthly_cost_usd?: number;
};

const ICON_MAP: Record<string, React.ReactNode> = {
  network: <Network className="h-4 w-4" />,
  eks: <Box className="h-4 w-4" />,
  compute: <Server className="h-4 w-4" />,
  naawi: <Box className="h-4 w-4" />,
  "sre-supreme": <ShieldCheck className="h-4 w-4 text-primary" />,
};

function getStepIcon(step: DagStep): React.ReactNode {
  if (step.id === "vpc-peering") return <GitCompareArrows className="h-4 w-4 text-primary" />;
  return ICON_MAP[step.intent] || <Box className="h-4 w-4" />;
}

function estimateStepCost(step: DagStep): number {
  if (step.intent === "compute") {
    const it = String(step.spec.instance_type || "t3.micro");
    if (it.includes("nano")) return 4;
    if (it.includes("micro")) return 8;
    if (it.includes("small")) return 16;
    if (it.includes("medium")) return 32;
    return 48;
  }
  if (step.intent === "network") return 12;
  if (step.intent === "eks") return 75;
  return 15;
}

const EMPTY_OPS: any[] = [];

// ───── Component ─────

export function OrchestrationPanel({
  resources,
  region,
  environment,
  workloadType = "general",
  instanceType = "t3.medium",
  os = "amazon-linux-2023",
  naawiOperations,
  onComplete,
}: OrchestrationPanelProps) {
  const stableOps = useMemo(() => naawiOperations ?? EMPTY_OPS, [naawiOperations]);
  const [steps, setSteps] = useState<DagStep[]>([]);
  const [stepOutputs, setStepOutputs] = useState<Record<string, Record<string, unknown>>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [deploymentResult, setDeploymentResult] = useState<any>(null);

  const {
    restoredState,
    isRestoring,
    createDeployment,
    saveProgress,
    completeDeployment,
    clearRestoredState,
  } = useDeploymentState();

  // ── Restore state from DB if available ──
  useEffect(() => {
    if (restoredState && restoredState.workload_type === workloadType) {
      setSteps(restoredState.steps);
      setStepOutputs(restoredState.step_outputs);
      if (restoredState.plan_result) setPlanResult(restoredState.plan_result as PlanResult);
      toast({ title: "Deployment restored", description: "Resumed from last saved state." });
      clearRestoredState();
    }
  }, [restoredState, workloadType, clearRestoredState]);

  // ── Build steps from declarative blueprints ──
  useEffect(() => {
    // Don't rebuild if we restored from DB
    if (restoredState) return;

    let built: DagStep[];

    if (stableOps.length > 0) {
      built = buildNaawiSteps(stableOps, region);
    } else if (workloadType === "cross-region-peered") {
      built = buildCrossRegionPeeredSteps(environment);
    } else if (SRE_PATTERNS.includes(workloadType as any)) {
      built = buildSreStep(workloadType, region, environment);
    } else {
      built = buildGenericSteps(resources, region, environment, instanceType, os, workloadType);
    }

    setSteps(built);
    setStepOutputs({});
    setPlanResult(null);
  }, [stableOps, resources, region, environment, workloadType, instanceType, os]);

  // ── Planning ──
  async function runPlan() {
    setIsPlanning(true);
    try {
      if (stableOps.length > 0) {
        const result = await naawiPlan({ operations: stableOps, region });
        if (result.status !== "success") throw new Error(result.error || "Plan failed");
        setPlanResult(result.details as PlanResult);
        toast({ title: "Naawi Plan Ready", description: "Review diff + estimated cost before execution." });
        return;
      }

      if (SRE_PATTERNS.includes(workloadType as any)) {
        const result = await executeIntent({
          intent: "sre-supreme", action: "plan",
          spec: { workload_type: workloadType, region, environment, name: `sre-${workloadType}-${environment}`, intentText: workloadType },
        });
        if (result.status !== "success") throw new Error(result.error || result.message || "Plan failed");
        setPlanResult(result.details as PlanResult);
        toast({ title: "SRE Plan Ready", description: "Review planned SDK calls, diff, and cost before execution." });
        return;
      }

      const estimated = steps.reduce((sum, step) => sum + estimateStepCost(step), 0);
      setPlanResult({
        risk_level: "LOW",
        requires_approval: false,
        estimated_monthly_cost_usd: estimated,
        discovery: steps.map(s => ({ operationId: s.id, status: "NOT_FOUND", suggestedAction: "CREATE" })),
        operations: steps.map(s => ({ id: s.id, service: s.intent.toUpperCase(), command: s.action })),
      });
      toast({ title: "Plan Ready", description: "Preview generated with estimated cost." });
    } catch (e) {
      toast({ title: "Planning failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsPlanning(false);
    }
  }

  // ── Async polling for long-running steps ──
  const pollIntervalRef = useRef<ReturnType<typeof setInterval>>();

  const pollAsyncStep = useCallback(async (
    stepIndex: number,
    step: DagStep,
    outputs: Record<string, Record<string, unknown>>,
    depId: string | null,
    allSteps: DagStep[],
  ): Promise<boolean> => {
    const POLL_INTERVAL = 30_000; // 30s
    const MAX_POLLS = 40; // ~20 min max

    return new Promise((resolve) => {
      let polls = 0;
      const pollFn = async () => {
        polls++;
        try {
          const result = await executeIntent({
            intent: step.intent as any,
            action: "wait",
            spec: { cluster_name: (outputs[step.id] as any)?.cluster_name, region: step.spec.region || "us-east-1" },
          });

          const details = result.details as Record<string, unknown> | undefined;

          if (result.status === "success" && details?.async_complete) {
            // Completed!
            clearInterval(pollIntervalRef.current);
            outputs[step.id] = { ...outputs[step.id], ...details };
            setStepOutputs({ ...outputs });
            setSteps(prev => prev.map((s, idx) =>
              idx === stepIndex ? { ...s, status: "done", output: result.message || JSON.stringify(details, null, 2), asyncJob: false } : s
            ));
            if (depId) saveProgress(depId, allSteps, outputs, "running");
            toast({ title: `${step.name} is ACTIVE`, description: result.message });
            resolve(true);
            return;
          }

          if (result.status === "error") {
            clearInterval(pollIntervalRef.current);

            // Persist granular failure payload for expandable debug view
            if (details && typeof details === "object") {
              outputs[step.id] = { ...outputs[step.id], ...details };
              setStepOutputs({ ...outputs });
            }

            setSteps(prev => prev.map((s, idx) =>
              idx === stepIndex ? { ...s, status: "error", output: result.error || "Async operation failed" } : s
            ));
            if (depId) saveProgress(depId, allSteps, outputs, "partial_failure");
            toast({ title: `${step.name} failed`, description: result.error, variant: "destructive" });
            resolve(false);
            return;
          }

          // Still pending — update progress message (include granular stage if provided)
          const stage = typeof (details as any)?.stage === "string" ? String((details as any).stage) : undefined;
          const status = (details as any)?.status ? String((details as any).status) : undefined;
          const statusMsg = status ? `Status: ${status}` : "Still provisioning...";
          const stageMsg = stage ? `Stage: ${stage}` : undefined;
          const msg = [stageMsg, statusMsg].filter(Boolean).join(" · ");

          setSteps(prev => prev.map((s, idx) =>
            idx === stepIndex ? { ...s, status: "polling" as any, output: `${msg} (poll ${polls}/${MAX_POLLS})` } : s
          ));

          if (polls >= MAX_POLLS) {
            clearInterval(pollIntervalRef.current);
            setSteps(prev => prev.map((s, idx) =>
              idx === stepIndex ? { ...s, status: "error", output: `Timed out after ${MAX_POLLS} polls (~${Math.round(MAX_POLLS * POLL_INTERVAL / 60000)} min)` } : s
            ));
            if (depId) saveProgress(depId, allSteps, outputs, "partial_failure");
            toast({ title: `${step.name} timed out`, variant: "destructive" });
            resolve(false);
          }
        } catch (e) {
          // Network error — don't fail, retry on next poll
          console.warn(`Poll error for ${step.name}:`, e);
        }
      };

      // First poll immediately
      pollFn();
      pollIntervalRef.current = setInterval(pollFn, POLL_INTERVAL);
    });
  }, [saveProgress]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // ── Execution with declarative output threading + async support ──
  async function runOrchestration(approved = false) {
    setIsRunning(true);
    const outputs: Record<string, Record<string, unknown>> = { ...stepOutputs };

    // Persist deployment
    const depId = await createDeployment(workloadType, region, environment, steps, planResult);

    if (stableOps.length > 0) {
      try {
        setSteps(prev => prev.map(s => ({ ...s, status: "running" })));
        const result = await naawiExecute({ operations: stableOps, region }, approved);
        if (result.status === "error") throw new Error(result.error || result.message);
        setSteps(prev => prev.map(s => ({ ...s, status: "done", output: JSON.stringify(result.details, null, 2) })));
        setDeploymentResult(result.details);
        if (depId) await completeDeployment(depId, "completed");
        toast({ title: "Deployment successful", description: result.message });
        onComplete?.();
      } catch (e) {
        setSteps(prev => prev.map(s => ({ ...s, status: "error", output: e instanceof Error ? e.message : "Failed" })));
        if (depId) await completeDeployment(depId, "failed");
        toast({ title: "Deployment failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      } finally {
        setIsRunning(false);
      }
      return;
    }

    // DAG-aware sequential execution with declarative input resolution + async polling
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "running" } : s));

      // Resolve inputs declaratively — no hardcoded step ID checks
      const resolvedSpec = resolveStepInputs(step, outputs);

      try {
        const result = await executeIntent({
          intent: step.intent as any,
          action: step.action as any,
          spec: resolvedSpec,
        });

        if (result.status === "error") throw new Error(result.error || result.message);

        // Store outputs
        if (result.details && typeof result.details === "object") {
          outputs[step.id] = result.details as Record<string, unknown>;
          setStepOutputs({ ...outputs });
        }

        // Handle async/pending response — enter polling mode
        if (result.status === "pending") {
          const details = result.details as Record<string, unknown> | undefined;
          if (details?.async_job) {
            setSteps(prev => prev.map((s, idx) =>
              idx === i ? { ...s, status: "polling" as any, output: result.message || "Waiting for resource...", asyncJob: true } : s
            ));
            if (depId) saveProgress(depId, steps, outputs, "running");
            toast({ title: `${step.name} started`, description: "Polling for completion (~10-15 min)..." });

            // Block here until async completes
            const success = await pollAsyncStep(i, step, outputs, depId, steps);
            if (!success) {
              setIsRunning(false);
              return; // Stop DAG — rollback available
            }
            continue; // Async step completed, move to next
          }
        }

        setSteps(prev => prev.map((s, idx) =>
          idx === i ? { ...s, status: "done", output: result.details ? JSON.stringify(result.details, null, 2) : result.message, result } : s
        ));

        if (i === steps.length - 1) setDeploymentResult(result.details);
        if (depId) saveProgress(depId, steps, outputs, "running");
        toast({ title: `${step.name} complete`, description: result.message });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Failed";

        // EKS deploy timeout recovery: the edge function may have timed out after
        // firing CreateCluster. Check if the cluster exists and switch to polling.
        if (step.intent === "eks" && step.action === "deploy" && step.spec.cluster_name) {
          try {
            console.log(`EKS deploy error — checking if cluster was created before timeout...`);
            const checkResult = await executeIntent({
              intent: "eks",
              action: "wait",
              spec: { cluster_name: step.spec.cluster_name, region: step.spec.region || "us-east-1" },
            });
            const checkDetails = checkResult.details as Record<string, unknown> | undefined;

            if (checkResult.status === "pending" && checkDetails?.async_job) {
              // Cluster IS creating — switch to polling mode instead of error
              outputs[step.id] = checkDetails;
              setStepOutputs({ ...outputs });
              setSteps(prev => prev.map((s, idx) =>
                idx === i ? { ...s, status: "polling" as any, output: `Recovered from timeout — ${checkResult.message}`, asyncJob: true } : s
              ));
              if (depId) saveProgress(depId, steps, outputs, "running");
              toast({ title: `${step.name} recovered`, description: "Edge function timed out but cluster is provisioning. Polling..." });

              const success = await pollAsyncStep(i, step, outputs, depId, steps);
              if (!success) { setIsRunning(false); return; }
              continue;
            }

            if (checkResult.status === "success" && checkDetails?.async_complete) {
              // Cluster is already ACTIVE
              outputs[step.id] = checkDetails;
              setStepOutputs({ ...outputs });
              setSteps(prev => prev.map((s, idx) =>
                idx === i ? { ...s, status: "done", output: `Recovered — cluster ACTIVE`, asyncJob: false } : s
              ));
              if (depId) saveProgress(depId, steps, outputs, "running");
              toast({ title: `${step.name} is ACTIVE`, description: "Recovered from timeout." });
              continue;
            }
          } catch {
            // Recovery check also failed — fall through to normal error handling
          }
        }

        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "error", output: errMsg } : s));

        if (depId) {
          saveProgress(depId, steps, outputs, "partial_failure");
        }

        toast({
          title: `${step.name} failed — rollback available`,
          description: errMsg,
          variant: "destructive",
        });

        setIsRunning(false);
        return;
      }
    }

    setIsRunning(false);
    if (depId) await completeDeployment(depId, "completed");
    toast({ title: "Stack deployed!", description: "All resources provisioned successfully." });
    onComplete?.();
  }

  // ── Rollback: reverse-walk completed steps and destroy ──
  const runRollback = useCallback(async () => {
    setIsRollingBack(true);
    const rollbackSteps = getRollbackOrder(steps);

    if (rollbackSteps.length === 0) {
      toast({ title: "Nothing to roll back", description: "No completed steps found." });
      setIsRollingBack(false);
      return;
    }

    toast({ title: "Rolling back", description: `Destroying ${rollbackSteps.length} resources in reverse order...` });

    let failures = 0;

    for (const step of rollbackSteps) {
      const rollbackAction = step.rollbackAction || "destroy";
      const rollbackSpec = buildRollbackSpec(step, stepOutputs);

      // Mark as running
      setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: "running" } : s));

      try {
        const result = await executeIntent({
          intent: step.intent as any,
          action: rollbackAction as any,
          spec: rollbackSpec,
        });

        if (result.status === "error") throw new Error(result.error || result.message);

        setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: "rolled_back" as any, output: "Destroyed" } : s));
        toast({ title: `Rolled back ${step.name}` });
      } catch (e) {
        failures++;
        setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: "error", output: `Rollback failed: ${e instanceof Error ? e.message : "Unknown"}` } : s));
        toast({ title: `Rollback failed: ${step.name}`, description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
      }
    }

    setIsRollingBack(false);
    if (failures > 0) {
      setShowForceNuke(true);
    }
    toast({
      title: failures === 0 ? "Rollback complete" : `Rollback finished with ${failures} failure(s)`,
      description: failures === 0 ? "All resources destroyed. 0 orphans." : "Use Force Nuke to clean up stuck resources.",
      variant: failures === 0 ? "default" : "destructive",
    });
  }, [steps, stepOutputs]);

  // ── Stack-level destroy (all steps, reverse order) ──
  const runStackDestroy = useCallback(async () => {
    setIsRollingBack(true);
    // Force all steps to "done" status so rollback picks them all up
    const allForDestroy = [...steps].filter(s => s.rollbackAction || s.rollbackSpec).reverse();

    if (allForDestroy.length === 0) {
      toast({ title: "No destroyable resources", variant: "destructive" });
      setIsRollingBack(false);
      return;
    }

    toast({ title: "Tearing down stack", description: `Destroying ${allForDestroy.length} resources in reverse dependency order...` });

    let failures = 0;

    for (const step of allForDestroy) {
      const rollbackAction = step.rollbackAction || "destroy";
      const rollbackSpec = buildRollbackSpec(step, stepOutputs);

      setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: "running" } : s));

      try {
        const result = await executeIntent({
          intent: step.intent as any,
          action: rollbackAction as any,
          spec: rollbackSpec,
        });

        if (result.status === "error") throw new Error(result.error || result.message);

        setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: "rolled_back" as any, output: "Destroyed" } : s));
      } catch (e) {
        failures++;
        setSteps(prev => prev.map(s => s.id === step.id ? { ...s, status: "error", output: `Destroy failed: ${e instanceof Error ? e.message : "Unknown"}` } : s));
      }
    }

    setIsRollingBack(false);
    setStepOutputs({});
    toast({
      title: failures === 0 ? "Stack destroyed" : `Teardown finished with ${failures} failure(s)`,
      variant: failures === 0 ? "default" : "destructive",
    });
  }, [steps, stepOutputs]);

  // ── UI Helpers ──
  const statusIcon = (status: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "polling": return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
      case "done": return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case "error": return <XCircle className="h-4 w-4 text-destructive" />;
      case "rolled_back": return <RotateCcw className="h-4 w-4 text-muted-foreground" />;
      default: return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const hasNaawi = stableOps.length > 0;
  const hasSrePattern = SRE_PATTERNS.includes(workloadType as any);
  const hasFailedSteps = steps.some(s => s.status === "error");
  const hasCompletedSteps = steps.some(s => s.status === "done");
  const allDone = steps.length > 0 && steps.every(s => s.status === "done");

  // ── Deployment progress & ETA ──
  const STEP_TIME_ESTIMATES: Record<string, number> = {
    "network:deploy": 15,
    "network:delete_peering": 5,
    "network:destroy": 20,
    "eks:deploy": 720,
    "eks:wait": 0,
    "eks:add_nodegroup": 180,
    "eks:destroy": 300,
    "compute:deploy": 30,
    "compute:destroy": 15,
    "sre-supreme:deploy": 60,
    "naawi:execute": 45,
  };

  const getStepEstimate = (step: DagStep) =>
    STEP_TIME_ESTIMATES[`${step.intent}:${step.action}`] ?? 30;

  const totalEstimatedSeconds = useMemo(() =>
    steps.reduce((sum, s) => sum + getStepEstimate(s), 0),
    [steps]
  );

  const completedCount = steps.filter(s => s.status === "done" || s.status === "rolled_back").length;
  const errorCount = steps.filter(s => s.status === "error").length;
  const activeCount = steps.filter(s => s.status === "running" || s.status === "polling").length;
  const progressPct = steps.length > 0
    ? Math.round(((completedCount + errorCount) / steps.length) * 100)
    : 0;

  const elapsedSeconds = useMemo(() => {
    const doneSteps = steps.filter(s => s.status === "done" || s.status === "error" || s.status === "rolled_back");
    return doneSteps.reduce((sum, s) => sum + getStepEstimate(s), 0);
  }, [steps]);

  const remainingSeconds = useMemo(() => {
    const pending = steps.filter(s => s.status === "pending" || s.status === "running" || s.status === "polling");
    return pending.reduce((sum, s) => sum + getStepEstimate(s), 0);
  }, [steps]);

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  if (isRestoring) {
    return (
      <Card className="bg-card border-primary/20">
        <CardContent className="py-8 flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Restoring deployment state...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            {hasNaawi ? "Project Naawi: SDK Execution" : "Stack Orchestration"}
          </CardTitle>
          <Badge variant="outline" className="text-xs">{steps.length} steps</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Plan / Risk / Cost */}
        {planResult && (
          <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <GitCompareArrows className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Diff & Execution Plan</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={planResult.risk_level === "HIGH" ? "destructive" : "secondary"}>
                  Risk: {planResult.risk_level || "LOW"}
                </Badge>
                {typeof planResult.estimated_monthly_cost_usd === "number" && (
                  <Badge variant="outline" className="gap-1">
                    <DollarSign className="h-3 w-3" /> ~${planResult.estimated_monthly_cost_usd.toFixed(2)}/mo
                  </Badge>
                )}
              </div>
            </div>

            {planResult.operations?.length ? (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Planned SDK Calls</p>
                {planResult.operations.map((op, i) => (
                  <div key={`${op.id}-${i}`} className="text-xs flex items-start gap-2">
                    <Badge variant="outline" className="h-5 text-[10px]">{i + 1}</Badge>
                    <span className="font-mono">{op.service}:{op.command}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              {planResult.discovery?.map((report, i) => (
                <div key={i} className="text-xs flex items-start gap-2">
                  {report.status === "MATCH" ? (
                    <CheckCircle2 className="h-3 w-3 text-primary mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-muted-foreground mt-0.5" />
                  )}
                  <span>
                    <span className="font-medium">{report.operationId}</span>: {report.status === "MATCH" ? "No change (adopt existing)" : "Will create/update"}
                  </span>
                </div>
              ))}
            </div>

            {planResult.requires_approval && (
              <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 border border-destructive/20 mt-2">
                <ShieldAlert className="h-4 w-4 text-destructive" />
                <p className="text-[10px] text-destructive font-medium uppercase tracking-wider">
                  Approval required for high-risk operations
                </p>
              </div>
            )}
          </div>
        )}

        {/* Rolling Deployment Status */}
        {steps.length > 0 && (isRunning || isRollingBack || completedCount > 0 || errorCount > 0) && (
          <div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {allDone ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : hasFailedSteps && !isRunning ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Timer className="h-4 w-4 text-primary animate-pulse" />
                )}
                <span className="text-sm font-semibold">
                  {isRollingBack ? "Rolling Back" : allDone ? "Deployment Complete" : hasFailedSteps && !isRunning ? "Deployment Failed" : "Deploying"}
                </span>
              </div>
              <span className="text-sm font-mono font-bold text-primary">{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-2" />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{completedCount}/{steps.length} steps complete{errorCount > 0 ? ` · ${errorCount} failed` : ""}</span>
              <div className="flex items-center gap-3">
                {(isRunning || isRollingBack) && remainingSeconds > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    ~{formatTime(remainingSeconds)} remaining
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Timer className="h-3 w-3" />
                  Total est: {formatTime(totalEstimatedSeconds)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={step.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                {statusIcon(step.status)}
                {i < steps.length - 1 && (
                  <div className={`w-px flex-1 mt-1 ${step.status === "done" ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {getStepIcon(step)}
                  <span className="text-sm font-semibold">{step.name}</span>
                  <Badge variant={step.status === "done" ? "default" : step.status === "error" ? "destructive" : step.status === "polling" ? "secondary" : step.status === "rolled_back" ? "secondary" : "outline"} className="text-[10px] h-4">
                    {step.status === "polling" ? "provisioning" : step.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground/50 font-mono ml-auto">
                    ~{formatTime(getStepEstimate(step))}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">{step.description}</p>
                {step.dependsOn.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    depends on: {step.dependsOn.join(", ")}
                  </p>
                )}
                {step.output && (step.status === "polling" || step.status === "error") && (
                  <p className="text-[10px] font-mono mt-1 text-muted-foreground bg-muted/50 rounded px-2 py-1 truncate max-w-full">
                    {step.output.slice(0, 200)}
                  </p>
                )}

                {/* Granular EKS debug (shows stage + raw error payloads like "No cluster found") */}
                {step.intent === "eks" && (step.status === "polling" || step.status === "error") && stepOutputs[step.id] && (
                  <details className="mt-2">
                    <summary className="text-[10px] text-muted-foreground cursor-pointer select-none">
                      View EKS details
                    </summary>
                    <pre className="mt-1 text-[10px] font-mono text-muted-foreground bg-muted/30 border border-border rounded p-2 overflow-auto max-h-40">
{JSON.stringify(stepOutputs[step.id], null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>

        <DeploymentDiagram workloadType={workloadType} steps={steps as any} />

        {/* Validation */}
        {steps.some(s => s.status === "done") && (
          <ValidationPhase workloadType={workloadType} deploymentResult={deploymentResult} />
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <Button onClick={runPlan} disabled={isPlanning || isRunning || isRollingBack || steps.length === 0} className="flex-1" variant="secondary">
            {isPlanning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {planResult ? "Refresh Plan" : "Generate Plan"}
          </Button>

          <Button
            onClick={() => runOrchestration(Boolean(planResult?.requires_approval))}
            disabled={isRunning || isPlanning || isRollingBack || !planResult || steps.length === 0}
            className="flex-1"
          >
            {isRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Executing...</>
            ) : (
              <><Rocket className="h-4 w-4 mr-2" /> {planResult?.requires_approval ? "Approve & Execute" : "Execute Stack"}</>
            )}
          </Button>
        </div>

        {/* Rollback & Destroy */}
        {(hasFailedSteps || allDone) && (
          <div className="flex gap-2">
            {hasFailedSteps && hasCompletedSteps && (
              <Button onClick={runRollback} disabled={isRollingBack || isRunning} variant="destructive" className="flex-1" size="sm">
                {isRollingBack ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                Rollback Completed Steps
              </Button>
            )}
            {allDone && (
              <Button onClick={runStackDestroy} disabled={isRollingBack || isRunning} variant="destructive" className="flex-1" size="sm">
                {isRollingBack ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Tear Down Stack
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
