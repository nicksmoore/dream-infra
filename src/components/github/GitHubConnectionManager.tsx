import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/api-client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Github, Plus, Trash2, CheckCircle2, XCircle, Loader2, ExternalLink, GitPullRequest, Shield,
} from "lucide-react";

interface GitHubConnection {
  id: string;
  repo_owner: string;
  repo_name: string;
  default_branch: string;
  auto_pr: boolean;
  require_approval: boolean;
  created_at: string;
  github_pat_credential_id: string | null;
}

interface GitHubRepo {
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  private?: boolean;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string;
}

export function GitHubConnectionManager() {
  const { user } = useAuth();
  const [connections, setConnections] = useState<GitHubConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  // Setup flow state
  const [step, setStep] = useState<"token" | "repo" | "settings">("token");
  const [pat, setPat] = useState("");
  const [validating, setValidating] = useState(false);
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [autoPr, setAutoPr] = useState(true);
  const [requireApproval, setRequireApproval] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConnections = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("github_connections")
      .select("*")
      .eq("user_id", user.id) as any;
    setConnections((data || []) as GitHubConnection[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const handleValidateToken = async () => {
    if (!pat.trim()) return;
    setValidating(true);
    try {
      const { data, error } = await invokeFunction("github-pr", {
        body: { action: "validate_token", token: pat.trim() },
      });
      if (error) throw new Error(error.message);
      if (!data.valid) throw new Error("Invalid token");

      setGhUser(data.user);
      setRepos(data.repos);
      setStep("repo");
      toast({ title: "✅ Token verified", description: `Connected as ${data.user.login}` });
    } catch (e) {
      toast({
        title: "Token validation failed",
        description: e instanceof Error ? e.message : "Invalid token",
        variant: "destructive",
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSaveConnection = async () => {
    if (!user || !selectedRepo) return;
    setSaving(true);

    const repo = repos.find(r => r.full_name === selectedRepo);
    if (!repo) return;

    try {
      // 1. Store PAT in credential vault
      const { error: vaultError } = await invokeFunction("credential-vault", {
        body: {
          action: "store",
          provider: "aws", // reuse the vault, provider field doesn't matter for GitHub
          label: `github-${repo.full_name}`,
          credentials: { pat: pat.trim() },
        },
      });
      if (vaultError) throw new Error(vaultError.message);

      // 2. Get the newly created credential ID
      const { data: creds } = await supabase
        .from("user_credentials")
        .select("id")
        .eq("user_id", user.id)
        .eq("label", `github-${repo.full_name}`)
        .order("created_at", { ascending: false })
        .limit(1);

      const credId = creds?.[0]?.id || null;

      // 3. Create github connection
      const { error: connError } = await supabase
        .from("github_connections")
        .insert({
          user_id: user.id,
          github_pat_credential_id: credId,
          repo_owner: repo.owner,
          repo_name: repo.name,
          default_branch: repo.default_branch,
          auto_pr: autoPr,
          require_approval: requireApproval,
        } as any) as any;

      if (connError) throw connError;

      toast({ title: "🔗 GitHub Connected", description: `${repo.full_name} linked for deployment PRs.` });
      setAddOpen(false);
      resetForm();
      fetchConnections();
    } catch (e) {
      toast({
        title: "Failed to save connection",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("github_connections")
      .delete()
      .eq("id", id) as any;
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Connection removed" });
      fetchConnections();
    }
  };

  const resetForm = () => {
    setStep("token");
    setPat("");
    setGhUser(null);
    setRepos([]);
    setSelectedRepo("");
    setAutoPr(true);
    setRequireApproval(true);
  };

  if (loading) return <div className="text-muted-foreground text-sm">Loading…</div>;

  return (
    <Card className="glass-panel-elevated border-border/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Github className="h-4 w-4 text-foreground" />
          GitHub Pipeline Integration
        </CardTitle>
        <CardDescription>
          Connect a GitHub repository to enable PR-based deployment reviews. Deployments create a PR with the plan — merge to approve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {connections.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border/50 rounded-lg">
            <GitPullRequest className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
            No repositories connected. Link a repo to enable PR gating.
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((conn) => (
              <div key={conn.id} className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/20">
                <div className="flex items-center gap-3">
                  <Github className="h-4 w-4 text-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium font-mono">{conn.repo_owner}/{conn.repo_name}</span>
                      <Badge variant="outline" className="text-[8px]">{conn.default_branch}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {conn.auto_pr && (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Auto-PR
                        </span>
                      )}
                      {conn.require_approval && (
                        <span className="text-[10px] text-amber-400 flex items-center gap-1">
                          <Shield className="h-2.5 w-2.5" /> Merge required
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost" size="sm" asChild
                  >
                    <a
                      href={`https://github.com/${conn.repo_owner}/${conn.repo_name}`}
                      target="_blank" rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    </a>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(conn.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => { resetForm(); setAddOpen(true); }}>
          <Plus className="h-3.5 w-3.5" /> Connect Repository
        </Button>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Github className="h-5 w-5" />
                Connect GitHub Repository
              </DialogTitle>
            </DialogHeader>

            {step === "token" && (
              <div className="space-y-4">
                <div className="glass-panel rounded-lg p-3 border-l-2 border-primary/40">
                  <p className="text-xs text-muted-foreground">
                    Create a <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank" rel="noopener noreferrer" className="text-primary underline">Personal Access Token</a> with <code className="text-primary font-mono text-[10px]">repo</code> scope.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Personal Access Token</Label>
                  <Input
                    type="password"
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="font-mono text-sm"
                  />
                </div>
                <Button onClick={handleValidateToken} disabled={!pat.trim() || validating} className="w-full">
                  {validating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Validating…</> : "Validate & Continue"}
                </Button>
              </div>
            )}

            {step === "repo" && ghUser && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-muted/20">
                  <img src={ghUser.avatar_url} alt="" className="h-8 w-8 rounded-full" />
                  <div>
                    <p className="text-sm font-medium">{ghUser.name || ghUser.login}</p>
                    <p className="text-xs text-muted-foreground">@{ghUser.login}</p>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 ml-auto" />
                </div>

                <div className="space-y-2">
                  <Label>Select Repository</Label>
                  <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a repository…" />
                    </SelectTrigger>
                    <SelectContent>
                      {repos.map((r) => (
                        <SelectItem key={r.full_name} value={r.full_name}>
                          <span className="font-mono text-xs">{r.full_name}</span>
                          {r.private && <Badge variant="outline" className="ml-2 text-[8px]">private</Badge>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={() => setStep("settings")} disabled={!selectedRepo} className="w-full">
                  Configure Settings →
                </Button>
              </div>
            )}

            {step === "settings" && (
              <div className="space-y-4">
                <div className="font-mono text-sm text-primary">{selectedRepo}</div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Auto-create PR on deploy</Label>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Deployment plans are pushed as a PR for review</p>
                    </div>
                    <Switch checked={autoPr} onCheckedChange={setAutoPr} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Require merge to deploy</Label>
                      <p className="text-[10px] text-muted-foreground mt-0.5">Block live execution until PR is merged</p>
                    </div>
                    <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
                  </div>
                </div>

                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setStep("repo")}>Back</Button>
                  <Button onClick={handleSaveConnection} disabled={saving}>
                    {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Connect Repository"}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// Hook for deployment components to check GitHub PR gate
export function useGitHubPRGate() {
  const { user } = useAuth();
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("github_connections")
        .select("*")
        .eq("user_id", user.id)
        .limit(1) as any;
      setConnection(data?.[0] || null);
      setLoading(false);
    }
    fetch();
  }, [user]);

  const createPR = async (planSummary: {
    golden_path: string;
    provider: string;
    region: string;
    environment: string;
    resources: string[];
    preflight_passed: boolean;
  }, deploymentId?: string) => {
    if (!connection) return null;

    const { data, error } = await invokeFunction("github-pr", {
      body: {
        action: "create_pr",
        github_connection_id: connection.id,
        deployment_id: deploymentId,
        plan_summary: planSummary,
      },
    });

    if (error) {
      let msg = error.message;
      try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch {}
      throw new Error(msg);
    }
    return data as { pr_number: number; pr_url: string; branch: string };
  };

  const checkPR = async (prNumber: number) => {
    if (!connection) return null;

    const { data, error } = await invokeFunction("github-pr", {
      body: {
        action: "check_pr",
        github_connection_id: connection.id,
        pr_number: prNumber,
      },
    });

    if (error) {
      let msg = error.message;
      try { const body = await (error as any).context?.json?.(); if (body?.error) msg = body.error; } catch {}
      throw new Error(msg);
    }
    return data as { status: string; merged: boolean; mergeable: boolean; html_url: string };
  };

  return {
    connection,
    loading,
    hasGitHubGate: !!connection?.auto_pr,
    requiresMerge: !!connection?.require_approval,
    createPR,
    checkPR,
  };
}
