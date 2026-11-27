-- Source-staged private versioned text skills. No executable code or implicit inference.
create table public.developer_skill_versions_v1 (
  project_id uuid not null references public.developer_projects(id) on delete cascade,
  id uuid not null,
  version integer not null check(version between 1 and 20),
  owner_id uuid not null references auth.users(id) on delete cascade,
  definition jsonb not null check(jsonb_typeof(definition)='object' and octet_length(definition::text)<=16384),
  created_at timestamptz not null default now(),
  primary key(project_id,id,version)
);
create index developer_skill_versions_owner_v1_idx on public.developer_skill_versions_v1(owner_id,project_id,id);
alter table public.developer_skill_versions_v1 enable row level security;
revoke all on public.developer_skill_versions_v1 from public,anon,authenticated;
grant select,insert,delete on public.developer_skill_versions_v1 to service_role;
create function public.manage_developer_skills_v1(
  p_owner uuid,p_key uuid,p_project uuid,p_operation text,p_input jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  a public.developer_skill_versions_v1%rowtype;
  v public.developer_skill_versions_v1%rowtype;
  config jsonb;
  skill_id uuid;
  expected integer;
  selected integer;
  result jsonb;
begin
  if p_owner is null then raise exception 'developer_owner_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    or exists(select 1 from public.banned_users where user_id=p_owner)
    or exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false))
  then raise exception 'developer_owner_unavailable' using errcode='42501'; end if;
  if p_key is null or p_project is null or not exists(
    select 1 from public.developer_billing_keys k
      join public.developer_account_owners a on a.account_id=k.account_id
      join public.developer_projects p on p.id=k.project_id and p.account_id=k.account_id
      join public.developer_credit_accounts acct on acct.id=k.account_id
    where k.id=p_key and p.id=p_project and a.owner_id=p_owner
      and k.enabled and k.revoked_at is null and k.expires_at>now()
      and 'chat'=any(k.capabilities)
      and acct.suspended_at is null
  ) then raise exception 'developer_scope_required' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>32768
  then raise exception 'developer_skill_invalid'; end if;
  if p_operation='list' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id),'[]'::jsonb)
      into result from (
        select distinct on(id) id,version,created_at,definition->>'name' as name,definition->>'description' as description
        from public.developer_skill_versions_v1 where owner_id=p_owner and project_id=p_project
        order by id,version desc
      ) t;
    return jsonb_build_object('object','list','data',result);
  end if;
  if coalesce(p_input->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception 'developer_skill_invalid'; end if;
  skill_id:=(p_input->>'id')::uuid;
  select * into a from public.developer_skill_versions_v1
    where owner_id=p_owner and project_id=p_project and id=skill_id order by version desc limit 1;
  if p_operation in ('create','update') then
    config:=p_input->'definition';
    if jsonb_typeof(config) is distinct from 'object'
      or config - 'name' - 'description' - 'instructions' <> '{}'::jsonb
      or jsonb_typeof(config->'name') is distinct from 'string'
      or octet_length(btrim(config->>'name')) not between 1 and 160
      or jsonb_typeof(config->'description') is distinct from 'string'
      or octet_length(btrim(config->>'description')) not between 1 and 512
      or jsonb_typeof(config->'instructions') is distinct from 'string'
      or octet_length(config->>'instructions') not between 1 and 4000
      or length(btrim(config->>'instructions'))=0
    then raise exception 'developer_skill_invalid'; end if;
    if p_operation='create' then
      if a.id is not null then
        select * into v from public.developer_skill_versions_v1
          where owner_id=p_owner and project_id=p_project and id=skill_id and version=1;
        if v.definition<>config then raise exception 'developer_skill_conflict'; end if;
        return jsonb_build_object('object','skill.definition')||(to_jsonb(v)-'owner_id');
      end if;
      if (select count(*) from public.developer_skill_versions_v1 where owner_id=p_owner and version=1)>=20
      then raise exception 'developer_skill_quota_exceeded'; end if;
      selected:=1;
    else
      if a.id is null then raise exception 'developer_skill_not_found'; end if;
      if jsonb_typeof(p_input->'expected_version') is distinct from 'number'
        or (p_input->>'expected_version')::numeric<>trunc((p_input->>'expected_version')::numeric)
        or (p_input->>'expected_version')::numeric not between 1 and 19
      then raise exception 'developer_skill_invalid'; end if;
      expected:=(p_input->>'expected_version')::integer;
      selected:=expected+1;
      select * into v from public.developer_skill_versions_v1
        where owner_id=p_owner and project_id=p_project and id=skill_id and version=selected;
      if found then
        if v.definition<>config then raise exception 'developer_skill_conflict'; end if;
        return jsonb_build_object('object','skill.definition')||(to_jsonb(v)-'owner_id');
      end if;
      if a.version<>expected then raise exception 'developer_skill_conflict'; end if;
    end if;
    if (select count(*) from public.developer_skill_versions_v1 where owner_id=p_owner)>=200
    then raise exception 'developer_skill_quota_exceeded'; end if;
    insert into public.developer_skill_versions_v1(project_id,id,version,owner_id,definition)
      values(p_project,skill_id,selected,p_owner,config) returning * into a;
  elsif a.id is null then
    raise exception 'developer_skill_not_found';
  elsif p_operation='delete' then
    delete from public.developer_skill_versions_v1 where owner_id=p_owner and project_id=p_project and id=skill_id;
    return jsonb_build_object('id',skill_id,'deleted',true);
  elsif p_operation='get' then
    if p_input ? 'version' then
      if jsonb_typeof(p_input->'version') is distinct from 'number'
        or (p_input->>'version')::numeric<>trunc((p_input->>'version')::numeric)
        or (p_input->>'version')::numeric not between 1 and 20
      then raise exception 'developer_skill_invalid'; end if;
      select * into a from public.developer_skill_versions_v1
        where owner_id=p_owner and project_id=p_project and id=skill_id and version=(p_input->>'version')::integer;
      if not found then raise exception 'developer_skill_not_found'; end if;
    end if;
  else raise exception 'developer_operation_invalid'; end if;
  return jsonb_build_object('object','skill.definition')||(to_jsonb(a)-'owner_id');
end $$;
revoke all on function public.manage_developer_skills_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_skills_v1(uuid,uuid,uuid,text,jsonb) to service_role;
create view public.developer_skill_export_records_v1 with(security_invoker=true) as
  select project_id,id,version,owner_id,definition,created_at from public.developer_skill_versions_v1;
revoke all on public.developer_skill_export_records_v1 from public,anon,authenticated;
grant select on public.developer_skill_export_records_v1 to service_role;
