-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Rewrite direct auth.uid()/auth.role()/auth.jwt() calls in RLS expressions
-- to scalar init-plans. This preserves policy semantics while avoiding a function
-- call for every candidate row. Existing init-plans are protected from double wrapping.
do $$
declare
  policy_row record;
  role_sql text;
  fixed_qual text;
  fixed_check text;
  create_sql text;
begin
  for policy_row in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ilike '%auth.uid()%'
        or coalesce(with_check, '') ilike '%auth.uid()%'
        or coalesce(qual, '') ilike '%auth.role()%'
        or coalesce(with_check, '') ilike '%auth.role()%'
        or coalesce(qual, '') ilike '%auth.jwt()%'
        or coalesce(with_check, '') ilike '%auth.jwt()%'
      )
    order by tablename, policyname
  loop
    select string_agg(quote_ident(role_name::text), ', ')
      into role_sql
    from unnest(policy_row.roles) as role_name;

    fixed_qual := policy_row.qual;
    fixed_check := policy_row.with_check;

    if fixed_qual is not null then
      fixed_qual := replace(fixed_qual, '( SELECT auth.uid() AS uid)', '__KOVA_UID_INITPLAN__');
      fixed_qual := replace(fixed_qual, '( SELECT auth.role() AS role)', '__KOVA_ROLE_INITPLAN__');
      fixed_qual := replace(fixed_qual, '( SELECT auth.jwt() AS jwt)', '__KOVA_JWT_INITPLAN__');
      fixed_qual := replace(fixed_qual, 'auth.uid()', '(select auth.uid())');
      fixed_qual := replace(fixed_qual, 'auth.role()', '(select auth.role())');
      fixed_qual := replace(fixed_qual, 'auth.jwt()', '(select auth.jwt())');
      fixed_qual := replace(fixed_qual, '__KOVA_UID_INITPLAN__', '(select auth.uid())');
      fixed_qual := replace(fixed_qual, '__KOVA_ROLE_INITPLAN__', '(select auth.role())');
      fixed_qual := replace(fixed_qual, '__KOVA_JWT_INITPLAN__', '(select auth.jwt())');
    end if;

    if fixed_check is not null then
      fixed_check := replace(fixed_check, '( SELECT auth.uid() AS uid)', '__KOVA_UID_INITPLAN__');
      fixed_check := replace(fixed_check, '( SELECT auth.role() AS role)', '__KOVA_ROLE_INITPLAN__');
      fixed_check := replace(fixed_check, '( SELECT auth.jwt() AS jwt)', '__KOVA_JWT_INITPLAN__');
      fixed_check := replace(fixed_check, 'auth.uid()', '(select auth.uid())');
      fixed_check := replace(fixed_check, 'auth.role()', '(select auth.role())');
      fixed_check := replace(fixed_check, 'auth.jwt()', '(select auth.jwt())');
      fixed_check := replace(fixed_check, '__KOVA_UID_INITPLAN__', '(select auth.uid())');
      fixed_check := replace(fixed_check, '__KOVA_ROLE_INITPLAN__', '(select auth.role())');
      fixed_check := replace(fixed_check, '__KOVA_JWT_INITPLAN__', '(select auth.jwt())');
    end if;

    if fixed_qual is not distinct from policy_row.qual
       and fixed_check is not distinct from policy_row.with_check then
      continue;
    end if;

    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );

    create_sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      policy_row.permissive,
      policy_row.cmd,
      role_sql
    );

    if fixed_qual is not null then
      create_sql := create_sql || ' using (' || fixed_qual || ')';
    end if;

    if fixed_check is not null then
      create_sql := create_sql || ' with check (' || fixed_check || ')';
    end if;

    execute create_sql;
  end loop;
end
$$;
;
