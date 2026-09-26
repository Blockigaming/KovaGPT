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
  ),
  'managedObjects', jsonb_build_object(
    'relations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', n.nspname || '.' || c.relname,
        'kind', c.relkind,
        'rowSecurity', c.relrowsecurity,
        'columnSha256', encode(extensions.digest(coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
            'notNull', a.attnotnull, 'generated', a.attgenerated,
            'default', pg_get_expr(ad.adbin, ad.adrelid)
          ) ORDER BY a.attnum)::text
          FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        ), '[]'), 'sha256'), 'hex'),
        'aclSha256', encode(extensions.digest(coalesce(c.relacl::text, 'NULL'), 'sha256'), 'hex')
      ) ORDER BY n.nspname, c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('auth', 'storage', 'realtime') AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ),
    'functions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        'kind', p.prokind,
        'definitionSha256', encode(extensions.digest(
          CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid)
            ELSE p.prokind::text || '|' || p.prosrc || '|' || p.proargtypes::text END,
          'sha256'), 'hex')
      ) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('auth', 'storage', 'realtime')
    ),
    'policies', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', n.nspname || '.' || c.relname || '.' || pol.polname,
        'definitionSha256', encode(extensions.digest(jsonb_build_object(
          'command', pol.polcmd, 'permissive', pol.polpermissive,
          'roles', (SELECT coalesce(jsonb_agg(role_name ORDER BY role_name), '[]'::jsonb)
            FROM (SELECT CASE WHEN role_id = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_id) END AS role_name
              FROM unnest(pol.polroles) role_id) role_names),
          'using', pg_get_expr(pol.polqual, pol.polrelid),
          'check', pg_get_expr(pol.polwithcheck, pol.polrelid)
        )::text, 'sha256'), 'hex')
      ) ORDER BY n.nspname, c.relname, pol.polname), '[]'::jsonb)
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('auth', 'storage', 'realtime')
    ),
    'triggers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', n.nspname || '.' || c.relname || '.' || t.tgname,
        'definitionSha256', encode(extensions.digest(pg_get_triggerdef(t.oid), 'sha256'), 'hex')
      ) ORDER BY n.nspname, c.relname, t.tgname), '[]'::jsonb)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('auth', 'storage', 'realtime') AND NOT t.tgisinternal
    )
  ),
  'serviceMigrations', jsonb_build_object(
    'auth', (SELECT jsonb_build_object('count', count(*), 'latest', max(version)) FROM auth.schema_migrations),
    'storage', (SELECT jsonb_build_object('count', count(*), 'latest', (
      SELECT jsonb_build_object('id', id, 'name', name) FROM storage.migrations ORDER BY id DESC LIMIT 1
    )) FROM storage.migrations),
    'realtime', (SELECT jsonb_build_object('count', count(*), 'latest', max(version)) FROM realtime.schema_migrations)
  )
)::text;
COMMIT;
