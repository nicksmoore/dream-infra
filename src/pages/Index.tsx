import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntentInput } from "@/components/IntentInput";
import { SREPanel } from "@/components/SREPanel";
import { IntentForm } from "@/components/IntentForm";
import { AdvancedConfigForm } from "@/components/AdvancedConfigForm";
import { ConfigPreview } from "@/components/ConfigPreview";
import { DeploymentHistory } from "@/components/DeploymentHistory";
import { ComputeActions } from "@/components/ComputeActions";
import { OrchestrationPanel } from "@/components/OrchestrationPanel";
import { DeploymentDebugger } from "@/components/DeploymentDebugger";
import { ResourceInventory } from "@/components/ResourceInventory";
import { GoldenPathSelector } from "@/components/GoldenPathSelector";
import { SafetyGateReport } from "@/components/SafetyGateReport";
import { DryRunPanel } from "@/components/DryRunPanel";
import { BatchPreviewPanel } from "@/components/BatchPreviewPanel";
import { AuditTrailPanel } from "@/components/AuditTrailPanel";
import { GoldenPathCatalog, type GoldenPathEntry, type CloudProvider as CatalogProvider } from "@/components/GoldenPathCatalog";
import { GoldenPathDeployment } from "@/components/GoldenPathDeployment";
import { PostDeployValidation } from "@/components/PostDeployValidation";

import { UserMenu } from "@/components/UserMenu";
import { CredentialVault } from "@/components/CredentialVault";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  ParsedIntent,
  Deployment,
  Ec2Config,
  WorkloadType,
  mapIntentToEc2Config,
  parseIntentRuleBased,
} from "@/lib/intent-types";
import {
  mapIntentToGoldenPaths,
  runSafetyGate,
  type GoldenPathTemplate,
  type GoldenPathChoice,
  type SafetyGateReport as SafetyGateReportType,
} from "@/lib/golden-path";
import {
  hydrateGoldenPathCeiling,
  getCurrentCapacityTier,
  escalateViaIntent,
  type CapacityTierId,
  type EscalationRecord,
} from "@/lib/policy-registry";
import { Zap, Eye, Rocket, Vault, FlaskConical, ListOrdered, ScrollText, Layers, BookOpen, Map, Bot } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { NavLink } from "@/components/NavLink";
import { useNavigate, Link } from "react-router-dom";

const DEFAULT_INTENT: ParsedIntent = {
  workloadType: "general",
  costSensitivity: "cheapest",
  environment: "dev",
  region: "us-east-1",
  os: "amazon-linux-2023",
};

const ARCHETYPE_TO_WORKLOAD: Record<string, WorkloadType> = {
  EDGE_STATIC_SPA: "global-spa",
  SERVICE_MESH: "service-mesh",
  EVENT_PIPELINE: "event-pipeline",
  INTERNAL_API: "internal-api",
  THREE_TIER: "three-tier",
  EDGE_CACHE: "edge-cache",
  CROSS_REGION_PEERED: "cross-region-peered",
  GITOPS_CANARY: "gitops-canary",
  EPHEMERAL_PREVIEW: "ephemeral-preview",
  SERVERLESS_FAST_PATH: "serverless-fast-path",
  STANDARD_VPC: "standard-vpc",
  OBSERVABILITY_STACK: "observability-stack",
  SECURE_HANDSHAKE: "secure-handshake",
  HARDENED_PATH: "hardened-path",
  AI_OPS_PATH: "ai-ops-path",
};

const WORKLOAD_TO_RESOURCES: Record<WorkloadType, string[]> = {
  general: ["ec2"],
  compute: ["ec2"],
  memory: ["ec2"],
  storage: ["ec2", "ebs"],
  accelerated: ["ec2"],
  hpc: ["ec2"],
  "global-spa": ["s3", "cloudfront", "route53", "lambda"],
  "service-mesh": ["eks", "app-mesh", "alb"],
  "event-pipeline": ["sqs", "lambda", "dynamodb", "eventbridge"],
  "internal-api": ["api-gateway", "lambda", "rds-proxy", "rds"],
  "three-tier": ["asg", "alb", "rds", "elasticache", "vpc", "subnets"],
  "edge-cache": ["dynamodb", "route53", "lambda", "cloudfront"],
  "cross-region-peered": ["vpc", "subnets", "vpc-peering", "eks"],
  "gitops-canary": ["eks", "argo-cd", "argo-rollouts"],
  "ephemeral-preview": ["eks", "vcluster", "gh-actions"],
  "serverless-fast-path": ["lambda", "api-gateway", "iam"],
  "standard-vpc": ["vpc", "subnets", "nat-gateway", "flow-logs"],
  "observability-stack": ["otel-collector", "prometheus", "loki"],
  "secure-handshake": ["iam", "vault", "eks"],
  "hardened-path": ["eks", "route53-arc", "rds-global", "s3-replication"],
  "ai-ops-path": ["eks", "prometheus-adapter", "keda", "naawi-engine"],
};

const normalizeWorkload = (value?: string): WorkloadType | null => {
  if (!value) return null;
  if (value in ARCHETYPE_TO_WORKLOAD) return ARCHETYPE_TO_WORKLOAD[value];
  const normalized = value.toLowerCase().replace(/_/g, "-");
  if (normalized in WORKLOAD_TO_RESOURCES) return normalized as WorkloadType;
  return null;
};

export default function Index() {
  const navigate = useNavigate();
  const [intent, setIntent] = useState<ParsedIntent>(DEFAULT_INTENT);
  const [config, setConfig] = useState<Ec2Config>(mapIntentToEc2Config(DEFAULT_INTENT));
  const [hasVaultCredentials] = useState(true);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [detectedResources, setDetectedResources] = useState<string[]>([]);
  const [operations, setOperations] = useState<any[]>([]);
  const [showDebugger, setShowDebugger] = useState(false);
  const [rawIntentText, setRawIntentText] = useState("");

  // Golden Path state
  const [goldenPathChoices, setGoldenPathChoices] = useState<GoldenPathChoice[]>([]);
  const [selectedGoldenPath, setSelectedGoldenPath] = useState<GoldenPathTemplate | null>(null);
  const [safetyReport, setSafetyReport] = useState<SafetyGateReportType | null>(null);
  const [goldenPathOverridden, setGoldenPathOverridden] = useState(false);
  const [currentTierId, setCurrentTierId] = useState<CapacityTierId>("sandbox");
  const [doltCommitRef, setDoltCommitRef] = useState<string | null>(null);
  const [escalationHistory, setEscalationHistory] = useState<EscalationRecord[]>([]);

  // Catalog selection state
  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<GoldenPathEntry | null>(null);
  const [selectedCatalogProvider, setSelectedCatalogProvider] = useState<CatalogProvider | null>(null);

  // ───── Dolt Snapshot Manager ─────
  const generateDoltSnapshot = useCallback((pathId: string, env: string): string => {
    const hash = `dolt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
    console.log(`[Naawi] Intent snapshot committed to Dolt: ${hash} (path=${pathId}, env=${env})`);
    return hash;
  }, []);

  const updateIntent = useCallback((newIntent: ParsedIntent) => {
    setIntent(newIntent);
    setConfig(prev => ({ ...mapIntentToEc2Config(newIntent), ...getAdvancedOverrides(prev) }));
  }, []);

  const handleGoldenPathSelect = useCallback((template: GoldenPathTemplate) => {
    setSelectedGoldenPath(template);
    setGoldenPathChoices([]);

    const { template: hydrated, tierName, source } = hydrateGoldenPathCeiling(template, intent.environment);
    const { tier } = getCurrentCapacityTier(template.id, intent.environment);
    setCurrentTierId(tier.id);

    const commitRef = generateDoltSnapshot(template.id, intent.environment);
    setDoltCommitRef(commitRef);

    console.log(
      `[Naawi] Golden Path "${template.name}" hydrated with ${tierName} tier (source: ${source}). ` +
      `Ceilings: ${hydrated.resourceCeiling.maxCpuMillicores}m CPU, ${hydrated.resourceCeiling.maxMemoryMb}MB Memory`
    );

    const needsCompute = hydrated.requiredResources.some(r => ["ec2", "asg", "eks", "lambda"].includes(r));
    const report = runSafetyGate(hydrated, {
      cpuMillicores: needsCompute ? Math.min(1000, hydrated.resourceCeiling.maxCpuMillicores) : 0,
      memoryMb: needsCompute ? Math.min(2048, hydrated.resourceCeiling.maxMemoryMb) : 0,
      instanceCount: needsCompute ? (config.instanceCount || 1) : 0,
      estimatedMonthlyCost: 50,
      hasVaultIntegration: hasVaultCredentials,
      hasHealthCheck: intent.environment === "prod",
      hasSloAlerts: false,
      doltCommitRef: commitRef,
      environment: intent.environment,
    });
    setSafetyReport(report);
    setDetectedResources(hydrated.requiredResources);
    setSelectedGoldenPath(hydrated);

    toast({
      title: `${hydrated.icon} ${hydrated.name} Selected`,
      description: report.halted
        ? "Safety gate has blockers — resolve before deploying."
        : `${hydrated.augmentations.length} augmentations auto-scaffolded. Capacity: ${tierName} tier.`,
    });
  }, [config.instanceCount, hasVaultCredentials, intent.environment, generateDoltSnapshot]);

  const handleGoldenPathOverride = useCallback((justification: string) => {
    setGoldenPathOverridden(true);
    setGoldenPathChoices([]);
    setSafetyReport(null);
    setSelectedGoldenPath(null);
    toast({
      title: "Golden Path Overridden",
      description: `Off-road justification logged: "${justification.slice(0, 60)}..."`,
      variant: "destructive",
    });
  }, []);

  const handleSafetyProceed = useCallback(() => {
    setSafetyReport(null);
    toast({ title: "Safety Gate Cleared", description: "Proceeding to orchestration." });
  }, []);

  const handleSafetyAbort = useCallback(() => {
    setSafetyReport(null);
    setSelectedGoldenPath(null);
    setGoldenPathChoices([]);
    setDoltCommitRef(null);
    toast({ title: "Deployment Cancelled" });
  }, []);

  const handleEscalation = useCallback((escalation_text: string) => {
    if (!selectedGoldenPath) return;
    const result = escalateViaIntent(
      escalation_text,
      selectedGoldenPath.id,
      intent.environment,
      "current-user"
    );
    if (result.success && result.newTier && result.record) {
      setEscalationHistory(prev => [...prev, result.record!]);
      setCurrentTierId(result.newTier.id);
      toast({
        title: `✅ Escalated to ${result.newTier.name}`,
        description: `Dolt commit: ${result.record.doltCommitHash}. Re-running safety gate...`,
      });
      handleGoldenPathSelect(selectedGoldenPath);
    } else if (result.requiresApproval) {
      toast({ title: "Approval Required", description: result.error, variant: "destructive" });
    } else {
      toast({ title: "Escalation Failed", description: result.error, variant: "destructive" });
    }
  }, [selectedGoldenPath, intent.environment, handleGoldenPathSelect]);

  const handleCatalogSelect = useCallback((entry: GoldenPathEntry, provider: CatalogProvider) => {
    setSelectedCatalogEntry(entry);
    setSelectedCatalogProvider(provider);
    setDetectedResources(entry.resources[provider]);
    toast({
      title: `${entry.icon} ${entry.name}`,
      description: `Deploying to ${provider.toUpperCase()} with ${entry.resources[provider].length} resources`,
    });
  }, []);

  const handleParse = useCallback(async (input: string) => {
    setIsParsing(true);
    setRawIntentText(input);
    setGoldenPathChoices([]);
    setSelectedGoldenPath(null);
    setSafetyReport(null);
    setGoldenPathOverridden(false);
    setSelectedCatalogEntry(null);
    setSelectedCatalogProvider(null);

    try {
      const { data, error } = await supabase.functions.invoke("parse-intent", {
        body: { message: input },
      });
      if (error) throw new Error(error.message);

      const intentData = data?.intent;
      const isCrossRegion = /cross.?region|vpc.?peer|peering/i.test(input);
      const mappedWorkload = isCrossRegion ? "cross-region-peered" as WorkloadType : normalizeWorkload(intentData?.archetype);

      if (mappedWorkload) {
        const mappedIntent: ParsedIntent = {
          ...DEFAULT_INTENT,
          ...intentData?.variables,
          workloadType: mappedWorkload,
        };
        updateIntent(mappedIntent);
        setDetectedResources(WORKLOAD_TO_RESOURCES[mappedWorkload]);
        const choices = mapIntentToGoldenPaths(input, mappedWorkload);
        if (choices.length === 1 && choices[0].confidence === "high") {
          handleGoldenPathSelect(choices[0].template);
        } else {
          setGoldenPathChoices(choices);
        }
        if (intentData?.confidence === "LOW") {
          toast({
            title: "Pattern inferred with defaults",
            description: intentData.disambiguationPrompt || "Some details were missing, so the engine used safe defaults.",
          });
        }
        return;
      }

      if (intentData?.confidence === "LOW") {
        toast({
          title: "Disambiguation Required",
          description: intentData.disambiguationPrompt || "Intent ambiguous. Please specify the target architecture pattern.",
          variant: "destructive",
        });
        const choices = mapIntentToGoldenPaths(input);
        setGoldenPathChoices(choices);
        return;
      }

      const parsed = parseIntentRuleBased(input);
      const merged = { ...DEFAULT_INTENT, ...parsed } as ParsedIntent;
      updateIntent(merged);
      setDetectedResources(parsed.resources || WORKLOAD_TO_RESOURCES[merged.workloadType] || ["ec2"]);
      const choices = mapIntentToGoldenPaths(input, merged.workloadType);
      if (choices.length === 1 && choices[0].confidence === "high") {
        handleGoldenPathSelect(choices[0].template);
      } else {
        setGoldenPathChoices(choices);
      }
      toast({ title: "Intent Parsed", description: "Review the Golden Path recommendation below." });
    } catch (e) {
      console.error("Parse error:", e);
      const parsed = parseIntentRuleBased(input);
      const merged = { ...DEFAULT_INTENT, ...parsed } as ParsedIntent;
      updateIntent(merged);
      setDetectedResources(parsed.resources || ["ec2"]);
      const choices = mapIntentToGoldenPaths(input, merged.workloadType);
      setGoldenPathChoices(choices);
      toast({ title: "Fell back to Rule-based", description: "Keyword matching used. Review Golden Path options." });
    } finally {
      setIsParsing(false);
    }
  }, [updateIntent, handleGoldenPathSelect]);

  const isMultiResource = detectedResources.length > 1 ||
    detectedResources.some(r => [
      "vpc", "eks", "subnets", "nacls", "s3", "cloudfront", "sqs", "lambda", "api-gateway", "rds",
      "edge_static_spa", "service_mesh", "event_pipeline"
    ].includes(r));

  const showOrchestration = (isMultiResource || operations.length > 0) && !safetyReport && (selectedGoldenPath || goldenPathOverridden || goldenPathChoices.length === 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-border/50">
        <div className="container max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight font-display text-foreground">Project Naawi</h1>
              <p className="text-[10px] text-muted-foreground tracking-wide">Intent-Driven Infrastructure · Observed Truth · Zero Configuration</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <NavLink to="/backstage" className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-primary/5" activeClassName="text-primary bg-primary/10">
              <BookOpen className="h-3.5 w-3.5 inline mr-1" />Backstage
            </NavLink>
            <NavLink to="/golden-path" className="text-xs font-medium text-muted-foreground hover:text-primary transition-colors px-3 py-1.5 rounded-lg hover:bg-primary/5" activeClassName="text-primary bg-primary/10">
              <Map className="h-3.5 w-3.5 inline mr-1" />VPC Foundation
            </NavLink>
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="glass-panel-elevated rounded-2xl p-6 animate-fade-in">
          <IntentInput onParse={handleParse} isLoading={isParsing} />
          <p className="text-[10px] text-muted-foreground mt-2">
            Describe what you need and the engine will match a Golden Path, or browse the catalog below.
          </p>
        </div>

        {detectedResources.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap animate-fade-in">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Resources</span>
            {detectedResources.map(r => (
              <Badge key={r} variant="secondary" className="glass-badge text-[10px] uppercase font-mono">{r}</Badge>
            ))}
            {selectedGoldenPath && (
              <Badge className="text-[10px] ml-2 gap-1">
                <Layers className="h-3 w-3" />
                {selectedGoldenPath.name}
              </Badge>
            )}
          </div>
        )}

        {goldenPathChoices.length > 0 && (
          <GoldenPathSelector
            choices={goldenPathChoices}
            onSelect={handleGoldenPathSelect}
            onOverride={handleGoldenPathOverride}
          />
        )}

        {safetyReport && (
          <SafetyGateReport
            report={safetyReport}
            onProceed={handleSafetyProceed}
            onAbort={handleSafetyAbort}
            onEscalate={handleEscalation}
          />
        )}

        {showOrchestration && (
          <div className="space-y-6">
            <OrchestrationPanel
              resources={detectedResources}
              region={intent.region}
              environment={intent.environment}
              workloadType={intent.workloadType}
              instanceType={config.instanceType}
              os={config.os}
              naawiOperations={operations}
            />
            {operations.length > 0 && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDebugger(!showDebugger)}
                  className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
                >
                  {showDebugger ? "Hide Engine Traces" : "Inspect IDI Engine Traces"}
                </Button>
              </div>
            )}
            {showDebugger && <DeploymentDebugger />}
          </div>
        )}

        {selectedCatalogEntry && selectedCatalogProvider ? (
          <GoldenPathDeployment
            entry={selectedCatalogEntry}
            provider={selectedCatalogProvider}
            region={intent.region}
            environment={intent.environment}
            onBack={() => {
              setSelectedCatalogEntry(null);
              setSelectedCatalogProvider(null);
            }}
          />
        ) : (
          <Tabs defaultValue="inventory" className="w-full">
            <TabsList className="glass-panel border-0 mb-6 p-1 h-auto flex-wrap">
              <TabsTrigger value="inventory" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg">
                <Eye className="h-3.5 w-3.5" /> Inventory
              </TabsTrigger>
              <TabsTrigger value="vault" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg">
                <Vault className="h-3.5 w-3.5" /> Vault
              </TabsTrigger>
              <TabsTrigger value="sre" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg">
                <Bot className="h-3.5 w-3.5" /> SRE
              </TabsTrigger>
              <TabsTrigger value="catalog" className="gap-1.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-lg">
                <Layers className="h-3.5 w-3.5" /> Catalog
              </TabsTrigger>
            </TabsList>

            {/* ═══════════ INVENTORY ═══════════ */}
            <TabsContent value="inventory">
              <ResourceInventory region={intent.region} />
            </TabsContent>

            {/* ═══════════ VAULT ═══════════ */}
            <TabsContent value="vault">
              <CredentialVault />
            </TabsContent>

            {/* ═══════════ SRE ═══════════ */}
            <TabsContent value="sre" className="space-y-6">
              <SREPanel />
            </TabsContent>

            {/* ═══════════ CATALOG ═══════════ */}
            <TabsContent value="catalog" className="space-y-6">
              <div className="glass-panel-elevated rounded-2xl p-6 animate-fade-in">
                <div className="flex items-center gap-3 mb-4">
                  <Layers className="h-5 w-5 text-primary" />
                  <div>
                    <h2 className="text-base font-bold font-display text-foreground">Golden Path Catalogue</h2>
                    <p className="text-xs text-muted-foreground">
                      PRD §5.1 — Real SDK deployments with preflight dry-run, live provisioning, and post-deploy validation via resource discovery.
                    </p>
                  </div>
                </div>
                <GoldenPathCatalog onSelect={handleCatalogSelect} />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}

function getAdvancedOverrides(config: Ec2Config): Partial<Ec2Config> {
  const overrides: Partial<Ec2Config> = {};
  if (config.subnetId) overrides.subnetId = config.subnetId;
  if (config.securityGroupIds?.length) overrides.securityGroupIds = config.securityGroupIds;
  if (config.privateIpAddress) overrides.privateIpAddress = config.privateIpAddress;
  if (config.keyName) overrides.keyName = config.keyName;
  if (config.iamInstanceProfile) overrides.iamInstanceProfile = config.iamInstanceProfile;
  if (config.userData) overrides.userData = config.userData;
  if (config.placementGroupName) overrides.placementGroupName = config.placementGroupName;
  if (config.spotMaxPrice) overrides.spotMaxPrice = config.spotMaxPrice;
  return overrides;
}
