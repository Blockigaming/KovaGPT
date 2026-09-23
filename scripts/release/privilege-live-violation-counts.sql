-- Catalog-only snapshot for the August 23 remote-only privilege lineage.
-- Produces one aggregate JSON object. It does not read application tables,
-- identify customer rows, call application functions, or apply schema changes.
-- The comparison checkpoint is source candidate 20260904230329, not the
-- historical effect of each separate remote migration. A later source writer
-- changes enforce_family_member_cap again and must be compared separately.
begin isolation level repeatable read read only;

with
public_relations as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  -- GRANT/REVOKE ON ALL TABLES IN SCHEMA also covers views, materialized
  -- views, and foreign tables, so the effective-privilege audit must too.
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
),
public_sequences as (
  select c.oid
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S'
),
table_operations as (
  select op from (values
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
    ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
  ) operations(op)
),
server_names as (
  select unnest(array[
    'agent_workers', 'api_emergency_controls', 'api_pricing_versions',
    'credit_purchases', 'developer_api_requests', 'developer_credit_accounts',
    'developer_credit_ledger', 'diagnostic_rate_limits', 'github_oauth_states',
    'github_webhook_deliveries', 'integration_oauth_states', 'integration_providers',
    'integration_webhook_subscriptions', 'integration_workspace_policies',
    'kova_schema_contract', 'upstream_price_registry'
  ]) name
),
server_tables as (
  select n.name, t.oid, t.relrowsecurity,
    exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = t.oid and p.polname = n.name || '_deny_clients'
        and p.polpermissive and p.polcmd = '*'
        and pg_catalog.pg_get_expr(p.polqual, t.oid) = 'false'
        and pg_catalog.pg_get_expr(p.polwithcheck, t.oid) = 'false'
    ) permissive_false_deny,
    exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = t.oid and p.polname = n.name || '_deny_clients'
        and not p.polpermissive and p.polcmd = '*'
        and pg_catalog.pg_get_expr(p.polqual, t.oid) = 'false'
        and pg_catalog.pg_get_expr(p.polwithcheck, t.oid) = 'false'
        and p.polroles @> array[
          (select oid from pg_catalog.pg_roles where rolname = 'anon'),
          (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
        ]::oid[]
    ) restrictive_deny,
    exists (
      select 1 from pg_catalog.pg_attribute a
      cross join lateral pg_catalog.aclexplode(a.attacl) grant_row
      where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
        and grant_row.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        and (
          case when grant_row.grantee = 0 then true else
            pg_catalog.pg_has_role('anon', grant_row.grantee, 'USAGE')
            or pg_catalog.pg_has_role('authenticated', grant_row.grantee, 'USAGE') end
        )
        and (
          pg_catalog.has_column_privilege('anon', t.oid, a.attnum, grant_row.privilege_type)
          or pg_catalog.has_column_privilege(
            'authenticated', t.oid, a.attnum, grant_row.privilege_type
          )
        )
    ) client_column_grant
  from server_names n left join public_relations t on t.relname = n.name
),
connector_names as (
  select key name, value operations from jsonb_each(
    '{"connected_account_audit_log":["SELECT"],"connected_accounts":["SELECT","DELETE"],"google_oauth_tokens":[],"integration_linked_accounts":["SELECT"],"integration_sync_jobs":["SELECT"],"integration_consents":["SELECT"],"integration_action_approvals":["SELECT","UPDATE"],"integration_audit_events":["SELECT"],"integration_deletion_requests":["SELECT"],"github_accounts":["SELECT"],"github_installations":["SELECT"],"github_repositories":["SELECT"],"github_repository_branches":["SELECT"],"github_sync_records":["SELECT"],"github_tool_audit":["SELECT"],"github_webhooks":["SELECT"],"github_coding_selections":["SELECT","INSERT","UPDATE","DELETE"]}'::jsonb
  )
),
connector_tables as (
  select n.name, n.operations, t.oid,
    exists (
      select 1 from pg_catalog.pg_attribute a
      cross join lateral pg_catalog.aclexplode(a.attacl) grant_row
      where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
        and grant_row.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
        and (
          case when grant_row.grantee = 0 then true else
            pg_catalog.pg_has_role('anon', grant_row.grantee, 'USAGE')
            or pg_catalog.pg_has_role('authenticated', grant_row.grantee, 'USAGE') end
        )
        and (
          pg_catalog.has_column_privilege('anon', t.oid, a.attnum, grant_row.privilege_type)
          or pg_catalog.has_column_privilege(
            'authenticated', t.oid, a.attnum, grant_row.privilege_type
          )
        )
    ) client_column_grant
  from connector_names n left join public_relations t on t.relname = n.name
),
trigger_names as (
  select unnest(array[
    'enforce_family_member_cap', 'enforce_supported_agent_job_kind',
    'set_feedback_submission_updated_at', 'validate_agent_dependency_edge',
    'set_deep_research_updated_at', 'prevent_financial_entry_mutation',
    'touch_updated_at'
  ]) name
),
trigger_routines as (
  select n.name, p.oid, p.proconfig, p.proowner, p.prorettype
  from trigger_names n left join pg_catalog.pg_proc p on p.proname = n.name
    and p.pronamespace = 'public'::regnamespace and p.pronargs = 0
),
owner_role as (
  select oid from pg_catalog.pg_roles where rolname = 'postgres'
),
default_acl as (
  select expectation.object_type, expectation.location,
    case when d.oid is null and expectation.location = 'global'
      then pg_catalog.acldefault(expectation.object_type, (select oid from owner_role))
      else d.defaclacl end acl
  from (values
    ('f'::"char", 'global'), ('f'::"char", 'public'),
    ('r'::"char", 'global'), ('r'::"char", 'public'),
    ('S'::"char", 'global'), ('S'::"char", 'public')
  ) expectation(object_type, location)
  left join pg_catalog.pg_default_acl d on d.defaclrole = (select oid from owner_role)
    and d.defaclobjtype = expectation.object_type
    and d.defaclnamespace = case when expectation.location = 'global' then 0::oid
      else 'public'::regnamespace::oid end
),
default_grants as (
  select d.object_type, d.location, grant_row.grantee, grant_row.privilege_type,
    case when grant_row.grantee = 0 then true
      when grant_row.grantee is not null then
        pg_catalog.pg_has_role('anon', grant_row.grantee, 'USAGE')
        or pg_catalog.pg_has_role('authenticated', grant_row.grantee, 'USAGE')
      else false end client_effective
  from default_acl d left join lateral pg_catalog.aclexplode(d.acl) grant_row on true
)
select jsonb_build_object(
  'serverVersionNum', current_setting('server_version_num')::integer,
  'observedMigrationCount', (select count(*) from supabase_migrations.schema_migrations),
  'publicRelationCount', (select count(*) from public_relations),
  'tableDdlClientGrantViolations', (
    select count(*) from public_relations t
    join table_operations o on o.op in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
    where pg_catalog.has_table_privilege('anon', t.oid, o.op)
       or pg_catalog.has_table_privilege('authenticated', t.oid, o.op)
  ),
  'sequenceUpdateClientGrantViolations', (
    select count(*) from public_sequences s
    where pg_catalog.has_sequence_privilege('anon', s.oid, 'UPDATE')
       or pg_catalog.has_sequence_privilege('authenticated', s.oid, 'UPDATE')
  ),
  'serverTableMissing', (select count(*) from server_tables where oid is null),
  'serverTableRlsMissing', (
    select count(*) from server_tables where oid is not null and not relrowsecurity
  ),
  'serverTableRestrictiveDenyMissing', (
    select count(*) from server_tables where oid is not null and not restrictive_deny
  ),
  'serverTableHistoricalPermissiveDeny', (
    select count(*) from server_tables where oid is not null and permissive_false_deny
  ),
  'serverTableClientGrantViolations', (
    select count(*) from server_tables s join table_operations o on s.oid is not null
    where pg_catalog.has_table_privilege('anon', s.oid, o.op)
       or pg_catalog.has_table_privilege('authenticated', s.oid, o.op)
  ),
  'serverTableClientColumnGrantViolations', (
    select count(*) from server_tables where client_column_grant
  ),
  'serverTableServiceGrantMissing', (
    select count(*) from server_tables s join table_operations o on s.oid is not null
    where not pg_catalog.has_table_privilege('service_role', s.oid, o.op)
  ),
  'connectorTableMissing', (select count(*) from connector_tables where oid is null),
  'connectorAuthenticatedGrantMismatch', (
    select count(*) from connector_tables c join table_operations o on c.oid is not null
    where pg_catalog.has_table_privilege('authenticated', c.oid, o.op)
      is distinct from (c.operations ? o.op)
  ),
  'connectorAnonGrantViolations', (
    select count(*) from connector_tables c join table_operations o on c.oid is not null
    where pg_catalog.has_table_privilege('anon', c.oid, o.op)
  ),
  'connectorClientColumnGrantViolations', (
    select count(*) from connector_tables where client_column_grant
  ),
  'connectorServiceGrantMissing', (
    select count(*) from connector_tables c join table_operations o on c.oid is not null
    where not pg_catalog.has_table_privilege('service_role', c.oid, o.op)
  ),
  'triggerRoutineMissing', (select count(*) from trigger_routines where oid is null),
  'triggerReturnTypeMismatch', (
    select count(*) from trigger_routines where oid is not null and prorettype <> 'trigger'::regtype
  ),
  'triggerPostgresOwnerMismatch', (
    select count(*) from trigger_routines where oid is not null
      and proowner <> (select oid from owner_role)
  ),
  'triggerCandidateSearchPathMismatch', (
    select count(*) from trigger_routines where oid is not null
      and not coalesce(proconfig @> array['search_path=pg_catalog, public, pg_temp'], false)
  ),
  'triggerHistoricalSearchPathMatch', (
    select count(*) from trigger_routines where oid is not null
      and coalesce(proconfig @> array['search_path=public, pg_temp'], false)
  ),
  'triggerClientExecuteViolations', (
    select count(*) from trigger_routines where oid is not null
      and (pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE'))
  ),
  'triggerUnboundRoutineCount', (
    select count(*) from trigger_routines p where p.oid is not null and not exists (
      select 1 from pg_catalog.pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal
    )
  ),
  'postgresOwnerMissing', (select count(*) = 0 from owner_role),
  'globalFunctionPublicExecute', (
    select count(*) from default_grants where object_type = 'f'
      and location = 'global' and grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'globalFunctionClientExecute', (
    select count(*) from default_grants where object_type = 'f'
      and location = 'global' and privilege_type = 'EXECUTE'
      and grantee <> 0 and client_effective
  ),
  'schemaFunctionClientExecute', (
    select count(*) from default_grants where object_type = 'f'
      and location = 'public' and privilege_type = 'EXECUTE'
      and client_effective
  ),
  'schemaFunctionServiceExecute', (
    select count(*) from default_grants where object_type = 'f'
      and location = 'public' and privilege_type = 'EXECUTE'
      and grantee = (select oid from pg_catalog.pg_roles where rolname = 'service_role')
  ),
  'schemaTableClientGrants', (
    select count(*) from default_grants where object_type = 'r' and location = 'public'
      and client_effective
  ),
  'schemaSequenceClientGrants', (
    select count(*) from default_grants where object_type = 'S' and location = 'public'
      and client_effective
  ),
  'globalTableClientGrants', (
    select count(*) from default_grants where object_type = 'r' and location = 'global'
      and client_effective
  ),
  'globalSequenceClientGrants', (
    select count(*) from default_grants where object_type = 'S' and location = 'global'
      and client_effective
  )
) as aggregate_counts;

commit;
