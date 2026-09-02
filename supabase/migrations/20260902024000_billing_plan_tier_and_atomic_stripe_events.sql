-- Resolve billing entitlements from exact live Price IDs, serialize every
-- authoritative Stripe subscription observation behind a database-issued
-- lease, and make concurrent Checkout creation converge on one attempt.

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

-- Exact active live-mode Prices verified in the Stripe catalog. Historical
-- exact Price rows remain mapped when a lookup key rotates to a new Price.
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

-- The previous application revision persisted lookup keys. Normalize those
-- verified live rows before exact resolution is enabled.
update public.subscriptions
set price_id = case price_id
  when 'plus_monthly' then 'price_1UAzhHAEZlsb6DBYWw2oUCeO'
  when 'pro_monthly' then 'price_1UAzhRAEZlsb6DBYlafU4mhc'
  else price_id
end
where environment = 'live'
  and price_id in ('plus_monthly', 'pro_monthly');

-- Preserve rollback compatibility: the rollback webhook may still write a
-- lookup key, but the database stores only its reviewed exact live Price ID.
create or replace function public.normalize_legacy_live_subscription_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.environment = 'live' then
    new.price_id := case new.price_id
      when 'plus_monthly' then 'price_1UAzhHAEZlsb6DBYWw2oUCeO'
      when 'pro_monthly' then 'price_1UAzhRAEZlsb6DBYlafU4mhc'
      else new.price_id
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_legacy_live_subscription_price()
  from public, anon, authenticated, service_role;

drop trigger if exists normalize_legacy_live_subscription_price
  on public.subscriptions;
create trigger normalize_legacy_live_subscription_price
before insert or update of price_id, environment
on public.subscriptions
for each row
execute function public.normalize_legacy_live_subscription_price();

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
    when subscription_count = 1
      and mapped_count = 1
      and distinct_tier_count = 1
      then resolved_tier
    else 'free'
  end
  from resolution;
$$;

revoke execute on function public.user_plan_tier(uuid)
  from public, anon, authenticated;
grant execute on function public.user_plan_tier(uuid) to service_role;

create or replace function public.effective_user_plan_tier(_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with principals as (
    select _user_id as user_id
    union
    select public.family_owner_of(_user_id)
  ),
  tiers as (
    select public.user_plan_tier(principal.user_id) as tier
    from principals as principal
    where principal.user_id is not null
  )
  select case
    when bool_or(tier = 'pro') then 'pro'
    when bool_or(tier = 'plus') then 'plus'
    else 'free'
  end
  from tiers;
$$;

revoke execute on function public.effective_user_plan_tier(uuid)
  from public, anon, authenticated;
grant execute on function public.effective_user_plan_tier(uuid)
  to service_role;

create or replace function public.current_user_plan_tier()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then 'free'
    else public.user_plan_tier(auth.uid())
  end;
$$;

revoke execute on function public.current_user_plan_tier()
  from public, anon;
grant execute on function public.current_user_plan_tier()
  to authenticated, service_role;

create or replace function public.current_effective_plan_tier()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then 'free'
    else public.effective_user_plan_tier(auth.uid())
  end;
$$;

revoke execute on function public.current_effective_plan_tier()
  from public, anon;
grant execute on function public.current_effective_plan_tier()
  to authenticated, service_role;

create or replace function public.user_subscription_summary(_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with resolved as (
    select
      public.user_plan_tier(_user_id) as tier,
      public.effective_user_plan_tier(_user_id) as effective_tier
  ),
  chosen as (
    select
      subscription.price_id,
      subscription.status,
      subscription.current_period_end,
      subscription.cancel_at_period_end
    from public.subscriptions as subscription
    join public.billing_plan_tiers as mapping
      on mapping.environment = 'live'
      and mapping.stripe_price_id = subscription.price_id
    cross join resolved
    where resolved.tier in ('plus', 'pro')
      and mapping.tier = resolved.tier
      and subscription.user_id = _user_id
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
    order by
      subscription.current_period_end desc nulls first,
      subscription.created_at desc,
      subscription.id desc
    limit 1
  )
  select jsonb_build_object(
    'tier', resolved.tier,
    'effectiveTier', resolved.effective_tier,
    'inherited',
      case
        when resolved.effective_tier = 'pro' and resolved.tier <> 'pro' then true
        when resolved.effective_tier = 'plus' and resolved.tier = 'free' then true
        else false
      end,
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
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then jsonb_build_object(
      'tier', 'free',
      'effectiveTier', 'free',
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

create sequence if not exists public.stripe_subscription_observation_sequence
  as bigint;

revoke all on sequence public.stripe_subscription_observation_sequence
  from public, anon, authenticated, service_role;

create table if not exists public.stripe_subscription_sync_state (
  environment text not null,
  stripe_subscription_id text not null,
  active_event_id text,
  active_observation_sequence bigint,
  active_lease_token uuid,
  active_lease_expires_at timestamptz,
  applied_observation_sequence bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (environment, stripe_subscription_id),
  constraint stripe_subscription_sync_state_environment_check
    check (environment in ('sandbox', 'live'))
);

alter table public.stripe_subscription_sync_state enable row level security;
revoke all on public.stripe_subscription_sync_state
  from public, anon, authenticated;
grant all on public.stripe_subscription_sync_state to service_role;

drop policy if exists "Stripe subscription sync state denies clients"
  on public.stripe_subscription_sync_state;
create policy "Stripe subscription sync state denies clients"
  on public.stripe_subscription_sync_state
  as restrictive
  for all
  to public
  using (false)
  with check (false);

create table if not exists public.stripe_checkout_attempts (
  environment text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_price_id text not null,
  idempotency_key uuid not null,
  session_expires_at timestamptz not null,
  idempotency_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment, user_id),
  constraint stripe_checkout_attempts_environment_check
    check (environment in ('sandbox', 'live')),
  constraint stripe_checkout_attempts_price_id_check
    check (stripe_price_id ~ '^price_[A-Za-z0-9]+$')
);

alter table public.stripe_checkout_attempts enable row level security;
revoke all on public.stripe_checkout_attempts
  from public, anon, authenticated;
grant all on public.stripe_checkout_attempts to service_role;

drop policy if exists "Stripe checkout attempts deny clients"
  on public.stripe_checkout_attempts;
create policy "Stripe checkout attempts deny clients"
  on public.stripe_checkout_attempts
  as restrictive
  for all
  to public
  using (false)
  with check (false);

alter table public.subscriptions
  add column if not exists last_stripe_observation_sequence bigint;

alter table public.processed_stripe_events
  add column if not exists processing_status text not null default 'completed',
  add column if not exists observation_sequence bigint,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists completed_at timestamptz;

update public.processed_stripe_events
set completed_at = coalesce(completed_at, processed_at)
where processing_status = 'completed';

alter table public.processed_stripe_events
  drop constraint if exists processed_stripe_events_processing_status_check;
alter table public.processed_stripe_events
  add constraint processed_stripe_events_processing_status_check
  check (processing_status in ('pending', 'processing', 'completed')) not valid;
alter table public.processed_stripe_events
  validate constraint processed_stripe_events_processing_status_check;

create or replace function public.begin_stripe_event(
  _event_id text,
  _event_created_at timestamptz,
  _event_type text,
  _environment text,
  _outcome text,
  _subscription_id text default null,
  _correlation_id uuid default null,
  _object_id text default null,
  _customer_id text default null,
  _invoice_id text default null,
  _checkout_session_id text default null,
  _lease_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _event_row public.processed_stripe_events%rowtype;
  _sync_row public.stripe_subscription_sync_state%rowtype;
  _observation_sequence bigint;
  _lease_token uuid;
  _lease_expires_at timestamptz;
begin
  if _environment is null or _environment not in ('sandbox', 'live') then
    raise exception 'stripe_environment_invalid' using errcode = '22023';
  end if;
  if coalesce(btrim(_event_id), '') = ''
    or coalesce(btrim(_event_type), '') = ''
    or _event_created_at is null
    or coalesce(btrim(_outcome), '') = ''
    or _lease_seconds < 15
    or _lease_seconds > 300 then
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
    retryable,
    processing_status
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
    true,
    'pending'
  )
  on conflict (event_id) do nothing;

  select event_row.*
  into _event_row
  from public.processed_stripe_events as event_row
  where event_row.event_id = _event_id
  for update;

  if _event_row.environment is distinct from _environment
    or _event_row.type is distinct from _event_type then
    raise exception 'stripe_event_identity_conflict'
      using errcode = '22023';
  end if;

  if _event_row.processing_status = 'completed' then
    return jsonb_build_object(
      'duplicate', true,
      'busy', false,
      'observationSequence', _event_row.observation_sequence,
      'leaseToken', null,
      'leaseExpiresAt', null
    );
  end if;

  if _event_row.lease_token is not null
    and _event_row.lease_expires_at > clock_timestamp() then
    return jsonb_build_object(
      'duplicate', false,
      'busy', true,
      'observationSequence', _event_row.observation_sequence,
      'leaseToken', null,
      'leaseExpiresAt', _event_row.lease_expires_at
    );
  end if;

  if _subscription_id is not null then
    insert into public.stripe_subscription_sync_state (
      environment,
      stripe_subscription_id
    )
    values (_environment, _subscription_id)
    on conflict (environment, stripe_subscription_id) do nothing;

    select sync_row.*
    into _sync_row
    from public.stripe_subscription_sync_state as sync_row
    where sync_row.environment = _environment
      and sync_row.stripe_subscription_id = _subscription_id
    for update;

    if _sync_row.active_lease_token is not null
      and _sync_row.active_lease_expires_at > clock_timestamp() then
      return jsonb_build_object(
        'duplicate', false,
        'busy', true,
        'observationSequence', null,
        'leaseToken', null,
        'leaseExpiresAt', _sync_row.active_lease_expires_at
      );
    end if;
  end if;

  _observation_sequence :=
    nextval('public.stripe_subscription_observation_sequence');
  _lease_token := gen_random_uuid();
  _lease_expires_at :=
    clock_timestamp() + make_interval(secs => _lease_seconds);

  if _subscription_id is not null then
    update public.stripe_subscription_sync_state
    set active_event_id = _event_id,
        active_observation_sequence = _observation_sequence,
        active_lease_token = _lease_token,
        active_lease_expires_at = _lease_expires_at,
        updated_at = now()
    where environment = _environment
      and stripe_subscription_id = _subscription_id;
  end if;

  update public.processed_stripe_events
  set processing_status = 'processing',
      observation_sequence = _observation_sequence,
      lease_token = _lease_token,
      lease_expires_at = _lease_expires_at,
      retryable = true
  where event_id = _event_id;

  return jsonb_build_object(
    'duplicate', false,
    'busy', false,
    'observationSequence', _observation_sequence,
    'leaseToken', _lease_token,
    'leaseExpiresAt', _lease_expires_at
  );
end;
$$;

revoke execute on function public.begin_stripe_event(
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.begin_stripe_event(
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  integer
) to service_role;

create or replace function public.complete_stripe_event(
  _event_id text,
  _environment text,
  _lease_token uuid,
  _observation_sequence bigint,
  _apply_subscription boolean,
  _customer_id text default null,
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
  _event_row public.processed_stripe_events%rowtype;
  _sync_row public.stripe_subscription_sync_state%rowtype;
  _mapping_found boolean := false;
  _mapped_user_id uuid;
  _persisted_user_id uuid;
  _persisted_customer_id text;
  _subscription_applied boolean := false;
begin
  select event_row.*
  into _event_row
  from public.processed_stripe_events as event_row
  where event_row.event_id = _event_id
  for update;

  if not found
    or _event_row.environment is distinct from _environment then
    raise exception 'stripe_event_claim_missing'
      using errcode = 'P0001';
  end if;

  if _event_row.processing_status = 'completed' then
    return jsonb_build_object(
      'duplicate', true,
      'subscriptionApplied', false,
      'orphaned', _event_row.outcome = 'orphaned_customer'
    );
  end if;

  if _event_row.processing_status <> 'processing'
    or _event_row.lease_token is distinct from _lease_token
    or _event_row.observation_sequence is distinct from _observation_sequence then
    raise exception 'stripe_event_lease_stale'
      using errcode = 'P0001';
  end if;

  if not _apply_subscription then
    update public.processed_stripe_events
    set processing_status = 'completed',
        retryable = false,
        completed_at = now(),
        lease_token = null,
        lease_expires_at = null
    where event_id = _event_id;

    return jsonb_build_object(
      'duplicate', false,
      'subscriptionApplied', false,
      'orphaned', false
    );
  end if;

  if coalesce(btrim(_event_row.subscription_id), '') = ''
    or coalesce(btrim(_customer_id), '') = ''
    or coalesce(btrim(_product_id), '') = ''
    or coalesce(btrim(_price_id), '') = ''
    or coalesce(btrim(_status), '') = '' then
    raise exception 'authoritative_subscription_incomplete'
      using errcode = '22023';
  end if;

  select sync_row.*
  into _sync_row
  from public.stripe_subscription_sync_state as sync_row
  where sync_row.environment = _environment
    and sync_row.stripe_subscription_id = _event_row.subscription_id
  for update;

  if not found
    or _sync_row.active_event_id is distinct from _event_id
    or _sync_row.active_lease_token is distinct from _lease_token
    or _sync_row.active_observation_sequence is distinct from _observation_sequence
    or _sync_row.applied_observation_sequence >= _observation_sequence then
    raise exception 'stripe_subscription_observation_stale'
      using errcode = 'P0001';
  end if;

  select true, mapping.user_id
  into _mapping_found, _mapped_user_id
  from public.stripe_customer_mappings as mapping
  where mapping.environment = _environment
    and mapping.stripe_customer_id = _customer_id
  for update;

  if not _mapping_found then
    raise exception 'stripe_customer_mapping_missing'
      using errcode = 'P0001';
  end if;

  if _mapped_user_id is null then
    update public.stripe_subscription_sync_state
    set applied_observation_sequence = _observation_sequence,
        active_event_id = null,
        active_observation_sequence = null,
        active_lease_token = null,
        active_lease_expires_at = null,
        updated_at = now()
    where environment = _environment
      and stripe_subscription_id = _event_row.subscription_id;

    update public.processed_stripe_events
    set processing_status = 'completed',
        outcome = 'orphaned_customer',
        retryable = false,
        customer_id = _customer_id,
        completed_at = now(),
        lease_token = null,
        lease_expires_at = null
    where event_id = _event_id;

    return jsonb_build_object(
      'duplicate', false,
      'subscriptionApplied', false,
      'orphaned', true
    );
  end if;

  if _environment = 'live'
    and not exists (
      select 1
      from public.billing_plan_tiers as mapping
      where mapping.environment = _environment
        and mapping.stripe_price_id = _price_id
    ) then
    raise exception 'stripe_price_not_registered'
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
    last_stripe_event_id,
    last_stripe_observation_sequence
  )
  values (
    _mapped_user_id,
    _event_row.subscription_id,
    _customer_id,
    _product_id,
    _price_id,
    _status,
    _current_period_start,
    _current_period_end,
    _cancel_at_period_end,
    _environment,
    now(),
    _event_row.event_created_at,
    _event_id,
    _observation_sequence
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
      last_stripe_event_id = excluded.last_stripe_event_id,
      last_stripe_observation_sequence =
        excluded.last_stripe_observation_sequence
  where persisted.user_id = excluded.user_id
    and persisted.stripe_customer_id = excluded.stripe_customer_id
    and coalesce(persisted.last_stripe_observation_sequence, 0)
      < excluded.last_stripe_observation_sequence
  returning true into _subscription_applied;

  if not coalesce(_subscription_applied, false) then
    select subscription.user_id, subscription.stripe_customer_id
    into _persisted_user_id, _persisted_customer_id
    from public.subscriptions as subscription
    where subscription.environment = _environment
      and subscription.stripe_subscription_id = _event_row.subscription_id;

    if _persisted_user_id is distinct from _mapped_user_id
      or _persisted_customer_id is distinct from _customer_id then
      raise exception 'stripe_subscription_identity_conflict'
        using errcode = 'P0001';
    end if;

    raise exception 'stripe_subscription_observation_out_of_order'
      using errcode = 'P0001';
  end if;

  update public.stripe_subscription_sync_state
  set applied_observation_sequence = _observation_sequence,
      active_event_id = null,
      active_observation_sequence = null,
      active_lease_token = null,
      active_lease_expires_at = null,
      updated_at = now()
  where environment = _environment
    and stripe_subscription_id = _event_row.subscription_id;

  update public.processed_stripe_events
  set processing_status = 'completed',
      retryable = false,
      customer_id = _customer_id,
      completed_at = now(),
      lease_token = null,
      lease_expires_at = null
  where event_id = _event_id;

  return jsonb_build_object(
    'duplicate', false,
    'subscriptionApplied', true,
    'orphaned', false
  );
end;
$$;

revoke execute on function public.complete_stripe_event(
  text,
  text,
  uuid,
  bigint,
  boolean,
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
  text,
  uuid,
  bigint,
  boolean,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  boolean
) to service_role;

create or replace function public.claim_stripe_checkout_attempt(
  _user_id uuid,
  _environment text,
  _price_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _mapped_customer_id text;
  _attempt public.stripe_checkout_attempts%rowtype;
  _now timestamptz := clock_timestamp();
begin
  if _environment is null or _environment not in ('sandbox', 'live')
    or coalesce(btrim(_price_id), '') = '' then
    raise exception 'stripe_checkout_attempt_invalid'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.billing_plan_tiers as mapping
    where mapping.environment = _environment
      and mapping.stripe_price_id = _price_id
  ) then
    raise exception 'stripe_price_not_registered'
      using errcode = 'P0001';
  end if;

  select mapping.stripe_customer_id
  into _mapped_customer_id
  from public.stripe_customer_mappings as mapping
  where mapping.environment = _environment
    and mapping.user_id = _user_id
  for update;

  if _mapped_customer_id is null then
    raise exception 'stripe_customer_mapping_missing'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.subscriptions as subscription
    where subscription.user_id = _user_id
      and subscription.environment = _environment
      and (
        (
          subscription.status in ('active', 'trialing', 'past_due')
          and (
            subscription.current_period_end is null
            or subscription.current_period_end > _now
          )
        )
        or (
          subscription.status = 'canceled'
          and subscription.current_period_end > _now
        )
      )
  ) then
    raise exception 'stripe_active_subscription_exists'
      using errcode = 'P0001';
  end if;

  insert into public.stripe_checkout_attempts as attempt (
    environment,
    user_id,
    stripe_price_id,
    idempotency_key,
    session_expires_at,
    idempotency_expires_at
  )
  values (
    _environment,
    _user_id,
    _price_id,
    gen_random_uuid(),
    _now + interval '23 hours',
    _now + interval '24 hours'
  )
  on conflict (environment, user_id) do update
  set stripe_price_id = case
        when attempt.idempotency_expires_at <= _now
          then excluded.stripe_price_id
        else attempt.stripe_price_id
      end,
      idempotency_key = case
        when attempt.idempotency_expires_at <= _now
          then excluded.idempotency_key
        else attempt.idempotency_key
      end,
      session_expires_at = case
        when attempt.idempotency_expires_at <= _now
          then excluded.session_expires_at
        else attempt.session_expires_at
      end,
      idempotency_expires_at = case
        when attempt.idempotency_expires_at <= _now
          then excluded.idempotency_expires_at
        else attempt.idempotency_expires_at
      end,
      updated_at = now()
  where attempt.idempotency_expires_at <= _now
    or attempt.stripe_price_id = excluded.stripe_price_id
  returning attempt.* into _attempt;

  if not found then
    raise exception 'stripe_checkout_attempt_open'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'idempotencyKey', _attempt.idempotency_key,
    'sessionExpiresAt', _attempt.session_expires_at,
    'stripeCustomerId', _mapped_customer_id
  );
end;
$$;

revoke execute on function public.claim_stripe_checkout_attempt(
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.claim_stripe_checkout_attempt(
  uuid,
  text,
  text
) to service_role;
