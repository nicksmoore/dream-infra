import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckCircle2, Loader2, Shield, AlertTriangle, Play, RotateCcw,
} from "lucide-react";

interface RemediationAction {
  id: string;
  resource_name: string;
  gap_description: string;
  severity: "critical" | "high" | "medium" | "low";
  action: string;
  sdk_calls: string[];
  approved: boolean;
  executed: boolean;
  success: boolean | null;
}

const MOCK_ACTIONS: RemediationAction[] = [
  { id: "r1", resource_name: "allow-all-sg", gap_description: "0.0.0.0/0 ingress rule", severity: "critical", action: "Revoke overly permissive ingress rules", sdk_calls: ["RevokeSecurityGroupIngress"], approved: false, executed: false, success: null },
  { id: "r2", resource_name: "staging-db", gap_description: "Public endpoint exposed", severity: "critical", action: "Disable public accessibility", sdk_calls: ["ModifyDBInstance { PubliclyAccessible: false }"], approved: false, executed: false, success: null },
  { id: "r3", resource_name: "staging-db", gap_description: "No encryption at rest", severity: "critical", action: "Enable storage encryption (requires modification window)", sdk_calls: ["ModifyDBInstance { StorageEncrypted: true }", "RebootDBInstance"], approved: false, executed: false, success: null },
  { id: "r4", resource_name: "company-assets-prod", gap_description: "Public access on S3 bucket", severity: "critical", action: "Apply public access block", sdk_calls: ["PutPublicAccessBlock", "PutBucketPolicy"], approved: false, executed: false, success: null },
  { id: "r5", resource_name: "production-vpc", gap_description: "Missing required tags", severity: "high", action: "Add CostCenter, Owner, ManagedBy tags", sdk_calls: ["CreateTags"], approved: false, executed: false, success: null },
  { id: "r6", resource_name: "api-server-1", gap_description: "Missing tags + public SG", severity: "high", action: "Tag resources and replace security group", sdk_calls: ["CreateTags", "ModifyInstanceAttribute"], approved: false, executed: false, success: null },
  { id: "r7", resource_name: "api-server-2", gap_description: "Missing required tags", severity: "high", action: "Add required compliance tags", sdk_calls: ["CreateTags"], approved: false, executed: false, success: null },
  { id: "r8", resource_name: "staging-db", gap_description: "Missing required tags", severity: "high", action: "Add compliance tags", sdk_calls: ["AddTagsToResource"], approved: false, executed: false, success: null },
  { id: "r9", resource_name: "auth-handler", gap_description: "Missing required tags", severity: "high", action: "Add Owner, CostCenter tags", sdk_calls: ["TagResource"], approved: false, executed: false, success: null },
  { id: "r10", resource_name: "unattached-eip", gap_description: "Unused Elastic IP", severity: "medium", action: "Release unattached EIP", sdk_calls: ["ReleaseAddress"], approved: false, executed: false, success: null },
];

interface RemediationPanelProps {
  onComplete: () => void;
}

export function RemediationPanel({ onComplete }: RemediationPanelProps) {
  const [actions, setActions] = useState<RemediationAction[]>(MOCK_ACTIONS);
  const [executing, setExecuting] = useState(false);
  const [execProgress, setExecProgress] = useState(0);
  const [currentAction, setCurrentAction] = useState("");

  const toggleApproval = (id: string) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, approved: !a.approved } : a));
  };

  const approveAll = (severity: string) => {
    setActions(prev => prev.map(a => a.severity === severity ? { ...a, approved: true } : a));
  };

  const executeApproved = () => {
    const approved = actions.filter(a => a.approved && !a.executed);
    if (approved.length === 0) return;
    setExecuting(true);
    setExecProgress(0);
    let i = 0;
    const interval = setInterval(() => {
      if (i < approved.length) {
        setCurrentAction(approved[i].resource_name + " — " + approved[i].action);
        setExecProgress(((i + 1) / approved.length) * 100);
        setActions(prev => prev.map(a => a.id === approved[i].id ? { ...a, executed: true, success: true } : a));
        i++;
      } else {
        clearInterval(interval);
        setExecuting(false);
        setCurrentAction("");
      }
    }, 800);
  };

  const approvedCount = actions.filter(a => a.approved).length;
  const executedCount = actions.filter(a => a.executed).length;
  const successCount = actions.filter(a => a.success === true).length;

  const SEVERITY_BADGE: Record<string, string> = {
    critical: "text-red-400 bg-red-500/10 border-red-500/20",
    high: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
    low: "text-muted-foreground bg-muted/40 border-border/40",
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="glass-panel border-border/40">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{actions.length}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Total Actions</p>
          </CardContent>
        </Card>
        <Card className="glass-panel border-border/40">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{approvedCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Approved</p>
          </CardContent>
        </Card>
        <Card className="glass-panel border-border/40">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{successCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Executed</p>
          </CardContent>
        </Card>
      </div>

      {/* Batch approve */}
      <Card className="glass-panel-elevated border-border/40">
        <CardContent className="p-4">
          <p className="text-xs font-semibold mb-3">Batch Approval</p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-red-400 border-red-500/20" onClick={() => approveAll("critical")}>
              <Shield className="h-3 w-3" /> Approve All Critical
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-amber-400 border-amber-500/20" onClick={() => approveAll("high")}>
              <AlertTriangle className="h-3 w-3" /> Approve All High
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => approveAll("medium")}>
              Approve All Medium
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Execution */}
      {executing && (
        <Card className="glass-panel-elevated border-primary/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs font-semibold">Executing Remediation Plan...</span>
            </div>
            <Progress value={execProgress} className="h-2" />
            <p className="text-[10px] text-muted-foreground font-mono">{currentAction}</p>
          </CardContent>
        </Card>
      )}

      {/* Action List */}
      <div className="space-y-2">
        {actions.map(action => (
          <Card key={action.id} className={`glass-panel border-border/30 transition-all ${action.executed ? "opacity-70" : ""}`}>
            <CardContent className="p-3">
              <div className="flex items-start gap-3">
                {action.executed ? (
                  action.success ? <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5" /> : <RotateCcw className="h-4 w-4 text-destructive mt-0.5" />
                ) : (
                  <Checkbox checked={action.approved} onCheckedChange={() => toggleApproval(action.id)} className="mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium">{action.resource_name}</span>
                    <Badge variant="outline" className={`text-[8px] ${SEVERITY_BADGE[action.severity]}`}>{action.severity}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{action.action}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {action.sdk_calls.map((call, i) => (
                      <Badge key={i} variant="secondary" className="text-[8px] font-mono">{call}</Badge>
                    ))}
                  </div>
                </div>
                {action.executed && action.success && (
                  <Badge className="text-[8px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">✓ Done</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <Button
          onClick={executeApproved}
          disabled={executing || approvedCount === 0 || actions.filter(a => a.approved && !a.executed).length === 0}
          className="flex-1 gap-2"
        >
          <Play className="h-4 w-4" />
          Execute {actions.filter(a => a.approved && !a.executed).length} Approved Actions
        </Button>
        <Button
          onClick={onComplete}
          variant="outline"
          disabled={executedCount === 0}
          className="gap-2"
        >
          Continue → Import
        </Button>
      </div>
    </div>
  );
}
