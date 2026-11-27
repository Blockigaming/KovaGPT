create table kova_private.chat_quota_observations (
  user_id uuid not null,
  window_kind text not null check (window_kind in ('weekly','five_hour')),
  period_start timestamptz not null,
  observed_at timestamptz not null,
  percent_used integer,
  primary key(user_id,window_kind,period_start)
);
alter table kova_private.chat_quota_observations enable row level security;
revoke all on kova_private.chat_quota_observations from public,anon,authenticated,service_role;

create function public.kova_observe_chat_quota(p_user uuid,p_plan text)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  observed timestamptz := statement_timestamp();
begin
  if p_user is null or p_plan is null or p_plan not in ('free','plus','pro') then
    raise exception 'invalid_quota_observation';
  end if;
  if exists(select 1 from public.account_deletion_fences where user_id=p_user) then
    return '[]'::jsonb;
  end if;
  delete from kova_private.chat_quota_observations
    where user_id=p_user and observed_at<observed-interval '30 days';
  insert into kova_private.chat_quota_observations(user_id,window_kind,period_start,observed_at,percent_used)
    select p_user,w.kind,w.period,observed,
      case when w.allowance is null then null when w.used>=w.allowance then 100
        else greatest(0,floor(100*w.used/nullif(w.allowance,0)))::integer end
    from public.kova_plan_cost_progress(p_user,p_plan,observed) as q
    cross join lateral (values
      ('weekly',date_trunc('week',observed),q.weekly_used,q.weekly_allowance),
      ('five_hour',date_trunc('hour',observed)-interval '4 hours',q.five_hour_used,q.five_hour_allowance)
    ) as w(kind,period,used,allowance)
    where w.kind='weekly' or p_plan<>'pro'
    on conflict(user_id,window_kind,period_start) do update
    set observed_at=excluded.observed_at,percent_used=excluded.percent_used
    where chat_quota_observations.observed_at<=excluded.observed_at;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'kind',window_kind,'start',period_start,'observedAt',observed_at,'percent',percent_used
  ) order by observed_at desc,window_kind)
    from kova_private.chat_quota_observations
    where user_id=p_user and (p_plan<>'pro' or window_kind='weekly')),'[]'::jsonb);
end $$;
revoke all on function public.kova_observe_chat_quota(uuid,text) from public,anon,authenticated;
grant execute on function public.kova_observe_chat_quota(uuid,text) to service_role;
