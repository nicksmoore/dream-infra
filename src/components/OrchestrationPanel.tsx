import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { executeIntent } from "@/lib/uidi-engine";
import type { EngineResponse } from "@/lib/uidi-engine";
import { toast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle, Circle, Rocket, Network, Server, Box } from "lucide-react";

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
  const [eksRoleArn, setEksRoleArn] = useState("");
  const [eksNodeRoleArn, setEksNodeRoleArn] = useState("");

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
        description: "Managed Kubernetes cluster (creation takes ~10-15 min)",
        icon: <Box className="h-4 w-4" />,
        intent: "eks",
        action: "deploy",
        spec: {
          region, environment,
          cluster_name: `uidi-${environment}-cluster`,
          role_arn: "", // filled at runtime
          subnet_ids: [], // filled from network step
          kubernetes_version: "1.29",
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

  const hasEks = resources.includes("eks");
  const eksValid = !hasEks || eksRoleArn.trim().length > 0;

  async function runOrchestration() {
    if (hasEks && !eksRoleArn) {
      toast({ title: "EKS Role ARN required", description: "Provide the IAM role ARN with AmazonEKSClusterPolicy.", variant: "destructive" });
      return;
    }

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
        spec.role_arn = eksRoleArn;
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
        {/* EKS Role inputs */}
        {hasEks && (
          <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">EKS Configuration</p>
            <div className="space-y-2">
              <Label htmlFor="eks-role" className="text-xs">Cluster Role ARN <span className="text-destructive">*</span></Label>
              <Input
                id="eks-role"
                placeholder="arn:aws:iam::123456789:role/eks-cluster-role"
                value={eksRoleArn}
                onChange={e => setEksRoleArn(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">IAM role with AmazonEKSClusterPolicy attached</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="eks-node-role" className="text-xs">Node Role ARN (optional, for node groups)</Label>
              <Input
                id="eks-node-role"
                placeholder="arn:aws:iam::123456789:role/eks-node-role"
                value={eksNodeRoleArn}
                onChange={e => setEksNodeRoleArn(e.target.value)}
                className="font-mono text-xs"
              />
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

        <Button onClick={runOrchestration} disabled={isRunning || !eksValid} className="w-full">
          {isRunning ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Deploying Stack...</>
          ) : (
            <><Rocket className="h-4 w-4 mr-2" /> Deploy Stack</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
