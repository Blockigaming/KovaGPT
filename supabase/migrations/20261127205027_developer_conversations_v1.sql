-- Staged, service-only conversation state. No provider calls or implicit inference.
create table public.developer_conversations_v1 (
  project_id uuid not null references public.developer_projects(id) on delete cascade,
  id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(octet_length(title) between 1 and 160),
  revision integer not null default 0 check(revision between 0 and 200),
  items jsonb not null default '[]'::jsonb
    check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=100 and octet_length(items::text)<=49152),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 days',
  primary key(project_id,id),
  check(expires_at>created_at)
);
create index developer_conversations_owner_v1_idx on public.developer_conversations_v1(owner_id,project_id);
create index developer_conversations_expiry_v1_idx on public.developer_conversations_v1(expires_at,id);
alter table public.developer_conversations_v1 enable row level security;
revoke all on public.developer_conversations_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.developer_conversations_v1 to service_role;

create function public.manage_developer_conversations_v1(
  p_owner uuid,p_key uuid,p_project uuid,p_operation text,p_input jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  c public.developer_conversations_v1%rowtype;
  item jsonb;
  existing jsonb;
  target text;
  item_position integer;
  next_items jsonb;
  active_items jsonb;
  result jsonb;
  expected integer;
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
      and ('chat'=any(k.capabilities) or 'streaming'=any(k.capabilities))
      and acct.suspended_at is null
  ) then raise exception 'developer_scope_required' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>65536
  then raise exception 'developer_conversation_invalid'; end if;
  delete from public.developer_conversations_v1 where owner_id=p_owner and expires_at<=now();

  if p_operation='list' then
    select coalesce(jsonb_agg(to_jsonb(t)-'owner_id'-'items' order by t.updated_at desc,t.id),'[]'::jsonb)
      into result from public.developer_conversations_v1 t
      where t.owner_id=p_owner and t.project_id=p_project;
    return jsonb_build_object('object','list','data',result);
  end if;
  if coalesce(p_input->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then raise exception 'developer_conversation_invalid'; end if;
  select * into c from public.developer_conversations_v1
    where project_id=p_project and id=(p_input->>'id')::uuid and owner_id=p_owner for update;
  if p_operation='create' then
    if jsonb_typeof(p_input->'title') is distinct from 'string'
      or octet_length(btrim(p_input->>'title')) not between 1 and 160
    then raise exception 'developer_conversation_invalid'; end if;
    if found then
      if c.title<>btrim(p_input->>'title') then raise exception 'developer_conversation_conflict'; end if;
    else
      if (select count(*) from public.developer_conversations_v1 where owner_id=p_owner)>=50
      then raise exception 'developer_conversation_quota_exceeded'; end if;
      insert into public.developer_conversations_v1(project_id,id,owner_id,title)
        values(p_project,(p_input->>'id')::uuid,p_owner,btrim(p_input->>'title')) returning * into c;
    end if;
  elsif not found then
    raise exception 'developer_conversation_not_found';
  elsif p_operation='delete' then
    delete from public.developer_conversations_v1 where project_id=p_project and id=c.id and owner_id=p_owner;
    return jsonb_build_object('id',c.id,'deleted',true);
  elsif p_operation in ('append','remove','get_item') then
    item:=p_input->'item';
    target:=case when p_operation='append' then item->>'id' else p_input->>'item_id' end;
    if coalesce(target,'') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then raise exception 'developer_conversation_invalid'; end if;
    select elem,(ord-1)::integer into existing,item_position
      from jsonb_array_elements(c.items) with ordinality as a(elem,ord)
      where elem->>'id'=target;
    if p_operation='get_item' then
      if existing is null or existing @> '{"deleted":true}'::jsonb
      then raise exception 'developer_conversation_not_found'; end if;
      return jsonb_build_object('object','conversation.item','conversation_id',c.id,'revision',c.revision,'item',existing);
    end if;
    if p_operation='append' then
      if jsonb_typeof(item) is distinct from 'object'
        or item - 'id' - 'role' - 'content' <> '{}'::jsonb
        or coalesce(item->>'role','') not in ('user','assistant','developer','system')
        or jsonb_typeof(item->'content') is distinct from 'string'
        or octet_length(item->>'content') not between 1 and 8192
        or length(btrim(item->>'content'))=0
      then raise exception 'developer_conversation_invalid'; end if;
      if existing is not null then
        if existing<>item then raise exception 'developer_conversation_conflict'; end if;
        -- Stable item IDs make retries safe even after later successful appends.
        return jsonb_build_object('object','conversation.item','conversation_id',c.id,'revision',c.revision,'item',existing);
      end if;
      if jsonb_array_length(c.items)>=100 then raise exception 'developer_conversation_quota_exceeded'; end if;
      next_items:=c.items||jsonb_build_array(item);
    else
      if existing is null then raise exception 'developer_conversation_not_found'; end if;
      if existing @> '{"deleted":true}'::jsonb then
        return jsonb_build_object('conversation_id',c.id,'revision',c.revision,'id',target,'deleted',true);
      end if;
      -- Keep only the identifier as a retry fence; erase removed message content.
      next_items:=jsonb_set(c.items,array[item_position::text],jsonb_build_object('id',target,'deleted',true));
    end if;
    if jsonb_typeof(p_input->'expected_revision') is distinct from 'number'
      or (p_input->>'expected_revision')::numeric<>trunc((p_input->>'expected_revision')::numeric)
      or (p_input->>'expected_revision')::numeric not between 0 and 200
    then raise exception 'developer_conversation_invalid'; end if;
    expected:=(p_input->>'expected_revision')::integer;
    if c.revision<>expected then raise exception 'developer_conversation_conflict'; end if;
    if octet_length(next_items::text)>49152 or c.revision>=200
    then raise exception 'developer_conversation_quota_exceeded'; end if;
    update public.developer_conversations_v1 set items=next_items,revision=revision+1,updated_at=clock_timestamp()
      where project_id=p_project and id=c.id and owner_id=p_owner returning * into c;
    if p_operation='remove' then
      return jsonb_build_object('conversation_id',c.id,'revision',c.revision,'id',target,'deleted',true);
    end if;
    return jsonb_build_object('object','conversation.item','conversation_id',c.id,'revision',c.revision,'item',item);
  elsif p_operation<>'get' then
    raise exception 'developer_operation_invalid';
  end if;
  select coalesce(jsonb_agg(elem order by ord),'[]'::jsonb) into active_items
    from jsonb_array_elements(c.items) with ordinality as a(elem,ord)
    where not (elem @> '{"deleted":true}'::jsonb);
  return jsonb_build_object('object','conversation','items',active_items)||(to_jsonb(c)-'owner_id'-'items');
end $$;
revoke all on function public.manage_developer_conversations_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_conversations_v1(uuid,uuid,uuid,text,jsonb) to service_role;

create function public.expire_developer_conversations_v1(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare own uuid; removed integer;
begin
  select owner_id into own from public.developer_conversations_v1 where expires_at<=now() order by expires_at,id limit 1;
  if own is null then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended(own::text,20260903204500));
  delete from public.developer_conversations_v1 c where (c.project_id,c.id) in(
    select project_id,id from public.developer_conversations_v1
    where owner_id=own and expires_at<=now() order by expires_at,id limit least(greatest(p_limit,1),100));
  get diagnostics removed=row_count;
  return removed;
end $$;
revoke all on function public.expire_developer_conversations_v1(integer) from public,anon,authenticated;
grant execute on function public.expire_developer_conversations_v1(integer) to service_role;
create view public.developer_conversation_export_records_v1 with(security_invoker=true) as
  select project_id,id,owner_id,title,revision,created_at,updated_at,expires_at,items
  from public.developer_conversations_v1 where expires_at>now();
revoke all on public.developer_conversation_export_records_v1 from public,anon,authenticated;
grant select on public.developer_conversation_export_records_v1 to service_role;
