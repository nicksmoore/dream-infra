import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TerraformStack, generateStackHcl } from "@/lib/terraform-mcp";
import { executeIntent, EngineResponse } from "@/lib/uidi-engine";
import { toast } from "@/hooks/use-toast";
import { Rocket, FileSearch, Trash2, Loader2, CheckCircle2, XCircle, Eye, Cpu } from "lucide-react";

interface TerraformActionsProps {
  stack: TerraformStack;
  onStatusChange: (status: TerraformStack["status"], output?: string, error?: string) => void;
  hasCredentials: boolean;
  onRequestCredentials: () => void;
  workspaceId?: string;
}

export function TerraformActions({ stack, onStatusChange, hasCredentials, onRequestCredentials, workspaceId }: TerraformActionsProps) {
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

      if (action === "plan") onStatusChange("planning");
      else onStatusChange("applying");

      const result: EngineResponse = await executeIntent({
        intent: "terraform",
        action,
        spec: {
          workspace_id: workspaceId || stack.workspaceId || stack.name,
          organization: stack.organization,
          hcl,
          region: stack.region,
          environment: stack.environment,
        },
        metadata: { project: stack.name },
      });

      const output = result.details
        ? JSON.stringify(result.details, null, 2)
        : result.message ?? "Operation completed";

      if (result.status === "error") {
        throw new Error(result.error ?? result.message ?? "Engine returned an error");
      }

      if (action === "plan") {
        setPlanOutput(output);
        onStatusChange("planned", output);
        toast({ title: "Plan complete", description: "Review the plan output below." });
      } else if (action === "apply") {
        onStatusChange("applied", output);
        toast({ title: "Applied!", description: "Infrastructure deployed via UIDI Core Engine." });
      } else {
        onStatusChange("destroyed", output);
        toast({ title: "Destroyed", description: "Infrastructure torn down via UIDI Core Engine." });
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

      <div className="flex justify-center">
        <Badge variant="outline" className="gap-1 text-xs">
          <Cpu className="h-3 w-3" /> UIDI Core Engine → HCP Terraform API
        </Badge>
      </div>

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
