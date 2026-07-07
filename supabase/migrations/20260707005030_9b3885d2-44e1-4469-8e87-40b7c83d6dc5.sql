CREATE TABLE public.pending_tool_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

CREATE INDEX pending_tool_actions_user_idx ON public.pending_tool_actions(user_id, created_at DESC);

GRANT ALL ON public.pending_tool_actions TO service_role;

ALTER TABLE public.pending_tool_actions ENABLE ROW LEVEL SECURITY;

-- No policies: table is server-only (accessed via service_role which bypasses RLS).
-- authenticated/anon have no grants and no policies, so cannot touch this table directly.
