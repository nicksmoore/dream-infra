import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search, Cloud, Server, Database, Network, Shield, Globe,
  Play, CheckCircle2, AlertTriangle, Loader2, HardDrive,
} from "lucide-react";

interface DiscoveredResource {
  id: string;
  provider: "aws" | "gcp" | "azure" | "oci";
  resource_type: string;
  region: string;
  name: string;
  has_required_tags: boolean;
  encryption_at_rest: boolean;
  public_access_exposed: boolean;
}

const MOCK_DISCOVERED: DiscoveredResource[] = [
  { id: "vpc-0a1b2c3d", provider: "aws", resource_type: "ec2.vpc", region: "us-east-1", name: "production-vpc", has_required_tags: false, encryption_at_rest: true, public_access_exposed: false },
  { id: "vpc-9x8y7z6w", provider: "aws", resource_type: "ec2.vpc", region: "us-east-1", name: "staging-vpc", has_required_tags: true, encryption_at_rest: true, public_access_exposed: false },
  { id: "i-0abc123def", provider: "aws", resource_type: "ec2.instance", region: "us-east-1", name: "api-server-1", has_required_tags: false, encryption_at_rest: true, public_access_exposed: true },
  { id: "i-0def456ghi", provider: "aws", resource_type: "ec2.instance", region: "us-east-1", name: "api-server-2", has_required_tags: false, encryption_at_rest: true, public_access_exposed: false },
  { id: "rds-prod-01", provider: "aws", resource_type: "rds.cluster", region: "us-east-1", name: "payments-db", has_required_tags: true, encryption_at_rest: true, public_access_exposed: false },
  { id: "rds-staging", provider: "aws", resource_type: "rds.instance", region: "us-east-1", name: "staging-db", has_required_tags: false, encryption_at_rest: false, public_access_exposed: true },
  { id: "s3-assets", provider: "aws", resource_type: "s3.bucket", region: "us-east-1", name: "company-assets-prod", has_required_tags: true, encryption_at_rest: true, public_access_exposed: true },
  { id: "s3-logs", provider: "aws", resource_type: "s3.bucket", region: "us-east-1", name: "cloudtrail-logs", has_required_tags: true, encryption_at_rest: true, public_access_exposed: false },
  { id: "sg-0123abc", provider: "aws", resource_type: "ec2.security_group", region: "us-east-1", name: "allow-all-sg", has_required_tags: false, encryption_at_rest: true, public_access_exposed: true },
  { id: "eks-prod-01", provider: "aws", resource_type: "eks.cluster", region: "us-east-1", name: "platform-cluster", has_required_tags: true, encryption_at_rest: true, public_access_exposed: false },
  { id: "lambda-auth", provider: "aws", resource_type: "lambda.function", region: "us-east-1", name: "auth-handler", has_required_tags: false, encryption_at_rest: true, public_access_exposed: false },
  { id: "eip-unused-1", provider: "aws", resource_type: "ec2.eip", region: "us-east-1", name: "unattached-eip", has_required_tags: false, encryption_at_rest: true, public_access_exposed: false },
];

const RESOURCE_ICONS: Record<string, React.ReactNode> = {
  "ec2.vpc": <Network className="h-3.5 w-3.5 text-primary" />,
  "ec2.instance": <Server className="h-3.5 w-3.5 text-emerald-400" />,
  "ec2.security_group": <Shield className="h-3.5 w-3.5 text-amber-400" />,
  "ec2.eip": <Globe className="h-3.5 w-3.5 text-muted-foreground" />,
  "rds.cluster": <Database className="h-3.5 w-3.5 text-violet-400" />,
  "rds.instance": <Database className="h-3.5 w-3.5 text-violet-400" />,
  "s3.bucket": <HardDrive className="h-3.5 w-3.5 text-amber-400" />,
  "eks.cluster": <Cloud className="h-3.5 w-3.5 text-primary" />,
  "lambda.function": <Play className="h-3.5 w-3.5 text-amber-400" />,
};

interface DiscoveryPanelProps {
  onComplete: (resources: DiscoveredResource[]) => void;
}

export function DiscoveryPanel({ onComplete }: DiscoveryPanelProps) {
  const [provider, setProvider] = useState("aws");
  const [region, setRegion] = useState("us-east-1");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredResource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const startDiscovery = () => {
    setScanning(true);
    setProgress(0);
    setDiscovered([]);
    const phases = ["Networking (VPCs, Subnets, SGs)", "Compute (EC2, EKS, Lambda)", "Storage (S3, EBS)", "Databases (RDS, DynamoDB)", "IAM & Security", "DNS & Load Balancers"];
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setProgress(Math.min((i / 18) * 100, 100));
      setPhase(phases[Math.min(Math.floor(i / 3), phases.length - 1)]);
      if (i >= 18) {
        clearInterval(interval);
        setScanning(false);
        setDiscovered(MOCK_DISCOVERED);
        setSelected(new Set(MOCK_DISCOVERED.map(r => r.id)));
      }
    }, 400);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const criticalCount = discovered.filter(r => r.public_access_exposed || !r.encryption_at_rest).length;
  const tagsMissing = discovered.filter(r => !r.has_required_tags).length;

  return (
    <div className="space-y-6">
      {/* Config */}
      <Card className="glass-panel-elevated border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Discovery Configuration
          </CardTitle>
          <CardDescription className="text-xs">Read-only API scan — zero write calls. Requires only describe/list permissions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Provider</label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aws">AWS</SelectItem>
                  <SelectItem value="gcp">GCP</SelectItem>
                  <SelectItem value="azure">Azure</SelectItem>
                  <SelectItem value="oci">OCI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Region</label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="us-east-1">us-east-1</SelectItem>
                  <SelectItem value="us-west-2">us-west-2</SelectItem>
                  <SelectItem value="eu-west-1">eu-west-1</SelectItem>
                  <SelectItem value="ap-southeast-1">ap-southeast-1</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={startDiscovery} disabled={scanning} className="w-full gap-2">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {scanning ? "Scanning..." : "Start Discovery Scan"}
          </Button>

          {scanning && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-[10px] text-muted-foreground font-mono">Scanning: {phase}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {discovered.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{discovered.length}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Resources Found</p>
              </CardContent>
            </Card>
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-destructive">{criticalCount}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Critical Issues</p>
              </CardContent>
            </Card>
            <Card className="glass-panel border-border/40">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-amber-400">{tagsMissing}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Missing Tags</p>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-panel border-border/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Discovered Resources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {discovered.map(r => (
                <div
                  key={r.id}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all cursor-pointer ${
                    selected.has(r.id) ? "border-primary/40 bg-primary/5" : "border-border/20 hover:border-border/40"
                  }`}
                  onClick={() => toggleSelect(r.id)}
                >
                  <Checkbox checked={selected.has(r.id)} className="pointer-events-none" />
                  {RESOURCE_ICONS[r.resource_type] || <Cloud className="h-3.5 w-3.5 text-muted-foreground" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate">{r.name}</span>
                      <Badge variant="secondary" className="text-[8px] font-mono">{r.resource_type}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">{r.id} · {r.region}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {r.public_access_exposed && (
                      <Badge variant="destructive" className="text-[8px]">
                        <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Public
                      </Badge>
                    )}
                    {!r.encryption_at_rest && (
                      <Badge variant="destructive" className="text-[8px]">Unencrypted</Badge>
                    )}
                    {!r.has_required_tags && (
                      <Badge variant="outline" className="text-[8px] text-amber-400 border-amber-500/20">No Tags</Badge>
                    )}
                    {r.has_required_tags && r.encryption_at_rest && !r.public_access_exposed && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Button
            onClick={() => onComplete(discovered.filter(r => selected.has(r.id)))}
            className="w-full gap-2"
            disabled={selected.size === 0}
          >
            Proceed with {selected.size} Resources → Intent Inference
          </Button>
        </>
      )}
    </div>
  );
}
