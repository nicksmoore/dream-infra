import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { executeIntent, type EngineResponse } from "@/lib/uidi-engine";
import type { GoldenPathEntry, CloudProvider } from "@/components/GoldenPathCatalog";
import {
  Rocket, FlaskConical, Eye, CheckCircle2, XCircle, Loader2,
  Shield, AlertTriangle, ChevronDown, ChevronUp, ArrowLeft,
} from "lucide-react";

type Phase = "preflight" | "deploying" | "validating" | "complete" | "failed";

interface StepResult {
  resource: string;
  action: string;
  status: "success" | "error" | "pending" | "running";
  message?: string;
  details?: unknown;
  duration?: number;
}

interface GoldenPathDeploymentProps {
  entry: GoldenPathEntry;
  provider: CloudProvider;
  region: string;
  environment: string;
  onBack: () => void;
}

export function GoldenPathDeployment({
  entry,
  provider,
  region,
  environment,
  onBack,
}: GoldenPathDeploymentProps) {
  const [phase, setPhase] = useState<Phase>("preflight");
  const [isRunning, setIsRunning] = useState(false);
  const [preflightResults, setPreflightResults] = useState<StepResult[]>([]);
  const [deployResults, setDeployResults] = useState<StepResult[]>([]);
  const [validateResults, setValidateResults] = useState<StepResult[]>([]);
  const [preflightPassed, setPreflightPassed] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [overallProgress, setOverallProgress] = useState(0);

  const resources = entry.resources[provider];

  // Map catalog resources to UIDI engine intents
  const mapResourceToIntent = useCallback((resource: string): { intent: string; action: string; spec: Record<string, unknown> } | null => {
    const lower = resource.toLowerCase();

    if (lower.includes("vpc") || lower.includes("vnet") || lower.includes("vpc network")) {
      return {
        intent: "network",
        action: "deploy",
        spec: { region, environment, name: `${entry.id}-${environment}`, vpc_cidr: "10.0.0.0/16", az_count: 2 },
      };
    }
    if (lower.includes("subnet")) {
      return null; // handled by VPC/network deploy
    }
    if (lower.includes("ec2") || lower.includes("compute engine") || lower.includes("linux vm") || lower.includes("vps")) {
      return {
        intent: "compute",
        action: "deploy",
        spec: {
          instance_type: "t3.medium",
          os: "amazon-linux-2023",
          region,
          environment,
          name: `${entry.id}-${environment}`,
          count: 1,
        },
      };
    }
    if (lower.includes("eks") || lower.includes("gke") || lower.includes("aks")) {
      return {
        intent: "eks",
        action: "deploy",
        spec: {
          cluster_name: `${entry.id}-${environment}`,
          region,
          environment,
          kubernetes_version: "1.29",
        },
      };
    }
    if (lower.includes("security group") || lower === "sg" || lower.includes("nsg") || lower.includes("firewall")) {
      return {
        intent: "compute",
        action: "deploy",
        spec: { region, environment, name: `${entry.id}-sg`, security_group: true },
      };
    }
    // For resources we don't have direct SDK support for yet, return null
    return null;
  }, [entry.id, region, environment]);

  // ─── PREFLIGHT (Dry Run) ───
  const runPreflight = useCallback(async () => {
    setIsRunning(true);
    setPreflightResults([]);
    setPreflightPassed(false);
    setOverallProgress(5);

    const results: StepResult[] = [];
    const deployable = resources.filter(r => mapResourceToIntent(r) !== null);
    const skipped = resources.filter(r => mapResourceToIntent(r) === null);

    // Mark skipped resources
    skipped.forEach(r => {
      results.push({ resource: r, action: "skip", status: "pending", message: "No SDK mapping yet — will be handled in future phases" });
    });

    let passed = true;
    for (let i = 0; i < deployable.length; i++) {
      const resource = deployable[i];
      const mapping = mapResourceToIntent(resource)!;
      
      results.push({ resource, action: "dry_run", status: "running" });
      setPreflightResults([...results]);
      setOverallProgress(5 + ((i + 1) / deployable.length) * 30);

      const start = Date.now();
      try {
        const response: EngineResponse = await executeIntent({
          intent: mapping.intent as any,
          action: "dry_run",
          spec: mapping.spec,
        });

        const duration = Date.now() - start;
        const lastIdx = results.length - 1;

        if (response.status === "error") {
          results[lastIdx] = {
            resource,
            action: "dry_run",
            status: "error",
            message: response.error || response.message || "Dry run failed",
            details: response.details,
            duration,
          };
          passed = false;
        } else {
          results[lastIdx] = {
            resource,
            action: "dry_run",
            status: "success",
            message: response.message || "Validation passed",
            details: response.details,
            duration,
          };
        }
      } catch (e) {
        const duration = Date.now() - start;
        const lastIdx = results.length - 1;
        results[lastIdx] = {
          resource,
          action: "dry_run",
          status: "error",
          message: e instanceof Error ? e.message : "Unknown error",
          duration,
        };
        passed = false;
      }
      setPreflightResults([...results]);
    }

    setPreflightPassed(passed);
    setOverallProgress(35);
    setIsRunning(false);

    if (passed) {
      toast({ title: "✅ Preflight Complete", description: `All ${deployable.length} resources passed dry-run validation.` });
    } else {
      toast({ title: "❌ Preflight Failed", description: "Some resources failed validation. Review errors before deploying.", variant: "destructive" });
    }
  }, [resources, mapResourceToIntent]);

  // ─── DEPLOY ───
  const runDeploy = useCallback(async () => {
    setIsRunning(true);
    setPhase("deploying");
    setDeployResults([]);
    setOverallProgress(40);

    const results: StepResult[] = [];
    const deployable = resources.filter(r => mapResourceToIntent(r) !== null);

    for (let i = 0; i < deployable.length; i++) {
      const resource = deployable[i];
      const mapping = mapResourceToIntent(resource)!;

      results.push({ resource, action: "deploy", status: "running" });
      setDeployResults([...results]);
      setOverallProgress(40 + ((i + 1) / deployable.length) * 35);

      const start = Date.now();
      try {
        const response: EngineResponse = await executeIntent({
          intent: mapping.intent as any,
          action: "deploy",
          spec: mapping.spec,
        });

        const duration = Date.now() - start;
        const lastIdx = results.length - 1;

        if (response.status === "error") {
          results[lastIdx] = {
            resource,
            action: "deploy",
            status: "error",
            message: response.error || response.message || "Deploy failed",
            details: response.details,
            duration,
          };
          setDeployResults([...results]);
          setPhase("failed");
          setIsRunning(false);
          toast({ title: "Deploy Failed", description: `${resource} failed to provision.`, variant: "destructive" });
          return;
        }

        results[lastIdx] = {
          resource,
          action: "deploy",
          status: "success",
          message: response.message || "Provisioned",
          details: response.details,
          duration,
        };
      } catch (e) {
        const duration = Date.now() - start;
        const lastIdx = results.length - 1;
        results[lastIdx] = {
          resource,
          action: "deploy",
          status: "error",
          message: e instanceof Error ? e.message : "Unknown error",
          duration,
        };
        setDeployResults([...results]);
        setPhase("failed");
        setIsRunning(false);
        return;
      }
      setDeployResults([...results]);
    }

    setOverallProgress(75);
    toast({ title: "🚀 Deploy Complete", description: `${deployable.length} resources provisioned. Starting validation...` });

    // Auto-proceed to validation
    await runValidation();
  }, [resources, mapResourceToIntent]);

  // ─── VALIDATE (Discover) ───
  const runValidation = useCallback(async () => {
    setPhase("validating");
    setValidateResults([]);
    setOverallProgress(80);

    const results: StepResult[] = [];
    const deployable = resources.filter(r => mapResourceToIntent(r) !== null);

    for (let i = 0; i < deployable.length; i++) {
      const resource = deployable[i];
      const mapping = mapResourceToIntent(resource)!;

      results.push({ resource, action: "discover", status: "running" });
      setValidateResults([...results]);
      setOverallProgress(80 + ((i + 1) / deployable.length) * 18);

      const start = Date.now();
      try {
        const response: EngineResponse = await executeIntent({
          intent: mapping.intent as any,
          action: "discover",
          spec: {
            region: mapping.spec.region,
            name: mapping.spec.name as string,
            environment: mapping.spec.environment as string,
          },
        });

        const duration = Date.now() - start;
        const lastIdx = results.length - 1;

        if (response.status === "error") {
          results[lastIdx] = {
            resource,
            action: "discover",
            status: "error",
            message: "Resource not found — may still be provisioning",
            details: response.details,
            duration,
          };
        } else {
          results[lastIdx] = {
            resource,
            action: "discover",
            status: "success",
            message: "Resource confirmed live",
            details: response.details,
            duration,
          };
        }
      } catch (e) {
        const duration = Date.now() - start;
        const lastIdx = results.length - 1;
        results[lastIdx] = {
          resource,
          action: "discover",
          status: "error",
          message: e instanceof Error ? e.message : "Validation failed",
          duration,
        };
      }
      setValidateResults([...results]);
    }

    setOverallProgress(100);
    setPhase("complete");
    setIsRunning(false);
    toast({ title: "✅ Deployment Validated", description: "Post-deploy resource verification complete." });
  }, [resources, mapResourceToIntent]);

  const phaseLabel = {
    preflight: "Preflight — Dry Run",
    deploying: "Deploying Resources",
    validating: "Validating Resources",
    complete: "Deployment Complete",
    failed: "Deployment Failed",
  };

  const StatusIcon = ({ status }: { status: StepResult["status"] }) => {
    switch (status) {
      case "success": return <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" />;
      case "error": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "running": return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
      case "pending": return <Shield className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const ResultList = ({ results, label }: { results: StepResult[]; label: string }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
        {label}
      </div>
      {results.map((r, i) => (
        <div key={`${r.resource}-${i}`} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/20">
          <StatusIcon status={r.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{r.resource}</span>
              <Badge variant="outline" className="text-[9px] font-mono">{r.action}</Badge>
              {r.duration && (
                <span className="text-[10px] text-muted-foreground font-mono">{r.duration}ms</span>
              )}
            </div>
            {r.message && <p className="text-xs text-muted-foreground mt-0.5">{r.message}</p>}
            {r.details && r.status !== "pending" && (
              <pre className="mt-1.5 text-[10px] font-mono bg-background/50 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto text-muted-foreground">
                {JSON.stringify(r.details, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <Card className="glass-panel-elevated border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack} className="h-7 w-7 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="text-2xl">{entry.icon}</span>
            <div>
              <CardTitle className="text-base">{entry.name}</CardTitle>
              <div className="flex items-center gap-2 mt-0.5">
                <code className="text-[10px] font-mono text-primary/70">{entry.intentId}</code>
                <Badge variant="outline" className="text-[9px]">{provider.toUpperCase()}</Badge>
                <Badge variant="outline" className="text-[9px]">{region}</Badge>
                <Badge variant="outline" className="text-[9px]">{environment}</Badge>
              </div>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`text-xs font-mono ${
              phase === "complete" ? "border-[hsl(var(--success)/0.4)] text-[hsl(var(--success))]" :
              phase === "failed" ? "border-destructive/40 text-destructive" :
              "border-primary/40 text-primary"
            }`}
          >
            {phaseLabel[phase]}
          </Badge>
        </div>

        <Progress value={overallProgress} className="mt-3 h-1.5" />
        <p className="text-[10px] text-muted-foreground mt-1 font-mono text-right">{overallProgress}%</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Resources summary */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Resources:</span>
          {resources.map(r => (
            <Badge key={r} variant="secondary" className="text-[9px] font-mono">{r}</Badge>
          ))}
        </div>

        <Separator />

        {/* Phase actions */}
        <div className="flex items-center gap-3">
          {phase === "preflight" && !preflightPassed && (
            <Button onClick={runPreflight} disabled={isRunning} className="gap-2">
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              Run Preflight (Dry Run)
            </Button>
          )}
          {phase === "preflight" && preflightPassed && (
            <Button onClick={runDeploy} disabled={isRunning} className="gap-2">
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Deploy via SDK
            </Button>
          )}
          {phase === "failed" && (
            <Button onClick={runPreflight} variant="outline" className="gap-2">
              <FlaskConical className="h-4 w-4" /> Retry from Preflight
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDetails(!showDetails)}
            className="ml-auto text-[10px] text-muted-foreground"
          >
            {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showDetails ? "Collapse" : "Expand"}
          </Button>
        </div>

        {showDetails && (
          <div className="space-y-4">
            {preflightResults.length > 0 && (
              <ResultList results={preflightResults} label="Preflight — P-5 Shared Closure Dry Run" />
            )}
            {deployResults.length > 0 && (
              <>
                <Separator />
                <ResultList results={deployResults} label="SDK Execution — Real Deployment" />
              </>
            )}
            {validateResults.length > 0 && (
              <>
                <Separator />
                <ResultList results={validateResults} label="Post-Deploy Validation — Resource Discovery" />
              </>
            )}
          </div>
        )}

        {phase === "complete" && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-[hsl(var(--success)/0.08)] border border-[hsl(var(--success)/0.2)]">
            <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />
            <div>
              <p className="text-sm font-semibold text-[hsl(var(--success))]">Golden Path Deployed & Validated</p>
              <p className="text-xs text-muted-foreground">
                {deployResults.filter(r => r.status === "success").length} resources provisioned,{" "}
                {validateResults.filter(r => r.status === "success").length} confirmed live via SDK discover.
              </p>
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/5 border border-destructive/20">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-destructive">Deployment Failed</p>
              <p className="text-xs text-muted-foreground">
                Review errors above. Resources that were provisioned before failure remain live.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
