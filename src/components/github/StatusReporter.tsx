import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, CheckCircle2, XCircle, Clock, Loader2, RotateCcw, AlertTriangle,
} from "lucide-react";

interface StateMapping {
  naawi: string;
  github: string;
  icon: React.ReactNode;
  naawiColor: string;
  githubColor: string;
}

const STATE_MAPPINGS: StateMapping[] = [
  { naawi: "intent_received", github: "queued", icon: <Clock className="h-4 w-4 text-muted-foreground" />, naawiColor: "text-muted-foreground", githubColor: "text-muted-foreground" },
  { naawi: "execution_started", github: "in_progress", icon: <Loader2 className="h-4 w-4 text-primary" />, naawiColor: "text-primary", githubColor: "text-primary" },
  { naawi: "success", github: "success", icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, naawiColor: "text-emerald-400", githubColor: "text-emerald-400" },
  { naawi: "partial_failure", github: "failure", icon: <AlertTriangle className="h-4 w-4 text-amber-400" />, naawiColor: "text-amber-400", githubColor: "text-red-400" },
  { naawi: "golden_path_violation", github: "failure", icon: <XCircle className="h-4 w-4 text-red-400" />, naawiColor: "text-red-400", githubColor: "text-red-400" },
  { naawi: "rolled_back", github: "inactive", icon: <RotateCcw className="h-4 w-4 text-muted-foreground" />, naawiColor: "text-amber-400", githubColor: "text-muted-foreground" },
];

interface CheckRunItem {
  name: string;
  intent: string;
  status: "compliant" | "violation" | "pending";
  details: string;
}

const MOCK_CHECK_RUN: CheckRunItem[] = [
  { name: "VPC — production-vpc", intent: "provision_network", status: "compliant", details: "All guardrails pass. CIDR non-overlapping. NAT gateway enabled." },
  { name: "EC2 — api-servers", intent: "provision_compute", status: "violation", details: "Security group allows 0.0.0.0/0 ingress. Missing required tags." },
  { name: "RDS — payments-db", intent: "provision_database", status: "compliant", details: "Encryption at rest enabled. Deletion protection on. Private endpoint." },
  { name: "S3 — assets-bucket", intent: "provision_storage", status: "violation", details: "Public access not blocked. Missing server-side encryption default." },
  { name: "EKS — platform-cluster", intent: "provision_kubernetes", status: "compliant", details: "Private endpoint. Secrets encryption enabled. Managed node group." },
];

const CHECK_STATUS = {
  compliant: { icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />, badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  violation: { icon: <XCircle className="h-3.5 w-3.5 text-red-400" />, badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  pending: { icon: <Clock className="h-3.5 w-3.5 text-muted-foreground" />, badge: "bg-muted text-muted-foreground border-border/40" },
};

export function StatusReporter() {
  const violations = MOCK_CHECK_RUN.filter(c => c.status === "violation").length;

  return (
    <div className="space-y-4">
      {/* State mapping table */}
      <Card className="glass-panel-elevated border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Deployment Lifecycle Mapping</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pb-2 border-b border-border/30">
              <span>Naawi State</span>
              <span></span>
              <span>GitHub Deployment State</span>
            </div>
            {STATE_MAPPINGS.map(m => (
              <div key={m.naawi} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center py-1.5">
                <code className={`font-mono text-xs ${m.naawiColor}`}>{m.naawi}</code>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  {m.icon}
                  <code className={`font-mono text-xs ${m.githubColor}`}>{m.github}</code>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Check Run simulation */}
      <Card className="glass-panel border-border/40">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Naawi Golden Path Check — PR #145</CardTitle>
            <Badge variant="outline" className={violations > 0 ? "text-red-400 bg-red-500/10 border-red-500/20 text-[8px]" : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 text-[8px]"}>
              {violations > 0 ? `${violations} violations — merge blocked` : "All checks pass"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {MOCK_CHECK_RUN.map(item => (
            <div key={item.name} className="flex items-start gap-3 p-3 rounded-lg border border-border/20">
              {CHECK_STATUS[item.status].icon}
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium">{item.name}</span>
                  <Badge variant="outline" className={`text-[8px] ${CHECK_STATUS[item.status].badge}`}>
                    {item.status}
                  </Badge>
                  <Badge variant="secondary" className="text-[8px] font-mono">{item.intent}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.details}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* PR Comment preview */}
      <Card className="glass-panel border-border/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">PR Comment Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/40 rounded-lg p-4 border border-border/50 font-mono text-[11px] space-y-2">
            <p className="text-foreground">🚀 <strong>Naawi Deployment Summary</strong> — PR #145</p>
            <p className="text-muted-foreground">──────────────────────────────</p>
            <p><span className="text-emerald-400">✓</span> VPC production-vpc — compliant</p>
            <p><span className="text-red-400">✗</span> EC2 api-servers — 2 violations</p>
            <p><span className="text-emerald-400">✓</span> RDS payments-db — compliant</p>
            <p><span className="text-red-400">✗</span> S3 assets-bucket — 2 violations</p>
            <p><span className="text-emerald-400">✓</span> EKS platform-cluster — compliant</p>
            <p className="text-muted-foreground">──────────────────────────────</p>
            <p className="text-foreground">Intents affected: <span className="text-primary">5</span> | Violations: <span className="text-red-400">4</span></p>
            <p className="text-muted-foreground">Deployment ID: dep-b8e1f4a2 | Dolt diff: a3f92c1..b8e1f4a</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
