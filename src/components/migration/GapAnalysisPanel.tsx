import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle, ShieldAlert, ShieldCheck, Info, ChevronDown, ChevronRight,
} from "lucide-react";

interface Gap {
  id: string;
  resource_name: string;
  resource_type: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  remediation: string;
  sdk_calls: number;
}

const MOCK_GAPS: Gap[] = [
  { id: "g1", resource_name: "staging-db", resource_type: "rds.instance", category: "Encryption at rest missing", severity: "critical", description: "RDS instance has no storage encryption enabled", remediation: "Enable storage encryption (requires instance modification with downtime)", sdk_calls: 2 },
  { id: "g2", resource_name: "staging-db", resource_type: "rds.instance", category: "Public access exposure", severity: "critical", description: "RDS endpoint is publicly accessible", remediation: "Modify DB instance to disable public accessibility", sdk_calls: 1 },
  { id: "g3", resource_name: "company-assets-prod", resource_type: "s3.bucket", category: "Public access exposure", severity: "critical", description: "S3 bucket allows public access via bucket policy", remediation: "Apply public access block and update bucket policy", sdk_calls: 2 },
  { id: "g4", resource_name: "allow-all-sg", resource_type: "ec2.security_group", category: "Public access exposure", severity: "critical", description: "Security group rule allows 0.0.0.0/0 ingress on all ports", remediation: "Revoke overly permissive ingress rules", sdk_calls: 1 },
  { id: "g5", resource_name: "api-server-1", resource_type: "ec2.instance", category: "Public access exposure", severity: "high", description: "EC2 instance reachable via permissive security group", remediation: "Replace security group with scoped rules", sdk_calls: 2 },
  { id: "g6", resource_name: "production-vpc", resource_type: "ec2.vpc", category: "Missing required tags", severity: "high", description: "VPC missing CostCenter and Owner tags", remediation: "Add required tags via CreateTags API", sdk_calls: 1 },
  { id: "g7", resource_name: "api-server-1", resource_type: "ec2.instance", category: "Missing required tags", severity: "high", description: "EC2 instances missing Environment and ManagedBy tags", remediation: "Add required tags", sdk_calls: 1 },
  { id: "g8", resource_name: "api-server-2", resource_type: "ec2.instance", category: "Missing required tags", severity: "high", description: "EC2 instances missing Environment and ManagedBy tags", remediation: "Add required tags", sdk_calls: 1 },
  { id: "g9", resource_name: "staging-db", resource_type: "rds.instance", category: "Missing required tags", severity: "high", description: "RDS instance missing required compliance tags", remediation: "Add tags via AddTagsToResource API", sdk_calls: 1 },
  { id: "g10", resource_name: "auth-handler", resource_type: "lambda.function", category: "Missing required tags", severity: "high", description: "Lambda function missing Owner and CostCenter tags", remediation: "Tag via TagResource API", sdk_calls: 1 },
  { id: "g11", resource_name: "unattached-eip", resource_type: "ec2.eip", category: "Unused resources", severity: "medium", description: "Elastic IP not associated with any running instance — cost leak", remediation: "Release unused EIP or attach to instance", sdk_calls: 1 },
  { id: "g12", resource_name: "production-vpc", resource_type: "ec2.vpc", category: "Naming convention violations", severity: "low", description: "VPC Name tag does not follow naawi-{env}-{purpose} convention", remediation: "Update Name tag to match convention", sdk_calls: 1 },
];

const SEVERITY_CONFIG = {
  critical: { color: "text-red-400 bg-red-500/10 border-red-500/20", icon: <ShieldAlert className="h-3.5 w-3.5 text-red-400" /> },
  high: { color: "text-amber-400 bg-amber-500/10 border-amber-500/20", icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> },
  medium: { color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20", icon: <Info className="h-3.5 w-3.5 text-yellow-400" /> },
  low: { color: "text-muted-foreground bg-muted/40 border-border/40", icon: <Info className="h-3.5 w-3.5 text-muted-foreground" /> },
};

interface GapAnalysisPanelProps {
  onComplete: (gaps: Gap[]) => void;
}

export function GapAnalysisPanel({ onComplete }: GapAnalysisPanelProps) {
  const [severityFilter, setSeverityFilter] = useState("all");
  const [expandedGap, setExpandedGap] = useState<string | null>(null);

  const filtered = MOCK_GAPS.filter(g => severityFilter === "all" || g.severity === severityFilter);
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  MOCK_GAPS.forEach(g => bySeverity[g.severity]++);
  const totalCalls = MOCK_GAPS.reduce((a, g) => a + g.sdk_calls, 0);
  const complianceScore = Math.round(((12 - MOCK_GAPS.length) / 12) * 100);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="glass-panel border-red-500/20">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{bySeverity.critical}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Critical</p>
          </CardContent>
        </Card>
        <Card className="glass-panel border-amber-500/20">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{bySeverity.high}</p>
            <p className="text-[10px] text-muted-foreground uppercase">High</p>
          </CardContent>
        </Card>
        <Card className="glass-panel border-yellow-500/20">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-400">{bySeverity.medium}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Medium</p>
          </CardContent>
        </Card>
        <Card className="glass-panel border-border/30">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{bySeverity.low}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Low</p>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-panel-elevated border-border/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Golden Path Compliance</span>
            <span className="text-sm font-bold text-foreground">{complianceScore}%</span>
          </div>
          <Progress value={complianceScore} className="h-2" />
          <p className="text-[10px] text-muted-foreground mt-2">
            {MOCK_GAPS.length} gaps detected · {totalCalls} SDK calls required · Est. {Math.ceil(totalCalls * 1.2)} seconds execution time
          </p>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Filter severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} gaps</span>
      </div>

      {/* Gap List */}
      <div className="space-y-2">
        {filtered.map(gap => (
          <Card key={gap.id} className="glass-panel border-border/30">
            <CardContent className="p-3">
              <div
                className="flex items-start gap-3 cursor-pointer"
                onClick={() => setExpandedGap(expandedGap === gap.id ? null : gap.id)}
              >
                {SEVERITY_CONFIG[gap.severity].icon}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium">{gap.resource_name}</span>
                    <Badge variant="outline" className={`text-[8px] ${SEVERITY_CONFIG[gap.severity].color}`}>
                      {gap.severity}
                    </Badge>
                    <Badge variant="secondary" className="text-[8px] font-mono">{gap.resource_type}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{gap.description}</p>
                </div>
                {expandedGap === gap.id ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
              {expandedGap === gap.id && (
                <div className="mt-3 ml-7 space-y-2 border-t border-border/20 pt-2">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Category</span>
                    <p className="text-xs">{gap.category}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Remediation</span>
                    <p className="text-xs text-emerald-400">{gap.remediation}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Effort</span>
                    <p className="text-xs font-mono">{gap.sdk_calls} SDK call{gap.sdk_calls !== 1 ? "s" : ""}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Button onClick={() => onComplete(MOCK_GAPS)} className="w-full gap-2">
        Generate Remediation Plan → {MOCK_GAPS.length} Gaps
      </Button>
    </div>
  );
}
