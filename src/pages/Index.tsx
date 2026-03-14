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
import { ResourceInventory } from "@/components/ResourceInventory";
import { McpConnectionStatus } from "@/components/McpConnectionStatus";
import { UserMenu } from "@/components/UserMenu";
import { CredentialVault } from "@/components/CredentialVault";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  ParsedIntent,
  Deployment,
  Ec2Config,
  mapIntentToEc2Config,
  parseIntentRuleBased,
} from "@/lib/intent-types";
import { Zap, Eye, Rocket, Vault } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const DEFAULT_INTENT: ParsedIntent = {
  workloadType: "general",
  costSensitivity: "cheapest",
  environment: "dev",
  region: "us-east-1",
  os: "amazon-linux-2023",
};

export default function Index() {
  const [intent, setIntent] = useState<ParsedIntent>(DEFAULT_INTENT);
  const [config, setConfig] = useState<Ec2Config>(mapIntentToEc2Config(DEFAULT_INTENT));
  const [hasVaultCredentials] = useState(true); // BYOC vault handles credentials now
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [detectedResources, setDetectedResources] = useState<string[]>([]);
  const [operations, setOperations] = useState<any[]>([]);

  const updateIntent = useCallback((newIntent: ParsedIntent) => {
    setIntent(newIntent);
    setConfig(prev => ({ ...mapIntentToEc2Config(newIntent), ...getAdvancedOverrides(prev) }));
  }, []);

  const handleParse = useCallback(async (input: string) => {
    setIsParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke("parse-intent", {
        body: { message: input },
      });
      if (error) throw new Error(error.message);
      if (data?.intent?.operations) {
        setOperations(data.intent.operations);
        // Map detected resources from operations for UI badges
        const resources = Array.from(new Set(data.intent.operations.map((op: any) => op.service.toLowerCase())));
        setDetectedResources(resources);
        toast({ title: "Intent compiled", description: `Project Naawi: ${data.intent.operations.length} SDK operations generated.` });
      } else if (data?.intent) {
        const merged = { ...DEFAULT_INTENT, ...data.intent };
        updateIntent(merged);
        setDetectedResources(data.intent.resources || ["ec2"]);
        toast({ title: "Intent parsed", description: "Configuration updated from your description." });
      }
    } catch {
      const parsed = parseIntentRuleBased(input);
      const merged = { ...DEFAULT_INTENT, ...parsed } as ParsedIntent;
      updateIntent(merged);
      setDetectedResources(parsed.resources || ["ec2"]);
      toast({ title: "Used rule-based parsing", description: "AI parsing unavailable, fell back to keyword matching." });
    } finally {
      setIsParsing(false);
    }
  }, [updateIntent]);

  const isMultiResource = detectedResources.length > 1 ||
    detectedResources.some(r => ["vpc", "eks", "subnets", "nacls", "s3", "cloudfront", "sqs", "lambda", "api-gateway", "rds"].includes(r));

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
          <div className="flex items-center gap-2">
            <McpConnectionStatus />
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
              </div>
            )}

            {isMultiResource || operations.length > 0 ? (
              <OrchestrationPanel
                resources={detectedResources}
                region={intent.region}
                environment={intent.environment}
                workloadType={intent.workloadType}
                instanceType={config.instanceType}
                os={config.os}
                naawiOperations={operations}
              />
            ) : (
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
                    // Navigate to vault tab
                    toast({ title: "Add credentials in the Vault tab", description: "Your cloud keys are now managed via the encrypted BYOC vault." });
                  }}
                />
              </>
            )}

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
