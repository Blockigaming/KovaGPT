-- Harden SECURITY DEFINER helpers callable by signed-in users: they may only be
-- asked about the caller's own identity (server/service_role calls are unchanged).
CREATE OR REPLACE FUNCTION public.is_project_member(_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.project_members WHERE project_id = _project_id AND user_id = _user_id
    ) OR EXISTS (
      SELECT 1 FROM public.projects WHERE id = _project_id AND owner_id = _user_id
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project(_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN false
    ELSE public.project_role_of(_project_id, _user_id) IN ('owner','editor')
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_family_member(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.family_members WHERE group_id = _group_id AND user_id = _user_id
    )
  END;
$$;

-- Unauthenticated visitors never need these internal helpers.
REVOKE ALL ON FUNCTION public.is_project_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_project(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_family_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.project_role_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.family_owner_of(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_plan_tier(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.match_project_chunks(uuid, vector, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_writing_document(uuid, text, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_project(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_family_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.project_role_of(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO service_role;