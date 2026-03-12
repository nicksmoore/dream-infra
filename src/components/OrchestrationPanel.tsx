import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { executeIntent, reconcile } from "@/lib/uidi-engine";
import type { EngineResponse, ReconcileReport } from "@/lib/uidi-engine";
import { toast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, Circle, Rocket, Network, Server, Box, ShieldCheck, RefreshCw, AlertTriangle } from "lucide-react";

interface OrchestrationStep {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  intent: string;
  action: string;
  spec: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error";
  output?: string;
  result?: EngineResponse;
}

interface OrchestrationPanelProps {
  resources: string[];
  region: string;
  environment: string;
  instanceType?: string;
  os?: string;
  onComplete?: () => void;
}

export function OrchestrationPanel({
  resources,
  region,
  environment,
  instanceType = "t3.medium",
  os = "amazon-linux-2023",
  onComplete,
}: OrchestrationPanelProps) {
  const buildSteps = (): OrchestrationStep[] => {
    const result: OrchestrationStep[] = [];

    if (resources.some(r => ["vpc", "subnets", "nacls"].includes(r))) {
      result.push({
        id: "network",
        name: "Network Stack",
        description: "VPC, Subnets (public + private), Internet Gateway, Route Tables, NACLs, Security Group",
        icon: <Network className="h-4 w-4" />,
        intent: "network",
        action: "deploy",
        spec: { region, environment, name: `uidi-vpc-${environment}`, vpc_cidr: "10.0.0.0/16", az_count: 2 },
        status: "pending",
      });
    }

    if (resources.includes("eks")) {
      result.push({
        id: "eks",
        name: "EKS Cluster",
        description: "Managed Kubernetes cluster — IAM role auto-provisioned (~10-15 min)",
        icon: <Box className="h-4 w-4" />,
        intent: "eks",
        action: "deploy",
        spec: {
          region, environment,
          cluster_name: `uidi-${environment}-cluster`,
          subnet_ids: [], // filled from network step
          kubernetes_version: "1.29",
          // role_arn intentionally omitted — engine auto-resolves
        },
        status: "pending",
      });
    }

    if (resources.includes("ec2")) {
      result.push({
        id: "ec2",
        name: "EC2 Instance",
        description: `${instanceType} running ${os}`,
        icon: <Server className="h-4 w-4" />,
        intent: "compute",
        action: "deploy",
        spec: {
          instance_type: instanceType,
          os, region, environment,
          name: `uidi-${environment}-instance`,
          count: 1,
        },
        status: "pending",
      });
    }

    return result;
  };

  const [steps, setSteps] = useState<OrchestrationStep[]>(buildSteps);
  const [isRunning, setIsRunning] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null);

  async function runOrchestration() {
    setIsRunning(true);
    let networkResult: EngineResponse | null = null;

    const currentSteps = buildSteps();
    setSteps(currentSteps.map(s => ({ ...s, status: "pending" })));

    for (let i = 0; i < currentSteps.length; i++) {
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "running" } : s));

      const step = currentSteps[i];
      const spec = { ...step.spec };

      // Wire dependencies from previous steps
      if (step.id === "eks" && networkResult?.details) {
        const details = networkResult.details as Record<string, unknown>;
        const subnets = details.subnets as { id: string; type: string }[];
        spec.subnet_ids = subnets?.map(s => s.id) || [];
        spec.security_group_ids = details.security_group_id ? [details.security_group_id] : [];
      }

      if (step.id === "ec2" && networkResult?.details) {
        const details = networkResult.details as Record<string, unknown>;
        const subnets = details.subnets as { id: string; type: string }[];
        const publicSubnet = subnets?.find(s => s.type === "public");
        if (publicSubnet) spec.subnet_id = publicSubnet.id;
        if (details.security_group_id) spec.security_group_ids = [details.security_group_id];
      }

      try {
        const result = await executeIntent({
          intent: step.intent as "compute" | "network" | "eks",
          action: step.action as "deploy",
          spec,
        });

        if (result.status === "error") {
          throw new Error(result.error || result.message || "Step failed");
        }

        if (step.id === "network") networkResult = result;

        const output = result.details ? JSON.stringify(result.details, null, 2) : result.message || "Done";
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "done", output, result } : s));
        toast({ title: `${step.name} complete`, description: result.message });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Unknown error";
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "error", output: errMsg } : s));
        toast({ title: `${step.name} failed`, description: errMsg, variant: "destructive" });
        setIsRunning(false);
        return;
      }
    }

    setIsRunning(false);
    toast({ title: "Stack deployed!", description: "All resources provisioned successfully." });
    onComplete?.();
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "done": return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case "error": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const hasEks = resources.includes("eks");

  return (
    <Card className="bg-card border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Stack Orchestration
          </CardTitle>
          <Badge variant="outline" className="text-xs">{steps.length} steps</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* IAM auto-provision notice */}
        {hasEks && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">IAM roles auto-managed</span> — The engine will discover or create{" "}
              <code className="text-xs bg-muted px-1 rounded">UIDI-EKS-Cluster-Role</code> with the correct trust policy and policies attached.
            </p>
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
                <div className="flex items-center gap-2">
                  {step.icon}
                  <span className="text-sm font-semibold">{step.name}</span>
                  <Badge
                    variant={step.status === "done" ? "default" : step.status === "error" ? "destructive" : "outline"}
                    className="text-xs capitalize"
                  >
                    {step.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                {step.output && (
                  <pre className="mt-2 bg-muted/30 rounded p-2 text-xs font-mono overflow-x-auto max-h-[200px] overflow-y-auto">
                    {step.output}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Reconcile Report */}
        {reconcileReport && (
          <div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Reconciliation Report</span>
              <Badge variant="outline" className="text-xs font-mono">{reconcileReport.intent_hash.slice(0, 12)}…</Badge>
            </div>
            <div className="flex gap-2 flex-wrap">
              {reconcileReport.summary.matched > 0 && <Badge className="text-xs bg-primary/20 text-primary">{reconcileReport.summary.matched} matched</Badge>}
              {reconcileReport.summary.drifted > 0 && <Badge variant="destructive" className="text-xs">{reconcileReport.summary.drifted} drifted</Badge>}
              {reconcileReport.summary.created > 0 && <Badge className="text-xs bg-primary/20 text-primary">{reconcileReport.summary.created} created</Badge>}
              {reconcileReport.summary.failed > 0 && <Badge variant="destructive" className="text-xs">{reconcileReport.summary.failed} failed</Badge>}
            </div>
            {reconcileReport.actions_taken.map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {a.action === "none" ? <CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" /> :
                  a.action.includes("drift") ? <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" /> :
                  a.action.includes("fail") || a.action === "error" ? <XCircle className="h-3 w-3 text-destructive mt-0.5 shrink-0" /> :
                  <CheckCircle2 className="h-3 w-3 text-primary mt-0.5 shrink-0" />}
                <span><span className="font-medium uppercase">{a.resource}</span>: {a.result}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={runOrchestration} disabled={isRunning || isReconciling} className="flex-1">
            {isRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Deploying Stack...</>
            ) : (
              <><Rocket className="h-4 w-4 mr-2" /> Deploy Stack</>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              setIsReconciling(true);
              setReconcileReport(null);
              try {
                const desiredResources: Record<string, unknown> = {};
                if (resources.some(r => ["vpc", "subnets", "nacls"].includes(r))) {
                  desiredResources.network = { name: `uidi-vpc-${environment}`, vpc_cidr: "10.0.0.0/16", az_count: 2 };
                }
                if (resources.includes("eks")) {
                  desiredResources.eks = { cluster_name: `uidi-${environment}-cluster`, kubernetes_version: "1.29" };
                }
                if (resources.includes("ec2")) {
                  desiredResources.compute = { name: `uidi-${environment}-instance`, instance_type: instanceType, os, count: 1 };
                }
                const result = await reconcile({ environment, region, desired_resources: desiredResources as any });
                if (result.details) setReconcileReport(result.details as ReconcileReport);
                toast({ title: "Reconciliation complete", description: result.message });
              } catch (e) {
                toast({ title: "Reconciliation failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
              } finally {
                setIsReconciling(false);
              }
            }}
            disabled={isRunning || isReconciling}
          >
            {isReconciling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
