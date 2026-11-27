-- Resets preserve the raw usage ledger and monthly safety ceiling.
create table kova_private.chat_limit_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  grant_key text not null,
  granted_at timestamptz not null,
  expires_at timestamptz not null,
  granted_by uuid,
  reason text,
  redeemed_at timestamptz,
  reset_weekly boolean not null default false,
  reset_five_hour boolean not null default false,
  daily_chats integer not null default 0,
  daily_thinking integer not null default 0,
  hourly_regular integer not null default 0,
  hourly_thinking integer not null default 0,
  unique(user_id, grant_key)
);
alter table kova_private.chat_limit_resets enable row level security;
revoke all on kova_private.chat_limit_resets from public, anon, authenticated, service_role;

create or replace function public.kova_chat_limit_resets(p_user uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set timezone='UTC' as $$
declare
  current_time_utc timestamptz := statement_timestamp();
  scheduled_at timestamptz;
begin
  if p_user is null or p_plan is null or p_plan not in ('free','plus','pro') then
    raise exception 'invalid_reset_principal';
  end if;
  -- Issue the next eligible grant on access. Existing grants carry over.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,20261126120000));
  select max(granted_at) into scheduled_at from kova_private.chat_limit_resets
    where user_id=p_user and granted_by is null;
  if scheduled_at is null or scheduled_at + (case when p_plan='free' then interval '1 month'
    else interval '14 days' end) <= current_time_utc then
    insert into kova_private.chat_limit_resets(user_id,grant_key,granted_at,expires_at)
      values(p_user,'scheduled:' || current_time_utc::text,current_time_utc,current_time_utc+interval '1 month')
      on conflict do nothing;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'grantedAt', granted_at, 'expiresAt', expires_at, 'redeemedAt', redeemed_at,
      'weekly', reset_weekly, 'fiveHour', reset_five_hour, 'manual', granted_by is not null
    ) order by granted_at desc)
    from kova_private.chat_limit_resets where user_id=p_user
      and (expires_at>current_time_utc or coalesce(redeemed_at,expires_at)>=current_time_utc-interval '30 days')
  ),'[]'::jsonb);
end $$;

create or replace function public.kova_grant_chat_limit_reset(
  p_user uuid,p_admin uuid,p_id uuid,p_reason text
) returns boolean language plpgsql security definer set search_path=public,pg_temp set timezone='UTC' as $$
begin
  if p_id is null or p_user is null or p_admin is null or p_reason is null
     or length(btrim(p_reason)) not between 1 and 240
     or not kova_private.auth_user_exists(p_user) or not kova_private.auth_user_exists(p_admin)
     or exists(select 1 from account_deletion_fences where user_id in (p_user,p_admin)) then
    raise exception 'invalid_reset_grant';
  end if;
  insert into kova_private.chat_limit_resets(user_id,grant_key,granted_at,expires_at,granted_by,reason)
  values(p_user,'manual:' || p_id::text,statement_timestamp(),statement_timestamp()+interval '1 month',p_admin,btrim(p_reason))
  on conflict do nothing;
  return true;
end $$;

create or replace function public.kova_redeem_chat_limit_reset(
  p_user uuid,p_id uuid,p_plan text,p_weekly boolean,p_five_hour boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp set timezone='UTC' as $$
declare
  reset_at timestamptz;
  daily record;
  hourly record;
begin
  if p_weekly is null or p_five_hour is null or not (p_weekly or p_five_hour)
    or p_plan is null or p_plan not in ('free','plus','pro') or (p_plan='pro' and p_five_hour) then
    raise exception 'invalid_reset_windows';
  end if;
  if p_user is null or p_id is null or exists(select 1 from account_deletion_fences where user_id=p_user) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,20261104223000));
  perform pg_advisory_xact_lock(hashtextextended('kova-ai-global',0));
  reset_at := clock_timestamp();
  select chats,thinking_chats into daily from daily_usage where user_id=p_user and usage_date=reset_at::date;
  select regular_messages,thinking_messages into hourly from message_usage_hourly
     where user_id=p_user and window_start=date_trunc('hour',reset_at);
  update kova_private.chat_limit_resets set
    redeemed_at=reset_at,reset_weekly=p_weekly,reset_five_hour=p_five_hour,
    daily_chats=coalesce(daily.chats,0),daily_thinking=coalesce(daily.thinking_chats,0),
    hourly_regular=coalesce(hourly.regular_messages,0),hourly_thinking=coalesce(hourly.thinking_messages,0)
    where id=p_id and user_id=p_user and redeemed_at is null and expires_at>reset_at;
  return found;
end $$;

revoke all on function public.kova_chat_limit_resets(uuid,text) from public,anon,authenticated;
grant execute on function public.kova_chat_limit_resets(uuid,text) to service_role;

revoke all on function public.kova_grant_chat_limit_reset(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.kova_grant_chat_limit_reset(uuid,uuid,uuid,text) to service_role;

revoke all on function public.kova_redeem_chat_limit_reset(uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.kova_redeem_chat_limit_reset(uuid,uuid,text,boolean,boolean) to service_role;

create or replace function public.kova_plan_cost_progress(
  _user_id uuid, _plan text, _asof timestamptz default statement_timestamp()
) returns table(
  month_used numeric, monthly_allowance numeric,
  weekly_used numeric, weekly_allowance numeric,
  five_hour_used numeric, five_hour_allowance numeric
)
language plpgsql stable security definer
set search_path=public,pg_temp as $$
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
  configured_allowance numeric;
  remaining_days numeric;
  weekly_reset timestamptz;
  five_reset timestamptz;
  weekly_before_reset numeric;
  five_before_reset numeric;
begin
  if _user_id is null or _plan not in ('free','plus','pro') then
    raise exception 'invalid_kova_cost_progress';
  end if;
  select monthly_allowance_usd into configured_allowance
  from kova_private.chat_plan_budget_policy where plan = _plan;
  monthly_allowance := coalesce(configured_allowance, case _plan
    when 'free' then 3::numeric
    when 'plus' then 60::numeric
    else 300::numeric
  end);
  five_start := greatest(month_start,hourly_start-interval '4 hours');
  select
    coalesce(sum(coalesce(actual_cost_usd,estimated_cost_usd)),0),
    coalesce(sum(coalesce(actual_cost_usd,estimated_cost_usd))
      filter (where created_at>=greatest(month_start,week_start)),0),
    coalesce(sum(coalesce(actual_cost_usd,estimated_cost_usd))
      filter (where created_at>=five_start),0)
  into month_used,weekly_used,five_hour_used
  from public.ai_usage_events
  where user_id=_user_id and created_at>=month_start and created_at<month_end
    and status<>'quota_rejected';
  select max(redeemed_at) filter (where reset_weekly),max(redeemed_at) filter (where reset_five_hour)
    into weekly_reset,five_reset from kova_private.chat_limit_resets
    where user_id=_user_id and redeemed_at<=_asof
      and redeemed_at>=least(greatest(month_start,week_start),five_start);
  select coalesce(sum(coalesce(actual_cost_usd,estimated_cost_usd)) filter (
      where created_at>=greatest(month_start,week_start) and created_at<weekly_reset),0),
    coalesce(sum(coalesce(actual_cost_usd,estimated_cost_usd)) filter (
      where created_at>=five_start and created_at<five_reset),0)
    into weekly_before_reset,five_before_reset
    from public.ai_usage_events where user_id=_user_id and status<>'quota_rejected'
      and created_at>=least(greatest(month_start,week_start),five_start)
      and created_at<greatest(weekly_reset,five_reset);
  other_week := month_used-weekly_used;
  other_five := month_used-five_hour_used;
  weekly_used := greatest(0,weekly_used-weekly_before_reset);
  five_hour_used := greatest(0,five_hour_used-five_before_reset);
  weekly_slots := greatest(1,ceil(extract(epoch from (month_end-greatest(month_start,week_start)))/604800));
  five_slots := greatest(1,ceil(extract(epoch from (month_end-five_start))/18000));
  if configured_allowance is not null then
    weekly_allowance := greatest(0,monthly_allowance-other_week)/weekly_slots;
    -- Budget one usable burst per remaining day. The rolling five-hour
    -- window limits bursts while atomic monthly admission controls total spend.
    remaining_days := greatest(1,ceil(extract(epoch from (month_end-five_start))/86400));
    five_hour_allowance := case when _plan='pro' then null else
      least(weekly_allowance,greatest(0,monthly_allowance-other_five)/remaining_days)
    end;
    return next;
    return;
  end if;

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
$$;
revoke all on function public.kova_plan_cost_progress(uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.kova_plan_cost_progress(uuid,text,timestamptz)
  to service_role;

create or replace function public.try_consume_paid_message(
  _user_id uuid, _thinking boolean, _weekly_limit integer, _short_limit integer
) returns text
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare
  now_utc timestamp := statement_timestamp() at time zone 'UTC';
  week_start date := date_trunc('week', now_utc)::date;
  hour_start timestamptz := date_trunc('hour', statement_timestamp());
  five_hour_start timestamptz := date_trunc('hour', statement_timestamp()) - interval '4 hours';
  weekly_count bigint;
  short_count bigint;
  cost_managed boolean;
  week_reset record;
  short_reset record;
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

  select exists(select 1 from kova_private.chat_plan_budget_policy
    where plan=public.effective_user_plan_tier(_user_id)) into cost_managed;

  perform pg_advisory_xact_lock(hashtextextended(_user_id::text, 20261104223000));
  select redeemed_at,daily_chats,daily_thinking into week_reset from kova_private.chat_limit_resets
    where user_id=_user_id and reset_weekly and redeemed_at >= (week_start::timestamp at time zone 'UTC')
    order by redeemed_at desc limit 1;
  select redeemed_at,hourly_regular,hourly_thinking into short_reset from kova_private.chat_limit_resets
    where user_id=_user_id and reset_five_hour and redeemed_at>=five_hour_start
    order by redeemed_at desc limit 1;
  -- Discard expired per-user hourly buckets so storage never grows unbounded.
  delete from public.message_usage_hourly
    where user_id=_user_id and window_start<five_hour_start;

  select coalesce(sum(case when _thinking then thinking_chats else chats - thinking_chats end), 0)
    into weekly_count from public.daily_usage
    where user_id = _user_id and usage_date between
      greatest(week_start,(week_reset.redeemed_at at time zone 'UTC')::date) and now_utc::date;
  weekly_count := greatest(0,weekly_count-coalesce(case when _thinking then week_reset.daily_thinking
    else week_reset.daily_chats-week_reset.daily_thinking end,0));
  if not cost_managed and weekly_count >= _weekly_limit then return 'weekly'; end if;

  if _short_limit is not null then
    select coalesce(sum(case when _thinking then thinking_messages else regular_messages end),0)
      into short_count from public.message_usage_hourly
      where user_id=_user_id and window_start>=greatest(five_hour_start,date_trunc('hour',short_reset.redeemed_at))
        and window_start<=hour_start;
    short_count := greatest(0,short_count-coalesce(case when _thinking then short_reset.hourly_thinking
      else short_reset.hourly_regular end,0));
    if not cost_managed and short_count>=_short_limit then return 'five_hour'; end if;
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



create or replace function public.kova_chat_usage_breakdown(p_user uuid,p_days integer)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with events as (
    select provider_model,conversation_id,tool_usage,
      (created_at at time zone 'UTC')::date as day
    from ai_usage_events where user_id=p_user and p_days in (7,30)
      and created_at>=(((now() at time zone 'UTC')::date-p_days+1)::timestamp at time zone 'UTC')
      and created_at<=now() and status='completed'
  ), models as (
    select provider_model as model,count(*) as messages from events
    group by provider_model order by count(*) desc,provider_model limit 30
  ), chats as (
    select conversation_id as id,count(*) as messages from events
    where conversation_id is not null group by conversation_id
    order by count(*) desc,conversation_id limit 10
  ), tools as (
    select day,sum(case
      when jsonb_typeof(tool_usage->'calls')='number' then greatest((tool_usage->>'calls')::numeric,0)
      else 0 end) as calls from events group by day
  )
  select jsonb_build_object(
    'models',coalesce((select jsonb_agg(to_jsonb(models) order by messages desc,model) from models),'[]'::jsonb),
    'chats',coalesce((select jsonb_agg(to_jsonb(chats) order by messages desc,id) from chats),'[]'::jsonb),
    'tools',coalesce((select jsonb_agg(to_jsonb(tools) order by day) from tools where calls>0),'[]'::jsonb)
  );
$$;
revoke all on function public.kova_chat_usage_breakdown(uuid,integer) from public,anon,authenticated;
grant execute on function public.kova_chat_usage_breakdown(uuid,integer) to service_role;
