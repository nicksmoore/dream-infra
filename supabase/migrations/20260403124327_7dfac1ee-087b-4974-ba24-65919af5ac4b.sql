
CREATE TABLE public.github_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  github_pat_credential_id UUID REFERENCES public.user_credentials(id) ON DELETE SET NULL,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  auto_pr BOOLEAN NOT NULL DEFAULT true,
  require_approval BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, repo_owner, repo_name)
);

ALTER TABLE public.github_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own github connections"
ON public.github_connections FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own github connections"
ON public.github_connections FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own github connections"
ON public.github_connections FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own github connections"
ON public.github_connections FOR DELETE
USING (auth.uid() = user_id);

-- PR tracking table
CREATE TABLE public.deployment_prs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  deployment_id UUID REFERENCES public.deployments(id) ON DELETE CASCADE,
  github_connection_id UUID REFERENCES public.github_connections(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  pr_status TEXT NOT NULL DEFAULT 'open',
  head_branch TEXT NOT NULL,
  plan_summary JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.deployment_prs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own deployment PRs"
ON public.deployment_prs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own deployment PRs"
ON public.deployment_prs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own deployment PRs"
ON public.deployment_prs FOR UPDATE
USING (auth.uid() = user_id);
