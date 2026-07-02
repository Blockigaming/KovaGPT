
-- 1. Fix Usage Today tracker
CREATE OR REPLACE FUNCTION public.try_increment_daily_usage(_user_id uuid, _kind text, _increment integer, _limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'utc')::date;
  today_row record;
  cur_val int;
BEGIN
  IF _kind NOT IN ('images', 'chats', 'uploads', 'voice') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;
  IF _increment < 1 THEN
    RAISE EXCEPTION 'increment must be positive';
  END IF;

  -- Ensure today's row exists (idempotent) then lock it.
  INSERT INTO public.daily_usage (user_id, usage_date, images, chats, uploads, voice, updated_at)
  VALUES (_user_id, today, 0, 0, 0, 0, now())
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT * INTO today_row
  FROM public.daily_usage
  WHERE user_id = _user_id AND usage_date = today
  FOR UPDATE;

  cur_val := CASE _kind
    WHEN 'images' THEN today_row.images
    WHEN 'chats' THEN today_row.chats
    WHEN 'uploads' THEN today_row.uploads
    WHEN 'voice' THEN today_row.voice
  END;

  IF COALESCE(cur_val, 0) + _increment > _limit THEN
    RETURN false;
  END IF;

  UPDATE public.daily_usage
  SET
    images = CASE WHEN _kind = 'images' THEN images + _increment ELSE images END,
    chats = CASE WHEN _kind = 'chats' THEN chats + _increment ELSE chats END,
    uploads = CASE WHEN _kind = 'uploads' THEN uploads + _increment ELSE uploads END,
    voice = CASE WHEN _kind = 'voice' THEN voice + _increment ELSE voice END,
    updated_at = now()
  WHERE user_id = _user_id AND usage_date = today;

  RETURN true;
END;
$function$;

-- 2. Family Sharing tables
CREATE TABLE IF NOT EXISTS public.family_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My Family',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id)
);

CREATE TABLE IF NOT EXISTS public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.family_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id),
  UNIQUE (user_id)  -- a user can belong to at most one family group
);

CREATE TABLE IF NOT EXISTS public.family_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.family_groups(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  invited_email text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_members_group ON public.family_members(group_id);
CREATE INDEX IF NOT EXISTS idx_family_members_user ON public.family_members(user_id);
CREATE INDEX IF NOT EXISTS idx_family_invites_group ON public.family_invites(group_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_groups TO authenticated;
GRANT ALL ON public.family_groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO authenticated;
GRANT ALL ON public.family_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_invites TO authenticated;
GRANT ALL ON public.family_invites TO service_role;

ALTER TABLE public.family_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_invites ENABLE ROW LEVEL SECURITY;

-- Helper: is user a member of a given group (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_family_member(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.family_members WHERE group_id = _group_id AND user_id = _user_id
  );
$$;

-- Helper: returns the owner's user_id if the given user is a member of a family group (else null)
CREATE OR REPLACE FUNCTION public.family_owner_of(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.owner_id
  FROM public.family_members m
  JOIN public.family_groups g ON g.id = m.group_id
  WHERE m.user_id = _user_id
  LIMIT 1;
$$;

-- Policies: family_groups
CREATE POLICY "Owner reads own group" ON public.family_groups
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Members read their group" ON public.family_groups
  FOR SELECT TO authenticated USING (public.is_family_member(auth.uid(), id));
CREATE POLICY "Owner creates own group" ON public.family_groups
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner updates own group" ON public.family_groups
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner deletes own group" ON public.family_groups
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- Policies: family_members
CREATE POLICY "Read members of my group" ON public.family_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.family_groups g WHERE g.id = group_id AND g.owner_id = auth.uid())
    OR public.is_family_member(auth.uid(), group_id)
  );
CREATE POLICY "Owner adds members" ON public.family_members
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.family_groups g WHERE g.id = group_id AND g.owner_id = auth.uid())
    OR user_id = auth.uid()  -- for accepting invites via server fn using auth client
  );
CREATE POLICY "Owner removes members; members can leave" ON public.family_members
  FOR DELETE TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.family_groups g WHERE g.id = group_id AND g.owner_id = auth.uid())
  );

-- Policies: family_invites
CREATE POLICY "Owner reads invites" ON public.family_invites
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.family_groups g WHERE g.id = group_id AND g.owner_id = auth.uid())
  );
CREATE POLICY "Owner creates invites" ON public.family_invites
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.family_groups g WHERE g.id = group_id AND g.owner_id = auth.uid())
  );
CREATE POLICY "Owner deletes invites" ON public.family_invites
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.family_groups g WHERE g.id = group_id AND g.owner_id = auth.uid())
  );

-- Enforce max 5 accepted members per group via trigger
CREATE OR REPLACE FUNCTION public.enforce_family_member_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.family_members WHERE group_id = NEW.group_id;
  IF cnt >= 6 THEN  -- 1 owner + 5 members
    RAISE EXCEPTION 'Family group is full (max 5 members plus owner)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_member_cap ON public.family_members;
CREATE TRIGGER trg_family_member_cap
  BEFORE INSERT ON public.family_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_family_member_cap();
