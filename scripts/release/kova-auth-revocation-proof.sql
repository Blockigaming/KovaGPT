-- Run in a REPEATABLE READ, READ ONLY transaction. Aggregate metadata only.
-- All violation counts must be zero before enabling a Kova-signed data plane.
-- This cannot prove external PostgREST config reload or active-channel teardown.
with targets as (
  select c.oid from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and c.relrowsecurity
    and (n.nspname='public'
      or (n.nspname='storage' and c.relname in ('buckets','objects'))
      or (n.nspname='realtime' and c.relname='messages'))
), expected_roles as (
  select array_agg(oid order by oid) as ids from pg_catalog.pg_roles where rolname in ('anon','authenticated')
), guarded as (
  select p.polrelid from pg_catalog.pg_policy p
  where p.polname='kova_owned_session_guard' and not p.polpermissive and p.polcmd='*'
    and (select array_agg(role_id order by role_id) from unnest(p.polroles) role_id)=(select ids from expected_roles)
    and regexp_replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'\s','','g')='(SELECTkova_auth_guard.session_is_active()ASsession_is_active)'
    and regexp_replace(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'\s','','g')='(SELECTkova_auth_guard.session_is_active()ASsession_is_active)'
), expected_functions(name,definer,body_sha256) as (
  values ('session_is_active',true,'9af8752e28bb22fe416a752d2a99fcfdf7bd58b0b6b60a4487c1b278a7618e60'),
    ('check_request',false,'c8aa8a9974380dddf33a52ae229f5a645581494da4570c74b8fececb189853a9')
)
select
  (select count(*) from targets) as scoped_rls_tables,
  (select count(*) from targets t where not exists(select 1 from guarded g where g.polrelid=t.oid)) as unguarded_rls_tables,
  (select count(*) from expected_functions e where not exists(
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='kova_auth_guard' and p.proname=e.name and p.pronargs=0
      and p.prosecdef=e.definer and p.provolatile='s' and p.proconfig=array['search_path=""']
      and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=e.body_sha256
      and has_function_privilege('anon',p.oid,'execute')
      and has_function_privilege('authenticated',p.oid,'execute')
      and has_function_privilege('service_role',p.oid,'execute')
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.privilege_type='EXECUTE' and a.grantee<>p.proowner
          and a.grantee not in(select oid from pg_catalog.pg_roles where rolname in('anon','authenticated','service_role')))
  )) as invalid_guard_functions,
  (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='kova_private' and c.relkind in('r','p') and
      (has_table_privilege('anon',c.oid,'select,insert,update,delete') or
       has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))) as browser_accessible_private_tables,
  (has_schema_privilege('anon','kova_private','usage') or
   has_schema_privilege('authenticated','kova_private','usage'))::int as browser_private_schema_access,
  (not exists(select 1 from pg_catalog.pg_db_role_setting s join pg_catalog.pg_roles r on r.oid=s.setrole
    cross join lateral unnest(s.setconfig) setting
    where r.rolname='authenticator' and s.setdatabase=(select oid from pg_catalog.pg_database where datname=current_database())
      and setting='pgrst.db_pre_request=kova_auth_guard.check_request'))::int as missing_database_request_hook;