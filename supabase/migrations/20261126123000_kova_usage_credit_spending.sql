-- Sandbox funding is isolated from the production inference wallet.
alter table kova_private.usage_credit_orders add column payment_fee_cents integer
  check (payment_fee_cents >= 0 and payment_fee_cents < amount_cents);
create table kova_private.usage_credit_spends (
  event_id uuid primary key references public.ai_usage_events(id) on delete cascade,
  order_id uuid not null references kova_private.usage_credit_orders(id),
  maximum_micros bigint not null check (maximum_micros > 0),
  settled_micros bigint check (settled_micros >= 0),
  pricing_divisor bigint not null check (pricing_divisor > 0)
);
create index on kova_private.usage_credit_spends(order_id);
alter table kova_private.usage_credit_spends enable row level security;
revoke all on kova_private.usage_credit_spends from public,anon,authenticated,service_role;

create function kova_private.settle_usage_credit_spend()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.actual_cost_usd is not null then
    update kova_private.usage_credit_spends s
      set settled_micros=least(s.maximum_micros,
        ceil(greatest(new.actual_cost_usd,0)*1000000*o.amount_cents*10000/s.pricing_divisor)::bigint)
      from kova_private.usage_credit_orders o
      where s.event_id=new.id and o.id=s.order_id and s.settled_micros is null;
  end if;
  return new;
end $$;

create trigger settle_usage_credit_spend after update of actual_cost_usd
  on public.ai_usage_events for each row execute function kova_private.settle_usage_credit_spend();

create or replace function public.acquire_ai_generation(
  p_request_id text,p_idempotency_key text,p_user_id uuid,p_guest_ip_hash text,p_conversation_id uuid,p_mode text,p_plan text,p_premium boolean,
  p_model text,p_estimated_input bigint,p_reserved_tokens bigint,p_estimated_cost numeric,p_context_trimmed boolean,
  p_daily_limit bigint,p_monthly_limit bigint,p_premium_limit integer,p_guest_limit integer,p_global_concurrency integer,p_principal_concurrency integer,p_lease_seconds integer,
  p_period_start timestamptz,p_period_end timestamptz)
returns table(event_id uuid,decision text) language plpgsql security definer set search_path=public,pg_temp as $$
declare active_global integer; active_principal integer; used_day bigint; used_month bigint; used_premium integer; used_guest integer; new_id uuid; cost_state record; cost_managed boolean;
  exhausted text;
  funding record;
  max_debit bigint;
  funding_divisor bigint;
begin
  if p_user_id is not null and public.effective_user_usage_multiplier(p_user_id)=5 then
    p_daily_limit := case when p_daily_limit is null then null else least(p_daily_limit::numeric*5,9223372036854775807)::bigint end;
    p_monthly_limit := case when p_monthly_limit is null then null else least(p_monthly_limit::numeric*5,9223372036854775807)::bigint end;
    p_premium_limit := case when p_premium_limit is null then null else least(p_premium_limit::bigint*5,2147483647)::integer end;
  end if;
  if (p_user_id is null)=(p_guest_ip_hash is null) then return query select null::uuid,'invalid_principal'; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('kova-ai-global',0));
  if exists(select 1 from ai_usage_events where idempotency_key=p_idempotency_key and ((p_user_id is not null and user_id=p_user_id) or (p_guest_ip_hash is not null and guest_ip_hash=p_guest_ip_hash))) then
    return query select null::uuid,'duplicate'; return;
  end if;
  update ai_usage_events set status='stale',completed_at=now(),error_classification='lease_expired' where status in ('reserved','started','streaming') and lease_expires_at<now();
  select count(*) into active_global from ai_usage_events where status in ('reserved','started','streaming') and lease_expires_at>=now();
  if active_global>=p_global_concurrency then return query select null::uuid,'global_concurrency'; return; end if;
  select count(*) into active_principal from ai_usage_events where status in ('reserved','started','streaming') and lease_expires_at>=now() and ((p_user_id is not null and user_id=p_user_id) or (p_guest_ip_hash is not null and guest_ip_hash=p_guest_ip_hash));
  if active_principal>=p_principal_concurrency then return query select null::uuid,'principal_concurrency'; return; end if;
  if p_user_id is not null then
    -- The global lock also serializes this spend reservation with every other
    -- in-flight model request. Pro basic chat bypasses token count, never cost.
    if p_plan is null or p_plan not in ('free','plus','pro') or p_estimated_cost is null
       or p_estimated_cost < 0 then
      return query select null::uuid,'monthly_cost'; return;
    end if;
    select * into cost_state
      from public.kova_plan_cost_progress(p_user_id,p_plan,statement_timestamp());
    if cost_state.month_used + p_estimated_cost > cost_state.monthly_allowance then
      exhausted := 'monthly_cost';
    elsif cost_state.weekly_used + p_estimated_cost > cost_state.weekly_allowance then
      exhausted := 'weekly_cost';
    elsif p_plan in ('free','plus') and
       cost_state.five_hour_used + p_estimated_cost > cost_state.five_hour_allowance then
      exhausted := 'five_hour_cost';
    end if;
    if current_setting('kova.credit_message_overflow',true)='enabled' then
      exhausted := coalesce(exhausted,'weekly_cost');
    end if;
    -- Paid fallback remains dormant until live funding records verified payment fees.
    if exhausted is not null and p_estimated_cost > 0 and p_estimated_cost <= 500
       and current_setting('kova.usage_credit_spending',true)='enabled'
       and current_setting('kova.credit_generation_eligible',true)='enabled' then
      for funding in
        select id,amount_cents,payment_fee_cents,refunded_cents
        from kova_private.usage_credit_orders
        where claimed_by=p_user_id and environment=current_setting('kova.usage_credit_funding_environment',true) and not disputed
          and payment_fee_cents is not null and refunded_cents=0
        order by claimed_at,id for update
      loop
        funding_divisor := funding.amount_cents::bigint*9000-funding.payment_fee_cents::bigint*10000;
        if funding_divisor <= 0 then continue; end if;
        max_debit := ceil(p_estimated_cost*1000000*funding.amount_cents*10000/funding_divisor)::bigint;
        if max_debit <= funding.amount_cents::bigint*10000 - coalesce((
          select sum(coalesce(settled_micros,maximum_micros))
          from kova_private.usage_credit_spends where order_id=funding.id
        ),0) then exit; end if;
        max_debit := null;
      end loop;
    end if;
    if exhausted is not null and max_debit is null then
      return query select null::uuid,exhausted; return;
    end if;
    select exists(select 1 from kova_private.chat_plan_budget_policy
      where plan=p_plan) into cost_managed;
    -- Private cost-managed plans do not also exhaust fixed token/message counts.
    -- Legacy installations retain their earlier count safeguards.
    if max_debit is null and not cost_managed and not coalesce(p_plan='pro' and p_model='kova-argon-4.6' and p_mode='instant' and p_premium=false,false) then
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_day from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed') and not (plan_tier='pro' and provider_model='kova-argon-4.6' and kova_mode='instant' and premium=false);
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_month from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('month',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed') and not (plan_tier='pro' and provider_model='kova-argon-4.6' and kova_mode='instant' and premium=false);
    if used_day+p_reserved_tokens>p_daily_limit then return query select null::uuid,'daily_tokens'; return; end if;
    if used_month+p_reserved_tokens>p_monthly_limit then return query select null::uuid,'monthly_tokens'; return; end if;
    end if;
    if max_debit is null and p_premium and not cost_managed then
      select count(*) into used_premium from ai_usage_events where user_id=p_user_id and premium and created_at>=p_period_start and created_at<p_period_end and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed');
      if used_premium>=p_premium_limit then return query select null::uuid,'premium_period'; return; end if;
    end if;
  else
    select count(*) into used_guest from ai_usage_events where guest_ip_hash=p_guest_ip_hash and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed');
    if used_guest>=p_guest_limit then return query select null::uuid,'guest_daily'; return; end if;
  end if;
  begin
    insert into ai_usage_events(request_id,idempotency_key,user_id,guest_ip_hash,conversation_id,kova_mode,plan_tier,premium,provider_model,estimated_input_tokens,reserved_tokens,estimated_cost_usd,context_trimmed,status,lease_expires_at)
    values(p_request_id,p_idempotency_key,p_user_id,p_guest_ip_hash,p_conversation_id,p_mode,p_plan,p_premium,p_model,p_estimated_input,p_reserved_tokens,p_estimated_cost,p_context_trimmed,'reserved',now()+make_interval(secs=>p_lease_seconds)) returning id into new_id;
  exception when unique_violation then return query select null::uuid,'duplicate'; return; end;
  if max_debit is not null then
    insert into kova_private.usage_credit_spends(event_id,order_id,maximum_micros,pricing_divisor)
    values(new_id,funding.id,max_debit,funding_divisor);
  end if;
  return query select new_id,'acquired';
end $$;



-- Only the server service role may call the existing paid admission function.
revoke all on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz) to service_role;

create function public.kova_credit_spending_history(p_user uuid,p_env text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'spentMicros',coalesce((select sum(coalesce(s.settled_micros,s.maximum_micros))
      from kova_private.usage_credit_spends s join kova_private.usage_credit_orders o on o.id=s.order_id
      where o.claimed_by=p_user and o.environment=p_env),0),
    'entries',coalesce((select jsonb_agg(to_jsonb(history) order by date desc) from (
      select e.id,e.provider_model as model,e.created_at as date,
        coalesce(s.settled_micros,s.maximum_micros) as micros,s.settled_micros is null as pending
      from kova_private.usage_credit_spends s join kova_private.usage_credit_orders o on o.id=s.order_id
      join public.ai_usage_events e on e.id=s.event_id
      where o.claimed_by=p_user and o.environment=p_env order by e.created_at desc,e.id limit 50
    ) history),'[]'::jsonb)
  );
$$;
revoke all on function public.kova_credit_spending_history(uuid,text) from public,anon,authenticated;
grant execute on function public.kova_credit_spending_history(uuid,text) to service_role;

create function public.acquire_credit_eligible_generation(
  p_request_id text,p_idempotency_key text,p_user_id uuid,p_guest_ip_hash text,p_conversation_id uuid,p_mode text,p_plan text,p_premium boolean,
  p_model text,p_estimated_input bigint,p_reserved_tokens bigint,p_estimated_cost numeric,p_context_trimmed boolean,
  p_daily_limit bigint,p_monthly_limit bigint,p_premium_limit integer,p_guest_limit integer,p_global_concurrency integer,p_principal_concurrency integer,p_lease_seconds integer,
  p_period_start timestamptz,p_period_end timestamptz,p_message_overflow boolean)
returns table(event_id uuid,decision text) language plpgsql security invoker set search_path='' as $$
begin
  perform set_config('kova.credit_generation_eligible','enabled',true);
  perform set_config('kova.credit_message_overflow',case when p_message_overflow then 'enabled' else 'disabled' end,true);
  return query select * from public.acquire_ai_generation(
    p_request_id, p_idempotency_key, p_user_id, p_guest_ip_hash, p_conversation_id, p_mode, p_plan, p_premium, p_model, p_estimated_input, p_reserved_tokens, p_estimated_cost, p_context_trimmed, p_daily_limit, p_monthly_limit, p_premium_limit, p_guest_limit, p_global_concurrency, p_principal_concurrency, p_lease_seconds, p_period_start, p_period_end);
end $$;
revoke all on function public.acquire_credit_eligible_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.acquire_credit_eligible_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz,boolean) to service_role;


create function public.kova_fund_credit_order_with_fee(
  p_id uuid,p_env text,p_session text,p_intent text,p_amount integer,p_refund integer,p_disputed boolean,p_fee integer
)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_fee is null or p_fee<0 or p_fee>=p_amount then return false; end if;
  if not public.kova_fund_credit_order(p_id,p_env,p_session,p_intent,p_amount,p_refund,p_disputed) then
    return false;
  end if;
  update kova_private.usage_credit_orders set payment_fee_cents=p_fee
    where environment=p_env and payment_intent=p_intent and funded_at is not null
      and p_fee>=0 and p_fee<amount_cents and (payment_fee_cents is null or payment_fee_cents=p_fee);
  if not found then raise exception 'credit_fee_mismatch'; end if;
  return true;
end $$;
revoke all on function public.kova_fund_credit_order_with_fee(uuid,text,text,text,integer,integer,boolean,integer) from public,anon,authenticated;
grant execute on function public.kova_fund_credit_order_with_fee(uuid,text,text,text,integer,integer,boolean,integer) to service_role;
