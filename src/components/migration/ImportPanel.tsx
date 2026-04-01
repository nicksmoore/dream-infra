import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Loader2, Shield, Network, Server, Database, HardDrive, Cloud,
  GitCommit, ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ImportedResource {
  provider_resource_id: string;
  resource_type: string;
  naawi_intent: string;
  name: string;
  golden_path_compliant: boolean;
}

const MOCK_IMPORTED: ImportedResource[] = [
  { provider_resource_id: "vpc-0a1b2c3d", resource_type: "ec2.vpc", naawi_intent: "provision_network", name: "production-vpc", golden_path_compliant: true },
  { provider_resource_id: "vpc-9x8y7z6w", resource_type: "ec2.vpc", naawi_intent: "provision_network", name: "staging-vpc", golden_path_compliant: true },
  { provider_resource_id: "i-0abc123def", resource_type: "ec2.instance", naawi_intent: "provision_compute", name: "api-server-1", golden_path_compliant: true },
  { provider_resource_id: "i-0def456ghi", resource_type: "ec2.instance", naawi_intent: "provision_compute", name: "api-server-2", golden_path_compliant: true },
  { provider_resource_id: "rds-prod-01", resource_type: "rds.cluster", naawi_intent: "provision_database", name: "payments-db", golden_path_compliant: true },
  { provider_resource_id: "s3-assets", resource_type: "s3.bucket", naawi_intent: "provision_storage", name: "company-assets-prod", golden_path_compliant: true },
];

const TYPE_ICONS: Record<string, React.ReactNode> = {
  "ec2.vpc": <Network className="h-3.5 w-3.5 text-primary" />,
  "ec2.instance": <Server className="h-3.5 w-3.5 text-emerald-400" />,
  "rds.cluster": <Database className="h-3.5 w-3.5 text-violet-400" />,
  "s3.bucket": <HardDrive className="h-3.5 w-3.5 text-amber-400" />,
};

export function ImportPanel() {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(true);
  const [progress, setProgress] = useState(0);
  const [imported, setImported] = useState<ImportedResource[]>([]);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setProgress(Math.min((i / 10) * 100, 100));
      if (i >= 10) {
        clearInterval(interval);
        setImporting(false);
        setImported(MOCK_IMPORTED);
      }
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const compliant = imported.filter(r => r.golden_path_compliant).length;

  return (
    <div className="space-y-6">
      {importing ? (
        <Card className="glass-panel-elevated border-border/40">
          <CardContent className="p-8 text-center space-y-4">
            <Loader2 className="h-10 w-10 text-primary mx-auto animate-spin" />
            <div>
              <p className="text-sm font-semibold">Registering Resources in Dolt</p>
              <p className="text-xs text-muted-foreground mt-1">Writing import_registry entries with full provenance...</p>
            </div>
            <Progress value={progress} className="h-2 max-w-sm mx-auto" />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Success Banner */}
          <Card className="glass-panel-elevated border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="p-6 text-center space-y-3">
              <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto" />
              <div>
                <p className="text-lg font-bold text-foreground">Migration Complete</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {imported.length} resources registered as Naawi-managed. All resources now participate in ongoing drift detection, SDK Sentinel monitoring, and ZTAI audit trails.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{imported.length}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Imported</p>
              </CardContent>
            </Card>
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-emerald-400">{compliant}</p>
                <p className="text-[10px] text-muted-foreground uppercase">GP Compliant</p>
              </CardContent>
            </Card>
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary">100%</p>
                <p className="text-[10px] text-muted-foreground uppercase">Coverage</p>
              </CardContent>
            </Card>
          </div>

          {/* Imported Resources */}
          <Card className="glass-panel border-border/40">
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-semibold mb-3 flex items-center gap-2">
                <GitCommit className="h-3.5 w-3.5 text-primary" />
                Import Registry
              </p>
              {imported.map(r => (
                <div key={r.provider_resource_id} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/20">
                  {TYPE_ICONS[r.resource_type] || <Cloud className="h-3.5 w-3.5 text-muted-foreground" />}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{r.name}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <Badge variant="secondary" className="text-[8px] font-mono">{r.naawi_intent}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">{r.provider_resource_id}</p>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Post-migration info */}
          <Card className="glass-panel-elevated border-primary/20">
            <CardContent className="p-4">
              <p className="text-xs font-semibold mb-2 flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-primary" /> Post-Migration Lifecycle
              </p>
              <ul className="space-y-1.5 text-[11px] text-muted-foreground">
                <li>• <span className="text-foreground">SDK Sentinel</span> — Monitors for API drift against Golden Path baseline</li>
                <li>• <span className="text-foreground">Engram Drift Monitor</span> — Includes migrated intents in divergence sampling</li>
                <li>• <span className="text-foreground">Agentic Remediation</span> — Autonomously addresses future drift (with approval)</li>
                <li>• <span className="text-foreground">ZTAI Audit Trail</span> — Complete lineage from discovery through all changes</li>
                <li>• <span className="text-foreground">GitHub Actions</span> — Intent file changes execute against these resources</li>
              </ul>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button onClick={() => navigate("/console")} className="flex-1 gap-2">
              Go to Console
            </Button>
            <Button onClick={() => navigate("/backstage")} variant="outline" className="gap-2">
              View in Backstage
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
