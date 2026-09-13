-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Prevent authenticated callers from probing another user's family or billing state.
create or replace function public.family_owner_of(_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result_owner uuid;
begin
  if auth.role() <> 'service_role'
     and ((select auth.uid()) is null or (select auth.uid()) <> _user_id) then
    raise exception 'forbidden_user_scope' using errcode = '42501';
  end if;

  select g.owner_id
    into result_owner
  from public.family_members m
  join public.family_groups g on g.id = m.group_id
  where m.user_id = _user_id
  limit 1;

  return result_owner;
end;
$$;

revoke all on function public.family_owner_of(uuid) from public, anon;
grant execute on function public.family_owner_of(uuid) to authenticated, service_role;

create or replace function public.user_plan_tier(_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  tier text := 'free';
  subscription_row record;
begin
  if auth.role() <> 'service_role'
     and ((select auth.uid()) is null or (select auth.uid()) <> _user_id) then
    raise exception 'forbidden_user_scope' using errcode = '42501';
  end if;

  for subscription_row in
    select price_id, status, current_period_end
    from public.subscriptions
    where user_id = _user_id
    order by created_at desc
    limit 5
  loop
    if (
      subscription_row.status in ('active', 'trialing', 'past_due')
      and (
        subscription_row.current_period_end is null
        or subscription_row.current_period_end > now()
      )
    ) or (
      subscription_row.status = 'canceled'
      and subscription_row.current_period_end > now()
    ) then
      if lower(coalesce(subscription_row.price_id, '')) like '%pro%' then
        return 'pro';
      elsif lower(coalesce(subscription_row.price_id, '')) like '%plus%' then
        tier := 'plus';
      end if;
    end if;
  end loop;

  return tier;
end;
$$;

revoke all on function public.user_plan_tier(uuid) from public, anon;
grant execute on function public.user_plan_tier(uuid) to authenticated, service_role;
;
