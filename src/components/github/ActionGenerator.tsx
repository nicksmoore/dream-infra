import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, CheckCircle2, Github } from "lucide-react";
import { toast } from "sonner";

export function ActionGenerator() {
  const [config, setConfig] = useState({
    intentsPath: "infra/intents/",
    environment: "production",
    providers: "aws",
    diffMode: true,
    dryRun: false,
    failOnDrift: true,
    createDeployment: true,
  });
  const [copied, setCopied] = useState(false);

  const yaml = `name: Naawi Deploy

on:
  push:
    branches: [main]
    paths:
      - '${config.intentsPath}**'
  pull_request:
    paths:
      - '${config.intentsPath}**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Naawi Deploy
        uses: aura-solutions/naawi-deploy@v1
        with:
          naawi-api-key: \${{ secrets.NAAWI_API_KEY }}
          intents-path: '${config.intentsPath}'
          environment: ${config.environment}
          providers: '${config.providers}'
          diff-mode: ${config.diffMode}
          dry-run: ${config.dryRun}
          fail-on-drift: ${config.failOnDrift}
          create-deployment: ${config.createDeployment}

      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '🚀 Naawi deployment: \${{ steps.deploy.outputs.deployment-id }}\\n' +
                    'Resources: \${{ steps.deploy.outputs.resources-created }} created, ' +
                    '\${{ steps.deploy.outputs.resources-modified }} modified\\n' +
                    'Golden Path violations: \${{ steps.deploy.outputs.golden-path-violations }}'
            })`;

  const copyYaml = () => {
    navigator.clipboard.writeText(yaml);
    setCopied(true);
    toast.success("Workflow YAML copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <Card className="glass-panel-elevated border-border/40 border-l-2 border-l-primary/40">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Github className="h-5 w-5 text-primary mt-0.5" />
            <div className="text-sm space-y-1">
              <p className="font-semibold text-foreground">aura-solutions/naawi-deploy@v1</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                First-class GitHub Actions action. Configure below to generate a workflow YAML.
                Context injection, diff-mode execution, PR annotation, and deployment status reporting included.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Config */}
      <Card className="glass-panel border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Action Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Intents Path</Label>
              <Input
                value={config.intentsPath}
                onChange={e => setConfig(c => ({ ...c, intentsPath: e.target.value }))}
                className="mt-1 h-8 text-xs font-mono"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Environment</Label>
              <Select value={config.environment} onValueChange={v => setConfig(c => ({ ...c, environment: v }))}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">production</SelectItem>
                  <SelectItem value="staging">staging</SelectItem>
                  <SelectItem value="development">development</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Providers</Label>
              <Select value={config.providers} onValueChange={v => setConfig(c => ({ ...c, providers: v }))}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aws">AWS</SelectItem>
                  <SelectItem value="gcp">GCP</SelectItem>
                  <SelectItem value="aws,gcp">AWS + GCP</SelectItem>
                  <SelectItem value="aws,gcp,azure">AWS + GCP + Azure</SelectItem>
                  <SelectItem value="aws,gcp,azure,oci">All Providers</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={config.diffMode} onCheckedChange={v => setConfig(c => ({ ...c, diffMode: v }))} />
              <Label className="text-xs">Diff Mode</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={config.dryRun} onCheckedChange={v => setConfig(c => ({ ...c, dryRun: v }))} />
              <Label className="text-xs">Dry Run</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={config.failOnDrift} onCheckedChange={v => setConfig(c => ({ ...c, failOnDrift: v }))} />
              <Label className="text-xs">Fail on Drift</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={config.createDeployment} onCheckedChange={v => setConfig(c => ({ ...c, createDeployment: v }))} />
              <Label className="text-xs">Create Deployment</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Output */}
      <Card className="glass-panel border-border/40">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">.github/workflows/naawi-deploy.yml</CardTitle>
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={copyYaml}>
            {copied ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </CardHeader>
        <CardContent>
          <pre className="font-mono text-[11px] bg-muted/40 rounded-lg p-4 border border-border/50 overflow-x-auto max-h-96">
            {yaml}
          </pre>
        </CardContent>
      </Card>

      {/* Outputs reference */}
      <Card className="glass-panel border-border/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Action Outputs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { name: "deployment-id", desc: "Naawi Dolt deployment ID" },
              { name: "github-deployment-id", desc: "GitHub Deployments API ID" },
              { name: "intents-executed", desc: "Count of intent files executed" },
              { name: "resources-created", desc: "Cloud resources created" },
              { name: "resources-modified", desc: "Cloud resources modified" },
              { name: "golden-path-violations", desc: "Count of Golden Path violations (0 = compliant)" },
            ].map(o => (
              <div key={o.name} className="flex items-center gap-3 text-xs">
                <code className="font-mono text-primary bg-primary/5 px-2 py-0.5 rounded">{o.name}</code>
                <span className="text-muted-foreground">{o.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
