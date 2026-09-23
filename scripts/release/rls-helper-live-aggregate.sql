BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH target_functions AS (
  SELECT n.nspname AS schema_name,
         p.proname AS function_name,
         pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         pg_get_function_result(p.oid) AS result_type,
         p.proowner::regrole::text AS owner_role,
         p.prosecdef AS security_definer,
         p.provolatile AS volatility,
         p.proconfig AS settings,
         p.proacl::text AS explicit_acl,
         has_schema_privilege('anon', n.oid, 'USAGE') AS anon_schema_usage,
         has_schema_privilege('authenticated', n.oid, 'USAGE') AS authenticated_schema_usage,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
         has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute,
         encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex') AS definition_sha256,
         (strpos(p.prosrc, 'forbidden_user_scope') > 0) AS mentions_scope_denial,
         (strpos(p.prosrc, 'auth.uid()') > 0) AS mentions_auth_uid,
         (strpos(p.prosrc, 'auth.role()') > 0) AS mentions_auth_role
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'kova_private')
     AND p.proname IN ('family_owner_of', 'user_plan_tier')
), policies AS (
  SELECT p.schemaname, p.tablename, p.policyname, p.permissive,
         p.roles::text AS roles, p.cmd, p.qual, p.with_check,
         lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) AS expression_text
    FROM pg_policies p
   WHERE p.schemaname = 'public'
), classified_policies AS (
  SELECT *,
         regexp_replace(
           expression_text,
           '\(\s*select\s+auth\.(uid|role|jwt)\(\)(\s+as\s+[a-z_]+)?\s*\)',
           '<INITPLAN>', 'gi'
         ) AS without_scalar_initplans
    FROM policies
), policy_summary AS (
  SELECT count(*) AS public_policy_count,
         count(*) FILTER (WHERE expression_text LIKE '%auth.uid()%') AS uid_policy_count,
         count(*) FILTER (WHERE expression_text LIKE '%auth.role()%') AS role_policy_count,
         count(*) FILTER (WHERE expression_text LIKE '%auth.jwt()%') AS jwt_policy_count,
         count(*) FILTER (
           WHERE without_scalar_initplans LIKE '%auth.uid()%'
              OR without_scalar_initplans LIKE '%auth.role()%'
              OR without_scalar_initplans LIKE '%auth.jwt()%'
         ) AS direct_auth_policy_count,
         count(*) FILTER (WHERE expression_text LIKE '%family_owner_of(%') AS family_owner_reference_count,
         count(*) FILTER (WHERE expression_text LIKE '%user_plan_tier(%') AS user_plan_reference_count,
         encode(sha256(convert_to(coalesce(string_agg(
           format('%s|%s|%s|%s|%s|%s|%s|%s',
             schemaname, tablename, policyname, permissive, roles,
             cmd, coalesce(qual, ''), coalesce(with_check, '')),
           E'\n' ORDER BY schemaname, tablename, policyname), ''), 'UTF8')), 'hex')
           AS policy_catalog_sha256
    FROM classified_policies
)
SELECT now() AS captured_at,
       current_setting('transaction_isolation') AS transaction_isolation,
       current_setting('transaction_read_only') AS transaction_read_only,
       current_setting('server_version_num') AS server_version_num,
       (SELECT count(*) FROM supabase_migrations.schema_migrations) AS migration_count,
       (SELECT max(version) FROM supabase_migrations.schema_migrations) AS last_migration_version,
       (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY schema_name, function_name,
                                     identity_arguments), '[]'::jsonb)
          FROM target_functions f) AS scoped_function_metadata,
       (SELECT row_to_json(s) FROM policy_summary s) AS public_policy_aggregate;

COMMIT;
