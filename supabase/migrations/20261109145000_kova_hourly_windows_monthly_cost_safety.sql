-- Free and Plus: one 5-hour meter updated each UTC hour; all paid plans
-- retain the Monday-start weekly count. Pro has only the weekly visible meter.
-- This migration does not drop the former short-window table or its history.
create table if not exists public.message_usage_hourly (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  regular_messages integer not null default 0 check (regular_messages >= 0),
  thinking_messages integer not null default 0 check (thinking_messages >= 0),
  primary key (user_id, window_start)
);
alter table public.message_usage_hourly enable row level security;
revoke all on public.message_usage_hourly from public, anon, authenticated;
grant select, insert, update, delete on public.message_usage_hourly to service_role;

create or replace function public.try_consume_paid_message(
  _user_id uuid, _thinking boolean, _weekly_limit integer, _short_limit integer
) returns text
language plpgsql security invoker set search_path = '' set statement_timeout = '5s' as $$
declare
  now_utc timestamp := statement_timestamp() at time zone 'UTC';
  week_start date := date_trunc('week', now_utc)::date;
  hour_start timestamptz := date_trunc('hour', statement_timestamp());
  five_hour_start timestamptz := date_trunc('hour', statement_timestamp()) - interval '4 hours';
  weekly_count bigint;
  short_count bigint;
begin
  if _user_id is null or _thinking is null
    or _weekly_limit is null or _weekly_limit not between 1 and 100000
    or (_short_limit is not null and _short_limit not between 1 and _weekly_limit) then
    raise exception 'invalid_message_allowance';
  end if;

  if public.effective_user_usage_multiplier(_user_id)=5 then
    _weekly_limit := _weekly_limit*5;
    if _short_limit is not null then _short_limit := _short_limit*5; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_user_id::text, 20261104223000));

  select coalesce(sum(case when _thinking then thinking_chats else chats - thinking_chats end), 0)
    into weekly_count from public.daily_usage
    where user_id = _user_id and usage_date between week_start and now_utc::date;
  if weekly_count >= _weekly_limit then return 'weekly'; end if;

  if _short_limit is not null then
    select coalesce(sum(case when _thinking then thinking_messages else regular_messages end),0)
      into short_count from public.message_usage_hourly
      where user_id=_user_id and window_start>=five_hour_start
        and window_start<=hour_start;
    if short_count>=_short_limit then return 'five_hour'; end if;
  end if;

  if not public.try_consume_daily_message(_user_id, _thinking, 100000, 100000) then
    raise exception 'message_reservation_unavailable';
  end if;

  if _short_limit is not null then
    insert into public.message_usage_hourly(
      user_id,window_start,regular_messages,thinking_messages
    ) values (
      _user_id,hour_start,case when _thinking then 0 else 1 end,
      case when _thinking then 1 else 0 end
    )
    on conflict (user_id,window_start) do update set
      regular_messages=message_usage_hourly.regular_messages+excluded.regular_messages,
      thinking_messages=message_usage_hourly.thinking_messages+excluded.thinking_messages;
  end if;
  return 'allowed';
end
$$;
revoke all on function public.try_consume_paid_message(uuid,boolean,integer,integer)
  from public,anon,authenticated;
grant execute on function public.try_consume_paid_message(uuid,boolean,integer,integer)
  to service_role;

-- Single server-owned source for cost-weighted quota progress and admission.
-- Costs are conservative: the greater of actual and reserved estimated spend.
-- User-supplied amounts and client percentages cannot influence this query.
create or replace function public.kova_plan_cost_progress(
  _user_id uuid, _plan text, _asof timestamptz default statement_timestamp()
) returns table(
  month_used numeric, monthly_allowance numeric,
  weekly_used numeric, weekly_allowance numeric,
  five_hour_used numeric, five_hour_allowance numeric
)
language plpgsql stable security definer
set search_path=public,pg_temp as $
declare
  month_start timestamptz := date_trunc('month', _asof at time zone 'UTC') at time zone 'UTC';
  month_end timestamptz := date_trunc('month', _asof at time zone 'UTC') at time zone 'UTC' + interval '1 month';
  week_start timestamptz := date_trunc('week', _asof at time zone 'UTC') at time zone 'UTC';
  hourly_start timestamptz := date_trunc('hour', _asof at time zone 'UTC') at time zone 'UTC';
  five_start timestamptz;
  other_week numeric;
  other_five numeric;
  weekly_slots numeric;
  five_slots numeric;
begin
  if _user_id is null or _plan not in ('free','plus','pro') then
    raise exception 'invalid_kova_cost_progress';
  end if;
  monthly_allowance := case _plan
    when 'free' then 3::numeric
    when 'plus' then 60::numeric
    else 300::numeric
  end;
  five_start := greatest(month_start,hourly_start-interval '4 hours');
  select
    coalesce(sum(greatest(coalesce(actual_cost_usd,0),coalesce(estimated_cost_usd,0))),0),
    coalesce(sum(greatest(coalesce(actual_cost_usd,0),coalesce(estimated_cost_usd,0)))
      filter (where created_at>=greatest(month_start,week_start)),0),
    coalesce(sum(greatest(coalesce(actual_cost_usd,0),coalesce(estimated_cost_usd,0)))
      filter (where created_at>=five_start),0)
  into month_used,weekly_used,five_hour_used
  from public.ai_usage_events
  where user_id=_user_id and created_at>=month_start and created_at<month_end
    and status<>'quota_rejected';
  other_week := month_used-weekly_used;
  other_five := month_used-five_hour_used;
  weekly_slots := greatest(1,ceil(extract(epoch from (month_end-greatest(month_start,week_start)))/604800));
  five_slots := greatest(1,ceil(extract(epoch from (month_end-five_start))/18000));
  weekly_allowance := greatest(
    case _plan when 'free' then 0.5::numeric when 'plus' then 5::numeric else 10::numeric end,
    greatest(0,monthly_allowance-other_week)/weekly_slots
  );
  five_hour_allowance := case when _plan='pro' then null
    else greatest(
      case _plan when 'free' then 0.1::numeric else 2::numeric end,
      greatest(0,monthly_allowance-other_five)/five_slots
    )
  end;
  return next;
end
$;
revoke all on function public.kova_plan_cost_progress(uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.kova_plan_cost_progress(uuid,text,timestamptz)
  to service_role;

-- Preserve the existing concurrency/idempotency and token restrictions while
-- adding an atomic cap to the same admission transaction. No new RPC signature.
create or replace function public.acquire_ai_generation(
  p_request_id text,p_idempotency_key text,p_user_id uuid,p_guest_ip_hash text,p_conversation_id uuid,p_mode text,p_plan text,p_premium boolean,
  p_model text,p_estimated_input bigint,p_reserved_tokens bigint,p_estimated_cost numeric,p_context_trimmed boolean,
  p_daily_limit bigint,p_monthly_limit bigint,p_premium_limit integer,p_guest_limit integer,p_global_concurrency integer,p_principal_concurrency integer,p_lease_seconds integer,
  p_period_start timestamptz,p_period_end timestamptz)
returns table(event_id uuid,decision text) language plpgsql security definer set search_path=public,pg_temp as $$
declare active_global integer; active_principal integer; used_day bigint; used_month bigint; used_premium integer; used_guest integer; new_id uuid; cost_state record;
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
    if p_plan not in ('free','plus','pro') or p_estimated_cost is null
       or p_estimated_cost < 0 then
      return query select null::uuid,'monthly_cost'; return;
    end if;
    select * into cost_state
      from public.kova_plan_cost_progress(p_user_id,p_plan,statement_timestamp());
    if cost_state.month_used + p_estimated_cost > cost_state.monthly_allowance then
      return query select null::uuid,'monthly_cost'; return;
    end if;
    if cost_state.weekly_used + p_estimated_cost > cost_state.weekly_allowance then
      return query select null::uuid,'weekly_cost'; return;
    end if;
    if p_plan in ('free','plus') and
       cost_state.five_hour_used + p_estimated_cost > cost_state.five_hour_allowance then
      return query select null::uuid,'five_hour_cost'; return;
    end if;
    -- Included Pro Argon Lite chat has no daily/monthly token allowance.
    if not coalesce(p_plan='pro' and p_model='kova-argon-4.6' and p_mode='instant' and p_premium=false,false) then
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_day from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed') and not (plan_tier='pro' and provider_model='kova-argon-4.6' and kova_mode='instant' and premium=false);
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_month from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('month',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed') and not (plan_tier='pro' and provider_model='kova-argon-4.6' and kova_mode='instant' and premium=false);
    if used_day+p_reserved_tokens>p_daily_limit then return query select null::uuid,'daily_tokens'; return; end if;
    if used_month+p_reserved_tokens>p_monthly_limit then return query select null::uuid,'monthly_tokens'; return; end if;
    end if;
    if p_premium then
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
  return query select new_id,'acquired';
end $$;


-- Only the server service role may call the existing paid admission function.
revoke all on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz) to service_role;
