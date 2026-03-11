import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { executeIntent, EngineResponse } from "@/lib/uidi-engine";
import { Ec2Config } from "@/lib/intent-types";
import { toast } from "@/hooks/use-toast";
import { Rocket, FileSearch, Trash2, Loader2, CheckCircle2, XCircle, Eye, Cpu } from "lucide-react";

type Status = "idle" | "dry_run_passed" | "deploying" | "deployed" | "failed" | "destroyed";

interface ComputeActionsProps {
  config: Ec2Config;
  hasCredentials: boolean;
  onRequestCredentials: () => void;
}

export function ComputeActions({ config, hasCredentials, onRequestCredentials }: ComputeActionsProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);

  const runAction = async (action: "dry_run" | "deploy" | "destroy") => {
    if (!hasCredentials) {
      onRequestCredentials();
      return;
    }

    setIsRunning(true);
    setCurrentAction(action);
    setError(null);

    try {
      const spec: Record<string, unknown> = {
        instance_type: config.instanceType,
        os: config.amiId || "amazon-linux-2023",
        region: config.region,
        environment: config.tags?.Environment || "dev",
        name: config.tags?.Name || "uidi-instance",
        count: config.instanceCount || 1,
      };

      if (config.subnetId) spec.subnet_id = config.subnetId;
      if (config.keyName) spec.key_name = config.keyName;
      if (config.securityGroupIds?.length) spec.security_group_ids = config.securityGroupIds;
      if (config.userData) spec.user_data = config.userData;
      if (config.iamInstanceProfile) spec.iam_instance_profile = config.iamInstanceProfile;
      if (config.rootVolumeSize) spec.root_volume_size = config.rootVolumeSize;
      if (config.rootVolumeType) spec.root_volume_type = config.rootVolumeType;

      if (action === "destroy" && instanceId) {
        spec.instance_id = instanceId;
      }

      const result: EngineResponse = await executeIntent({
        intent: "compute",
        action,
        spec,
      });

      const resultOutput = result.details
        ? JSON.stringify(result.details, null, 2)
        : result.message ?? "Operation completed";

      if (result.status === "error") {
        throw new Error(result.error ?? result.message ?? "Engine returned an error");
      }

      setOutput(resultOutput);

      if (action === "dry_run") {
        setStatus("dry_run_passed");
        toast({ title: "Dry run passed", description: "Validation successful — ready to deploy." });
      } else if (action === "deploy") {
        setStatus("deployed");
        if (result.details && typeof result.details === "object" && "instance_id" in (result.details as Record<string, unknown>)) {
          setInstanceId((result.details as Record<string, unknown>).instance_id as string);
        }
        toast({ title: "Deployed!", description: "Instance launched via UIDI SDK Engine." });
      } else {
        setStatus("destroyed");
        setInstanceId(null);
        toast({ title: "Destroyed", description: "Instance terminated via UIDI SDK Engine." });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      setStatus("failed");
      setError(errMsg);
      toast({ title: `${action} failed`, description: errMsg, variant: "destructive" });
    } finally {
      setIsRunning(false);
      setCurrentAction(null);
    }
  };

  const statusIcon = () => {
    switch (status) {
      case "dry_run_passed":
      case "deployed":
        return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <Button
          variant="outline"
          onClick={() => runAction("dry_run")}
          disabled={isRunning}
        >
          {isRunning && currentAction === "dry_run" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileSearch className="h-4 w-4 mr-2" />}
          Dry Run
        </Button>
        <Button
          onClick={() => runAction("deploy")}
          disabled={isRunning}
          className="px-8"
        >
          {isRunning && currentAction === "deploy" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Rocket className="h-4 w-4 mr-2" />}
          Deploy
        </Button>
        <Button
          variant="destructive"
          onClick={() => runAction("destroy")}
          disabled={isRunning || !instanceId}
        >
          {isRunning && currentAction === "destroy" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
          Destroy
        </Button>
      </div>

      <div className="flex justify-center">
        <Badge variant="outline" className="gap-1 text-xs">
          <Cpu className="h-3 w-3" /> UIDI SDK Engine → AWS EC2 API
        </Badge>
      </div>

      {(output || error) && (
        <Card className="bg-muted/30">
          <CardContent className="py-3 px-4 space-y-2">
            <div className="flex items-center gap-2">
              {statusIcon()}
              <span className="text-sm font-semibold capitalize">{status.replace(/_/g, " ")}</span>
              {status === "dry_run_passed" && (
                <Badge variant="outline" className="text-xs">
                  <Eye className="h-3 w-3 mr-1" /> Ready to deploy
                </Badge>
              )}
            </div>
            {output && (
              <pre className="bg-background rounded p-3 text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto leading-relaxed">
                {output}
              </pre>
            )}
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
