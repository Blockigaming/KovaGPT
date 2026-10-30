-- Add only the two missing SELECT guards observed on the production catalog.
-- Existing owner policies, ACLs, Auth definitions, rows and history are unchanged.
-- This is not Auth adoption or authority retirement. The existing signed-claim
-- validator deliberately preserves unadopted hosted users during dual mode.
-- Recovery: acquire the same two relation locks, then recheck these exact
-- guard-policy postconditions and unchanged
-- owner policies/ACLs, drop only kova_owned_browser_read_guard on these two tables
-- in one transaction. Do not replace any policy or use CASCADE. That reversal
-- restores the known revoked-owned-session read exposure; it is not full Auth
-- cutover recovery. Keep dual mode, old keys/trust and the working prior image.
do $browser_read_guard$
declare
  v_guard oid := to_regprocedure('kova_auth_guard.session_is_active()');
  v_authenticated oid;
  v_target record;
  v_relation oid;
  v_guard_expression constant text := '(SELECTkova_auth_guard.session_is_active()ASsession_is_active)';
begin
  select oid into v_authenticated from pg_catalog.pg_roles where rolname='authenticated';
  if v_authenticated is null or not exists(select 1 from pg_catalog.pg_roles where rolname='anon')
     or not exists(select 1 from pg_catalog.pg_roles where rolname='service_role')
     or exists(select 1 from pg_catalog.pg_roles where rolname in('anon','authenticated')
       and (rolsuper or rolbypassrls)) then
    raise exception 'kova_browser_read_roles_drift';
  end if;
  if v_guard is null or not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
    where p.oid=v_guard and p.pronargs=0 and p.prorettype='boolean'::regtype
      and not p.proretset and p.prokind='f' and p.prosecdef and p.provolatile='s'
      and l.lanname='plpgsql' and p.proconfig=array['search_path=""']::text[]
      and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=
        '2e3b09bd213f3916b5509b8cf787a86605a101cfd0efc07d3b79782286ab47ab'
  ) or not has_schema_privilege('authenticated','kova_auth_guard','USAGE')
    or not has_function_privilege('authenticated',v_guard,'EXECUTE') then
    raise exception 'kova_browser_read_guard_definition_drift';
  end if;

  -- Stabilize the relation/policy baseline before any additive DDL. A failure
  -- anywhere in this single DO statement atomically removes both additions.
  lock table public.chat_history_records, public.library_folders in share row exclusive mode;
  for v_target in
    select * from (values
      ('chat_history_records','chat_history_owner_read',
       '((owner_id=(SELECTauth.uid()ASuid))AND(SELECTkova_private.chat_history_reader_current()ASchat_history_reader_current))'),
      ('library_folders','library folders owner read','((SELECTauth.uid()ASuid)=user_id)')
    ) as targets(table_name,owner_policy,owner_expression)
  loop
    v_relation := to_regclass(format('public.%I',v_target.table_name));
    if not exists(select 1 from pg_catalog.pg_class c where c.oid=v_relation
        and c.relkind='r' and c.relrowsecurity and not c.relforcerowsecurity)
      or has_table_privilege('anon',v_relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or not has_table_privilege('authenticated',v_relation,'SELECT')
      or has_table_privilege('authenticated',v_relation,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or not has_table_privilege('service_role',v_relation,'SELECT')
      or exists(select 1 from pg_catalog.pg_class c,
          lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
          where c.oid=v_relation and a.grantee=0)
      or has_any_column_privilege('anon',v_relation,'SELECT,INSERT,UPDATE,REFERENCES')
      or has_any_column_privilege('authenticated',v_relation,'INSERT,UPDATE,REFERENCES') then
      raise exception 'kova_browser_read_table_privilege_drift: %',v_target.table_name;
    end if;
    if not exists(select 1 from pg_catalog.pg_policy p
        where p.polrelid=v_relation and p.polname=v_target.owner_policy
          and p.polpermissive and p.polcmd='r' and p.polroles=array[v_authenticated]
          and p.polwithcheck is null
          and regexp_replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'\s','','g')=v_target.owner_expression)
      or exists(select 1 from pg_catalog.pg_policy p where p.polrelid=v_relation
          and p.polname not in(v_target.owner_policy,'kova_owned_browser_read_guard','kova_owned_session_guard')) then
      raise exception 'kova_browser_read_owner_policy_drift: %',v_target.table_name;
    end if;
    -- A complete canonical replay already has the earlier all-command guard.
    -- Preserve that exact policy if present; production's two gaps lack it.
    -- Do not accept a same-name weaker or differently scoped policy.
    if exists(select 1 from pg_catalog.pg_policy p where p.polrelid=v_relation
        and p.polname='kova_owned_session_guard' and (
          not p.polpermissive and p.polcmd='*'
          and (select array_agg(role_id order by role_id) from unnest(p.polroles) role_id)=
            (select array_agg(oid order by oid) from pg_catalog.pg_roles where rolname in('anon','authenticated'))
          and regexp_replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'\s','','g')=v_guard_expression
          and regexp_replace(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'\s','','g')=v_guard_expression) is not true) then
      raise exception 'kova_browser_read_existing_guard_conflict: %',v_target.table_name;
    end if;
    if not exists(select 1 from pg_catalog.pg_policy p where p.polrelid=v_relation
        and p.polname='kova_owned_browser_read_guard') then
      -- Literal statements keep both additions visible to the source inventory.
      if v_target.table_name='chat_history_records' then
        create policy kova_owned_browser_read_guard on public.chat_history_records
          as restrictive for select to authenticated
          using ((select kova_auth_guard.session_is_active()));
      else
        create policy kova_owned_browser_read_guard on public.library_folders
          as restrictive for select to authenticated
          using ((select kova_auth_guard.session_is_active()));
      end if;
    end if;
    if not exists(select 1 from pg_catalog.pg_policy p where p.polrelid=v_relation
        and p.polname='kova_owned_browser_read_guard' and not p.polpermissive
        and p.polcmd='r' and p.polroles=array[v_authenticated] and p.polwithcheck is null
        and regexp_replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'\s','','g')=v_guard_expression) then
      raise exception 'kova_browser_read_policy_conflict: %',v_target.table_name;
    end if;
  end loop;
end
$browser_read_guard$;
