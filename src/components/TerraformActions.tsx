import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TerraformStack,
  generateStackHcl,
  N8N_WORKFLOW_ID,
  buildOrchestratorMessage,
  UidiOrchestratorResponse,
} from "@/lib/terraform-mcp";
import { toast } from "@/hooks/use-toast";
import { Rocket, FileSearch, Trash2, Loader2, CheckCircle2, XCircle, Eye, Zap } from "lucide-react";

interface TerraformActionsProps {
  stack: TerraformStack;
  onStatusChange: (status: TerraformStack["status"], output?: string, error?: string) => void;
  hasCredentials: boolean;
  onRequestCredentials: () => void;
  executeWorkflow?: (workflowId: string, inputs: unknown) => Promise<unknown>;
}

export function TerraformActions({ stack, onStatusChange, hasCredentials, onRequestCredentials, executeWorkflow }: TerraformActionsProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [planOutput, setPlanOutput] = useState<string | null>(stack.planOutput ?? null);

  const runAction = async (action: "plan" | "apply" | "destroy") => {
    if (!hasCredentials) {
      onRequestCredentials();
      return;
    }

    if (stack.resources.length === 0) {
      toast({ title: "No resources", description: "Add at least one resource to your stack.", variant: "destructive" });
      return;
    }

    setIsRunning(true);
    setCurrentAction(action);

    try {
      const hcl = generateStackHcl(stack);

      const message = buildOrchestratorMessage({
        intent: "terraform",
        action,
        spec: {
          hcl,
          workspace: stack.name,
          region: stack.region,
          environment: stack.environment,
          auto_approve: action !== "plan",
        },
      });

      if (executeWorkflow) {
        // Route through n8n orchestrator
        if (action === "plan") onStatusChange("planning");
        else if (action === "apply") onStatusChange("applying");
        else onStatusChange("applying");

        const result = await executeWorkflow(N8N_WORKFLOW_ID, {
          type: "chat",
          chatInput: message,
        });

        const response = parseOrchestratorResponse(result);
        const output = response.details
          ? JSON.stringify(response.details, null, 2)
          : response.message ?? "Operation completed";

        if (response.status === "error") {
          throw new Error(response.error ?? response.message ?? "Orchestrator returned an error");
        }

        if (action === "plan") {
          setPlanOutput(output);
          onStatusChange("planned", output);
          toast({ title: "Plan complete", description: "Review the plan output below." });
        } else if (action === "apply") {
          onStatusChange("applied", output);
          toast({ title: "Applied!", description: "Infrastructure deployed via n8n orchestrator." });
        } else {
          onStatusChange("destroyed", output);
          toast({ title: "Destroyed", description: "Infrastructure torn down via n8n orchestrator." });
        }
      } else {
        // Fallback: direct MCP proxy (legacy)
        const { mcpCallTool } = await import("@/lib/terraform-mcp");

        if (action === "plan") {
          onStatusChange("planning");
          const result = await mcpCallTool("terraform_plan", {
            hcl, workspace: stack.name, region: stack.region, environment: stack.environment,
          });
          const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          setPlanOutput(output);
          onStatusChange("planned", output);
          toast({ title: "Plan complete", description: "Review the plan output below." });
        } else if (action === "apply") {
          onStatusChange("applying");
          const result = await mcpCallTool("terraform_apply", {
            hcl, workspace: stack.name, region: stack.region, environment: stack.environment, auto_approve: true,
          });
          const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          onStatusChange("applied", output);
          toast({ title: "Applied!", description: "Infrastructure deployed successfully." });
        } else {
          onStatusChange("applying");
          const result = await mcpCallTool("terraform_destroy", {
            workspace: stack.name, region: stack.region, auto_approve: true,
          });
          const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          onStatusChange("destroyed", output);
          toast({ title: "Destroyed", description: "Infrastructure has been torn down." });
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      onStatusChange("failed", undefined, errMsg);
      toast({ title: `${action} failed`, description: errMsg, variant: "destructive" });
    } finally {
      setIsRunning(false);
      setCurrentAction(null);
    }
  };

  const statusIcon = () => {
    switch (stack.status) {
      case "planned": return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case "applied": return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case "failed": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <Button
          variant="outline"
          onClick={() => runAction("plan")}
          disabled={isRunning || stack.resources.length === 0}
        >
          {isRunning && currentAction === "plan" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileSearch className="h-4 w-4 mr-2" />}
          Plan
        </Button>
        <Button
          onClick={() => runAction("apply")}
          disabled={isRunning || stack.resources.length === 0}
          className="px-8"
        >
          {isRunning && currentAction === "apply" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />}
          Apply
        </Button>
        <Button
          variant="destructive"
          onClick={() => runAction("destroy")}
          disabled={isRunning || stack.status === "draft"}
        >
          {isRunning && currentAction === "destroy" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
          Destroy
        </Button>
      </div>

      {executeWorkflow && (
        <div className="flex justify-center">
          <Badge variant="outline" className="gap-1 text-xs">
            <Zap className="h-3 w-3" /> Routed via n8n Orchestrator
          </Badge>
        </div>
      )}

      {(planOutput || stack.error) && (
        <Card className="bg-muted/30">
          <CardContent className="py-3 px-4 space-y-2">
            <div className="flex items-center gap-2">
              {statusIcon()}
              <span className="text-sm font-semibold capitalize">{stack.status}</span>
              {stack.status === "planned" && (
                <Badge variant="outline" className="text-xs">
                  <Eye className="h-3 w-3 mr-1" /> Review before applying
                </Badge>
              )}
            </div>
            {planOutput && (
              <pre className="bg-background rounded p-3 text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto leading-relaxed">
                {planOutput}
              </pre>
            )}
            {stack.error && (
              <p className="text-sm text-destructive">{stack.error}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function parseOrchestratorResponse(result: unknown): UidiOrchestratorResponse {
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    return {
      status: (r.status as "success" | "error") ?? "success",
      platform: r.platform as string | undefined,
      message: r.message as string | undefined,
      error: r.error as string | undefined,
      details: r.details,
      timestamp: r.timestamp as string | undefined,
    };
  }
  return { status: "success", message: String(result) };
}
