
CREATE TABLE public.deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stack_name text NOT NULL DEFAULT 'unnamed-stack',
  workload_type text NOT NULL DEFAULT 'general',
  region text NOT NULL DEFAULT 'us-east-1',
  environment text NOT NULL DEFAULT 'dev',
  status text NOT NULL DEFAULT 'planning',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  step_outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own deployments"
  ON public.deployments FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
