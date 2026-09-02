-- Make paid-tier resolution exact and live-environment scoped, then expose one
-- service-role-only transaction boundary for Stripe event completion.

create table if not exists public.billing_plan_tiers (
  environment text not null,
  stripe_price_id text not null,
  lookup_key text not null,
  tier text not null,
  primary key (environment, stripe_price_id),
  constraint billing_plan_tiers_environment_check
    check (environment in ('sandbox', 'live')),
  constraint billing_plan_tiers_price_id_check
    check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  constraint billing_plan_tiers_lookup_key_check
    check (lookup_key ~ '^[a-z0-9_]+$'),
  constraint billing_plan_tiers_tier_check
    check (tier in ('plus', 'pro'))
);

alter table public.billing_plan_tiers enable row level security;
revoke all on public.billing_plan_tiers from public, anon, authenticated;
grant select on public.billing_plan_tiers to service_role;

drop policy if exists "Billing plan tiers deny client access"
  on public.billing_plan_tiers;
create policy "Billing plan tiers deny client access"
  on public.billing_plan_tiers
  as restrictive
  for all
  to public
  using (false)
  with check (false);

-- These are the exact active live-mode Prices verified in the Stripe catalog.
-- A future Price or sandbox Price must be added by a reviewed forward migration;
-- an unknown identifier intentionally resolves to free. Historical exact Price
-- rows remain mapped when a lookup key rotates to a new Price.
insert into public.billing_plan_tiers (
  environment,
  stripe_price_id,
  lookup_key,
  tier
)
values
  ('live', 'price_1UAzhHAEZlsb6DBYWw2oUCeO', 'plus_monthly', 'plus'),
  ('live', 'price_1UAzhRAEZlsb6DBYlafU4mhc', 'pro_monthly', 'pro')
on conflict (environment, stripe_price_id) do update
set lookup_key = excluded.lookup_key,
    tier = excluded.tier;

create or replace function public.user_plan_tier(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with active_live_subscriptions as (
    select subscription.price_id
    from public.subscriptions as subscription
    where subscription.user_id = _user_id
      and subscription.environment = 'live'
      and (
        (
          subscription.status in ('active', 'trialing', 'past_due')
          and (
            subscription.current_period_end is null
            or subscription.current_period_end > now()
          )
        )
        or (
          subscription.status = 'canceled'
          and subscription.current_period_end > now()
        )
      )
  ),
  resolution as (
    select
      count(*) as subscription_count,
      count(mapping.tier) as mapped_count,
      count(distinct mapping.tier) as distinct_tier_count,
      min(mapping.tier) as resolved_tier
    from active_live_subscriptions as subscription
    left join public.billing_plan_tiers as mapping
      on mapping.environment = 'live'
      and mapping.stripe_price_id = subscription.price_id
  )
  select case
    when subscription_count > 0
      and subscription_count = mapped_count
      and distinct_tier_count = 1
      then resolved_tier
    else 'free'
  end
  from resolution;
$$;

revoke execute on function public.user_plan_tier(uuid)
  from public, anon, authenticated;
grant execute on function public.user_plan_tier(uuid) to service_role;

create or replace function public.complete_stripe_event(
  _event_id text,
  _event_created_at timestamptz,
  _event_type text,
  _environment text,
  _outcome text,
  _apply_subscription boolean,
  _correlation_id uuid default null,
  _object_id text default null,
  _customer_id text default null,
  _subscription_id text default null,
  _invoice_id text default null,
  _checkout_session_id text default null,
  _product_id text default null,
  _price_id text default null,
  _status text default null,
  _current_period_start timestamptz default null,
  _current_period_end timestamptz default null,
  _cancel_at_period_end boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _event_inserted boolean := false;
  _subscription_applied boolean := false;
  _mapped_user_id uuid;
  _persisted_user_id uuid;
  _persisted_customer_id text;
begin
  if _environment is null or _environment not in ('sandbox', 'live') then
    raise exception 'stripe_environment_invalid' using errcode = '22023';
  end if;
  if coalesce(btrim(_event_id), '') = ''
    or coalesce(btrim(_event_type), '') = ''
    or _event_created_at is null
    or coalesce(btrim(_outcome), '') = '' then
    raise exception 'stripe_event_incomplete' using errcode = '22023';
  end if;

  insert into public.processed_stripe_events (
    event_id,
    type,
    environment,
    processed_at,
    event_created_at,
    correlation_id,
    object_id,
    customer_id,
    subscription_id,
    invoice_id,
    checkout_session_id,
    outcome,
    retryable
  )
  values (
    _event_id,
    _event_type,
    _environment,
    now(),
    _event_created_at,
    _correlation_id,
    _object_id,
    _customer_id,
    _subscription_id,
    _invoice_id,
    _checkout_session_id,
    _outcome,
    false
  )
  on conflict (event_id, environment) do nothing
  returning true into _event_inserted;

  if not coalesce(_event_inserted, false) then
    return jsonb_build_object(
      'duplicate', true,
      'subscriptionApplied', false,
      'stale', false
    );
  end if;

  if not _apply_subscription then
    return jsonb_build_object(
      'duplicate', false,
      'subscriptionApplied', false,
      'stale', false
    );
  end if;

  if coalesce(btrim(_subscription_id), '') = ''
    or coalesce(btrim(_customer_id), '') = ''
    or coalesce(btrim(_product_id), '') = ''
    or coalesce(btrim(_price_id), '') = ''
    or coalesce(btrim(_status), '') = '' then
    raise exception 'authoritative_subscription_incomplete'
      using errcode = '22023';
  end if;

  select mapping.user_id
  into _mapped_user_id
  from public.stripe_customer_mappings as mapping
  where mapping.environment = _environment
    and mapping.stripe_customer_id = _customer_id;

  if _mapped_user_id is null then
    raise exception 'stripe_customer_mapping_missing'
      using errcode = 'P0001';
  end if;

  insert into public.subscriptions as persisted (
    user_id,
    stripe_subscription_id,
    stripe_customer_id,
    product_id,
    price_id,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    environment,
    updated_at,
    last_stripe_event_created_at,
    last_stripe_event_id
  )
  values (
    _mapped_user_id,
    _subscription_id,
    _customer_id,
    _product_id,
    _price_id,
    _status,
    _current_period_start,
    _current_period_end,
    _cancel_at_period_end,
    _environment,
    now(),
    _event_created_at,
    _event_id
  )
  on conflict (stripe_subscription_id, environment) do update
  set product_id = excluded.product_id,
      price_id = excluded.price_id,
      status = excluded.status,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = excluded.updated_at,
      last_stripe_event_created_at = excluded.last_stripe_event_created_at,
      last_stripe_event_id = excluded.last_stripe_event_id
  where persisted.user_id = excluded.user_id
    and persisted.stripe_customer_id = excluded.stripe_customer_id
    and (
      persisted.last_stripe_event_created_at is null
      or (
        persisted.last_stripe_event_created_at,
        coalesce(persisted.last_stripe_event_id, '')
      ) < (
        excluded.last_stripe_event_created_at,
        excluded.last_stripe_event_id
      )
    )
  returning true into _subscription_applied;

  if not coalesce(_subscription_applied, false) then
    select subscription.user_id, subscription.stripe_customer_id
    into _persisted_user_id, _persisted_customer_id
    from public.subscriptions as subscription
    where subscription.environment = _environment
      and subscription.stripe_subscription_id = _subscription_id;

    if _persisted_user_id is distinct from _mapped_user_id
      or _persisted_customer_id is distinct from _customer_id then
      raise exception 'stripe_subscription_identity_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'subscriptionApplied', coalesce(_subscription_applied, false),
    'stale', not coalesce(_subscription_applied, false)
  );
end;
$$;

revoke execute on function public.complete_stripe_event(
  text,
  timestamptz,
  text,
  text,
  text,
  boolean,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  boolean
) from public, anon, authenticated;
grant execute on function public.complete_stripe_event(
  text,
  timestamptz,
  text,
  text,
  text,
  boolean,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  boolean
) to service_role;
