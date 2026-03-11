import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IntentInput } from "@/components/IntentInput";
import { IntentForm } from "@/components/IntentForm";
import { AdvancedConfigForm } from "@/components/AdvancedConfigForm";
import { ConfigPreview } from "@/components/ConfigPreview";
import { CredentialsModal } from "@/components/CredentialsModal";
import { DeploymentHistory } from "@/components/DeploymentHistory";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  ParsedIntent,
  AwsCredentials,
  Deployment,
  Ec2Config,
  mapIntentToEc2Config,
  parseIntentRuleBased,
} from "@/lib/intent-types";
import { Rocket, KeyRound, Trash2, Zap } from "lucide-react";

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
  const [credentials, setCredentials] = useState<AwsCredentials | null>(null);
  const [credModalOpen, setCredModalOpen] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  const updateIntent = useCallback((newIntent: ParsedIntent) => {
    setIntent(newIntent);
    // Preserve advanced config overrides, just update the core fields
    setConfig(prev => ({ ...mapIntentToEc2Config(newIntent), ...getAdvancedOverrides(prev) }));
  }, []);

  const handleParse = useCallback(async (input: string) => {
    setIsParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke("parse-intent", {
        body: { message: input },
      });
      if (error) throw new Error(error.message);
      if (data?.intent) {
        const merged = { ...DEFAULT_INTENT, ...data.intent };
        updateIntent(merged);
        toast({ title: "Intent parsed", description: "Configuration updated from your description." });
      }
    } catch {
      const parsed = parseIntentRuleBased(input);
      const merged = { ...DEFAULT_INTENT, ...parsed } as ParsedIntent;
      updateIntent(merged);
      toast({ title: "Used rule-based parsing", description: "AI parsing unavailable, fell back to keyword matching." });
    } finally {
      setIsParsing(false);
    }
  }, [updateIntent]);

  const handleDeploy = useCallback(async () => {
    if (!credentials) {
      setCredModalOpen(true);
      return;
    }

    setIsDeploying(true);
    const deployId = crypto.randomUUID();
    const newDep: Deployment = { id: deployId, status: "launching", config, timestamp: new Date() };
    setDeployments((prev) => [newDep, ...prev]);

    try {
      const { data, error } = await supabase.functions.invoke("provision-ec2", {
        body: { config, credentials },
      });
      if (error) throw new Error(error.message);

      setDeployments((prev) =>
        prev.map((d) =>
          d.id === deployId
            ? { ...d, status: "running" as const, instanceId: data?.instanceId, publicIp: data?.publicIp }
            : d
        )
      );
      toast({ title: "Instance launched!", description: `Instance ${data?.instanceId} is now running.` });
    } catch (err: any) {
      setDeployments((prev) =>
        prev.map((d) => (d.id === deployId ? { ...d, status: "failed" as const, error: err.message } : d))
      );
      toast({ title: "Deployment failed", description: err.message, variant: "destructive" });
    } finally {
      setIsDeploying(false);
    }
  }, [credentials, config]);

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
            {credentials ? (
              <Button variant="outline" size="sm" onClick={() => { setCredentials(null); toast({ title: "Credentials cleared" }); }}>
                <Trash2 className="h-3 w-3 mr-1" /> Clear Creds
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setCredModalOpen(true)}>
                <KeyRound className="h-3 w-3 mr-1" /> Set AWS Creds
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-8 space-y-6">
        <Card className="bg-card">
          <CardContent className="pt-6">
            <IntentInput onParse={handleParse} isLoading={isParsing} />
          </CardContent>
        </Card>

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

        <div className="flex justify-center">
          <Button size="lg" onClick={handleDeploy} disabled={isDeploying} className="px-8 animate-pulse-glow">
            <Rocket className="h-5 w-5 mr-2" />
            {isDeploying ? "Deploying..." : "Deploy Infrastructure"}
          </Button>
        </div>

        <DeploymentHistory deployments={deployments} />
      </main>

      <CredentialsModal open={credModalOpen} onOpenChange={setCredModalOpen} onSave={setCredentials} />
    </div>
  );
}

// Extract advanced config overrides that shouldn't be reset when intent changes
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
