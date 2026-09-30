-- Private M17 export of live managed function, policy and trigger DDL.
-- Connect explicitly to the selected project. This query cannot authenticate its
-- target. Treat the returned SQL as sensitive: inspect and retain it only in the
-- protected recovery workspace, never in CI, a PR, or a public artifact.
-- No customer rows are read. This is not an automatically executable restore.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

WITH functions AS (
  SELECT n.nspname AS schema_name,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS identity,
         p.prokind AS kind,
         pg_get_userbyid(p.proowner) AS owner_name,
         p.proacl::text AS explicit_acl,
         CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) END AS ddl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('auth', 'storage')
), triggers AS (
  SELECT n.nspname AS schema_name, c.relname AS relation_name,
         t.tgname AS trigger_name, t.tgenabled AS enabled,
         pg_get_triggerdef(t.oid) || ';' AS ddl
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('auth', 'storage') AND NOT t.tgisinternal
), relations AS (
  SELECT n.nspname AS schema_name, c.relname AS relation_name,
         c.relkind AS kind, pg_get_userbyid(c.relowner) AS owner_name,
         c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security,
         c.relacl::text AS explicit_acl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('auth', 'storage')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
), policies AS (
  SELECT n.nspname AS schema_name, c.relname AS relation_name,
         p.polname AS policy_name, c.relrowsecurity AS row_security,
         c.relforcerowsecurity AS force_row_security,
         format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
           p.polname, n.nspname, c.relname,
           CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
           CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END,
           (SELECT string_agg(CASE WHEN role_id = 0 THEN 'PUBLIC'
             ELSE format('%I', pg_get_userbyid(role_id)) END, ', ' ORDER BY role_id)
            FROM unnest(p.polroles) role_id),
           CASE WHEN p.polqual IS NULL THEN ''
             ELSE format(' USING (%s)', pg_get_expr(p.polqual, p.polrelid)) END,
           CASE WHEN p.polwithcheck IS NULL THEN ''
             ELSE format(' WITH CHECK (%s)', pg_get_expr(p.polwithcheck, p.polrelid)) END
         ) AS ddl
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('auth', 'storage')
), export AS (
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'scope', 'managed-function-policy-trigger-ddl-only',
    'replayApproved', false,
    'databaseVersion', current_setting('server_version'),
    'extensions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', e.extname, 'version', e.extversion, 'schema', n.nspname
    ) ORDER BY e.extname), '[]'::jsonb)
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace),
    'schemaAcls', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'owner', pg_get_userbyid(n.nspowner),
      'explicitAcl', n.nspacl::text
    ) ORDER BY n.nspname), '[]'::jsonb)
      FROM pg_namespace n WHERE n.nspname IN ('auth', 'storage')),
    'relationAcls', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', schema_name, 'relation', relation_name, 'kind', kind,
      'owner', owner_name, 'rowSecurity', row_security,
      'forceRowSecurity', force_row_security, 'explicitAcl', explicit_acl
    ) ORDER BY schema_name, relation_name, kind), '[]'::jsonb) FROM relations),
    'columnAcls', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'relation', c.relname, 'column', a.attname,
      'explicitAcl', a.attacl::text
    ) ORDER BY n.nspname, c.relname, a.attnum), '[]'::jsonb)
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('auth', 'storage') AND a.attnum > 0
        AND NOT a.attisdropped AND a.attacl IS NOT NULL),
    'defaultAcls', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'owner', pg_get_userbyid(d.defaclrole),
      'objectType', d.defaclobjtype, 'explicitAcl', d.defaclacl::text
    ) ORDER BY n.nspname NULLS FIRST, d.defaclrole, d.defaclobjtype), '[]'::jsonb)
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE d.defaclnamespace = 0 OR n.nspname IN ('auth', 'storage')),
    'functions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', schema_name, 'identity', identity, 'kind', kind,
      'owner', owner_name, 'explicitAcl', explicit_acl, 'ddl', ddl,
      'sha256', CASE WHEN ddl IS NOT NULL
        THEN encode(extensions.digest(ddl, 'sha256'), 'hex') END
    ) ORDER BY schema_name, identity), '[]'::jsonb) FROM functions),
    'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', schema_name, 'relation', relation_name, 'name', trigger_name,
      'enabled', enabled, 'ddl', ddl,
      'sha256', encode(extensions.digest(ddl, 'sha256'), 'hex')
    ) ORDER BY schema_name, relation_name, trigger_name), '[]'::jsonb) FROM triggers),
    'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'schema', schema_name, 'relation', relation_name, 'name', policy_name,
      'rowSecurity', row_security, 'forceRowSecurity', force_row_security,
      'ddl', ddl, 'sha256', encode(extensions.digest(ddl, 'sha256'), 'hex')
    ) ORDER BY schema_name, relation_name, policy_name), '[]'::jsonb) FROM policies)
  ) AS contents
)
SELECT jsonb_build_object(
  'exportSha256', encode(extensions.digest(contents::text, 'sha256'), 'hex'),
  'contents', contents
) AS managed_ddl_export
FROM export;

COMMIT;
