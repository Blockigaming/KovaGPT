-- Read-only, single-snapshot metadata inventory for M17. No customer table data
-- or secret values are returned. Bind the project identity in the connection or
-- Supabase execute_sql project_id; this SQL cannot authenticate its own target.
-- The catalog alone is not a full recovery proof.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH managed_relations AS (
  SELECT
    count(*) FILTER (WHERE n.nspname = 'auth')::int AS auth_relations,
    count(*) FILTER (WHERE n.nspname = 'storage')::int AS storage_relations,
    count(*) FILTER (WHERE n.nspname = 'auth' AND c.relkind = 'S')::int AS auth_sequences,
    count(*) FILTER (WHERE n.nspname = 'storage' AND c.relkind = 'S')::int AS storage_sequences,
    count(*) FILTER (WHERE n.nspname = 'auth' AND pg_get_userbyid(c.relowner) <> 'supabase_auth_admin')::int AS auth_owner_anomalies,
    count(*) FILTER (WHERE n.nspname = 'storage' AND pg_get_userbyid(c.relowner) <> 'supabase_storage_admin')::int AS storage_owner_anomalies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('auth', 'storage') AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
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
  'schemaVersion', 2,
  'catalog', jsonb_build_object(
    'authRelations', r.auth_relations,
    'storageRelations', r.storage_relations,
    'authSequences', r.auth_sequences,
    'storageSequences', r.storage_sequences,
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
  'storageBucketSettings', (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'public', b.public,
        'fileSizeLimit', b.file_size_limit,
        'allowedMimeTypes', b.allowed_mime_types
      ) ORDER BY b.id
    ), '[]'::jsonb)
    FROM storage.buckets b
  ),
  'managedSchemaGrants', (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'owner', pg_get_userbyid(n.nspowner),
        'grantor', pg_get_userbyid(a.grantor),
        'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        'privilege', a.privilege_type,
        'grantable', a.is_grantable
      ) ORDER BY n.nspname, a.grantee, a.grantor, a.privilege_type), '[]'::jsonb)
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname IN ('auth', 'storage')
  ),
  'managedRelationGrants', (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'relation', c.relname,
        'kind', c.relkind,
        'owner', pg_get_userbyid(c.relowner),
        'grantor', pg_get_userbyid(a.grantor),
        'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        'privilege', a.privilege_type,
        'grantable', a.is_grantable
      ) ORDER BY n.nspname, c.relname, c.relkind, a.grantee, a.grantor, a.privilege_type), '[]'::jsonb)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 'S' ELSE 'r' END)::"char", c.relowner))) a
    WHERE n.nspname IN ('auth', 'storage') AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
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
