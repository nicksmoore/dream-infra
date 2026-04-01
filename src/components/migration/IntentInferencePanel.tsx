import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, XCircle, Edit, Loader2, Brain, Network,
  Server, Database, Shield, HardDrive, Cloud,
} from "lucide-react";

interface InferredIntent {
  id: string;
  intent: string;
  provider: string;
  name: string;
  environment: string;
  confidence: number;
  deviations: string[];
  resourceIds: string[];
  status: "pending" | "accepted" | "rejected" | "editing";
  yaml: string;
}

const MOCK_INFERRED: InferredIntent[] = [
  {
    id: "inf-1", intent: "provision_network", provider: "aws", name: "production-vpc", environment: "production",
    confidence: 87, deviations: ["Missing required tags (CostCenter, Owner)", "Default SG allows 0.0.0.0/0 egress"],
    resourceIds: ["vpc-0a1b2c3d", "sg-0123abc"], status: "pending",
    yaml: `intent: provision_network\nprovider: aws\nregion: us-east-1\nname: production-vpc\nenvironment: production\nspec:\n  cidr: "10.0.0.0/16"\n  private_subnets: 3\n  public_subnets: 3\n  nat_gateway: true`,
  },
  {
    id: "inf-2", intent: "provision_network", provider: "aws", name: "staging-vpc", environment: "staging",
    confidence: 94, deviations: [],
    resourceIds: ["vpc-9x8y7z6w"], status: "pending",
    yaml: `intent: provision_network\nprovider: aws\nregion: us-east-1\nname: staging-vpc\nenvironment: staging\nspec:\n  cidr: "10.1.0.0/16"\n  private_subnets: 2\n  public_subnets: 2\n  nat_gateway: true`,
  },
  {
    id: "inf-3", intent: "provision_compute", provider: "aws", name: "api-servers", environment: "production",
    confidence: 72, deviations: ["Instance publicly accessible via SG", "Missing required tags"],
    resourceIds: ["i-0abc123def", "i-0def456ghi"], status: "pending",
    yaml: `intent: provision_compute\nprovider: aws\nregion: us-east-1\nname: api-servers\nenvironment: production\nspec:\n  instance_type: t3.large\n  count: 2\n  os: amazon-linux-2`,
  },
  {
    id: "inf-4", intent: "provision_database", provider: "aws", name: "payments-db", environment: "production",
    confidence: 91, deviations: [],
    resourceIds: ["rds-prod-01"], status: "pending",
    yaml: `intent: provision_database\nprovider: aws\nregion: us-east-1\nname: payments-db\nenvironment: production\nspec:\n  engine: aurora-postgresql\n  instance_class: db.r6g.large`,
  },
  {
    id: "inf-5", intent: "provision_database", provider: "aws", name: "staging-db", environment: "staging",
    confidence: 63, deviations: ["No encryption at rest", "Public endpoint exposed", "Missing required tags"],
    resourceIds: ["rds-staging"], status: "pending",
    yaml: `intent: provision_database\nprovider: aws\nregion: us-east-1\nname: staging-db\nenvironment: staging\nspec:\n  engine: postgresql\n  instance_class: db.t3.medium`,
  },
  {
    id: "inf-6", intent: "provision_storage", provider: "aws", name: "company-assets", environment: "production",
    confidence: 82, deviations: ["Public access enabled"],
    resourceIds: ["s3-assets"], status: "pending",
    yaml: `intent: provision_storage\nprovider: aws\nregion: us-east-1\nname: company-assets\nenvironment: production\nspec:\n  type: s3\n  versioning: true`,
  },
];

const INTENT_ICONS: Record<string, React.ReactNode> = {
  provision_network: <Network className="h-4 w-4 text-primary" />,
  provision_compute: <Server className="h-4 w-4 text-emerald-400" />,
  provision_database: <Database className="h-4 w-4 text-violet-400" />,
  provision_storage: <HardDrive className="h-4 w-4 text-amber-400" />,
  provision_security: <Shield className="h-4 w-4 text-red-400" />,
};

function confidenceColor(c: number) {
  if (c >= 90) return "text-emerald-400";
  if (c >= 70) return "text-amber-400";
  if (c >= 50) return "text-orange-400";
  return "text-destructive";
}

function confidenceLabel(c: number) {
  if (c >= 90) return "High";
  if (c >= 70) return "Medium";
  if (c >= 50) return "Low";
  return "Cannot Infer";
}

interface IntentInferencePanelProps {
  onComplete: (intents: InferredIntent[]) => void;
}

export function IntentInferencePanel({ onComplete }: IntentInferencePanelProps) {
  const [inferring, setInferring] = useState(true);
  const [progress, setProgress] = useState(0);
  const [intents, setIntents] = useState<InferredIntent[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setProgress(Math.min((i / 12) * 100, 100));
      if (i >= 12) {
        clearInterval(interval);
        setInferring(false);
        setIntents(MOCK_INFERRED);
      }
    }, 350);
    return () => clearInterval(interval);
  }, []);

  const updateStatus = (id: string, status: "accepted" | "rejected") => {
    setIntents(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  };

  const accepted = intents.filter(i => i.status === "accepted").length;
  const rejected = intents.filter(i => i.status === "rejected").length;
  const pending = intents.filter(i => i.status === "pending").length;

  return (
    <div className="space-y-6">
      {inferring ? (
        <Card className="glass-panel-elevated border-border/40">
          <CardContent className="p-8 text-center space-y-4">
            <Brain className="h-10 w-10 text-primary mx-auto animate-pulse" />
            <div>
              <p className="text-sm font-semibold">Engram Intent Inference</p>
              <p className="text-xs text-muted-foreground mt-1">Clustering resources and reverse-engineering deployment intent...</p>
            </div>
            <Progress value={progress} className="h-2 max-w-sm mx-auto" />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{intents.length}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Intents Inferred</p>
              </CardContent>
            </Card>
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-emerald-400">{accepted}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Accepted</p>
              </CardContent>
            </Card>
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-muted-foreground">{pending}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending Review</p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            {intents.map(intent => (
              <Card
                key={intent.id}
                className={`glass-panel border-border/40 transition-all ${
                  intent.status === "accepted" ? "border-emerald-500/30 bg-emerald-500/5" :
                  intent.status === "rejected" ? "border-destructive/30 bg-destructive/5 opacity-60" : ""
                }`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    {INTENT_ICONS[intent.intent] || <Cloud className="h-4 w-4 text-muted-foreground" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{intent.name}</span>
                        <Badge variant="secondary" className="text-[8px] font-mono">{intent.intent}</Badge>
                        <Badge variant="outline" className="text-[8px]">{intent.environment}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {intent.resourceIds.length} resources · {intent.provider.toUpperCase()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <span className={`text-lg font-bold font-mono ${confidenceColor(intent.confidence)}`}>
                          {intent.confidence}%
                        </span>
                        <p className={`text-[9px] ${confidenceColor(intent.confidence)}`}>{confidenceLabel(intent.confidence)}</p>
                      </div>
                    </div>
                  </div>

                  {intent.deviations.length > 0 && (
                    <div className="space-y-1 pl-7">
                      {intent.deviations.map((d, i) => (
                        <p key={i} className="text-[10px] text-amber-400 font-mono">⚠ DEVIATION: {d}</p>
                      ))}
                    </div>
                  )}

                  {expandedId === intent.id && (
                    <pre className="font-mono text-[11px] bg-muted/40 rounded-lg p-3 border border-border/50 overflow-x-auto">
                      {intent.yaml}
                    </pre>
                  )}

                  <div className="flex items-center gap-2 pl-7">
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-[10px] gap-1"
                      onClick={() => setExpandedId(expandedId === intent.id ? null : intent.id)}
                    >
                      <Edit className="h-3 w-3" /> {expandedId === intent.id ? "Hide" : "View"} YAML
                    </Button>
                    {intent.status === "pending" && (
                      <>
                        <Button size="sm" className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => updateStatus(intent.id, "accepted")}>
                          <CheckCircle2 className="h-3 w-3" /> Accept
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-destructive" onClick={() => updateStatus(intent.id, "rejected")}>
                          <XCircle className="h-3 w-3" /> Reject
                        </Button>
                      </>
                    )}
                    {intent.status === "accepted" && (
                      <Badge className="text-[8px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">✓ Accepted</Badge>
                    )}
                    {intent.status === "rejected" && (
                      <Badge className="text-[8px] bg-destructive/10 text-destructive border-destructive/20">✗ Rejected</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button
            onClick={() => onComplete(intents.filter(i => i.status === "accepted"))}
            className="w-full gap-2"
            disabled={accepted === 0}
          >
            Proceed with {accepted} Accepted Intents → Gap Analysis
          </Button>
        </>
      )}
    </div>
  );
}
