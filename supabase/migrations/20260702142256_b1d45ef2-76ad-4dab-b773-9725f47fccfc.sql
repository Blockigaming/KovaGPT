-- Lock down SECURITY DEFINER functions: revoke EXECUTE from public/anon/authenticated.
-- All of these functions are only invoked by server-side code running as service_role
-- (email queue dispatch/wake via net.http_post + cron, usage/storage/subscription
-- checks from createServerFn handlers). They must not be callable directly by
-- signed-out or signed-in users via the Data API.

REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_increment_daily_usage(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_add_storage_bytes(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;

-- feature_flags: restrict Data API read to authenticated users only.
-- Flags remain non-sensitive booleans, but signed-out visitors no longer see them.
REVOKE SELECT ON public.feature_flags FROM anon;