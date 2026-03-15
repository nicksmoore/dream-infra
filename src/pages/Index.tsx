import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntentInput } from "@/components/IntentInput";
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
import { Zap, Eye, Rocket, Vault } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";

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
};

const normalizeWorkload = (value?: string): WorkloadType | null => {
  if (!value) return null;
  if (value in ARCHETYPE_TO_WORKLOAD) return ARCHETYPE_TO_WORKLOAD[value];
  const normalized = value.toLowerCase().replace(/_/g, "-");
  if (normalized in WORKLOAD_TO_RESOURCES) return normalized as WorkloadType;
  return null;
};

export default function Index() {
  const [intent, setIntent] = useState<ParsedIntent>(DEFAULT_INTENT);
  const [config, setConfig] = useState<Ec2Config>(mapIntentToEc2Config(DEFAULT_INTENT));
  const [hasVaultCredentials] = useState(true);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [detectedResources, setDetectedResources] = useState<string[]>([]);
  const [operations, setOperations] = useState<any[]>([]);
  const [showDebugger, setShowDebugger] = useState(false);

  // Golden Path state
  const [goldenPathChoices, setGoldenPathChoices] = useState<GoldenPathChoice[]>([]);
  const [selectedGoldenPath, setSelectedGoldenPath] = useState<GoldenPathTemplate | null>(null);
  const [safetyReport, setSafetyReport] = useState<SafetyGateReportType | null>(null);
  const [rawIntentText, setRawIntentText] = useState("");
  const [goldenPathOverridden, setGoldenPathOverridden] = useState(false);

  const updateIntent = useCallback((newIntent: ParsedIntent) => {
    setIntent(newIntent);
    setConfig(prev => ({ ...mapIntentToEc2Config(newIntent), ...getAdvancedOverrides(prev) }));
  }, []);

  const handleGoldenPathSelect = useCallback((template: GoldenPathTemplate) => {
    setSelectedGoldenPath(template);
    setGoldenPathChoices([]); // Hide selector

    // Run safety gate
    const report = runSafetyGate(template, {
      cpuMillicores: 1000, // default estimate
      memoryMb: 2048,
      instanceCount: config.instanceCount || 1,
      estimatedMonthlyCost: 50, // heuristic
      hasVaultIntegration: hasVaultCredentials,
      hasHealthCheck: intent.environment === "prod",
      hasSloAlerts: false,
      environment: intent.environment,
    });

    setSafetyReport(report);

    // Update resources from golden path
    setDetectedResources(template.requiredResources);

    toast({
      title: `${template.icon} ${template.name} Selected`,
      description: report.halted
        ? "Safety gate has blockers — resolve before deploying."
        : `${template.augmentations.length} augmentations will be auto-scaffolded.`,
    });
  }, [config.instanceCount, hasVaultCredentials, intent.environment]);

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
    setSafetyReport(null); // Clear report, keep selectedGoldenPath for reference
    toast({ title: "Safety Gate Cleared", description: "Proceeding to orchestration." });
  }, []);

  const handleSafetyAbort = useCallback(() => {
    setSafetyReport(null);
    setSelectedGoldenPath(null);
    setGoldenPathChoices([]);
    toast({ title: "Deployment Cancelled" });
  }, []);

  const handleParse = useCallback(async (input: string) => {
    setIsParsing(true);
    setRawIntentText(input);
    // Reset golden path state on new parse
    setGoldenPathChoices([]);
    setSelectedGoldenPath(null);
    setSafetyReport(null);
    setGoldenPathOverridden(false);

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

        // Golden Path mapping
        const choices = mapIntentToGoldenPaths(input, mappedWorkload);
        if (choices.length === 1 && choices[0].confidence === "high") {
          // Auto-select high-confidence single match
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
        // Still show golden path choices for refinement
        const choices = mapIntentToGoldenPaths(input);
        setGoldenPathChoices(choices);
        return;
      }

      const parsed = parseIntentRuleBased(input);
      const merged = { ...DEFAULT_INTENT, ...parsed } as ParsedIntent;
      updateIntent(merged);
      setDetectedResources(parsed.resources || WORKLOAD_TO_RESOURCES[merged.workloadType] || ["ec2"]);
      
      // Golden Path mapping for rule-based
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

  // Determine if we should show orchestration (golden path cleared or overridden)
  const showOrchestration = (isMultiResource || operations.length > 0) && !safetyReport && (selectedGoldenPath || goldenPathOverridden || goldenPathChoices.length === 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">IDI Console</h1>
              <p className="text-xs text-muted-foreground">Intent-Driven Infrastructure</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-8 space-y-6">
        <Tabs defaultValue="deploy" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="deploy" className="gap-1.5">
              <Rocket className="h-3.5 w-3.5" /> Deploy
            </TabsTrigger>
            <TabsTrigger value="inventory" className="gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Inventory
            </TabsTrigger>
            <TabsTrigger value="vault" className="gap-1.5">
              <Vault className="h-3.5 w-3.5" /> Vault
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deploy" className="space-y-6">
            <Card className="bg-card">
              <CardContent className="pt-6">
                <IntentInput onParse={handleParse} isLoading={isParsing} />
              </CardContent>
            </Card>

            {detectedResources.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Detected Resources:</span>
                {detectedResources.map(r => (
                  <Badge key={r} variant="secondary" className="text-xs uppercase">{r}</Badge>
                ))}
                {selectedGoldenPath && (
                  <Badge variant="default" className="text-xs ml-2">
                    {selectedGoldenPath.icon} {selectedGoldenPath.name}
                  </Badge>
                )}
              </div>
            )}

            {/* Golden Path Selector — Choice Architecture */}
            {goldenPathChoices.length > 0 && (
              <GoldenPathSelector
                choices={goldenPathChoices}
                onSelect={handleGoldenPathSelect}
                onOverride={handleGoldenPathOverride}
              />
            )}

            {/* Safety Gate Report — Halt & Report */}
            {safetyReport && (
              <SafetyGateReport
                report={safetyReport}
                onProceed={handleSafetyProceed}
                onAbort={handleSafetyAbort}
              />
            )}

            {/* Orchestration — after Golden Path cleared */}
            {showOrchestration ? (
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
            ) : !safetyReport && goldenPathChoices.length === 0 && detectedResources.length > 0 && !isMultiResource ? (
              <>
                <Card className="bg-card">
                  <CardContent className="pt-6">
                    <IntentForm intent={intent} onChange={updateIntent} />
                  </CardContent>
                </Card>

                <Card className="bg-card">
                  <CardContent className="pt-6">
                    <AdvancedConfigForm config={config} workloadType={intent.workloadType} onChange={setConfig} />
                  </CardContent>
                </Card>

                <ConfigPreview config={config} />

                <ComputeActions
                  config={config}
                  hasCredentials={hasVaultCredentials}
                  onRequestCredentials={() => {
                    toast({ title: "Add credentials in the Vault tab", description: "Your cloud keys are now managed via the encrypted BYOC vault." });
                  }}
                />
              </>
            ) : null}

            <DeploymentHistory deployments={deployments} />
          </TabsContent>

          <TabsContent value="inventory">
            <ResourceInventory region={intent.region} />
          </TabsContent>

          <TabsContent value="vault">
            <CredentialVault />
          </TabsContent>
        </Tabs>
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
