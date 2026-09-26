BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
  'serverVersionNum', current_setting('server_version_num')::int,
  'managedSchemas', (
    SELECT jsonb_object_agg(n.nspname, jsonb_build_object(
      'relations', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind IN ('r', 'p', 'v', 'm', 'f')),
      'sequences', (SELECT count(*) FROM pg_class c WHERE c.relnamespace = n.oid AND c.relkind = 'S'),
      'functions', (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = n.oid),
      'policies', (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid WHERE c.relnamespace = n.oid),
      'noninternalTriggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = n.oid AND NOT t.tgisinternal)
    ))
    FROM pg_namespace n WHERE n.nspname IN ('auth', 'storage', 'realtime')
  ),
  'extensions', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', e.extname, 'version', e.extversion, 'schema', n.nspname
    ) ORDER BY e.extname), '[]'::jsonb)
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  )
)::text;
COMMIT;
