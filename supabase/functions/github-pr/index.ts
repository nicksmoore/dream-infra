import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GITHUB_API = "https://api.github.com";

interface CreatePRRequest {
  action: "create_pr" | "check_pr" | "list_repos" | "validate_token";
  github_connection_id?: string;
  deployment_id?: string;
  plan_summary?: {
    golden_path: string;
    provider: string;
    region: string;
    environment: string;
    resources: string[];
    preflight_passed: boolean;
  };
  pr_number?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify JWT
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: CreatePRRequest = await req.json();

    // Helper: get decrypted PAT from credential vault
    async function getGitHubPAT(connectionId: string): Promise<string> {
      const { data: conn } = await supabase
        .from("github_connections")
        .select("github_pat_credential_id")
        .eq("id", connectionId)
        .eq("user_id", user!.id)
        .single();

      if (!conn?.github_pat_credential_id) {
        throw new Error("No GitHub PAT linked to this connection");
      }

      const { data: cred } = await supabase
        .from("user_credentials")
        .select("encrypted_credentials, iv")
        .eq("id", conn.github_pat_credential_id)
        .eq("user_id", user!.id)
        .single();

      if (!cred) throw new Error("Credential not found");

      // Decrypt using Web Crypto API (same key derivation as credential-vault)
      const encKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(encKey.slice(0, 32)),
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      );

      const iv = Uint8Array.from(atob(cred.iv), c => c.charCodeAt(0));
      const encrypted = Uint8Array.from(atob(cred.encrypted_credentials), c => c.charCodeAt(0));

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        keyMaterial,
        encrypted,
      );

      const parsed = JSON.parse(new TextDecoder().decode(decrypted));
      return parsed.pat || parsed.accessKeyId || Object.values(parsed)[0] as string;
    }

    // Helper: GitHub API call
    async function githubFetch(pat: string, path: string, options: RequestInit = {}) {
      const res = await fetch(`${GITHUB_API}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(`GitHub API error (${res.status}): ${JSON.stringify(data)}`);
      }
      return data;
    }

    switch (body.action) {
      case "validate_token": {
        // User provides PAT directly for validation before storing
        const tokenToValidate = (body as any).token;
        if (!tokenToValidate) {
          return new Response(JSON.stringify({ error: "Token required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const userData = await githubFetch(tokenToValidate, "/user");
        const { data: repos } = await fetch(`${GITHUB_API}/user/repos?sort=updated&per_page=30&type=owner`, {
          headers: { Authorization: `Bearer ${tokenToValidate}`, Accept: "application/vnd.github.v3+json" },
        }).then(r => r.json().then(d => ({ data: d })));

        return new Response(JSON.stringify({
          valid: true,
          user: { login: userData.login, avatar_url: userData.avatar_url, name: userData.name },
          repos: (repos || []).map((r: any) => ({
            full_name: r.full_name,
            owner: r.owner.login,
            name: r.name,
            default_branch: r.default_branch,
            private: r.private,
          })),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "list_repos": {
        if (!body.github_connection_id) {
          return new Response(JSON.stringify({ error: "github_connection_id required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const pat = await getGitHubPAT(body.github_connection_id);
        const repos = await githubFetch(pat, "/user/repos?sort=updated&per_page=50&type=owner");
        return new Response(JSON.stringify({
          repos: repos.map((r: any) => ({
            full_name: r.full_name,
            owner: r.owner.login,
            name: r.name,
            default_branch: r.default_branch,
          })),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "create_pr": {
        if (!body.github_connection_id || !body.plan_summary) {
          return new Response(JSON.stringify({ error: "github_connection_id and plan_summary required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const pat = await getGitHubPAT(body.github_connection_id);

        const { data: conn } = await supabase
          .from("github_connections")
          .select("*")
          .eq("id", body.github_connection_id)
          .eq("user_id", user!.id)
          .single();

        if (!conn) throw new Error("GitHub connection not found");

        const { repo_owner, repo_name, default_branch } = conn;
        const plan = body.plan_summary;
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const branchName = `naawi/deploy-${plan.environment}-${timestamp}`;

        // 1. Get the default branch's latest SHA
        const ref = await githubFetch(pat, `/repos/${repo_owner}/${repo_name}/git/ref/heads/${default_branch}`);
        const baseSha = ref.object.sha;

        // 2. Create a new branch
        await githubFetch(pat, `/repos/${repo_owner}/${repo_name}/git/refs`, {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
        });

        // 3. Create a deployment plan file
        const planContent = {
          naawi_version: "v3",
          golden_path: plan.golden_path,
          provider: plan.provider,
          region: plan.region,
          environment: plan.environment,
          resources: plan.resources,
          preflight_passed: plan.preflight_passed,
          created_at: new Date().toISOString(),
          deployment_id: body.deployment_id || null,
        };

        const fileContent = btoa(JSON.stringify(planContent, null, 2));
        const filePath = `.naawi/deployments/${plan.environment}/${timestamp}.json`;

        await githubFetch(pat, `/repos/${repo_owner}/${repo_name}/contents/${filePath}`, {
          method: "PUT",
          body: JSON.stringify({
            message: `naawi: ${plan.golden_path} deployment plan for ${plan.environment}`,
            content: fileContent,
            branch: branchName,
          }),
        });

        // 4. Create the PR
        const prBody = `## 🚀 Naawi Deployment Plan

**Golden Path:** \`${plan.golden_path}\`
**Provider:** ${plan.provider.toUpperCase()}
**Region:** ${plan.region}
**Environment:** ${plan.environment}
**Preflight:** ${plan.preflight_passed ? "✅ Passed" : "❌ Failed"}

### Resources
${plan.resources.map((r: string) => `- \`${r}\``).join("\n")}

---
_This PR was auto-generated by [Naawi](https://project-naawi.lovable.app). Merge to approve deployment._
_Deployment ID: \`${body.deployment_id || "pending"}\`_`;

        const pr = await githubFetch(pat, `/repos/${repo_owner}/${repo_name}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            title: `[Naawi] Deploy ${plan.golden_path} → ${plan.environment}`,
            body: prBody,
            head: branchName,
            base: default_branch,
          }),
        });

        // 5. Save PR record
        await supabase.from("deployment_prs").insert({
          user_id: user!.id,
          deployment_id: body.deployment_id || null,
          github_connection_id: body.github_connection_id,
          pr_number: pr.number,
          pr_url: pr.html_url,
          pr_status: "open",
          head_branch: branchName,
          plan_summary: plan,
        });

        return new Response(JSON.stringify({
          success: true,
          pr_number: pr.number,
          pr_url: pr.html_url,
          branch: branchName,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check_pr": {
        if (!body.github_connection_id || !body.pr_number) {
          return new Response(JSON.stringify({ error: "github_connection_id and pr_number required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const pat = await getGitHubPAT(body.github_connection_id);

        const { data: conn } = await supabase
          .from("github_connections")
          .select("repo_owner, repo_name")
          .eq("id", body.github_connection_id)
          .eq("user_id", user!.id)
          .single();

        if (!conn) throw new Error("Connection not found");

        const pr = await githubFetch(pat, `/repos/${conn.repo_owner}/${conn.repo_name}/pulls/${body.pr_number}`);

        const status = pr.merged ? "merged" : pr.state;

        // Update local record
        await supabase
          .from("deployment_prs")
          .update({ pr_status: status, updated_at: new Date().toISOString() })
          .eq("github_connection_id", body.github_connection_id)
          .eq("pr_number", body.pr_number)
          .eq("user_id", user!.id);

        return new Response(JSON.stringify({
          pr_number: pr.number,
          status,
          merged: pr.merged,
          mergeable: pr.mergeable,
          approvals: pr.requested_reviewers?.length || 0,
          html_url: pr.html_url,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${body.action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    console.error("github-pr error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
