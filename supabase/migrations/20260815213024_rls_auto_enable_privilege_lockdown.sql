-- The automatic RLS event-trigger function is an internal DDL guard, not a
-- browser-callable RPC. Keep the function and event trigger intact while
-- removing Data API execution from public browser roles.
DO $privilege_lockdown$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
      FROM PUBLIC, anon, authenticated;
  END IF;
END
$privilege_lockdown$;
