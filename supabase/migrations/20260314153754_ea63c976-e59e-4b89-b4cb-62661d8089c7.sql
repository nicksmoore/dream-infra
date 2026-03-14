
-- Contribution tier enum
CREATE TYPE public.contributor_tier AS ENUM ('intent', 'logic', 'core');

-- Badge type enum
CREATE TYPE public.badge_type AS ENUM ('founder', 'yaml_slayer', 'intent_seeker', 'logic_builder', 'core_architect', 'bounty_winner');

-- Contributors table (public profiles for the leaderboard)
CREATE TABLE public.contributors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  github_username TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  tier contributor_tier NOT NULL DEFAULT 'intent',
  xp INTEGER NOT NULL DEFAULT 0,
  pr_count INTEGER NOT NULL DEFAULT 0,
  intents_validated INTEGER NOT NULL DEFAULT 0,
  yaml_kills INTEGER NOT NULL DEFAULT 0,
  is_founding BOOLEAN NOT NULL DEFAULT false,
  bio TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Contributions log
CREATE TABLE public.contributions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contributor_id UUID REFERENCES public.contributors(id) ON DELETE CASCADE NOT NULL,
  contribution_type TEXT NOT NULL, -- 'pr', 'intent_validation', 'yaml_kill', 'bounty', 'session'
  title TEXT NOT NULL,
  description TEXT,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  pr_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Badges awarded
CREATE TABLE public.contributor_badges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contributor_id UUID REFERENCES public.contributors(id) ON DELETE CASCADE NOT NULL,
  badge badge_type NOT NULL,
  awarded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(contributor_id, badge)
);

-- YAML Bounties
CREATE TABLE public.yaml_bounties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contributor_id UUID REFERENCES public.contributors(id) ON DELETE CASCADE NOT NULL,
  legacy_config_type TEXT NOT NULL, -- 'terraform', 'cloudformation', 'k8s', 'ansible'
  legacy_snippet TEXT NOT NULL,
  naawi_intent TEXT NOT NULL,
  votes INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  month TEXT NOT NULL, -- '2026-03'
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributor_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.yaml_bounties ENABLE ROW LEVEL SECURITY;

-- Public read for leaderboard
CREATE POLICY "Anyone can view contributors" ON public.contributors FOR SELECT USING (true);
CREATE POLICY "Anyone can view contributions" ON public.contributions FOR SELECT USING (true);
CREATE POLICY "Anyone can view badges" ON public.contributor_badges FOR SELECT USING (true);
CREATE POLICY "Anyone can view bounties" ON public.yaml_bounties FOR SELECT USING (true);

-- Authenticated users can manage their own contributor profile
CREATE POLICY "Users can insert own contributor" ON public.contributors FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contributor" ON public.contributors FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Authenticated users can add contributions linked to their contributor profile
CREATE POLICY "Users can insert own contributions" ON public.contributions FOR INSERT TO authenticated WITH CHECK (
  contributor_id IN (SELECT id FROM public.contributors WHERE user_id = auth.uid())
);

-- Authenticated users can submit bounties
CREATE POLICY "Users can insert own bounties" ON public.yaml_bounties FOR INSERT TO authenticated WITH CHECK (
  contributor_id IN (SELECT id FROM public.contributors WHERE user_id = auth.uid())
);
