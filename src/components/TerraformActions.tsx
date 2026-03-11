import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TerraformStack, mcpCallTool, generateStackHcl } from "@/lib/terraform-mcp";
import { toast } from "@/hooks/use-toast";
import { Rocket, FileSearch, Trash2, Loader2, CheckCircle2, XCircle, Eye } from "lucide-react";

interface TerraformActionsProps {
  stack: TerraformStack;
  onStatusChange: (status: TerraformStack["status"], output?: string, error?: string) => void;
  hasCredentials: boolean;
  onRequestCredentials: () => void;
}

export function TerraformActions({ stack, onStatusChange, hasCredentials, onRequestCredentials }: TerraformActionsProps) {
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

      if (action === "plan") {
        onStatusChange("planning");
        const result = await mcpCallTool("terraform_plan", {
          hcl,
          workspace: stack.name,
          region: stack.region,
          environment: stack.environment,
        });
        const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        setPlanOutput(output);
        onStatusChange("planned", output);
        toast({ title: "Plan complete", description: "Review the plan output below." });
      } else if (action === "apply") {
        onStatusChange("applying");
        const result = await mcpCallTool("terraform_apply", {
          hcl,
          workspace: stack.name,
          region: stack.region,
          environment: stack.environment,
          auto_approve: true,
        });
        const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        onStatusChange("applied", output);
        toast({ title: "Applied!", description: "Infrastructure deployed successfully." });
      } else if (action === "destroy") {
        onStatusChange("applying");
        const result = await mcpCallTool("terraform_destroy", {
          workspace: stack.name,
          region: stack.region,
          auto_approve: true,
        });
        const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        onStatusChange("destroyed", output);
        toast({ title: "Destroyed", description: "Infrastructure has been torn down." });
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
