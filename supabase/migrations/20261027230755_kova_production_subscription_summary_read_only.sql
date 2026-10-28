-- Production baseline repair: expose existing exact-price billing resolvers.
-- This installs no Prices, subscriptions, Stripe configuration, or paid entitlement.
-- The full Stripe lease migration must be separately reconciled and rehearsed.
begin;

-- This targeted migration is valid only for the audited empty billing baseline.
-- A changed ledger or catalog requires a new review, not a guessed free result.
do $$
begin
  if to_regclass('public.subscriptions') is null
     or to_regclass('public.billing_plan_tiers') is null
     or to_regprocedure('public.billing_user_plan_tier(uuid)') is null
     or to_regprocedure('public.effective_user_plan_tier(uuid)') is null
  then
    raise exception 'billing_summary_baseline_missing' using errcode = 'P0001';
  end if;
  if (to_regprocedure('public.user_subscription_summary(uuid)') is null)
     <> (to_regprocedure('public.current_subscription_summary()') is null)
  then
    raise exception 'billing_summary_partial_installation' using errcode = 'P0001';
  end if;
  if to_regprocedure('public.user_subscription_summary(uuid)') is null
     and (exists (select 1 from public.subscriptions)
          or exists (select 1 from public.billing_plan_tiers)) then
    raise exception 'billing_summary_baseline_changed' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.user_subscription_summary(_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with active_live_subscriptions as (
    select subscription.id
    from public.subscriptions as subscription
    where subscription.user_id = _user_id
      and subscription.environment = 'live'
      and (
        (
          subscription.status in ('active', 'trialing', 'past_due')
          and (
            subscription.current_period_end > now()
          )
        )
        or (
          subscription.status = 'canceled'
          and subscription.current_period_end > now()
        )
      )
  ),
  resolved as (
    select
      public.billing_user_plan_tier(_user_id) as tier,
      public.effective_user_plan_tier(_user_id) as effective_tier,
      (select count(*) from active_live_subscriptions) as active_subscription_count
  ),
  chosen as (
    select
      subscription.price_id,
      subscription.status,
      subscription.current_period_end,
      subscription.cancel_at_period_end
    from public.subscriptions as subscription
    join active_live_subscriptions as active_subscription
      on active_subscription.id = subscription.id
    join public.billing_plan_tiers as mapping
      on mapping.environment = 'live'
      and mapping.stripe_price_id = subscription.price_id
    cross join resolved
    where resolved.tier in ('plus', 'pro')
      and mapping.tier = resolved.tier
    order by
      subscription.current_period_end desc nulls first,
      subscription.created_at desc,
      subscription.id desc
    limit 1
  )
  select jsonb_build_object(
    'tier', resolved.tier,
    'effectiveTier', resolved.effective_tier,
    'activeSubscriptionCount', resolved.active_subscription_count,
    'billingConflict',
      resolved.active_subscription_count > 1
      or (
        resolved.active_subscription_count = 1
        and resolved.tier = 'free'
      ),
    'inherited',
      resolved.active_subscription_count = 0
      and (
        (resolved.effective_tier = 'pro' and resolved.tier <> 'pro')
        or (
          resolved.effective_tier = 'plus'
          and resolved.tier = 'free'
        )
      ),
    'status', chosen.status,
    'priceId', chosen.price_id,
    'currentPeriodEnd', chosen.current_period_end,
    'cancelAtPeriodEnd', coalesce(chosen.cancel_at_period_end, false),
    'trialing', coalesce(chosen.status = 'trialing', false)
  )
  from resolved
  left join chosen on true;
$$;

revoke execute on function public.user_subscription_summary(uuid)
  from public, anon, authenticated;
grant execute on function public.user_subscription_summary(uuid)
  to service_role;

create or replace function public.current_subscription_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then jsonb_build_object(
      'tier', 'free',
      'effectiveTier', 'free',
      'activeSubscriptionCount', 0,
      'billingConflict', false,
      'inherited', false,
      'status', null,
      'priceId', null,
      'currentPeriodEnd', null,
      'cancelAtPeriodEnd', false,
      'trialing', false
    )
    else public.user_subscription_summary(auth.uid())
  end;
$$;

revoke execute on function public.current_subscription_summary()
  from public, anon;
grant execute on function public.current_subscription_summary()
  to authenticated, service_role;

commit;
