-- Cover protected tables added after the original owned-session guard rollout.
-- Keep existing ownership policies, grants, functions and private schemas intact.
-- A conflicting policy fails closed instead of silently changing authorization.
do $coverage$
declare
  v_table record;
  v_expected_roles oid[];
begin
  if to_regprocedure('kova_auth_guard.session_is_active()') is null then
    raise exception 'kova_auth_session_guard_missing';
  end if;
  select array_agg(oid order by oid) into v_expected_roles
    from pg_catalog.pg_roles where rolname in ('anon', 'authenticated');
  if coalesce(array_length(v_expected_roles, 1), 0) <> 2 then
    raise exception 'kova_auth_session_guard_roles_missing';
  end if;

  for v_table in
    select c.oid, n.nspname, c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and c.relrowsecurity
      and (n.nspname = 'public'
        or (n.nspname = 'storage' and c.relname in ('buckets', 'objects'))
        or (n.nspname = 'realtime' and c.relname = 'messages'))
    order by n.nspname, c.relname
  loop
    if not exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = v_table.oid and p.polname = 'kova_owned_session_guard'
    ) then
      execute format(
        'create policy kova_owned_session_guard on %I.%I as restrictive for all to anon, authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()))',
        v_table.nspname, v_table.relname
      );
    end if;
    if not exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = v_table.oid and p.polname = 'kova_owned_session_guard'
        and not p.polpermissive and p.polcmd = '*'
        and (select array_agg(role_id order by role_id) from unnest(p.polroles) role_id) = v_expected_roles
        and regexp_replace(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '\s', '', 'g') = '(SELECTkova_auth_guard.session_is_active()ASsession_is_active)'
        and regexp_replace(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '\s', '', 'g') = '(SELECTkova_auth_guard.session_is_active()ASsession_is_active)'
    ) then
      raise exception 'kova_auth_session_guard_policy_conflict';
    end if;
  end loop;
end
$coverage$;
