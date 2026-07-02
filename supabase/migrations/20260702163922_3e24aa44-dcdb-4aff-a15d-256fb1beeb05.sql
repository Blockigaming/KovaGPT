
REVOKE EXECUTE ON FUNCTION public.is_family_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.family_owner_of(uuid) FROM PUBLIC, anon, authenticated;
-- keep these callable so RLS policies + tier hook work:
GRANT EXECUTE ON FUNCTION public.is_family_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.family_owner_of(uuid) TO authenticated, service_role;
