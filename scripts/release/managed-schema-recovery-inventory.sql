-- Read-only, single-snapshot metadata inventory for M17. No customer table data
-- or secret values are returned. Bind the project identity in the connection or
-- Supabase execute_sql project_id; this SQL cannot authenticate its own target.
-- The catalog alone is not a full recovery proof.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH managed_relations AS (
  SELECT
    count(*) FILTER (WHERE n.nspname = 'auth')::int AS auth_relations,
    count(*) FILTER (WHERE n.nspname = 'storage')::int AS storage_relations,
    count(*) FILTER (WHERE n.nspname = 'auth' AND pg_get_userbyid(c.relowner) <> 'supabase_auth_admin')::int AS auth_owner_anomalies,
    count(*) FILTER (WHERE n.nspname = 'storage' AND pg_get_userbyid(c.relowner) <> 'supabase_storage_admin')::int AS storage_owner_anomalies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('auth', 'storage') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
),
managed_functions AS (
  SELECT
    count(*) FILTER (WHERE n.nspname = 'auth')::int AS auth_functions,
    count(*) FILTER (WHERE n.nspname = 'storage')::int AS storage_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('auth', 'storage')
),
managed_triggers AS (
  SELECT
    n.nspname,
    c.relname,
    t.tgname,
    encode(digest(pg_get_triggerdef(t.oid), 'sha256'), 'hex') AS definition_sha256
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('auth', 'storage') AND NOT t.tgisinternal
),
managed_policies AS (
  SELECT
    n.nspname,
    c.relname,
    p.polname,
    p.polcmd,
    p.polpermissive,
    coalesce(
      (
        SELECT jsonb_agg(
          CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END
          ORDER BY role_oid
        )
        FROM unnest(p.polroles) AS role_oid
      ),
      '[]'::jsonb
    ) AS policy_roles,
    pg_get_expr(p.polqual, p.polrelid) AS policy_using,
    pg_get_expr(p.polwithcheck, p.polrelid) AS policy_check
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('auth', 'storage')
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'catalog', jsonb_build_object(
    'authRelations', r.auth_relations,
    'storageRelations', r.storage_relations,
    'authRelationOwnerAnomalies', r.auth_owner_anomalies,
    'storageRelationOwnerAnomalies', r.storage_owner_anomalies,
    'authFunctions', f.auth_functions,
    'storageFunctions', f.storage_functions,
    'authNoninternalTriggers', (SELECT count(*)::int FROM managed_triggers WHERE nspname = 'auth'),
    'storageNoninternalTriggers', (SELECT count(*)::int FROM managed_triggers WHERE nspname = 'storage'),
    'storageObjectPolicies', (SELECT count(*)::int FROM managed_policies WHERE nspname = 'storage' AND relname = 'objects'),
    'storageBuckets', (SELECT count(*)::int FROM storage.buckets),
    'storageObjects', (SELECT count(*)::int FROM storage.objects)
  ),
  'extensions', (
    SELECT jsonb_agg(
      jsonb_build_object('name', e.extname, 'version', e.extversion, 'schema', n.nspname)
      ORDER BY e.extname
    )
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
  ),
  'managedPolicies', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'schema', nspname, 'table', relname, 'policy', polname,
        'command', polcmd, 'permissive', polpermissive,
        'roles', policy_roles, 'using', policy_using, 'check', policy_check
      )
      ORDER BY nspname, relname, polname
    )
    FROM managed_policies
  ),
  'managedTriggers', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'schema', nspname, 'table', relname, 'name', tgname,
        'definitionSha256', definition_sha256
      )
      ORDER BY nspname, relname, tgname
    )
    FROM managed_triggers
  )
) AS recovery_inventory
FROM managed_relations r
CROSS JOIN managed_functions f;

COMMIT;
