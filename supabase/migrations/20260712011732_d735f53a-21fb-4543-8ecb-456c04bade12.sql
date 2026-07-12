
-- Projects collaboration feature
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  system_prompt TEXT CHECK (system_prompt IS NULL OR char_length(system_prompt) <= 4000),
  color TEXT DEFAULT 'blue',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_owner ON public.projects(owner_id);

CREATE TYPE public.project_role AS ENUM ('owner','editor','viewer');

CREATE TABLE public.project_members (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.project_role NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON public.project_members(user_id);

CREATE TABLE public.project_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.project_role NOT NULL DEFAULT 'editor',
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  UNIQUE (project_id, email)
);
CREATE INDEX idx_project_invites_email ON public.project_invites(lower(email));
CREATE INDEX idx_project_invites_project ON public.project_invites(project_id);

CREATE TABLE public.project_chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled chat' CHECK (char_length(title) BETWEEN 1 AND 200),
  snapshot JSONB NOT NULL DEFAULT '{"messages":[]}'::jsonb,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_chats_project ON public.project_chats(project_id, updated_at DESC);

-- Grants (roles use auth.uid(); no anon access)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_invites TO authenticated;
GRANT ALL ON public.project_invites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_chats TO authenticated;
GRANT ALL ON public.project_chats TO service_role;

-- Security definer helpers to avoid RLS recursion
CREATE OR REPLACE FUNCTION public.is_project_member(_project_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members WHERE project_id = _project_id AND user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.projects WHERE id = _project_id AND owner_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.project_role_of(_project_id UUID, _user_id UUID)
RETURNS public.project_role
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.projects WHERE id = _project_id AND owner_id = _user_id) THEN 'owner'::public.project_role
    ELSE (SELECT role FROM public.project_members WHERE project_id = _project_id AND user_id = _user_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project(_project_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.project_role_of(_project_id, _user_id) IN ('owner','editor');
$$;

-- Auto-add owner as member on project create
CREATE OR REPLACE FUNCTION public.projects_add_owner_member()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.project_members(project_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_projects_add_owner AFTER INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.projects_add_owner_member();

CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_project_chats_updated_at BEFORE UPDATE ON public.project_chats
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_chats ENABLE ROW LEVEL SECURITY;

-- projects
CREATE POLICY "members can view projects" ON public.projects FOR SELECT TO authenticated
  USING (public.is_project_member(id, auth.uid()));
CREATE POLICY "users can create their own projects" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner can update project" ON public.projects FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner can delete project" ON public.projects FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- project_members
CREATE POLICY "members can view members" ON public.project_members FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));
CREATE POLICY "owner can add members" ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
              OR user_id = auth.uid());
CREATE POLICY "owner can update members" ON public.project_members FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()));
CREATE POLICY "owner or self can remove member" ON public.project_members FOR DELETE TO authenticated
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()));

-- project_invites: owner manages; invitee can view/accept by email
CREATE POLICY "owner can view invites" ON public.project_invites FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
         OR lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));
CREATE POLICY "owner can create invites" ON public.project_invites FOR INSERT TO authenticated
  WITH CHECK (invited_by = auth.uid()
              AND EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()));
CREATE POLICY "owner or invitee can update invite" ON public.project_invites FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid())
         OR lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')))
  WITH CHECK (true);
CREATE POLICY "owner can delete invite" ON public.project_invites FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()));

-- project_chats: any member can read; editors/owner write
CREATE POLICY "members can view chats" ON public.project_chats FOR SELECT TO authenticated
  USING (public.is_project_member(project_id, auth.uid()));
CREATE POLICY "editors can insert chats" ON public.project_chats FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_project(project_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY "editors can update chats" ON public.project_chats FOR UPDATE TO authenticated
  USING (public.can_edit_project(project_id, auth.uid()))
  WITH CHECK (public.can_edit_project(project_id, auth.uid()));
CREATE POLICY "editors can delete chats" ON public.project_chats FOR DELETE TO authenticated
  USING (public.can_edit_project(project_id, auth.uid()));
