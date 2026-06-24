
REVOKE EXECUTE ON FUNCTION public.try_increment_daily_usage(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_increment_daily_usage(uuid, text, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.try_add_storage_bytes(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_add_storage_bytes(uuid, bigint, bigint) TO service_role;
