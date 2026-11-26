-- Staged source. Materialize with the repository migration tooling before
-- enabling KOVA_DEVELOPER_WORKSPACE_V2. Never apply directly to production.
-- Reuse existing owner and global billing locks. No account funding occurs.
create or replace function public.manage_developer_workspace_v2(
  p_owner uuid, p_operation text, p_input jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  a uuid;
  p uuid;
  project_name text;
  existing_name text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or exists(select 1 from public.banned_users where user_id=p_owner)
  then raise exception 'developer_owner_required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('developer_billing',0));
  if p_input is null or jsonb_typeof(p_input)<>'object' or pg_column_size(p_input)>8192
    then raise exception 'developer_input_invalid'; end if;

  if p_operation='ensure_workspace' then
    -- Adopt an existing account instead of creating a parallel wallet. The
    -- same transaction lock is used by the original create_account operation.
    select own.account_id into a
      from public.developer_account_owners own
      join public.developer_credit_accounts account on account.id=own.account_id
      where own.owner_id=p_owner
      order by (account.currency='USD') desc, own.created_at, own.account_id
      limit 1;
    if a is null then
      return public.manage_developer_workspace(
        p_owner,'create_account',jsonb_build_object('name','Personal workspace','currency','USD'));
    end if;
    select id into p from public.developer_projects where account_id=a
      order by created_at,id limit 1;
    if p is null then
      insert into public.developer_projects(account_id,name)
        values(a,'Default project') returning id into p;
    end if;
    return jsonb_build_object('accountId',a,'projectId',p);
  end if;

  a:=(p_input->>'accountId')::uuid;
  if not exists(select 1 from public.developer_account_owners where account_id=a and owner_id=p_owner)
    then raise exception 'developer_owner_required' using errcode='42501'; end if;
  p:=(p_input->>'projectId')::uuid;
  if p is null then raise exception 'developer_input_invalid'; end if;
  project_name:=btrim(p_input->>'name');
  if project_name is null or length(project_name) not between 1 and 80
    then raise exception 'developer_input_invalid'; end if;
  if p_operation='create_project' then
    -- A caller-generated UUID is an idempotency key, not authorization.
    select name into existing_name from public.developer_projects where id=p and account_id=a;
    if found then
      if existing_name<>project_name then raise exception 'developer_project_conflict'; end if;
      return jsonb_build_object('accountId',a,'projectId',p);
    end if;
    if (select count(*) from public.developer_projects where account_id=a)>=100
      then raise exception 'developer_project_limit'; end if;
    insert into public.developer_projects(id,account_id,name)
      values(p,a,project_name);
  elsif p_operation='rename_project' then
    update public.developer_projects set name=project_name where id=p and account_id=a;
    if not found then raise exception 'developer_owner_required' using errcode='42501'; end if;
  else
    raise exception 'developer_operation_invalid';
  end if;
  return jsonb_build_object('accountId',a,'projectId',p);
end $$;
revoke all on function public.manage_developer_workspace_v2(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_workspace_v2(uuid,text,jsonb) to service_role;
