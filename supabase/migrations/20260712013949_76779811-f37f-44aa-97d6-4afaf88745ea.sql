
-- 1) family_members: owner-only INSERT (invite acceptance uses service role)
DROP POLICY IF EXISTS "Owner adds members" ON public.family_members;
CREATE POLICY "Owner adds members"
ON public.family_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.family_groups g
    WHERE g.id = family_members.group_id AND g.owner_id = auth.uid()
  )
);

-- 2) project_members: owner-only INSERT (invite acceptance uses service role)
DROP POLICY IF EXISTS "owner can add members" ON public.project_members;
CREATE POLICY "owner can add members"
ON public.project_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_members.project_id AND p.owner_id = auth.uid()
  )
);

-- 3) project_invites: owner-only UPDATE (invitees accept/decline via server-side flow)
DROP POLICY IF EXISTS "owner or invitee can update invite" ON public.project_invites;
CREATE POLICY "owner can update invite"
ON public.project_invites
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_invites.project_id AND p.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_invites.project_id AND p.owner_id = auth.uid()
  )
);

-- 4) Revoke anon EXECUTE on internal SECURITY DEFINER helpers.
REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_edit_project(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.project_role_of(uuid, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.projects_add_owner_member() FROM anon, PUBLIC;
