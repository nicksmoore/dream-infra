import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GitCommit, GitBranch, GitPullRequest, User, Clock, Hash, ExternalLink,
} from "lucide-react";

interface LineageRecord {
  deployment_id: string;
  commit_sha: string;
  branch: string;
  repo: string;
  pr_number: number | null;
  actor: string;
  triggered_by: "human_cli" | "github_actions" | "api" | "remediation";
  naawi_version: string;
  recorded_at: string;
  resources_created: number;
  status: "success" | "failure" | "rolled_back";
}

const MOCK_LINEAGE: LineageRecord[] = [
  { deployment_id: "dep-a3f92c1d", commit_sha: "a3f92c1d8b7e", branch: "main", repo: "aura-solutions/infra", pr_number: 142, actor: "nick-moore", triggered_by: "github_actions", naawi_version: "0.4.2", recorded_at: "2026-04-01T14:23:00Z", resources_created: 8, status: "success" },
  { deployment_id: "dep-b8e1f4a2", commit_sha: "b8e1f4a23c9d", branch: "feat/vpc-redesign", repo: "aura-solutions/infra", pr_number: 145, actor: "sarah-chen", triggered_by: "github_actions", naawi_version: "0.4.2", recorded_at: "2026-04-01T12:15:00Z", resources_created: 3, status: "success" },
  { deployment_id: "dep-c9d2e5b3", commit_sha: "c9d2e5b34a0e", branch: "main", repo: "aura-solutions/infra", pr_number: null, actor: "nick-moore", triggered_by: "human_cli", naawi_version: "0.4.1", recorded_at: "2026-03-31T18:42:00Z", resources_created: 1, status: "success" },
  { deployment_id: "dep-d0e3f6c4", commit_sha: "d0e3f6c45b1f", branch: "hotfix/sg-lockdown", repo: "aura-solutions/infra", pr_number: 139, actor: "remediation-bot", triggered_by: "remediation", naawi_version: "0.4.1", recorded_at: "2026-03-31T03:12:00Z", resources_created: 0, status: "success" },
  { deployment_id: "dep-e1f4g7d5", commit_sha: "e1f4g7d56c2g", branch: "feat/eks-upgrade", repo: "aura-solutions/infra", pr_number: 137, actor: "james-wu", triggered_by: "github_actions", naawi_version: "0.4.1", recorded_at: "2026-03-30T16:08:00Z", resources_created: 5, status: "failure" },
];

const TRIGGER_BADGE: Record<string, { label: string; class: string }> = {
  github_actions: { label: "GitHub Actions", class: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  human_cli: { label: "CLI", class: "bg-primary/10 text-primary border-primary/20" },
  api: { label: "API", class: "bg-muted text-muted-foreground border-border/40" },
  remediation: { label: "Auto-Remediation", class: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
};

const STATUS_BADGE: Record<string, { class: string }> = {
  success: { class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  failure: { class: "bg-red-500/10 text-red-400 border-red-500/20" },
  rolled_back: { class: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
};

export function GitLineagePanel() {
  return (
    <div className="space-y-4">
      <Card className="glass-panel-elevated border-border/40 border-l-2 border-l-primary/40">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <GitCommit className="h-5 w-5 text-primary mt-0.5" />
            <div className="text-sm space-y-1">
              <p className="font-semibold text-foreground">Git Lineage — Dolt Schema: git_lineage</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Every deployment records commit SHA, branch, repo, PR number, actor, and trigger type.
                Lineage gracefully degrades to null fields when invoked outside a Git context.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {MOCK_LINEAGE.map(record => (
          <Card key={record.deployment_id} className="glass-panel border-border/40 hover:border-border/60 transition-all">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  <code className="font-mono text-xs text-foreground">{record.commit_sha}</code>
                  <Badge variant="outline" className={`text-[8px] ${TRIGGER_BADGE[record.triggered_by].class}`}>
                    {TRIGGER_BADGE[record.triggered_by].label}
                  </Badge>
                  <Badge variant="outline" className={`text-[8px] ${STATUS_BADGE[record.status].class}`}>
                    {record.status}
                  </Badge>
                </div>
                <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                  {new Date(record.recorded_at).toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <GitBranch className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono text-foreground">{record.branch}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono text-foreground">{record.repo}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <User className="h-3 w-3 text-muted-foreground" />
                  <span className="text-foreground">{record.actor}</span>
                </div>
                {record.pr_number && (
                  <div className="flex items-center gap-1.5">
                    <GitPullRequest className="h-3 w-3 text-muted-foreground" />
                    <span className="text-primary">PR #{record.pr_number}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                <span>Deployment: <code className="text-foreground">{record.deployment_id}</code></span>
                <span>Resources: <span className="text-foreground">{record.resources_created}</span></span>
                <span>Engine: <code className="text-foreground">v{record.naawi_version}</code></span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
