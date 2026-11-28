-- Staged durable, explicitly authorized batch execution. No provider or financial work in SQL.
create table public.developer_batches_v1 (
  project_id uuid not null references public.developer_projects(id) on delete cascade,
  id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  api_key_id uuid not null references public.developer_billing_keys(id) on delete cascade,
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  resource_kind text not null default 'batch' check(resource_kind in ('batch','automation','response','research')),
  paused_at timestamptz,
  maximum_ticks bigint not null check(maximum_ticks between 1 and 100000000000000),
  request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  canceled_at timestamptz,
  primary key(project_id,id)
);
create table public.developer_batch_items_v1 (
  project_id uuid not null,
  batch_id uuid not null,
  id uuid not null,
  ordinal integer not null check(ordinal between 1 and 8),
  operation_kind text not null default 'chat/completions' check(operation_kind in ('chat/completions','agent-turns','responses','moderations','embeddings','decisions','search','analysis')),
  run_at timestamptz,
  input jsonb not null check(jsonb_typeof(input)='object' and octet_length(input::text)<=16384),
  "authorization" text not null check(length("authorization") between 1 and 2048),
  maximum_ticks bigint not null check(maximum_ticks between 1 and 100000000000000),
  request_group text not null check(request_group ~ '^[a-f0-9]{64}$'),
  state text not null default 'queued' check(state in ('queued','running','completed','uncertain','canceled')),
  lease_token uuid,
  lease_expires_at timestamptz,
  output jsonb check(output is null or (jsonb_typeof(output)='object' and octet_length(output::text)<=131072)),
  finished_at timestamptz,
  primary key(project_id,batch_id,id),
  unique(project_id,batch_id,ordinal),
  foreign key(project_id,batch_id) references public.developer_batches_v1(project_id,id) on delete cascade
);
create index developer_batches_owner_v1_idx on public.developer_batches_v1(owner_id,api_key_id,project_id);
create index developer_batches_expiry_v1_idx on public.developer_batches_v1(expires_at);
create index developer_batch_items_state_v1_idx on public.developer_batch_items_v1(state,lease_expires_at);
alter table public.developer_batches_v1 enable row level security;
alter table public.developer_batch_items_v1 enable row level security;
revoke all on public.developer_batches_v1,public.developer_batch_items_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.developer_batches_v1,public.developer_batch_items_v1 to service_role;

create function public.developer_batch_key_active_v1(p_owner uuid,p_project uuid,p_key uuid)
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
        and 'chat'=any(k.capabilities) and c.suspended_at is null
    )
$$;
revoke all on function public.developer_batch_key_active_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.developer_batch_key_active_v1(uuid,uuid,uuid) to service_role;

create function public.manage_developer_batches_v1(
  p_owner uuid,p_key uuid,p_project uuid,p_operation text,p_input jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  b public.developer_batches_v1%rowtype;
  item public.developer_batch_items_v1%rowtype;
  j jsonb;
  batch uuid;
  n integer:=0;
  budget bigint;
  total bigint:=0;
  deadline timestamptz;
  scheduled_at timestamptz;
  previous_at timestamptz;
  kind text;
  result jsonb;
begin
  if p_owner is null then raise exception 'developer_scope_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not public.developer_batch_key_active_v1(p_owner,p_project,p_key)
    then raise exception 'developer_scope_required' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>90000
    then raise exception 'developer_batch_invalid'; end if;
  kind:=coalesce(p_input->>'resource_kind','batch');
  if kind not in ('batch','automation','response','research') then raise exception 'developer_batch_invalid'; end if;
  if p_operation='list' then
    if kind='response' then
      select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id),'[]'::jsonb)
        into result from (
          select job.id,job.created_at,job.expires_at,i.state as status,i.finished_at
          from public.developer_batches_v1 job join public.developer_batch_items_v1 i
            on i.project_id=job.project_id and i.batch_id=job.id and i.id=job.id
          where job.owner_id=p_owner and job.project_id=p_project and job.api_key_id=p_key
            and job.resource_kind='response'
          order by job.created_at desc,job.id limit 20
        ) t;
      return jsonb_build_object('object','list','data',result);
    end if;
    select coalesce(jsonb_agg(to_jsonb(t)-'owner_id'-'request_digest' order by t.created_at desc,t.id),'[]'::jsonb) into result
      from (select * from public.developer_batches_v1 where owner_id=p_owner and project_id=p_project and api_key_id=p_key and resource_kind=kind order by created_at desc,id limit 20) t;
    return jsonb_build_object('object','list','data',result);
  end if;
  if coalesce(p_input->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then raise exception 'developer_batch_invalid'; end if;
  batch:=(p_input->>'id')::uuid;
  select * into b from public.developer_batches_v1 where owner_id=p_owner and project_id=p_project and api_key_id=p_key and id=batch and resource_kind=kind for update;
  if p_operation='replay' then
    if coalesce(p_input->>'request_digest','') !~ '^[a-f0-9]{64}$'
      then raise exception 'developer_batch_invalid'; end if;
    if b.id is null then
      if exists(select 1 from public.developer_batches_v1 where project_id=p_project and id=batch)
        then raise exception 'developer_batch_not_found'; end if;
      return jsonb_build_object('found',false);
    end if;
    if b.request_digest<>p_input->>'request_digest'
      then raise exception 'developer_batch_conflict'; end if;
    return jsonb_build_object('found',true,'batch',
      jsonb_build_object('object','batch')||(to_jsonb(b)-'owner_id'-'request_digest'));
  elsif p_operation='create' then
    if b.id is not null then
      if b.request_digest<>p_input->>'request_digest' then raise exception 'developer_batch_conflict'; end if;
      return jsonb_build_object('object','batch')||(to_jsonb(b)-'owner_id'-'request_digest');
    end if;
    if exists(select 1 from public.developer_batches_v1 where project_id=p_project and id=batch)
      then raise exception 'developer_batch_not_found'; end if;
    if (select count(*) from public.developer_batches_v1 where owner_id=p_owner)>=10
      then raise exception 'developer_batch_quota_exceeded'; end if;
    if coalesce(p_input->>'request_digest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_input->>'currency','') !~ '^[A-Z]{3}$'
      or not exists(select 1 from public.developer_billing_keys k join public.developer_credit_accounts c on c.id=k.account_id where k.id=p_key and c.currency=p_input->>'currency')
      or jsonb_typeof(p_input->'maximum_ticks') is distinct from 'number'
      or coalesce(p_input->>'maximum_ticks','') !~ '^[1-9][0-9]{0,14}$'
      or jsonb_typeof(p_input->'items') is distinct from 'array'
      or jsonb_array_length(p_input->'items') not between 1 and 8
      or (kind='response' and jsonb_array_length(p_input->'items')<>1)
      or (kind='research' and jsonb_array_length(p_input->'items') not between 1 and 4)
    then raise exception 'developer_batch_invalid'; end if;
    budget:=(p_input->>'maximum_ticks')::bigint;
    deadline:=(p_input->>'expires_at')::timestamptz;
    if budget>100000000000000 or deadline is null or deadline<=now() or deadline>now()+interval '24 hours'
      then raise exception 'developer_batch_invalid'; end if;
    insert into public.developer_batches_v1(project_id,id,owner_id,api_key_id,currency,maximum_ticks,request_digest,expires_at,resource_kind)
      values(p_project,batch,p_owner,p_key,p_input->>'currency',budget,p_input->>'request_digest',deadline,kind) returning * into b;
    for j in select value from jsonb_array_elements(p_input->'items') loop
      if coalesce(j->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(j->>'maximum_ticks','') !~ '^[1-9][0-9]{0,14}$'
        or jsonb_typeof(j->'maximum_ticks') is distinct from 'number'
        or coalesce(j->>'operation_kind','chat/completions') not in ('chat/completions','agent-turns','responses','moderations','embeddings','decisions','search','analysis')
        or (kind='response' and (j->>'id' is distinct from batch::text or j->>'operation_kind' is distinct from 'responses'))
        or (kind='research' and (j->>'operation_kind' is distinct from 'search'
          or (jsonb_array_length(p_input->'items')=1 and (j->'input'->'research' is distinct from 'true'::jsonb
            or jsonb_typeof(j->'input'->'max_tool_calls') is distinct from 'number'
            or coalesce(j->'input'->>'max_tool_calls','') not in ('2','3')))
          or (jsonb_array_length(p_input->'items')>1 and j->'input' ? 'research')))
        or (kind<>'research' and j->'input' ? 'research')
        or coalesce(j->>'request_group','') !~ '^[a-f0-9]{64}$'
        or length(coalesce(j->>'authorization','')) not between 1 and 2048
        or jsonb_typeof(j->'input') is distinct from 'object'
        or octet_length((j->'input')::text)>16384
      then raise exception 'developer_batch_invalid'; end if;
      n:=n+1; total:=total+(j->>'maximum_ticks')::bigint;
      if total>budget then raise exception 'developer_batch_budget_invalid'; end if;
      scheduled_at:=null;
      if kind='automation' then
        if jsonb_typeof(j->'run_at') is distinct from 'string' then raise exception 'developer_batch_invalid'; end if;
        scheduled_at:=(j->>'run_at')::timestamptz;
        if scheduled_at is null or scheduled_at<=now() or scheduled_at>=deadline
          or (previous_at is not null and scheduled_at<=previous_at)
        then raise exception 'developer_batch_invalid'; end if;
        previous_at:=scheduled_at;
      elsif j ? 'run_at' then raise exception 'developer_batch_invalid'; end if;
      insert into public.developer_batch_items_v1(project_id,batch_id,id,ordinal,input,"authorization",maximum_ticks,request_group,run_at,operation_kind)
        values(p_project,batch,(j->>'id')::uuid,n,j->'input',j->>'authorization',(j->>'maximum_ticks')::bigint,j->>'request_group',scheduled_at,coalesce(j->>'operation_kind','chat/completions'));
    end loop;
    return jsonb_build_object('object','batch')||(to_jsonb(b)-'owner_id'-'request_digest');
  elsif b.id is null then raise exception 'developer_batch_not_found';
  elsif p_operation='cancel' then
    update public.developer_batches_v1 set canceled_at=coalesce(canceled_at,clock_timestamp())
      where project_id=p_project and id=batch returning * into b;
    update public.developer_batch_items_v1 set state='canceled',finished_at=clock_timestamp()
      where project_id=p_project and batch_id=batch and state='queued';
    return jsonb_build_object('id',batch,'canceled_at',b.canceled_at);
  elsif p_operation in ('pause','resume') then
    if kind<>'automation' or b.canceled_at is not null or b.expires_at<=now() then raise exception 'developer_batch_conflict'; end if;
    update public.developer_batches_v1 set paused_at=case when p_operation='pause' then coalesce(paused_at,clock_timestamp()) else null end
      where project_id=p_project and id=batch returning * into b;
    return jsonb_build_object('id',batch,'paused_at',b.paused_at);
  elsif p_operation='get' then
    if kind='research' then
      select coalesce(jsonb_agg(to_jsonb(t) order by t.ordinal),'[]'::jsonb) into result from (
        select i.id,i.ordinal,i.operation_kind,i.state,i.input->>'query' as query,coalesce(i.input->'research'='true'::jsonb,false) as autonomous,r.id as request_id,r.settlement_state,r.final_customer_charge,
          case when i.state='completed' and r.settlement_state='settled' then i.output else null end as output
        from public.developer_batch_items_v1 i left join lateral (
          select r.id,r.settlement_state,r.final_customer_charge from public.developer_api_requests r
          where r.api_key_id=b.api_key_id and r.project_id=b.project_id and r.request_group=i.request_group order by r.created_at,r.id limit 1
        ) r on true where i.project_id=p_project and i.batch_id=batch
      ) t;
      return jsonb_build_object('object','research.run','items',result)||(to_jsonb(b)-'owner_id'-'request_digest');
    end if;
    select coalesce(jsonb_agg(to_jsonb(t) order by t.ordinal),'[]'::jsonb) into result from (
      select i.id,i.ordinal,i.operation_kind,i.state,i.maximum_ticks,i.run_at,i.finished_at,r.id as request_id,r.settlement_state,r.final_customer_charge
      from public.developer_batch_items_v1 i left join public.developer_api_requests r
        on r.api_key_id=b.api_key_id and r.project_id=b.project_id and r.request_group=i.request_group
      where i.project_id=p_project and i.batch_id=batch
    ) t;
    return jsonb_build_object('object','batch','items',result)||(to_jsonb(b)-'owner_id'-'request_digest');
  elsif p_operation='get_item' then
    if kind='research' then raise exception 'developer_batch_invalid'; end if;
    if coalesce(p_input->>'item_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then raise exception 'developer_batch_invalid'; end if;
    select * into item from public.developer_batch_items_v1 where project_id=p_project and batch_id=batch and id=(p_input->>'item_id')::uuid;
    if not found then raise exception 'developer_batch_not_found'; end if;
    select jsonb_build_object('request_id',r.id,'settlement_state',r.settlement_state,'final_customer_charge',r.final_customer_charge)
      into result from public.developer_api_requests r where r.api_key_id=b.api_key_id and r.project_id=b.project_id and r.request_group=item.request_group
      order by r.created_at,r.id limit 1;
    return jsonb_build_object('object','batch.item')||(to_jsonb(item)-'authorization'-'lease_token'-'lease_expires_at')||coalesce(result,'{}'::jsonb);
  else raise exception 'developer_operation_invalid'; end if;
end $$;
revoke all on function public.manage_developer_batches_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_developer_batches_v1(uuid,uuid,uuid,text,jsonb) to service_role;

create function public.claim_developer_batch_v1(p_allow_automations boolean default false,p_allow_responses boolean default false,p_allow_research boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.developer_batches_v1%rowtype; item public.developer_batch_items_v1%rowtype;
begin
  -- A claimed item is never automatically re-executed, even after a crash.
  update public.developer_batch_items_v1 i set state='uncertain',lease_token=null,lease_expires_at=null,finished_at=clock_timestamp()
    where (i.project_id,i.batch_id,i.id) in (select project_id,batch_id,id from public.developer_batch_items_v1
      where state='running' and lease_expires_at<=clock_timestamp() order by lease_expires_at limit 100 for update skip locked)
      and i.state='running' and i.lease_expires_at<=clock_timestamp();
  update public.developer_batch_items_v1 i set state='canceled',finished_at=clock_timestamp()
    where (i.project_id,i.batch_id,i.id) in (
      select x.project_id,x.batch_id,x.id from public.developer_batch_items_v1 x
      join public.developer_batches_v1 j on j.project_id=x.project_id and j.id=x.batch_id
      where x.state='queued' and (j.expires_at<=now() or j.canceled_at is not null
        or not public.developer_batch_key_active_v1(j.owner_id,j.project_id,j.api_key_id))
      order by j.expires_at,x.ordinal limit 100 for update of x skip locked)
      and i.state='queued';
  delete from public.developer_batches_v1 j where (j.project_id,j.id) in (
    select project_id,id from public.developer_batches_v1 where expires_at<now()-interval '7 days' order by expires_at limit 20 for update skip locked);
  select * into b from public.developer_batches_v1 j
    where j.canceled_at is null and j.paused_at is null and j.expires_at>now()
      and (j.resource_kind='batch' or (j.resource_kind='automation' and p_allow_automations is true)
        or (j.resource_kind='response' and p_allow_responses is true)
        or (j.resource_kind='research' and p_allow_research is true))
      and public.developer_batch_key_active_v1(j.owner_id,j.project_id,j.api_key_id)
      and exists(select 1 from public.developer_batch_items_v1 x where x.project_id=j.project_id and x.batch_id=j.id and x.state='queued' and (x.run_at is null or x.run_at<=now()))
      and not exists(select 1 from public.developer_batch_items_v1 x where x.project_id=j.project_id and x.batch_id=j.id and x.state='running')
    order by j.created_at,j.id limit 1 for update of j skip locked;
  if not found then return null; end if;
  select * into item from public.developer_batch_items_v1
    where project_id=b.project_id and batch_id=b.id and state='queued' and (run_at is null or run_at<=now()) order by ordinal limit 1 for update;
  if not found then return null; end if;
  update public.developer_batch_items_v1 set state='running',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '180 seconds'
    where project_id=b.project_id and batch_id=b.id and id=item.id returning * into item;
  return jsonb_build_object('owner_id',b.owner_id,'api_key_id',b.api_key_id,'currency',b.currency,'item',to_jsonb(item));
end $$;
revoke all on function public.claim_developer_batch_v1(boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_developer_batch_v1(boolean,boolean,boolean) to service_role;

-- Revalidate the claim immediately before dispatch; never revive an expired lease.
create function public.validate_developer_batch_claim_v1(p_project uuid,p_batch uuid,p_item uuid,p_lease uuid)
returns boolean language sql volatile security invoker set search_path='' as $$
  select exists(select 1 from public.developer_batch_items_v1 i
    join public.developer_batches_v1 b on b.project_id=i.project_id and b.id=i.batch_id
    where i.project_id=p_project and i.batch_id=p_batch and i.id=p_item
      and i.state='running' and i.lease_token=p_lease and i.lease_expires_at>clock_timestamp()
      and b.canceled_at is null and b.expires_at>clock_timestamp()
      and public.developer_batch_key_active_v1(b.owner_id,b.project_id,b.api_key_id))
$$;
revoke all on function public.validate_developer_batch_claim_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.validate_developer_batch_claim_v1(uuid,uuid,uuid,uuid) to service_role;

create function public.finish_developer_batch_v1(p_project uuid,p_batch uuid,p_item uuid,p_lease uuid,p_output jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.developer_batches_v1%rowtype; item public.developer_batch_items_v1%rowtype; settled boolean;
begin
  select * into b from public.developer_batches_v1 where project_id=p_project and id=p_batch for update;
  if not found then return false; end if;
  select * into item from public.developer_batch_items_v1
    where project_id=p_project and batch_id=p_batch and id=p_item and state='running' and lease_token=p_lease and lease_expires_at>clock_timestamp() for update;
  if not found then return false; end if;
  if p_output is not null and (jsonb_typeof(p_output)<>'object' or octet_length(p_output::text)>131072) then return false; end if;
  select exists(select 1 from public.developer_api_requests r
    where r.api_key_id=b.api_key_id and r.project_id=b.project_id and r.request_group=item.request_group
      and r.settlement_state='settled') into settled;
  update public.developer_batch_items_v1 set
    state=case when p_output is not null and settled then 'completed' else 'uncertain' end,
    output=case when settled then p_output else null end,lease_token=null,lease_expires_at=null,finished_at=clock_timestamp()
    where project_id=p_project and batch_id=p_batch and id=p_item;
  return found;
end $$;
revoke all on function public.finish_developer_batch_v1(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_developer_batch_v1(uuid,uuid,uuid,uuid,jsonb) to service_role;

create view public.developer_batch_export_records_v1 with(security_invoker=true) as
  select b.owner_id,b.project_id,b.id as batch_id,b.api_key_id,b.currency,b.maximum_ticks,b.created_at,b.expires_at,b.canceled_at,b.resource_kind,b.paused_at,
    i.id as item_id,i.operation_kind,i.run_at,i.input,i.output,i.state,i.finished_at
  from public.developer_batches_v1 b join public.developer_batch_items_v1 i on i.project_id=b.project_id and i.batch_id=b.id;
revoke all on public.developer_batch_export_records_v1 from public,anon,authenticated;
grant select on public.developer_batch_export_records_v1 to service_role;
