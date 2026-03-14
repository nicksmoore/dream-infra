import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { executeIntent, reconcile, naawiPlan, naawiExecute } from "@/lib/uidi-engine";
import type { EngineResponse, ReconcileReport } from "@/lib/uidi-engine";
import { toast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, Circle, Rocket, Network, Server, Box, ShieldCheck, AlertTriangle, Eye, ShieldAlert, DollarSign, GitCompareArrows } from "lucide-react";

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
  workloadType?: string;
  instanceType?: string;
  os?: string;
  naawiOperations?: any[];
  onComplete?: () => void;
}

export function OrchestrationPanel({
  resources,
  region,
  environment,
  workloadType = "general",
  instanceType = "t3.medium",
  os = "amazon-linux-2023",
  naawiOperations = [],
  onComplete,
}: OrchestrationPanelProps) {
  const [steps, setSteps] = useState<OrchestrationStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planResult, setPlanResult] = useState<any>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null);

  useEffect(() => {
    const buildSteps = (): OrchestrationStep[] => {
      const result: OrchestrationStep[] = [];

      // ── Project Naawi: Granular SDK Operations (Highest Priority) ──
      if (naawiOperations && naawiOperations.length > 0) {
        naawiOperations.forEach(op => {
          result.push({
            id: op.id,
            name: `${op.service}.${op.command}`,
            description: `Direct SDK call: ${op.id} (Risk: ${op.riskLevel})`,
            icon: <Box className="h-4 w-4" />,
            intent: "naawi",
            action: "execute",
            spec: { operations: [op], region },
            status: "pending",
          });
        });
        return result;
      }

      // SRE-Supreme Pattern Detection
      const srePatterns = ["global-spa", "service-mesh", "event-pipeline", "internal-api", "three-tier"];
      if (srePatterns.includes(workloadType)) {
        result.push({
          id: "sre-pattern",
          name: `SRE Supreme: ${workloadType.toUpperCase()}`,
          description: `Deploying professional-grade ${workloadType} pattern with SRE Moat features.`,
          icon: <ShieldCheck className="h-4 w-4 text-primary" />,
          intent: "sre-supreme",
          action: "deploy",
          spec: { workload_type: workloadType, region, environment, name: `sre-${workloadType}-${environment}` },
          status: "pending",
        });
        return result;
      }

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
          spec: { region, environment, cluster_name: `uidi-${environment}-cluster`, subnet_ids: [], kubernetes_version: "1.29" },
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
          spec: { instance_type: instanceType, os, region, environment, name: `uidi-${environment}-instance`, count: 1 },
          status: "pending",
        });
      }

      return result;
    };

    setSteps(buildSteps());
    setPlanResult(null); // Reset plan when input changes
  }, [naawiOperations, resources, region, environment, workloadType, instanceType, os]);

  async function runPlan() {
    if (naawiOperations.length === 0) return;
    setIsPlanning(true);
    try {
      const result = await naawiPlan({ operations: naawiOperations, region });
      if (result.status === "success") {
        setPlanResult(result.details);
        toast({ title: "Naawi Plan Ready", description: "Review the discovery report before execution." });
      } else {
        throw new Error(result.error || "Plan failed");
      }
    } catch (e) {
      toast({ title: "Planning failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsPlanning(false);
    }
  }

  async function runOrchestration(approved = false) {
    setIsRunning(true);
    let networkResult: EngineResponse | null = null;

    if (naawiOperations.length > 0) {
      try {
        setSteps(prev => prev.map(s => ({ ...s, status: "running" })));
        const result = await naawiExecute({ operations: naawiOperations, region }, approved);
        
        if (result.status === "error") throw new Error(result.error || result.message);

        setSteps(prev => prev.map(s => ({ ...s, status: "done", output: JSON.stringify(result.details, null, 2) })));
        toast({ title: "Deployment successful", description: result.message });
        onComplete?.();
      } catch (e) {
        setSteps(prev => prev.map(s => ({ ...s, status: "error", output: e instanceof Error ? e.message : "Failed" })));
        toast({ title: "Deployment failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
      } finally {
        setIsRunning(false);
      }
      return;
    }

    // Step-by-step logic (SRE-Supreme or standard)
    for (let i = 0; i < steps.length; i++) {
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "running" } : s));
      const step = steps[i];
      const spec = { ...step.spec };

      try {
        const result = await executeIntent({
          intent: step.intent as any,
          action: step.action as any,
          spec,
        });

        if (result.status === "error") throw new Error(result.error || result.message);
        if (step.id === "network") networkResult = result;

        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "done", output: result.details ? JSON.stringify(result.details, null, 2) : result.message, result } : s));
        toast({ title: `${step.name} complete`, description: result.message });
      } catch (e) {
        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "error", output: e instanceof Error ? e.message : "Failed" } : s));
        toast({ title: `${step.name} failed`, description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
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

  const hasNaawi = naawiOperations.length > 0;

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
        {/* Naawi Plan / Risk Alert */}
        {planResult && (
          <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Discovery Plan</span>
              </div>
              <Badge variant={planResult.risk_level === "HIGH" ? "destructive" : "secondary"}>
                Risk: {planResult.risk_level}
              </Badge>
            </div>
            
            <div className="space-y-2">
              {planResult.discovery?.map((report: any, i: number) => (
                <div key={i} className="text-xs flex items-start gap-2">
                  {report.status === "MATCH" ? (
                    <CheckCircle2 className="h-3 w-3 text-primary mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5" />
                  )}
                  <span>
                    <span className="font-medium">{report.operationId}</span>: 
                    {report.status === "MATCH" ? " Existing resource found (Safe)" : " Resource missing (Will Create)"}
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
                  <span className="text-sm font-semibold">{step.name}</span>
                  <Badge variant={step.status === "done" ? "default" : step.status === "error" ? "destructive" : "outline"} className="text-[10px] h-4">
                    {step.status}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          {hasNaawi && !planResult && (
            <Button onClick={runPlan} disabled={isPlanning || isRunning} className="flex-1" variant="secondary">
              {isPlanning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              Generate Plan
            </Button>
          )}
          
          <Button 
            onClick={() => runOrchestration(planResult?.requires_approval)} 
            disabled={isRunning || isPlanning || (hasNaawi && !planResult)} 
            className="flex-1"
          >
            {isRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Executing...</>
            ) : (
              <><Rocket className="h-4 w-4 mr-2" /> {planResult?.requires_approval ? "Approve & Execute" : "Execute Stack"}</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
