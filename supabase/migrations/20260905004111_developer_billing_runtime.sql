-- Source only. No keys, prices, limits, funding or activation are seeded.
create table public.developer_billing_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.developer_credit_accounts(id),
  project_id uuid not null,
  enabled boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  capabilities text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table public.developer_billing_limits (
  account_id uuid not null references public.developer_credit_accounts(id),
  scope_type text not null check(scope_type in ('organization','project','key')),
  scope_id uuid not null,
  request_limit numeric(20,8) not null check(request_limit > 0 and request_limit <= 1000000000),
  daily_limit numeric(20,8) not null check(daily_limit >= request_limit and daily_limit <= 1000000000),
  monthly_limit numeric(20,8) not null check(monthly_limit >= daily_limit and monthly_limit <= 1000000000),
  concurrent_limit integer not null check(concurrent_limit between 1 and 100),
  primary key(account_id,scope_type,scope_id)
);
create table public.developer_billing_alerts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.developer_api_requests(id),
  reason text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique(request_id,reason)
);
alter table public.developer_api_requests
  add column request_fingerprint text,
  add column request_group text,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column dispatched_at timestamptz,
  add column provider_response_id text;
create index developer_requests_scope_budget_idx on public.developer_api_requests(account_id,created_at)
  include(project_id,api_key_id,settlement_state,maximum_reserved_charge,final_customer_charge);
create index developer_requests_lease_idx on public.developer_api_requests(lease_expires_at)
  where settlement_state in ('reserved','dispatched');
create unique index developer_credit_terminal_once_idx on public.developer_credit_ledger(request_id,entry_type)
  where request_id is not null and entry_type in ('reserve','release','settle');

create function public.admit_developer_billing(
  p_key uuid,p_request_key text,p_fingerprint text,p_provider text,p_model text,
  p_capability text,p_version uuid,p_quote jsonb,p_limits jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  k public.developer_billing_keys%rowtype; a public.developer_credit_accounts%rowtype;
  v public.api_pricing_versions%rowtype; r public.developer_api_requests%rowtype;
  b public.developer_billing_limits%rowtype; scope_name text; scope_uuid uuid;
  amount numeric; used_group numeric; used_day numeric; used_month numeric; inflight integer;
  new_id uuid := gen_random_uuid(); lease uuid := gen_random_uuid();
begin
  -- One lock order across admission/dispatch/settlement/recovery makes scope budgets atomic.
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  if length(p_request_key) not between 1 and 160 or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'developer_request_invalid';
  end if;
  select * into k from public.developer_billing_keys where id=p_key and enabled
    and revoked_at is null and expires_at>now() and p_capability=any(capabilities);
  if not found then raise exception 'developer_key_unavailable'; end if;
  select * into a from public.developer_credit_accounts where id=k.account_id and suspended_at is null for update;
  if not found then raise exception 'developer_account_unavailable'; end if;
  select * into r from public.developer_api_requests where request_key=p_key::text||':'||p_request_key;
  if found then
    if r.request_fingerprint is distinct from p_fingerprint then raise exception 'developer_idempotency_conflict'; end if;
    return jsonb_build_object('decision','duplicate','request_id',r.id,'state',r.settlement_state);
  end if;
  select * into v from public.api_pricing_versions where id=p_version and status='approved'
    and approved_by is not null and approved_at is not null and effective_at<=now()
    and expires_at>now() and currency=a.currency;
  if not found then raise exception 'developer_pricing_unavailable'; end if;
  if exists(select 1 from public.api_emergency_controls c where c.active and
    ((c.scope_type='global') or (c.scope_type='provider' and c.scope_id=p_provider)
      or (c.scope_type='model' and c.scope_id=p_model)
      or (c.scope_type='capability' and c.scope_id=p_capability)
      or (c.scope_type='organization' and c.scope_id=a.organization_id::text)
      or (c.scope_type='project' and c.scope_id=k.project_id::text)
      or (c.scope_type='key' and c.scope_id=k.id::text))) then raise exception 'developer_emergency_block'; end if;
  amount := (p_quote->>'maximumReservedCharge')::numeric;
  if amount is null or amount<>round(amount,8) or not(amount>0 and amount<=1000000000)
    or (p_quote->>'customerCharge')::numeric is distinct from amount
    or (p_quote->>'promotionalSubsidy')::numeric is distinct from 0::numeric
    or coalesce((p_quote->>'marginFloor')::numeric,.5)<v.margin_floor
    or p_quote->>'currency' is distinct from a.currency
    or p_quote->>'pricingVersionId' is distinct from p_version::text then
    raise exception 'developer_quote_invalid';
  end if;
  foreach scope_name in array array['organization','project','key'] loop
    scope_uuid := case scope_name when 'organization' then a.organization_id when 'project' then k.project_id else k.id end;
    select * into b from public.developer_billing_limits where account_id=a.id and scope_type=scope_name and scope_id=scope_uuid;
    if not found then raise exception 'developer_limits_unconfigured'; end if;
    select
      coalesce(sum(case when created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
        then case when settlement_state='settled' then final_customer_charge else maximum_reserved_charge end else 0 end),0),
      coalesce(sum(case when created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
        then case when settlement_state='settled' then final_customer_charge else maximum_reserved_charge end else 0 end),0),
      count(*) filter(where settlement_state in ('reserved','dispatched','uncertain','reconciliation_required'))
      into used_day,used_month,inflight
      from public.developer_api_requests where account_id=a.id and settlement_state<>'rejected'
        and (scope_name='organization' or (scope_name='project' and project_id=scope_uuid) or (scope_name='key' and api_key_id=scope_uuid));
    select coalesce(sum(case when settlement_state='settled' then final_customer_charge else maximum_reserved_charge end),0)
      into used_group from public.developer_api_requests where account_id=a.id and api_key_id=k.id
        and request_group=split_part(p_request_key,':',1) and settlement_state<>'rejected';
    if amount+used_group>b.request_limit or amount+used_day>b.daily_limit or amount+used_month>b.monthly_limit
      or inflight>=b.concurrent_limit then raise exception 'developer_budget_exceeded'; end if;
  end loop;
  if a.available_amount<amount then raise exception 'developer_credit_insufficient'; end if;
  insert into public.developer_api_requests(id,request_key,request_fingerprint,request_group,account_id,organization_id,project_id,api_key_id,
    public_model,provider,upstream_model,capability,pricing_version_id,accepted_public_price,estimated_customer_charge,
    maximum_reserved_charge,estimated_upstream_cost,risk_buffer_amount,currency,rounding_difference,usage_limits,cost_breakdown,
    settlement_state,lease_token,lease_expires_at)
  values(new_id,p_key::text||':'||p_request_key,p_fingerprint,split_part(p_request_key,':',1),a.id,a.organization_id,k.project_id,k.id,
    coalesce(p_quote->'publicPrice'->>'model',p_model),p_provider,p_model,p_capability,p_version,p_quote,amount,amount,
    (p_quote->>'estimatedUpstreamCost')::numeric,(p_quote->>'riskBufferAmount')::numeric,a.currency,
    (p_quote->>'roundingDifference')::numeric,p_limits,p_quote->'upstreamBreakdown','reserved',lease,now()+interval '2 minutes');
  update public.developer_credit_accounts set available_amount=available_amount-amount,reserved_amount=reserved_amount+amount where id=a.id;
  insert into public.developer_credit_ledger(account_id,request_id,entry_type,amount,balance_after)
    values(a.id,new_id,'reserve',-amount,a.available_amount-amount);
  return jsonb_build_object('decision','admitted','request_id',new_id,'lease_token',lease);
end $$;

create function public.dispatch_developer_billing(p_request uuid,p_lease uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.developer_api_requests%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select * into r from public.developer_api_requests where id=p_request and lease_token=p_lease
    and settlement_state='reserved' and lease_expires_at>now() for update;
  if not found then return false; end if;
  if not exists(select 1 from public.developer_billing_keys k join public.developer_credit_accounts a on a.id=k.account_id
    where k.id=r.api_key_id and k.enabled and k.revoked_at is null and k.expires_at>now()
      and r.capability=any(k.capabilities) and a.suspended_at is null)
    or not exists(select 1 from public.api_pricing_versions where id=r.pricing_version_id and status='approved' and expires_at>now())
    or exists(select 1 from public.api_emergency_controls c where c.active and
      (c.scope_type='global' or (c.scope_type='provider' and c.scope_id=r.provider)
        or (c.scope_type='model' and c.scope_id=r.upstream_model) or (c.scope_type='capability' and c.scope_id=r.capability)
        or (c.scope_type='organization' and c.scope_id=r.organization_id::text)
        or (c.scope_type='project' and c.scope_id=r.project_id::text) or (c.scope_type='key' and c.scope_id=r.api_key_id::text))) then return false; end if;
  update public.developer_api_requests set settlement_state='dispatched',dispatched_at=now(),lease_expires_at=now()+interval '10 minutes' where id=r.id;
  return true;
end $$;

alter table public.developer_api_requests add column terminal_outcome text check(terminal_outcome in ('settled','released')),
  add column terminal_result jsonb;

create function public.finish_developer_billing(p_request uuid,p_lease uuid,p_outcome text,p_result jsonb default '{}'::jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.developer_api_requests%rowtype; available numeric; charge numeric; cost numeric; margin numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  select * into r from public.developer_api_requests where id=p_request and lease_token=p_lease for update;
  if not found then return false; end if;
  if p_result is null or jsonb_typeof(p_result)<>'object' or pg_column_size(p_result)>65536 then return false;end if;
  if r.settlement_state in ('settled','rejected') then
    return coalesce(r.terminal_outcome=p_outcome and r.terminal_result=p_result,false);
  end if;
  if p_outcome='uncertain' then
    if r.settlement_state not in ('dispatched','uncertain','reconciliation_required') then return false; end if;
    update public.developer_api_requests set settlement_state='uncertain' where id=r.id;
    insert into public.developer_billing_alerts(request_id,reason) values(r.id,'authoritative_usage_required') on conflict do nothing;
    return true;
  elsif p_outcome='released' then
    -- A lost network response after dispatch is not proof of zero provider cost.
    if r.settlement_state<>'reserved' then return false; end if;
    charge:=0;
  elsif p_outcome='settled' then
    if r.settlement_state not in ('dispatched','uncertain','reconciliation_required') then return false; end if;
    charge:=round((p_result->>'finalCustomerCharge')::numeric,8);
    cost:=(p_result->>'actualTotalVariableCost')::numeric;
    if charge is null or cost is null or not(charge>=0 and charge<=r.maximum_reserved_charge)
      or not(cost>=0 and cost<=1000000000) or jsonb_typeof(p_result->'usage')<>'object'
      or coalesce(p_result->>'providerResponseId','')='' then raise exception 'developer_settlement_invalid'; end if;
    margin:=case when charge>0 then (charge-cost)/charge else -1 end;
  else raise exception 'developer_outcome_invalid'; end if;
  select available_amount into available from public.developer_credit_accounts where id=r.account_id for update;
  update public.developer_credit_accounts set available_amount=available_amount+r.maximum_reserved_charge-charge,
    reserved_amount=reserved_amount-r.maximum_reserved_charge where id=r.account_id;
  insert into public.developer_credit_ledger(account_id,request_id,entry_type,amount,balance_after)
    values(r.account_id,r.id,'release',r.maximum_reserved_charge,available+r.maximum_reserved_charge);
  if p_outcome='settled' then
    insert into public.developer_credit_ledger(account_id,request_id,entry_type,amount,balance_after)
      values(r.account_id,r.id,'settle',-charge,available+r.maximum_reserved_charge-charge);
  end if;
  update public.developer_api_requests set settlement_state=case when p_outcome='released' then 'rejected' else 'settled' end,
    final_customer_charge=charge,final_upstream_cost=(p_result->>'finalUpstreamCost')::numeric,
    total_variable_cost=cost,gross_profit=charge-cost,gross_margin_percentage=case when margin>=-9 then margin else null end,below_margin_floor=coalesce(margin<coalesce((r.accepted_public_price->>'marginFloor')::numeric,.5),false),
    margin_failure_cause=case when margin<coalesce((r.accepted_public_price->>'marginFloor')::numeric,.5) then 'authoritative_usage_variance' else null end,
    authoritative_usage=p_result->'usage',provider_response_id=left(p_result->>'providerResponseId',200),
    cost_breakdown=coalesce(p_result->'costBreakdown',cost_breakdown),terminal_outcome=p_outcome,terminal_result=p_result,
    settled_at=now(),lease_expires_at=null where id=r.id;
  if margin<coalesce((r.accepted_public_price->>'marginFloor')::numeric,.5) then
    insert into public.developer_billing_alerts(request_id,reason) values(r.id,'margin_below_floor') on conflict do nothing;
    insert into public.api_emergency_controls(scope_type,scope_id,reason)
      select 'model',r.upstream_model,'Authoritative usage exceeded the accepted margin floor.'
      where not exists(select 1 from public.api_emergency_controls where scope_type='model' and scope_id=r.upstream_model and active);
  end if;
  return true;
end $$;

create function public.recover_developer_billing(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare r record; handled integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('developer_billing',0));
  for r in select id,lease_token,settlement_state from public.developer_api_requests
    where settlement_state in ('reserved','dispatched') and lease_expires_at<now()
    order by lease_expires_at,id limit greatest(1,least(coalesce(p_limit,100),100)) for update loop
    if r.settlement_state='reserved' then
      perform public.finish_developer_billing(r.id,r.lease_token,'released');
    else
      update public.developer_api_requests set settlement_state='reconciliation_required' where id=r.id;
      insert into public.developer_billing_alerts(request_id,reason) values(r.id,'authoritative_usage_required') on conflict do nothing;
    end if;
    handled:=handled+1;
  end loop;
  return handled;
end $$;

alter table public.developer_billing_keys enable row level security;
alter table public.developer_billing_limits enable row level security;
alter table public.developer_billing_alerts enable row level security;
revoke all on public.developer_billing_keys,public.developer_billing_limits,public.developer_billing_alerts from public,anon,authenticated;
grant all on public.developer_billing_keys,public.developer_billing_limits,public.developer_billing_alerts to service_role;
revoke all on function public.admit_developer_billing(uuid,text,text,text,text,text,uuid,jsonb,jsonb),
  public.dispatch_developer_billing(uuid,uuid),public.finish_developer_billing(uuid,uuid,text,jsonb),
  public.recover_developer_billing(integer) from public,anon,authenticated;
grant execute on function public.admit_developer_billing(uuid,text,text,text,text,text,uuid,jsonb,jsonb),
  public.dispatch_developer_billing(uuid,uuid),public.finish_developer_billing(uuid,uuid,text,jsonb),
  public.recover_developer_billing(integer) to service_role;

-- A durable, private in-app delivery outbox; no external email/communication is sent.
create table public.developer_billing_alert_deliveries (
  alert_id uuid not null references public.developer_billing_alerts(id),
  administrator_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key(alert_id,administrator_id)
);
alter table public.developer_billing_alert_deliveries enable row level security;
revoke all on public.developer_billing_alert_deliveries from public,anon,authenticated;
grant all on public.developer_billing_alert_deliveries to service_role;
create function public.deliver_developer_billing_alerts(p_administrators uuid[],p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare item record; administrator uuid; delivered integer:=0;
begin
  if coalesce(array_length(p_administrators,1),0) not between 1 and 25 then return 0; end if;
  perform pg_advisory_xact_lock(hashtextextended('developer_billing_alerts',0));
  for item in select a.id from public.developer_billing_alerts a where a.acknowledged_at is null
    and exists(select 1 from unnest(p_administrators) u(id) where not exists(
      select 1 from public.developer_billing_alert_deliveries d where d.alert_id=a.id and d.administrator_id=u.id))
    order by a.created_at,a.id limit greatest(1,least(coalesce(p_limit,100),100)) loop
    foreach administrator in array p_administrators loop
      if administrator is not null and not exists(select 1 from public.developer_billing_alert_deliveries where alert_id=item.id and administrator_id=administrator) then
        begin
          insert into public.app_notifications(owner_id,type,title,safe_preview,action_url,source_entity,delivery_state)
            values(administrator,'billing_issue','Developer billing needs review',
              'A provider charge requires reconciliation or a margin review. New affected usage remains protected.',
              '/notifications','developer_billing:'||item.id::text,'delivered');
          insert into public.developer_billing_alert_deliveries(alert_id,administrator_id) values(item.id,administrator);
          delivered:=delivered+1;
        exception when foreign_key_violation then null;
        end;
      end if;
    end loop;
  end loop;
  return delivered;
end $$;
revoke all on function public.deliver_developer_billing_alerts(uuid[],integer) from public,anon,authenticated;
grant execute on function public.deliver_developer_billing_alerts(uuid[],integer) to service_role;

-- Retire the unused standalone hold path; live service traffic must use scoped admission.
revoke execute on function public.reserve_developer_api_credit(uuid,text,uuid,numeric) from service_role;
