
-- Per-user Google OAuth tokens
CREATE TABLE public.google_oauth_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_sub TEXT,
  email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.google_oauth_tokens TO authenticated;
GRANT ALL ON public.google_oauth_tokens TO service_role;
ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tokens select" ON public.google_oauth_tokens
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own tokens delete" ON public.google_oauth_tokens
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER google_oauth_tokens_touch BEFORE UPDATE ON public.google_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Audit log for connected-account actions
CREATE TABLE public.connected_account_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  resource_id TEXT,
  summary TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.connected_account_audit_log TO authenticated;
GRANT ALL ON public.connected_account_audit_log TO service_role;
ALTER TABLE public.connected_account_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audit select" ON public.connected_account_audit_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX connected_account_audit_log_user_created_idx
  ON public.connected_account_audit_log(user_id, created_at DESC);

-- Onboarding preferences
CREATE TABLE public.user_onboarding (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_use TEXT,
  response_style TEXT NOT NULL DEFAULT 'balanced',
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_onboarding TO authenticated;
GRANT ALL ON public.user_onboarding TO service_role;
ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own onboarding all" ON public.user_onboarding
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER user_onboarding_touch BEFORE UPDATE ON public.user_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
