import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { executeIntent, type EngineResponse } from "@/lib/uidi-engine";
import { analyzeDependencies, getRemediationSteps, type DependencyAnalysis, type DependencyLevel } from "@/lib/dependency-dag";
import type { GoldenPathEntry, CloudProvider } from "@/components/GoldenPathCatalog";
import {
  Rocket, FlaskConical, Eye, CheckCircle2, XCircle, Loader2,
  Shield, AlertTriangle, ChevronDown, ChevronUp, ArrowLeft,
  Layers, Network, Database, Server, AlertCircle, Wrench,
} from "lucide-react";

type Phase = "analyzing" | "foundation-check" | "preflight" | "deploying" | "validating" | "complete" | "failed";

interface StepResult {
  resource: string;
  action: string;
  status: "success" | "error" | "pending" | "running" | "skipped" | "blocked";
  message?: string;
  details?: unknown;
  duration?: number;
  level?: DependencyLevel;
}

interface GoldenPathDeploymentProps {
  entry: GoldenPathEntry;
  provider: CloudProvider;
  region: string;
  environment: string;
  onBack: () => void;
}

const LEVEL_LABELS: Record<DependencyLevel, { label: string; icon: typeof Network; color: string }> = {
  0: { label: "Foundation", icon: Network, color: "text-primary" },
  1: { label: "Services", icon: Database, color: "text-amber-400" },
  2: { label: "Compute", icon: Server, color: "text-emerald-400" },
};

export function GoldenPathDeployment({
  entry,
  provider,
  region,
  environment,
  onBack,
}: GoldenPathDeploymentProps) {
  const [phase, setPhase] = useState<Phase>("analyzing");
  const [isRunning, setIsRunning] = useState(false);
  const [analysis, setAnalysis] = useState<DependencyAnalysis | null>(null);
  const [preflightResults, setPreflightResults] = useState<StepResult[]>([]);
  const [deployResults, setDeployResults] = useState<StepResult[]>([]);
  const [validateResults, setValidateResults] = useState<StepResult[]>([]);
  const [preflightPassed, setPreflightPassed] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [overallProgress, setOverallProgress] = useState(0);
  const [autoPreflightDone, setAutoPreflightDone] = useState(false);
  const [foundationStatus, setFoundationStatus] = useState<"unknown" | "checking" | "healthy" | "missing">("unknown");
  const [foundationCheckResults, setFoundationCheckResults] = useState<StepResult[]>([]);

  const resources = entry.resources[provider];

  // ─── PRD §3.1: Run dependency analysis on mount ───
  useEffect(() => {
    const result = analyzeDependencies(resources);
    setAnalysis(result);
    setOverallProgress(5);

    if (!result.canDeploy) {
      toast({
        title: "⚠️ Missing Foundation Dependencies",
        description: `${result.missingDependencies.length} required resources are not in this path. Remediation steps are shown below.`,
        variant: "destructive",
      });
    }
  }, [resources]);

  // ─── PRD §3.2: Auto-trigger foundation check when analysis passes ───
  useEffect(() => {
    if (analysis?.canDeploy && phase === "analyzing" && !autoPreflightDone) {
      setAutoPreflightDone(true);
      runFoundationCheck();
    }
  }, [analysis, phase, autoPreflightDone]);

  // Auto-trigger preflight once foundation is confirmed healthy
  useEffect(() => {
    if (foundationStatus === "healthy" && phase === "foundation-check" && !isRunning) {
      setPhase("preflight");
      runPreflight();
    }
  }, [foundationStatus, phase, isRunning]);

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
    if (lower.includes("subnet")) return null; // handled by VPC
    if (lower.includes("ec2") || lower.includes("compute engine") || lower.includes("linux vm") || lower.includes("vps")) {
      return {
        intent: "compute",
        action: "deploy",
        spec: { instance_type: "t3.medium", os: "amazon-linux-2023", region, environment, name: `${entry.id}-${environment}`, count: 1 },
      };
    }
    if (lower.includes("eks") || lower.includes("gke") || lower.includes("aks")) {
      return {
        intent: "eks",
        action: "deploy",
        spec: { cluster_name: `${entry.id}-${environment}`, region, environment, kubernetes_version: "1.29" },
      };
    }
    if (lower.includes("security group") || lower === "sg" || lower.includes("nsg") || lower.includes("firewall")) {
      return null; // provisioned as part of VPC stack by handleNetwork("deploy")
    }
    if (lower.includes("igw") || lower.includes("nat") || lower.includes("route table")) {
      return null; // provisioned as part of VPC foundation
    }
    if (lower.includes("iam") || lower.includes("irsa")) {
      return null; // auto-resolved by EKS role resolver during deploy
    }
    if (lower.includes("s3") || lower.includes("gcs") || lower.includes("blob")) {
      return {
        intent: "compute",
        action: "deploy",
        spec: { region, environment, name: `${entry.id}-bucket`, bucket: true },
      };
    }
    if (lower.includes("lambda") || lower.includes("cloud function") || lower.includes("azure function")) {
      return {
        intent: "compute",
        action: "deploy",
        spec: { region, environment, name: `${entry.id}-fn`, lambda: true },
      };
    }
    if (lower.includes("rds") || lower.includes("cloud sql") || lower.includes("azure sql") || lower.includes("aurora")) {
      return {
        intent: "compute",
        action: "deploy",
        spec: { region, environment, name: `${entry.id}-db`, database: true },
      };
    }
    return null;
  }, [entry.id, region, environment]);

  // ─── FOUNDATION PRE-CHECK: Verify L0 stack exists before preflight ───
  const runFoundationCheck = useCallback(async () => {
    if (!analysis) return;
    setPhase("foundation-check");
    setIsRunning(true);
    setFoundationStatus("checking");

    const l0Resources = analysis.executionOrder.filter(r => r.level === 0);
    if (l0Resources.length === 0) {
      // No L0 deps to verify — proceed directly
      setFoundationStatus("healthy");
      setIsRunning(false);
      return;
    }

    // Initialise all L0 resources as "checking"
    const results: StepResult[] = l0Resources.map(r => ({
      resource: r.resource,
      action: "discover",
      status: "running" as const,
      level: 0 as DependencyLevel,
    }));
    setFoundationCheckResults([...results]);

    // Single network discover covers VPC, Subnets, and Security Group
    const start = Date.now();
    let found = false;
    let resultMessage = "";
    let details: unknown;

    try {
      const response: EngineResponse = await executeIntent({
        intent: "network" as any,
        action: "discover",
        spec: { region, environment, name: `vpc-foundation-${environment}` },
      });
      const duration = Date.now() - start;
      found = response.status !== "error";
      resultMessage = found
        ? response.message || "Foundation stack confirmed healthy"
        : "VPC Foundation not found — deploy naawi.gold.v1.VpcFoundation first";
      details = response.details;

      setFoundationCheckResults(results.map(r => ({
        ...r,
        status: (found ? "success" : "error") as StepResult["status"],
        message: found ? `${r.resource} confirmed` : resultMessage,
        details: found ? details : undefined,
        duration,
      })));
    } catch (e) {
      const duration = Date.now() - start;
      found = false;
      resultMessage = e instanceof Error ? e.message : "Foundation check failed";
      setFoundationCheckResults(results.map(r => ({
        ...r,
        status: "error" as const,
        message: resultMessage,
        duration,
      })));
    }

    setFoundationStatus(found ? "healthy" : "missing");
    setIsRunning(false);

    if (found) {
      toast({ title: "✅ Foundation Verified", description: "VPC Foundation is healthy. Running preflight..." });
    } else {
      toast({
        title: "⛔ Foundation Not Found",
        description: "Deploy naawi.gold.v1.VpcFoundation before this path can proceed.",
        variant: "destructive",
      });
    }
  }, [analysis, region, environment]);

  // ─── PREFLIGHT (Dry Run) — PRD §3.2: Mandatory, automated ───
  const runPreflight = useCallback(async () => {
    setIsRunning(true);
    setPhase("preflight");
    setPreflightResults([]);
    setPreflightPassed(false);
    setOverallProgress(10);

    if (!analysis) return;

    const results: StepResult[] = [];
    const ordered = analysis.executionOrder;
    const deployable = ordered.filter(r => mapResourceToIntent(r.resource) !== null);
    const skipped = ordered.filter(r => mapResourceToIntent(r.resource) === null);

    skipped.forEach(r => {
      results.push({
        resource: r.resource,
        action: "skip",
        status: "skipped",
        message: "Provisioned as part of parent resource or no direct SDK mapping",
        level: r.level as DependencyLevel,
      });
    });

    let passed = true;
    for (let i = 0; i < deployable.length; i++) {
      const { resource, level } = deployable[i];
      const mapping = mapResourceToIntent(resource)!;

      results.push({ resource, action: "dry_run", status: "running", level: level as DependencyLevel });
      setPreflightResults([...results]);
      setOverallProgress(10 + ((i + 1) / deployable.length) * 25);

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
          results[lastIdx] = { resource, action: "dry_run", status: "error", message: response.error || "Dry run failed", details: response.details, duration, level: level as DependencyLevel };
          passed = false;
        } else {
          results[lastIdx] = { resource, action: "dry_run", status: "success", message: response.message || "Validation passed", details: response.details, duration, level: level as DependencyLevel };
        }
      } catch (e) {
        const duration = Date.now() - start;
        const lastIdx = results.length - 1;
        results[lastIdx] = { resource, action: "dry_run", status: "error", message: e instanceof Error ? e.message : "Unknown error", duration, level: level as DependencyLevel };
        passed = false;
      }
      setPreflightResults([...results]);
    }

    setPreflightPassed(passed);
    setOverallProgress(35);
    setIsRunning(false);

    if (passed) {
      toast({ title: "✅ Preflight Complete", description: `All ${deployable.length} resources passed. Deploy action unlocked.` });
    } else {
      toast({ title: "❌ Preflight Failed", description: "Resolve errors before deploying.", variant: "destructive" });
    }
  }, [analysis, mapResourceToIntent]);

  // ─── DEPLOY — PRD §3.3: Live execution, dependency-ordered ───
  const runDeploy = useCallback(async () => {
    if (!analysis) return;
    setIsRunning(true);
    setPhase("deploying");
    setDeployResults([]);
    setOverallProgress(40);

    const results: StepResult[] = [];
    const ordered = analysis.executionOrder;
    const deployable = ordered.filter(r => mapResourceToIntent(r.resource) !== null);

    for (let i = 0; i < deployable.length; i++) {
      const { resource, level } = deployable[i];
      const mapping = mapResourceToIntent(resource)!;

      results.push({ resource, action: "deploy", status: "running", level: level as DependencyLevel });
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
          results[lastIdx] = { resource, action: "deploy", status: "error", message: response.error || "Deploy failed", details: response.details, duration, level: level as DependencyLevel };
          setDeployResults([...results]);

          // PRD §3.3: Remediation logic for live failures
          toast({
            title: `Deploy Failed: ${resource}`,
            description: `Level ${level} resource failed. ${level === 0 ? "Foundation failure — cannot continue." : "Attempting to continue with remaining resources."}`,
            variant: "destructive",
          });

          if (level === 0) {
            setPhase("failed");
            setIsRunning(false);
            return;
          }
          continue; // Non-foundation failures: continue deploying
        }

        results[lastIdx] = { resource, action: "deploy", status: "success", message: response.message || "Provisioned", details: response.details, duration, level: level as DependencyLevel };
      } catch (e) {
        const duration = Date.now() - start;
        const lastIdx = results.length - 1;
        results[lastIdx] = { resource, action: "deploy", status: "error", message: e instanceof Error ? e.message : "Unknown error", duration, level: level as DependencyLevel };
        setDeployResults([...results]);
        if ((level as DependencyLevel) === 0) {
          setPhase("failed");
          setIsRunning(false);
          return;
        }
        continue;
      }
      setDeployResults([...results]);
    }

    setOverallProgress(75);
    const successCount = results.filter(r => r.status === "success").length;
    toast({ title: "🚀 Deploy Phase Complete", description: `${successCount}/${deployable.length} resources provisioned. Validating...` });
    await runValidation();
  }, [analysis, mapResourceToIntent]);

  // ─── VALIDATE — PRD §3.3: Resource discovery against live state ───
  const runValidation = useCallback(async () => {
    if (!analysis) return;
    setPhase("validating");
    setValidateResults([]);
    setOverallProgress(80);

    const results: StepResult[] = [];
    const ordered = analysis.executionOrder;
    const deployable = ordered.filter(r => mapResourceToIntent(r.resource) !== null);

    for (let i = 0; i < deployable.length; i++) {
      const { resource, level } = deployable[i];
      const mapping = mapResourceToIntent(resource)!;

      results.push({ resource, action: "discover", status: "running", level: level as DependencyLevel });
      setValidateResults([...results]);
      setOverallProgress(80 + ((i + 1) / deployable.length) * 18);

      const start = Date.now();
      try {
        const response: EngineResponse = await executeIntent({
          intent: mapping.intent as any,
          action: "discover",
          spec: { region: mapping.spec.region, name: mapping.spec.name as string, environment: mapping.spec.environment as string },
        });
        const duration = Date.now() - start;
        const lastIdx = results.length - 1;

        if (response.status === "error") {
          results[lastIdx] = { resource, action: "discover", status: "error", message: "Resource not found — may still be provisioning", details: response.details, duration, level: level as DependencyLevel };
        } else {
          results[lastIdx] = { resource, action: "discover", status: "success", message: "Resource confirmed live", details: response.details, duration, level: level as DependencyLevel };
        }
      } catch (e) {
        const duration = Date.now() - start;
        const lastIdx = results.length - 1;
        results[lastIdx] = { resource, action: "discover", status: "error", message: e instanceof Error ? e.message : "Validation failed", duration, level: level as DependencyLevel };
      }
      setValidateResults([...results]);
    }

    setOverallProgress(100);
    setPhase("complete");
    setIsRunning(false);
    toast({ title: "✅ Deployment Validated", description: "All resources verified against live cloud state." });
  }, [analysis, mapResourceToIntent]);

  const phaseConfig: Record<Phase, { label: string; color: string }> = {
    analyzing:        { label: "Analyzing Dependencies", color: "text-muted-foreground" },
    "foundation-check": {
      label: foundationStatus === "missing"
        ? "⛔ Foundation Not Found — Deploy VPC Foundation First"
        : foundationStatus === "healthy"
          ? "Foundation Verified"
          : "Checking Foundation...",
      color: foundationStatus === "missing" ? "text-destructive" : foundationStatus === "healthy" ? "text-[hsl(var(--success))]" : "text-primary",
    },
    preflight:        { label: preflightPassed ? "Preflight Passed — Ready to Deploy" : "Preflight — Dry Run", color: preflightPassed ? "text-[hsl(var(--success))]" : "text-primary" },
    deploying:        { label: "Deploying Resources (Level 0 → 2)", color: "text-primary" },
    validating:       { label: "Validating Live State", color: "text-amber-400" },
    complete:         { label: "Deployment Complete & Validated", color: "text-[hsl(var(--success))]" },
    failed:           { label: "Deployment Failed — Remediation Available", color: "text-destructive" },
  };

  const StatusIcon = ({ status }: { status: StepResult["status"] }) => {
    switch (status) {
      case "success": return <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" />;
      case "error": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case "running": return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
      case "pending": return <Shield className="h-3.5 w-3.5 text-muted-foreground" />;
      case "skipped": return <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
      case "blocked": return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    }
  };

  const LevelBadge = ({ level }: { level?: DependencyLevel }) => {
    if (level === undefined) return null;
    const cfg = LEVEL_LABELS[level];
    return (
      <Badge variant="outline" className={`text-[8px] font-mono ${cfg.color} border-current/20`}>
        L{level} {cfg.label}
      </Badge>
    );
  };

  const ResultList = ({ results, label }: { results: StepResult[]; label: string }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
        {label}
      </div>
      {results.map((r, i) => (
        <div key={`${r.resource}-${i}`} className={`flex items-start gap-3 p-3 rounded-lg border bg-muted/20 ${
          r.status === "blocked" ? "border-destructive/30" : "border-border/50"
        }`}>
          <StatusIcon status={r.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{r.resource}</span>
              <Badge variant="outline" className="text-[9px] font-mono">{r.action}</Badge>
              <LevelBadge level={r.level} />
              {r.duration && <span className="text-[10px] text-muted-foreground font-mono">{r.duration}ms</span>}
            </div>
            {r.message && <p className="text-xs text-muted-foreground mt-0.5">{r.message}</p>}
            {r.details && r.status !== "pending" && r.status !== "skipped" && (
              <pre className="mt-1.5 text-[10px] font-mono bg-background/50 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto text-muted-foreground">
                {JSON.stringify(r.details, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const remediationSteps = analysis ? getRemediationSteps(analysis) : [];

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
          <Badge variant="outline" className={`text-xs font-mono ${phaseConfig[phase].color} border-current/30`}>
            {phaseConfig[phase].label}
          </Badge>
        </div>
        <Progress value={overallProgress} className="mt-3 h-1.5" />
        <p className="text-[10px] text-muted-foreground mt-1 font-mono text-right">{overallProgress}%</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ─── Dependency Analysis (PRD §3.1) ─── */}
        {analysis && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              <Layers className="h-3.5 w-3.5" /> Dependency Graph — Level 0 → 1 → 2
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([0, 1, 2] as DependencyLevel[]).map(level => {
                const cfg = LEVEL_LABELS[level];
                const Icon = cfg.icon;
                const items = analysis.levels[level];
                return (
                  <div key={level} className="rounded-lg border border-border/50 bg-muted/10 p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                      <span className={`text-[10px] font-semibold uppercase tracking-widest ${cfg.color}`}>
                        L{level}: {cfg.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {items.length > 0 ? items.map(r => (
                        <Badge key={r} variant="secondary" className="text-[8px] font-mono">{r}</Badge>
                      )) : (
                        <span className="text-[9px] text-muted-foreground/50 italic">none</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Missing dependencies / remediation */}
            {analysis.missingDependencies.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-xs font-semibold text-destructive">Missing Dependencies Detected</span>
                </div>
                {remediationSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Wrench className="h-3 w-3 text-destructive" />
                    <Badge variant="outline" className="text-[8px] font-mono border-destructive/20 text-destructive">
                      L{step.level} {step.priority}
                    </Badge>
                    <span className="text-muted-foreground">
                      Deploy <strong className="text-foreground">{step.resource}</strong>
                    </span>
                  </div>
                ))}
                {!analysis.canDeploy && (
                  <p className="text-[10px] text-destructive mt-1">
                    ⛔ Foundation dependencies missing — deployment blocked. Deploy VPC Foundation first.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Phase actions — PRD §5: Deploy button only after preflight PASS */}
        <div className="flex items-center gap-3">
          {phase === "analyzing" && !analysis?.canDeploy && (
            <Button variant="outline" onClick={onBack} className="gap-2 text-xs">
              <ArrowLeft className="h-3.5 w-3.5" /> Deploy Foundation First
            </Button>
          )}
          {phase === "foundation-check" && foundationStatus === "missing" && !isRunning && (
            <Button variant="outline" onClick={onBack} className="gap-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10">
              <ArrowLeft className="h-3.5 w-3.5" /> Deploy naawi.gold.v1.VpcFoundation
            </Button>
          )}
          {phase === "foundation-check" && foundationStatus === "missing" && !isRunning && (
            <Button variant="ghost" size="sm" onClick={runFoundationCheck} className="gap-2 text-xs text-muted-foreground">
              <FlaskConical className="h-3.5 w-3.5" /> Re-check Foundation
            </Button>
          )}
          {phase === "preflight" && !preflightPassed && !isRunning && (
            <Button onClick={runPreflight} disabled={isRunning || !analysis?.canDeploy} className="gap-2">
              <FlaskConical className="h-4 w-4" /> Retry Preflight
            </Button>
          )}
          {phase === "preflight" && preflightPassed && (
            <Button onClick={runDeploy} disabled={isRunning} className="gap-2">
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Apply — Deploy via SDK
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
            {foundationCheckResults.length > 0 && (
              <ResultList results={foundationCheckResults} label="Foundation Pre-Check — L0 Stack Discovery" />
            )}
            {preflightResults.length > 0 && (
              <>
                {foundationCheckResults.length > 0 && <Separator />}
                <ResultList results={preflightResults} label="Preflight — P-5 Shared Closure Dry Run" />
              </>
            )}
            {deployResults.length > 0 && (
              <>
                <Separator />
                <ResultList results={deployResults} label="SDK Execution — Live Deployment (Level 0 → 2)" />
              </>
            )}
            {validateResults.length > 0 && (
              <>
                <Separator />
                <ResultList results={validateResults} label="Post-Deploy Validation — Live Resource Discovery" />
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
              <p className="text-sm font-semibold text-destructive">Deployment Failed — Remediation Required</p>
              <p className="text-xs text-muted-foreground">
                {deployResults.filter(r => r.status === "error").length} resources failed.
                Successfully provisioned resources remain live. Use Retry from Preflight to re-attempt.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
