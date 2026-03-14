import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { executeIntent, reconcile, naawiPlan, naawiExecute } from "@/lib/uidi-engine";
import type { EngineResponse, ReconcileReport } from "@/lib/uidi-engine";
import { toast } from "@/hooks/use-toast";
import { DeploymentDiagram } from "@/components/DeploymentDiagram";
import { ValidationPhase } from "@/components/ValidationPhase";
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

const SRE_PATTERNS = ["global-spa", "service-mesh", "event-pipeline", "internal-api", "three-tier", "edge-cache"] as const;

type PlanResult = {
  discovery?: Array<{ operationId: string; status: string; suggestedAction?: string }>;
  operations?: Array<{ id: string; service: string; command: string }>;
  risk_level?: "LOW" | "HIGH";
  requires_approval?: boolean;
  estimated_monthly_cost_usd?: number;
};

function estimateLocalStepCost(step: OrchestrationStep): number {
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
  const [steps, setSteps] = useState<OrchestrationStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<ReconcileReport | null>(null);
  const [deploymentResult, setDeploymentResult] = useState<any>(null);

  useEffect(() => {
    const buildSteps = (): OrchestrationStep[] => {
      const result: OrchestrationStep[] = [];

      // ── Project Naawi: Granular SDK Operations (Highest Priority) ──
      if (stableOps && stableOps.length > 0) {
        stableOps.forEach(op => {
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

      // ── Cross-Region Peered Architecture (custom multi-step) ──
      if (workloadType === "cross-region-peered") {
        result.push({
          id: "data-vpc",
          name: "eu-central-1: Data VPC",
          description: "VPC 10.1.0.0/16 with private subnet in Frankfurt",
          icon: <Network className="h-4 w-4" />,
          intent: "network",
          action: "deploy",
          spec: { region: "eu-central-1", environment, name: `data-vpc-${environment}`, vpc_cidr: "10.1.0.0/16", az_count: 1, public_subnets: false },
          status: "pending",
        });
        result.push({
          id: "eks-vpc",
          name: "us-east-1: EKS Management VPC",
          description: "VPC 10.0.0.0/16 with public + private subnets in N. Virginia",
          icon: <Network className="h-4 w-4" />,
          intent: "network",
          action: "deploy",
          spec: { region: "us-east-1", environment, name: `eks-vpc-${environment}`, vpc_cidr: "10.0.0.0/16", az_count: 3 },
          status: "pending",
        });
        result.push({
          id: "vpc-peering",
          name: "VPC Peering: us-east-1 ↔ eu-central-1",
          description: "Cross-region peering connection with auto-accept + route propagation",
          icon: <GitCompareArrows className="h-4 w-4 text-primary" />,
          intent: "network",
          action: "deploy",
          spec: { region: "us-east-1", peer_region: "eu-central-1", requester_vpc: `eks-vpc-${environment}`, accepter_vpc: `data-vpc-${environment}`, type: "vpc-peering" },
          status: "pending",
        });
        result.push({
          id: "peering-routes",
          name: "Route Tables: Cross-Region Routes",
          description: "Inject routes for 10.1.0.0/16 ↔ 10.0.0.0/16 via peering connection",
          icon: <Network className="h-4 w-4" />,
          intent: "network",
          action: "deploy",
          spec: { region: "us-east-1", peer_region: "eu-central-1", type: "peering-routes" },
          status: "pending",
        });
        result.push({
          id: "eks-cluster",
          name: "us-east-1: EKS Cluster",
          description: "Managed Kubernetes cluster with route to eu-central-1 Data VPC (~10-15 min)",
          icon: <Box className="h-4 w-4" />,
          intent: "eks",
          action: "deploy",
          spec: { region: "us-east-1", environment, cluster_name: `eks-${environment}-cluster`, subnet_ids: [], kubernetes_version: "1.29" },
          status: "pending",
        });
        result.push({
          id: "eks-nodegroup",
          name: "us-east-1: EKS Node Group",
          description: "t3.medium managed node group (2 nodes)",
          icon: <Server className="h-4 w-4" />,
          intent: "eks",
          action: "add_nodegroup",
          spec: { region: "us-east-1", cluster_name: `eks-${environment}-cluster`, instance_types: ["t3.medium"], desired_size: 2, min_size: 1, max_size: 3 },
          status: "pending",
        });
        return result;
      }

      // SRE-Supreme Pattern Detection
      if (SRE_PATTERNS.includes(workloadType as (typeof SRE_PATTERNS)[number])) {
        result.push({
          id: "sre-pattern",
          name: `SRE Supreme: ${workloadType.toUpperCase()}`,
          description: `Deploying professional-grade ${workloadType} pattern with SRE Moat features.`,
          icon: <ShieldCheck className="h-4 w-4 text-primary" />,
          intent: "sre-supreme",
          action: "deploy",
          spec: { workload_type: workloadType, region, environment, name: `sre-${workloadType}-${environment}`, intentText: workloadType },
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
  }, [stableOps, resources, region, environment, workloadType, instanceType, os]);

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

      const isSrePattern = SRE_PATTERNS.includes(workloadType as (typeof SRE_PATTERNS)[number]);
      if (isSrePattern) {
        const result = await executeIntent({
          intent: "sre-supreme",
          action: "plan",
          spec: {
            workload_type: workloadType,
            region,
            environment,
            name: `sre-${workloadType}-${environment}`,
            intentText: workloadType,
          },
        });

        if (result.status !== "success") throw new Error(result.error || result.message || "Plan failed");
        setPlanResult(result.details as PlanResult);
        toast({ title: "SRE Plan Ready", description: "Review planned SDK calls, diff, and cost before execution." });
        return;
      }

      // Fallback local plan for non-SRE orchestration
      const estimated = steps.reduce((sum, step) => sum + estimateLocalStepCost(step), 0);
      setPlanResult({
        risk_level: "LOW",
        requires_approval: false,
        estimated_monthly_cost_usd: estimated,
        discovery: steps.map((step) => ({ operationId: step.id, status: "NOT_FOUND", suggestedAction: "CREATE" })),
        operations: steps.map((step) => ({ id: step.id, service: step.intent.toUpperCase(), command: step.action })),
      });
      toast({ title: "Plan Ready", description: "Preview generated with estimated cost." });
    } catch (e) {
      toast({ title: "Planning failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsPlanning(false);
    }
  }

  async function runOrchestration(approved = false) {
    setIsRunning(true);

    if (stableOps.length > 0) {
      try {
        setSteps(prev => prev.map(s => ({ ...s, status: "running" })));
        const result = await naawiExecute({ operations: stableOps, region }, approved);
        
        if (result.status === "error") throw new Error(result.error || result.message);

        setSteps(prev => prev.map(s => ({ ...s, status: "done", output: JSON.stringify(result.details, null, 2) })));
        setDeploymentResult(result.details);
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

    // Step-by-step logic with output threading (cross-region DAG)
    const stepOutputs: Record<string, any> = {};

    for (let i = 0; i < steps.length; i++) {
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "running" } : s));
      const step = steps[i];
      const spec = { ...step.spec };

      // ── Output Threading: inject prior step outputs into downstream specs ──
      if (step.id === "eks-cluster" || step.id === "eks") {
        // Thread subnet IDs from the EKS VPC (or fallback network step)
        const vpcOutput = stepOutputs["eks-vpc"] || stepOutputs["network"];
        if (vpcOutput) {
          const subnetIds = vpcOutput.subnet_ids || vpcOutput.subnets?.map((s: any) => s.SubnetId || s.subnet_id) || [];
          if (subnetIds.length > 0) {
            spec.subnet_ids = subnetIds;
          }
          if (vpcOutput.security_group_id) {
            spec.security_group_ids = [vpcOutput.security_group_id];
          }
        }
      }

      if (step.id === "eks-nodegroup") {
        // Thread cluster name + subnets + auto-resolve node role
        const eksOutput = stepOutputs["eks-cluster"] || stepOutputs["eks"];
        const vpcOutput = stepOutputs["eks-vpc"] || stepOutputs["network"];
        if (eksOutput?.cluster_name) spec.cluster_name = eksOutput.cluster_name;
        if (vpcOutput) {
          const subnetIds = vpcOutput.subnet_ids || vpcOutput.subnets?.map((s: any) => s.SubnetId || s.subnet_id) || [];
          if (subnetIds.length > 0) spec.subnet_ids = subnetIds;
        }
      }

      if (step.id === "vpc-peering") {
        // Thread VPC IDs from the two VPC steps
        const dataVpc = stepOutputs["data-vpc"];
        const eksVpc = stepOutputs["eks-vpc"];
        if (dataVpc?.vpc_id) spec.accepter_vpc_id = dataVpc.vpc_id;
        if (eksVpc?.vpc_id) spec.requester_vpc_id = eksVpc.vpc_id;
      }

      if (step.id === "peering-routes") {
        const peeringOutput = stepOutputs["vpc-peering"];
        if (peeringOutput?.peering_connection_id) spec.peering_connection_id = peeringOutput.peering_connection_id;
        const dataVpc = stepOutputs["data-vpc"];
        const eksVpc = stepOutputs["eks-vpc"];
        if (dataVpc?.route_table_id) spec.accepter_route_table_id = dataVpc.route_table_id;
        if (eksVpc?.route_table_id) spec.requester_route_table_id = eksVpc.route_table_id;
      }

      try {
        const result = await executeIntent({
          intent: step.intent as any,
          action: step.action as any,
          spec,
        });

        if (result.status === "error") throw new Error(result.error || result.message);
        
        // Store output for downstream threading
        if (result.details && typeof result.details === "object") {
          stepOutputs[step.id] = result.details;
        }

        setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "done", output: result.details ? JSON.stringify(result.details, null, 2) : result.message, result } : s));
        if (i === steps.length - 1) setDeploymentResult(result.details);
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

  const hasNaawi = stableOps.length > 0;
  const hasSrePattern = SRE_PATTERNS.includes(workloadType as (typeof SRE_PATTERNS)[number]);

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

        {/* Deployment DAG Diagram (collapsible, below plan) */}

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

        <DeploymentDiagram workloadType={workloadType} steps={steps} />

        {/* Validation & Security Scan — shown after deployment */}
        {steps.some(s => s.status === "done") && (
          <ValidationPhase
            workloadType={workloadType}
            deploymentResult={deploymentResult}
          />
        )}

        <div className="flex gap-2">
          <Button onClick={runPlan} disabled={isPlanning || isRunning || steps.length === 0} className="flex-1" variant="secondary">
            {isPlanning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
            {planResult ? "Refresh Plan" : "Generate Plan"}
          </Button>
          
          <Button 
            onClick={() => runOrchestration(Boolean(planResult?.requires_approval))} 
            disabled={isRunning || isPlanning || !planResult || steps.length === 0 || (hasNaawi && !planResult) || (hasSrePattern && !planResult)} 
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
