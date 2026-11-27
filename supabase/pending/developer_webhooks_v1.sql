-- Staged source: asynchronous, key-scoped notifications of terminal billing records.
-- Delivery failure never participates in a financial settlement transaction.
create table public.developer_webhook_endpoints_v1 (
  project_id uuid not null references public.developer_projects(id) on delete cascade,
  id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  api_key_id uuid not null references public.developer_billing_keys(id) on delete cascade,
  url text not null check(length(url) between 9 and 1024 and url like 'https://%'),
  events text[] not null check(cardinality(events) between 1 and 2 and events <@ array['request.settled','request.rejected']),
  generation integer not null default 1 check(generation between 1 and 1000),
  secret_nonce uuid not null default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  primary key(project_id,id)
);
create table public.developer_webhook_deliveries_v1 (
  project_id uuid not null,
  endpoint_id uuid not null,
  id uuid not null default gen_random_uuid(),
  request_id uuid references public.developer_api_requests(id),
  event_type text not null check(event_type in ('request.settled','request.rejected','webhook.test')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
  status text not null default 'pending' check(status in ('pending','leased','delivered','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  http_status integer check(http_status between 100 and 599),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  primary key(project_id,endpoint_id,id),
  foreign key(project_id,endpoint_id) references public.developer_webhook_endpoints_v1(project_id,id) on delete cascade,
  unique(project_id,endpoint_id,request_id,event_type)
);
create index developer_webhook_owner_v1_idx on public.developer_webhook_endpoints_v1(owner_id,project_id,api_key_id);
create index developer_webhook_due_v1_idx on public.developer_webhook_deliveries_v1(next_attempt_at,created_at) where status in ('pending','leased');
create index developer_webhook_expiry_v1_idx on public.developer_webhook_deliveries_v1(created_at);
create index developer_webhook_requests_v1_idx on public.developer_api_requests(api_key_id,settled_at,id)
  where settlement_state in ('settled','rejected');
alter table public.developer_webhook_endpoints_v1 enable row level security;
alter table public.developer_webhook_deliveries_v1 enable row level security;
revoke all on public.developer_webhook_endpoints_v1,public.developer_webhook_deliveries_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.developer_webhook_endpoints_v1,public.developer_webhook_deliveries_v1 to service_role;

-- Service-only authority; rechecked for registration and every delivery claim.
create function public.developer_webhook_key_active_v1(p_owner uuid,p_project uuid,p_key uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select p_owner is not null and kova_private.auth_user_exists(p_owner)
    and not exists(select 1 from public.account_deletion_fences where user_id=p_owner)
    and not exists(select 1 from public.banned_users where user_id=p_owner)
    and not exists(select 1 from public.user_preferences where user_id=p_owner and coalesce((settings->>'lockdown_mode')::boolean,false))
    and exists(
      select 1 from public.developer_billing_keys k
      join public.developer_account_owners a on a.account_id=k.account_id
      join public.developer_projects p on p.id=k.project_id and p.account_id=k.account_id
      join public.developer_credit_accounts c on c.id=k.account_id
      where k.id=p_key and p.id=p_project and a.owner_id=p_owner
        and k.enabled and k.revoked_at is null and k.expires_at>now()
        and cardinality(k.capabilities)>0 and c.suspended_at is null
    )
$$;
revoke all on function public.developer_webhook_key_active_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.developer_webhook_key_active_v1(uuid,uuid,uuid) to service_role;

create function public.manage_developer_webhooks_v1(
  p_owner uuid,p_key uuid,p_project uuid,p_operation text,p_input jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  e public.developer_webhook_endpoints_v1%rowtype;
  d public.developer_webhook_deliveries_v1%rowtype;
  endpoint uuid;
  requested_events text[];
  expected integer;
  result jsonb;
begin
  if p_owner is null then raise exception 'developer_scope_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not public.developer_webhook_key_active_v1(p_owner,p_project,p_key)
    then raise exception 'developer_scope_required' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>8192
    then raise exception 'developer_webhook_invalid'; end if;
  if p_operation='list' then
    select coalesce(jsonb_agg(to_jsonb(t)-'owner_id'-'secret_nonce' order by t.created_at,t.id),'[]'::jsonb)
      into result from public.developer_webhook_endpoints_v1 t
      where t.owner_id=p_owner and t.project_id=p_project and t.api_key_id=p_key;
    return jsonb_build_object('object','list','data',result);
  end if;
  if coalesce(p_input->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then raise exception 'developer_webhook_invalid'; end if;
  endpoint:=(p_input->>'id')::uuid;
  select * into e from public.developer_webhook_endpoints_v1
    where project_id=p_project and id=endpoint and owner_id=p_owner and api_key_id=p_key for update;
  if p_operation='create' then
    if jsonb_typeof(p_input->'url') is distinct from 'string'
      or length(p_input->>'url') not between 9 and 1024 or p_input->>'url' not like 'https://%'
      or jsonb_typeof(p_input->'events') is distinct from 'array'
    then raise exception 'developer_webhook_invalid'; end if;
    select array_agg(x order by x) into requested_events from jsonb_array_elements_text(p_input->'events') as t(x);
    if coalesce(cardinality(requested_events),0) not between 1 and 2
      or not requested_events <@ array['request.settled','request.rejected']
      or cardinality(requested_events)<>(select count(distinct x) from unnest(requested_events) as t(x))
    then raise exception 'developer_webhook_invalid'; end if;
    if e.id is not null then
      if e.url<>p_input->>'url' or e.events<>requested_events then raise exception 'developer_webhook_conflict'; end if;
    else
      if exists(select 1 from public.developer_webhook_endpoints_v1 where project_id=p_project and id=endpoint)
        then raise exception 'developer_webhook_not_found'; end if;
      if (select count(*) from public.developer_webhook_endpoints_v1 where owner_id=p_owner)>=20
        or (select count(*) from public.developer_webhook_endpoints_v1 where api_key_id=p_key)>=5
        then raise exception 'developer_webhook_quota_exceeded'; end if;
      insert into public.developer_webhook_endpoints_v1(project_id,id,owner_id,api_key_id,url,events)
        values(p_project,endpoint,p_owner,p_key,p_input->>'url',requested_events) returning * into e;
    end if;
    return jsonb_build_object('object','webhook.endpoint')||(to_jsonb(e)-'owner_id');
  elsif e.id is null then raise exception 'developer_webhook_not_found';
  elsif p_operation='get' then
    return jsonb_build_object('object','webhook.endpoint')||(to_jsonb(e)-'owner_id'-'secret_nonce');
  elsif p_operation='delete' then
    delete from public.developer_webhook_endpoints_v1 where project_id=p_project and id=e.id;
    return jsonb_build_object('id',e.id,'deleted',true);
  elsif p_operation='rotate' then
    if jsonb_typeof(p_input->'expected_generation') is distinct from 'number'
      or (p_input->>'expected_generation')::numeric<>trunc((p_input->>'expected_generation')::numeric)
      or (p_input->>'expected_generation')::numeric not between 1 and 999
    then raise exception 'developer_webhook_invalid'; end if;
    expected:=(p_input->>'expected_generation')::integer;
    if e.generation=expected then
      update public.developer_webhook_endpoints_v1 set generation=generation+1
        where project_id=p_project and id=e.id returning * into e;
    elsif e.generation<>expected+1 then raise exception 'developer_webhook_conflict';
    end if;
    return jsonb_build_object('object','webhook.endpoint')||(to_jsonb(e)-'owner_id');
  elsif p_operation='deliveries' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id),'[]'::jsonb) into result
      from (select id,event_type,status,attempts,http_status,created_at,finished_at
        from public.developer_webhook_deliveries_v1 where project_id=p_project and endpoint_id=e.id
        order by created_at desc,id limit 50) t;
    return jsonb_build_object('object','list','data',result);
  elsif p_operation='test' then
    if coalesce(p_input->>'event_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then raise exception 'developer_webhook_invalid'; end if;
    select * into d from public.developer_webhook_deliveries_v1
      where project_id=p_project and endpoint_id=e.id and id=(p_input->>'event_id')::uuid;
    if d.id is null then
      if (select count(*) from public.developer_webhook_deliveries_v1 where project_id=p_project and endpoint_id=e.id
        and event_type='webhook.test' and created_at>now()-interval '1 day')>=20
        then raise exception 'developer_webhook_quota_exceeded'; end if;
      insert into public.developer_webhook_deliveries_v1(project_id,endpoint_id,id,event_type,payload)
        values(p_project,e.id,(p_input->>'event_id')::uuid,'webhook.test','{"test":true}'::jsonb) returning * into d;
    elsif d.event_type<>'webhook.test' then raise exception 'developer_webhook_conflict';
    end if;
    return jsonb_build_object('id',d.id,'status',d.status);
  else raise exception 'developer_operation_invalid'; end if;
end $$;
revoke all on function public.manage_developer_webhooks_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_webhooks_v1(uuid,uuid,uuid,text,jsonb) to service_role;

create function public.claim_developer_webhooks_v1(p_limit integer default 3)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  -- Bounded retention and lease recovery; terminal events have a seven-day
  -- discovery window and an eight-day deduplication window.
  delete from public.developer_webhook_deliveries_v1 d where (d.project_id,d.endpoint_id,d.id) in
    (select project_id,endpoint_id,id from public.developer_webhook_deliveries_v1
      where created_at<now()-interval '8 days' order by created_at limit 100);
  update public.developer_webhook_deliveries_v1 d set status='failed',lease_token=null,lease_expires_at=null,finished_at=clock_timestamp()
    where (d.project_id,d.endpoint_id,d.id) in(
      select project_id,endpoint_id,id from public.developer_webhook_deliveries_v1
      where status='leased' and attempts>=5 and lease_expires_at<=now() order by created_at limit 100);
  insert into public.developer_webhook_deliveries_v1(project_id,endpoint_id,request_id,event_type,payload)
    select e.project_id,e.id,r.id,'request.'||r.settlement_state,
      jsonb_build_object('request_id',r.id,'model',r.public_model,'capability',r.capability,
        'state',r.settlement_state,'currency',r.currency,'final_charge',r.final_customer_charge)
    from public.developer_webhook_endpoints_v1 e
    join public.developer_api_requests r on r.api_key_id=e.api_key_id and r.project_id=e.project_id
    where r.settlement_state in ('settled','rejected') and ('request.'||r.settlement_state)=any(e.events)
      and r.created_at>=e.created_at and r.settled_at>=now()-interval '7 days'
      and public.developer_webhook_key_active_v1(e.owner_id,e.project_id,e.api_key_id)
      and not exists(select 1 from public.developer_webhook_deliveries_v1 d
        where d.project_id=e.project_id and d.endpoint_id=e.id and d.request_id=r.id and d.event_type='request.'||r.settlement_state)
    order by r.settled_at,r.id,e.id limit 50
    on conflict(project_id,endpoint_id,request_id,event_type) do nothing;

  with due as (
    select d.project_id,d.endpoint_id,d.id from public.developer_webhook_deliveries_v1 d
      join public.developer_webhook_endpoints_v1 e on e.project_id=d.project_id and e.id=d.endpoint_id
    where d.attempts<5 and d.created_at>=now()-interval '7 days'
      and ((d.status='pending' and d.next_attempt_at<=now()) or (d.status='leased' and d.lease_expires_at<=now()))
      and public.developer_webhook_key_active_v1(e.owner_id,e.project_id,e.api_key_id)
    order by d.next_attempt_at,d.created_at,d.id limit least(greatest(coalesce(p_limit,3),1),5)
    for update of d skip locked
  ), claimed as (
    update public.developer_webhook_deliveries_v1 d
      set status='leased',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds'
    from due where d.project_id=due.project_id and d.endpoint_id=due.endpoint_id and d.id=due.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'endpoint',to_jsonb(e)-'owner_id',
    'event',jsonb_build_object('id',d.id,'type',d.event_type,'created_at',d.created_at,'data',d.payload),
    'lease_token',d.lease_token
  )),'[]'::jsonb) into result
  from claimed d join public.developer_webhook_endpoints_v1 e on e.project_id=d.project_id and e.id=d.endpoint_id;
  return result;
end $$;
revoke all on function public.claim_developer_webhooks_v1(integer) from public,anon,authenticated;
grant execute on function public.claim_developer_webhooks_v1(integer) to service_role;

create function public.finish_developer_webhook_v1(p_project uuid,p_endpoint uuid,p_event uuid,p_lease uuid,p_http_status integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_http_status is not null and p_http_status not between 100 and 599 then return false; end if;
  update public.developer_webhook_deliveries_v1 set
    status=case when p_http_status between 200 and 299 then 'delivered' when attempts>=5 then 'failed' else 'pending' end,
    http_status=p_http_status,lease_token=null,lease_expires_at=null,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),
    finished_at=case when p_http_status between 200 and 299 or attempts>=5 then clock_timestamp() else null end
  where project_id=p_project and endpoint_id=p_endpoint and id=p_event and status='leased' and lease_token=p_lease;
  return found;
end $$;
revoke all on function public.finish_developer_webhook_v1(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.finish_developer_webhook_v1(uuid,uuid,uuid,uuid,integer) to service_role;

create view public.developer_webhook_export_records_v1 with(security_invoker=true) as
  select e.owner_id,e.project_id,e.id as endpoint_id,e.api_key_id,e.url,e.events,e.generation,e.created_at,
    d.id as event_id,d.event_type,d.payload,d.status,d.attempts,d.http_status,d.finished_at
  from public.developer_webhook_endpoints_v1 e left join public.developer_webhook_deliveries_v1 d
    on d.project_id=e.project_id and d.endpoint_id=e.id;
revoke all on public.developer_webhook_export_records_v1 from public,anon,authenticated;
grant select on public.developer_webhook_export_records_v1 to service_role;
