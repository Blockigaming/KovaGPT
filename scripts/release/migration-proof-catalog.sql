-- Read-only, single-checkpoint inventory for the 19 remote-only migration scopes.
-- This captures object-level digests for investigation, not a schema proof or
-- an assertion that the selected database/project is authenticated by SQL.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog;
WITH target_relations AS (
  SELECT c.oid, n.nspname::text AS schema_name, c.relname::text AS object_name,
         c.relkind::text AS kind, c.relowner::regrole::text AS owner_role,
         c.relrowsecurity, c.relforcerowsecurity, c.relacl,
         c.reloptions, c.relispopulated, c.relpersistence
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('public', 'kova_private')
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
), relation_rows AS (
  SELECT r.schema_name || '.' || r.object_name AS object_id,
         encode(extensions.digest(convert_to(jsonb_build_object(
           'kind', r.kind, 'owner', r.owner_role,
           'persistence', r.relpersistence::text,
           'relationOptions', r.reloptions, 'materializedViewPopulated',
             CASE WHEN r.kind = 'm' THEN r.relispopulated ELSE NULL END,
           'sequence', (SELECT jsonb_build_object(
             'type', format_type(s.seqtypid, NULL), 'start', s.seqstart,
             'increment', s.seqincrement, 'minimum', s.seqmin,
             'maximum', s.seqmax, 'cache', s.seqcache, 'cycle', s.seqcycle)
             FROM pg_sequence s WHERE s.seqrelid = r.oid),
           'viewDefinition', CASE WHEN r.kind IN ('v', 'm') THEN pg_get_viewdef(r.oid, true) ELSE NULL END,
           'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
             'collation', CASE WHEN a.attcollation = 0 THEN NULL
               ELSE a.attcollation::regcollation::text END,
             'nullable', NOT a.attnotnull, 'identity', a.attidentity::text,
             'generated', a.attgenerated::text,
             'default', pg_get_expr(d.adbin, d.adrelid)
           ) ORDER BY a.attnum), '[]'::jsonb)
             FROM pg_attribute a LEFT JOIN pg_attrdef d
               ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped),
           'constraints', (SELECT coalesce(jsonb_agg(
             con.conname || ':' || pg_get_constraintdef(con.oid, true)
             ORDER BY con.conname), '[]'::jsonb)
             FROM pg_constraint con WHERE con.conrelid = r.oid),
           'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'definition', pg_get_indexdef(i.indexrelid),
             'valid', i.indisvalid, 'ready', i.indisready, 'live', i.indislive)
             ORDER BY i.indexrelid::regclass::text), '[]'::jsonb)
             FROM pg_index i WHERE i.indrelid = r.oid),
           'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'definition', pg_get_triggerdef(t.oid, true), 'enabled', t.tgenabled::text)
             ORDER BY t.tgname), '[]'::jsonb)
             FROM pg_trigger t WHERE t.tgrelid = r.oid AND NOT t.tgisinternal),
           'publications', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'name', pt.pubname, 'columns', pt.attnames, 'rowFilter', pt.rowfilter,
             'insert', pub.pubinsert, 'update', pub.pubupdate,
             'delete', pub.pubdelete, 'truncate', pub.pubtruncate,
             'viaRoot', pub.pubviaroot)
             ORDER BY pt.pubname), '[]'::jsonb)
             FROM pg_publication_tables pt JOIN pg_publication pub ON pub.pubname = pt.pubname
            WHERE pt.schemaname = r.schema_name AND pt.tablename = r.object_name)
         )::text, 'UTF8'), 'sha256'), 'hex') AS schema_sha256,
         encode(extensions.digest(convert_to(jsonb_build_object(
           'explicitAcl', r.relacl::text,
           'roleMatrix', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'role', roles.role_name,
             'select', CASE WHEN r.kind = 'S' THEN has_sequence_privilege(roles.role_name, r.oid, 'SELECT') ELSE has_table_privilege(roles.role_name, r.oid, 'SELECT') END,
             'insert', CASE WHEN r.kind = 'S' THEN NULL ELSE has_table_privilege(roles.role_name, r.oid, 'INSERT') END,
             'update', CASE WHEN r.kind = 'S' THEN has_sequence_privilege(roles.role_name, r.oid, 'UPDATE') ELSE has_table_privilege(roles.role_name, r.oid, 'UPDATE') END,
             'delete', CASE WHEN r.kind = 'S' THEN NULL ELSE has_table_privilege(roles.role_name, r.oid, 'DELETE') END,
             'usage', CASE WHEN r.kind = 'S' THEN has_sequence_privilege(roles.role_name, r.oid, 'USAGE') ELSE NULL END,
             'truncate', CASE WHEN r.kind = 'S' THEN NULL ELSE has_table_privilege(roles.role_name, r.oid, 'TRUNCATE') END,
             'references', CASE WHEN r.kind = 'S' THEN NULL ELSE has_table_privilege(roles.role_name, r.oid, 'REFERENCES') END,
             'trigger', CASE WHEN r.kind = 'S' THEN NULL ELSE has_table_privilege(roles.role_name, r.oid, 'TRIGGER') END,
             'maintain', CASE WHEN r.kind IN ('r', 'p', 'm') THEN has_table_privilege(roles.role_name, r.oid, 'MAINTAIN') ELSE NULL END
           ) ORDER BY roles.role_name), '[]'::jsonb)
             FROM (VALUES ('anon'), ('authenticated'), ('service_role')) roles(role_name)),
           'columnAcl', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'name', a.attname, 'acl', a.attacl::text,
             'anonSelect', has_column_privilege('anon', r.oid, a.attnum, 'SELECT'),
             'anonInsert', has_column_privilege('anon', r.oid, a.attnum, 'INSERT'),
             'anonUpdate', has_column_privilege('anon', r.oid, a.attnum, 'UPDATE'),
             'anonReferences', has_column_privilege('anon', r.oid, a.attnum, 'REFERENCES'),
             'authenticatedSelect', has_column_privilege('authenticated', r.oid, a.attnum, 'SELECT'),
             'authenticatedInsert', has_column_privilege('authenticated', r.oid, a.attnum, 'INSERT'),
             'authenticatedUpdate', has_column_privilege('authenticated', r.oid, a.attnum, 'UPDATE'),
             'authenticatedReferences', has_column_privilege('authenticated', r.oid, a.attnum, 'REFERENCES'),
             'serviceSelect', has_column_privilege('service_role', r.oid, a.attnum, 'SELECT'),
             'serviceInsert', has_column_privilege('service_role', r.oid, a.attnum, 'INSERT'),
             'serviceUpdate', has_column_privilege('service_role', r.oid, a.attnum, 'UPDATE'),
             'serviceReferences', has_column_privilege('service_role', r.oid, a.attnum, 'REFERENCES')
           ) ORDER BY a.attnum), '[]'::jsonb)
             FROM pg_attribute a WHERE a.attrelid = r.oid AND a.attnum > 0
               AND NOT a.attisdropped AND r.kind <> 'S')
         )::text, 'UTF8'), 'sha256'), 'hex') AS acl_sha256,
         encode(extensions.digest(convert_to(jsonb_build_object(
           'enabled', r.relrowsecurity, 'forced', r.relforcerowsecurity,
           'apiRoleAttributes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'role', rolname, 'superuser', rolsuper, 'bypassRls', rolbypassrls)
             ORDER BY rolname), '[]'::jsonb)
             FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')),
           'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'name', p.polname, 'permissive', p.polpermissive,
             'command', p.polcmd::text,
             'roles', (SELECT coalesce(jsonb_agg(role_name ORDER BY role_name), '[]'::jsonb)
               FROM (SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC'
                            ELSE role_oid::regrole::text END AS role_name
                       FROM unnest(p.polroles) role_oid) policy_roles),
             'using', pg_get_expr(p.polqual, p.polrelid),
             'check', pg_get_expr(p.polwithcheck, p.polrelid)
           ) ORDER BY p.polname), '[]'::jsonb)
             FROM pg_policy p WHERE p.polrelid = r.oid)
         )::text, 'UTF8'), 'sha256'), 'hex') AS rls_sha256
    FROM target_relations r
), function_rows AS (
  SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS object_id,
         encode(extensions.digest(convert_to(jsonb_build_object(
           'definition', encode(extensions.digest(convert_to(pg_get_functiondef(p.oid), 'UTF8'), 'sha256'), 'hex'),
           'owner', p.proowner::regrole::text, 'securityDefiner', p.prosecdef,
           'settings', p.proconfig, 'explicitAcl', p.proacl::text,
           'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
           'authenticatedExecute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           'serviceExecute', has_function_privilege('service_role', p.oid, 'EXECUTE'),
           'anonSchemaUsage', has_schema_privilege('anon', n.oid, 'USAGE'),
           'authenticatedSchemaUsage', has_schema_privilege('authenticated', n.oid, 'USAGE'),
           'serviceSchemaUsage', has_schema_privilege('service_role', n.oid, 'USAGE')
         )::text, 'UTF8'), 'sha256'), 'hex') AS function_sha256
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'kova_private')
), schema_rows AS (
  SELECT n.nspname::text AS object_id,
         encode(extensions.digest(convert_to(jsonb_build_object(
           'owner', n.nspowner::regrole::text,
           'explicitAcl', n.nspacl::text,
           'roleMatrix', (SELECT jsonb_agg(jsonb_build_object(
             'role', roles.role_name,
             'usage', has_schema_privilege(roles.role_name, n.oid, 'USAGE'),
             'create', has_schema_privilege(roles.role_name, n.oid, 'CREATE')
           ) ORDER BY roles.role_name)
             FROM (VALUES ('anon'), ('authenticated'), ('service_role')) roles(role_name))
         )::text, 'UTF8'), 'sha256'), 'hex') AS acl_sha256
    FROM pg_namespace n WHERE n.nspname IN ('public', 'kova_private')
), type_rows AS (
  SELECT n.nspname || '.' || t.typname AS object_id,
         encode(extensions.digest(convert_to(jsonb_build_object(
           'kind', t.typtype::text, 'owner', t.typowner::regrole::text,
           'baseType', CASE WHEN t.typbasetype = 0 THEN NULL
             ELSE t.typbasetype::regtype::text END,
           'notNull', t.typnotnull, 'default', t.typdefault,
           'collation', CASE WHEN t.typcollation = 0 THEN NULL
             ELSE t.typcollation::regcollation::text END,
           'enums', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'label', e.enumlabel, 'sort', e.enumsortorder)
             ORDER BY e.enumsortorder), '[]'::jsonb)
             FROM pg_enum e WHERE e.enumtypid = t.oid),
           'domainConstraints', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'name', c.conname, 'definition', pg_get_constraintdef(c.oid, true),
             'validated', c.convalidated)
             ORDER BY c.conname), '[]'::jsonb)
             FROM pg_constraint c WHERE c.contypid = t.oid),
           'explicitAcl', t.typacl::text,
           'anonUsage', has_type_privilege('anon', t.oid, 'USAGE'),
           'authenticatedUsage', has_type_privilege('authenticated', t.oid, 'USAGE'),
           'serviceUsage', has_type_privilege('service_role', t.oid, 'USAGE')
         )::text, 'UTF8'), 'sha256'), 'hex') AS type_sha256
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname IN ('public', 'kova_private') AND t.typtype IN ('e', 'd')
), default_acl_rows AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'owner', d.defaclrole::regrole::text, 'schema', coalesce(n.nspname, '<global>'),
    'type', d.defaclobjtype::text, 'acl', d.defaclacl::text
  ) ORDER BY d.defaclrole::regrole::text, n.nspname, d.defaclobjtype::text), '[]'::jsonb) AS rows
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE d.defaclnamespace = 0 OR n.nspname IN ('public', 'kova_private')
), history AS (
  SELECT count(*)::int AS version_count,
         coalesce(jsonb_agg(version::text ORDER BY version::text COLLATE "C"), '[]'::jsonb) AS versions
    FROM supabase_migrations.schema_migrations
), remote_only_history AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'version', version::text,
    'statementCount', coalesce(cardinality(statements), 0),
    'statementsJsonSha256', encode(extensions.digest(
      convert_to(coalesce(to_jsonb(statements)::text, 'null'), 'UTF8'), 'sha256'), 'hex')
  ) ORDER BY version::text COLLATE "C"), '[]'::jsonb) AS rows
    FROM supabase_migrations.schema_migrations
   WHERE version::text = ANY (ARRAY[
     '20260823092107', '20260823092450', '20260823151901', '20260823151927',
     '20260823214802', '20260823215044', '20260823215132', '20260823215222',
     '20260823215259', '20260823215454', '20260823215619', '20260823215848',
     '20260824081357', '20260824081812', '20260824081926', '20260824082127',
     '20260824084005', '20260824085042', '20260824085444'
   ])
)
SELECT jsonb_build_object(
  'schemaVersion', 1, 'capturedAt', statement_timestamp(),
  'isolation', current_setting('transaction_isolation'),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'databaseName', current_database(),
  'postgresVersionNum', current_setting('server_version_num')::int,
  'ledger', (SELECT to_jsonb(history) FROM history),
  'remoteOnlyHistory', (SELECT rows FROM remote_only_history),
  'schemas', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY object_id), '[]'::jsonb) FROM schema_rows x),
  'types', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY object_id), '[]'::jsonb) FROM type_rows x),
  'relations', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY object_id), '[]'::jsonb) FROM relation_rows x),
  'functions', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY object_id), '[]'::jsonb) FROM function_rows x),
  'defaultAclSha256', (SELECT encode(extensions.digest(convert_to(rows::text, 'UTF8'), 'sha256'), 'hex') FROM default_acl_rows)
) AS evidence;
COMMIT;
