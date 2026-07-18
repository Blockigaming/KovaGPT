REVOKE EXECUTE ON FUNCTION public.user_plan_tier(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_project_chunks(uuid, vector, integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_plan_tier(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_project_chunks(uuid, vector, integer) TO authenticated, service_role;
