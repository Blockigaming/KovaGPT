-- Operator configuration is private and is never seeded with production values.
create table kova_private.chat_plan_budget_policy (
  plan text primary key check (plan in ('free','plus','pro')),
  monthly_allowance_usd numeric(12,4) not null check (
    monthly_allowance_usd > 0 and monthly_allowance_usd < 'Infinity'::numeric
  )
);
alter table kova_private.chat_plan_budget_policy enable row level security;
revoke all on kova_private.chat_plan_budget_policy from public,anon,authenticated,service_role;

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
  other_week := month_used-weekly_used;
  other_five := month_used-five_hour_used;
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
