
-- ============== LIBRARY ==============
CREATE TABLE public.user_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('upload','image','chat_artifact','document','code','website_draft','other')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('chat','images','upload','manual','other')),
  content_text text,
  file_url text,
  file_name text,
  file_type text,
  file_size bigint,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_library_items_user_id_created_idx ON public.user_library_items(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_library_items TO authenticated;
GRANT ALL ON public.user_library_items TO service_role;
ALTER TABLE public.user_library_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "library_select_own" ON public.user_library_items FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "library_insert_own" ON public.user_library_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "library_update_own" ON public.user_library_items FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "library_delete_own" ON public.user_library_items FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============== SHARED CHATS ==============
CREATE TABLE public.shared_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  recipient_user_id uuid,
  recipient_email text NOT NULL,
  local_chat_reference text,
  title text NOT NULL,
  snapshot jsonb NOT NULL,
  permission text NOT NULL DEFAULT 'view' CHECK (permission IN ('view')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shared_chats_owner_idx ON public.shared_chats(owner_user_id, created_at DESC);
CREATE INDEX shared_chats_recipient_email_idx ON public.shared_chats(lower(recipient_email));
CREATE INDEX shared_chats_recipient_user_idx ON public.shared_chats(recipient_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_chats TO authenticated;
GRANT ALL ON public.shared_chats TO service_role;
ALTER TABLE public.shared_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_owner_select" ON public.shared_chats FOR SELECT TO authenticated USING (auth.uid() = owner_user_id);
CREATE POLICY "shared_owner_insert" ON public.shared_chats FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "shared_owner_update" ON public.shared_chats FOR UPDATE TO authenticated USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "shared_owner_delete" ON public.shared_chats FOR DELETE TO authenticated USING (auth.uid() = owner_user_id);
-- Recipient may view shares addressed to their authenticated email, only if status != revoked.
CREATE POLICY "shared_recipient_select" ON public.shared_chats FOR SELECT TO authenticated
  USING (
    status <> 'revoked'
    AND (
      recipient_user_id = auth.uid()
      OR lower(recipient_email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
    )
  );

-- ============== FINANCE: plaid_items ==============
CREATE TABLE public.plaid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plaid_item_id text NOT NULL UNIQUE,
  access_token_encrypted text,
  institution_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disconnected','error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plaid_items_user_idx ON public.plaid_items(user_id);

-- access_token_encrypted MUST NEVER be readable by the client; deny all to authenticated.
GRANT ALL ON public.plaid_items TO service_role;
ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
-- (No policies for authenticated role = no client access. Only service_role from server fns.)

-- ============== FINANCE: financial_accounts ==============
CREATE TABLE public.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plaid_item_id uuid REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  account_name text NOT NULL,
  account_type text,
  account_subtype text,
  institution_name text,
  mask text,
  current_balance numeric,
  available_balance numeric,
  currency text DEFAULT 'USD',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX financial_accounts_user_idx ON public.financial_accounts(user_id);

GRANT SELECT ON public.financial_accounts TO authenticated;
GRANT ALL ON public.financial_accounts TO service_role;
ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fa_select_own" ON public.financial_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- No insert/update/delete policies for authenticated; only the server-side Plaid flow writes here.

-- ============== updated_at trigger ==============
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_library_touch BEFORE UPDATE ON public.user_library_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_shared_touch BEFORE UPDATE ON public.shared_chats FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_plaid_touch BEFORE UPDATE ON public.plaid_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_fa_touch BEFORE UPDATE ON public.financial_accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
