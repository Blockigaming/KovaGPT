-- Reviewable ACL inputs for the 98-version baseline/live comparison.
-- Catalog metadata only; no application rows or function bodies.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog;
WITH relations AS (
  SELECT c.oid, n.nspname::text AS schema_name, c.relname::text AS object_name,
         c.relkind::text AS kind, c.relowner::regrole::text AS owner_role,
         c.relacl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'kova_private')
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
), relation_acl AS (
  SELECT r.schema_name || '.' || r.object_name AS object_id, r.kind,
         r.owner_role, r.relacl::text AS raw_acl,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'grantor', CASE WHEN g.grantor = 0 THEN 'PUBLIC' ELSE g.grantor::regrole::text END,
            'grantee', CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END,
            'privilege', g.privilege_type, 'grantable', g.is_grantable)
            ORDER BY g.grantee, g.grantor, g.privilege_type, g.is_grantable), '[]'::jsonb)
          FROM aclexplode(r.relacl) g) AS grants,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'role', role_name,
            'select', CASE WHEN r.kind = 'S' THEN has_sequence_privilege(role_name, r.oid, 'SELECT') ELSE has_table_privilege(role_name, r.oid, 'SELECT') END,
            'insert', CASE WHEN r.kind = 'S' THEN NULL ELSE has_table_privilege(role_name, r.oid, 'INSERT') END,
            'update', CASE WHEN r.kind = 'S' THEN has_sequence_privilege(role_name, r.oid, 'UPDATE') ELSE has_table_privilege(role_name, r.oid, 'UPDATE') END,
            'delete', CASE WHEN r.kind = 'S' THEN NULL ELSE has_table_privilege(role_name, r.oid, 'DELETE') END,
            'usage', CASE WHEN r.kind = 'S' THEN has_sequence_privilege(role_name, r.oid, 'USAGE') ELSE NULL END)
            ORDER BY role_name), '[]'::jsonb)
          FROM (VALUES ('anon'), ('authenticated'), ('service_role')) api(role_name)) AS effective,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'name', a.attname, 'acl', a.attacl::text)
            ORDER BY a.attnum), '[]'::jsonb)
          FROM pg_attribute a WHERE a.attrelid = r.oid AND a.attnum > 0
            AND NOT a.attisdropped AND a.attacl IS NOT NULL) AS column_grants
    FROM relations r
), defaults AS (
  SELECT d.defaclrole::regrole::text AS owner_role,
         n.nspname::text AS schema_name, d.defaclobjtype::text AS kind,
         d.defaclacl::text AS raw_acl,
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
           'grantor', CASE WHEN g.grantor = 0 THEN 'PUBLIC' ELSE g.grantor::regrole::text END,
           'grantee', CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END,
           'privilege', g.privilege_type, 'grantable', g.is_grantable)
           ORDER BY g.grantee, g.grantor, g.privilege_type, g.is_grantable), '[]'::jsonb)
           FROM aclexplode(d.defaclacl) g) AS grants
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE n.nspname IN ('public', 'kova_private') OR d.defaclnamespace = 0
)
SELECT jsonb_build_object(
  'transactionReadOnly', current_setting('transaction_read_only') = 'on',
  'isolationLevel', current_setting('transaction_isolation'),
  'relations', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.object_id), '[]'::jsonb) FROM relation_acl r),
  'defaultPrivileges', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.owner_role, d.schema_name, d.kind), '[]'::jsonb) FROM defaults d)
) AS migration_acl_detail;
COMMIT;
