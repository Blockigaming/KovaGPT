-- Lock down SECURITY DEFINER functions: revoke EXECUTE from public/anon/authenticated.
-- All of these functions are only invoked by server-side code running as service_role
-- (email queue dispatch/wake via net.http_post + cron, usage/storage/subscription
-- checks from createServerFn handlers). They must not be callable directly by
-- signed-out or signed-in users via the Data API.
--
-- Some email dispatch functions are provisioned dynamically only after the
-- project-specific queue URL and secret exist. A clean CI, development, staging,
-- restore, or disaster-recovery database therefore may not contain them yet.
-- Missing optional functions are a safe no-op; any listed function that does
-- exist still has its public, anon, and authenticated EXECUTE privileges revoked.
DO $privilege_lockdown$
DECLARE
  function_signature text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.read_email_batch(text,integer,integer)',
    'public.enqueue_email(text,jsonb)',
    'public.delete_email(text,bigint)',
    'public.move_to_dlq(text,text,bigint,jsonb)',
    'public.email_queue_wake()',
    'public.email_queue_dispatch()',
    'public.try_increment_daily_usage(uuid,text,integer,integer)',
    'public.has_active_subscription(uuid,text)',
    'public.try_add_storage_bytes(uuid,bigint,bigint)'
  ]
  LOOP
    IF to_regprocedure(function_signature) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        function_signature
      );
    END IF;
  END LOOP;

  -- feature_flags: restrict Data API read to authenticated users only.
  -- Flags remain non-sensitive booleans, but signed-out visitors no longer see them.
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    EXECUTE 'REVOKE SELECT ON public.feature_flags FROM anon';
  END IF;
END
$privilege_lockdown$;
