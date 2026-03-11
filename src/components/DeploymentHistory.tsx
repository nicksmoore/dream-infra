import { Deployment } from "@/lib/intent-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, CheckCircle2, Loader2, XCircle, Clock } from "lucide-react";

interface DeploymentHistoryProps {
  deployments: Deployment[];
}

const statusConfig = {
  pending: { icon: Clock, label: "Pending", variant: "secondary" as const },
  launching: { icon: Loader2, label: "Launching", variant: "secondary" as const },
  running: { icon: CheckCircle2, label: "Running", variant: "default" as const },
  failed: { icon: XCircle, label: "Failed", variant: "destructive" as const },
};

export function DeploymentHistory({ deployments }: DeploymentHistoryProps) {
  if (deployments.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Deployment History</h2>
      </div>
      <div className="space-y-2">
        {deployments.map((dep) => {
          const { icon: Icon, label, variant } = statusConfig[dep.status];
          return (
            <Card key={dep.id} className="bg-card">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-3">
                    <Icon className={`h-4 w-4 ${dep.status === "launching" ? "animate-spin" : ""} ${dep.status === "running" ? "text-primary" : dep.status === "failed" ? "text-destructive" : "text-muted-foreground"}`} />
                    <div>
                      <p className="text-sm font-medium font-mono">{dep.config.instanceType}</p>
                      <p className="text-xs text-muted-foreground">{dep.config.region} · {dep.config.amiDescription}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {dep.instanceId && (
                      <p className="text-xs font-mono text-muted-foreground">{dep.instanceId}</p>
                    )}
                    {dep.publicIp && (
                      <Badge variant="outline" className="font-mono text-xs">{dep.publicIp}</Badge>
                    )}
                    <Badge variant={variant}>{label}</Badge>
                  </div>
                </div>
                {dep.error && (
                  <p className="mt-2 text-xs text-destructive">{dep.error}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
