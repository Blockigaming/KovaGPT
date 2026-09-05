-- Establish immutable, environment-scoped Kova account-to-Customer identity
-- before the atomic event-completion function is introduced.
begin;

create table if not exists public.stripe_customer_mappings (
  environment text not null,
  stripe_customer_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_customer_mappings_pkey primary key (environment, stripe_customer_id),
  constraint stripe_customer_mappings_environment_user_key unique (environment, user_id),
  constraint stripe_customer_mappings_environment_check
    check (environment in ('sandbox', 'live'))
);

alter table public.stripe_customer_mappings enable row level security;
revoke all on public.stripe_customer_mappings from public, anon, authenticated;
grant all on public.stripe_customer_mappings to service_role;

drop policy if exists stripe_customer_mappings_deny_clients
  on public.stripe_customer_mappings;
create policy stripe_customer_mappings_deny_clients
  on public.stripe_customer_mappings
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

do $$
begin
  if exists (
    select 1
    from public.subscriptions
    where stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    group by environment, user_id
    having count(distinct stripe_customer_id) > 1
  ) then
    raise exception 'stripe_customer_backfill_user_conflict';
  end if;

  if exists (
    select 1
    from public.subscriptions
    where stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    group by environment, stripe_customer_id
    having count(distinct user_id) > 1
  ) then
    raise exception 'stripe_customer_backfill_customer_conflict';
  end if;

  if exists (
    select 1
    from (
      select distinct environment, stripe_customer_id, user_id
      from public.subscriptions
      where stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    ) candidate
    join public.stripe_customer_mappings mapping
      on mapping.environment = candidate.environment
     and mapping.stripe_customer_id = candidate.stripe_customer_id
    where mapping.user_id is not null
      and mapping.user_id is distinct from candidate.user_id
  ) then
    raise exception 'stripe_customer_backfill_existing_customer_conflict';
  end if;

  if exists (
    select 1
    from (
      select distinct environment, stripe_customer_id, user_id
      from public.subscriptions
      where stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    ) candidate
    join public.stripe_customer_mappings mapping
      on mapping.environment = candidate.environment
     and mapping.user_id = candidate.user_id
    where mapping.stripe_customer_id <> candidate.stripe_customer_id
  ) then
    raise exception 'stripe_customer_backfill_existing_user_conflict';
  end if;
end;
$$;

insert into public.stripe_customer_mappings as mapping (
  environment,
  stripe_customer_id,
  user_id
)
select distinct
  environment,
  stripe_customer_id,
  user_id
from public.subscriptions
where stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
on conflict (environment, stripe_customer_id) do update
set user_id = excluded.user_id,
    updated_at = now()
where mapping.user_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.subscriptions'::regclass
      and constraint_row.contype = 'u'
      and (
        select array_agg(attribute.attname order by key_column.position)
        from unnest(constraint_row.conkey) with ordinality key_column(attnum, position)
        join pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key_column.attnum
      ) = array['stripe_subscription_id', 'environment']::name[]
  ) then
    alter table public.subscriptions
      add constraint subscriptions_stripe_subscription_environment_key
      unique (stripe_subscription_id, environment);
  end if;
end;
$$;

-- Keep the legacy single-column uniqueness contracts throughout the rollback
-- window. The new composite keys are additive; a later, separately reviewed
-- contract migration may remove the legacy keys after rollback is retired.
do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.processed_stripe_events'::regclass
      and constraint_row.contype = 'u'
      and (
        select array_agg(attribute.attname order by key_column.position)
        from unnest(constraint_row.conkey) with ordinality key_column(attnum, position)
        join pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key_column.attnum
      ) = array['event_id', 'environment']::name[]
  ) then
    alter table public.processed_stripe_events
      add constraint processed_stripe_events_event_environment_key
      unique (event_id, environment);
  end if;
end;
$$;

alter table public.subscriptions
  drop constraint if exists subscriptions_environment_check;
alter table public.subscriptions
  add constraint subscriptions_environment_check
  check (environment in ('sandbox', 'live')) not valid;
alter table public.subscriptions validate constraint subscriptions_environment_check;

alter table public.processed_stripe_events
  drop constraint if exists processed_stripe_events_environment_check;
alter table public.processed_stripe_events
  add constraint processed_stripe_events_environment_check
  check (environment in ('sandbox', 'live')) not valid;
alter table public.processed_stripe_events
  validate constraint processed_stripe_events_environment_check;

-- Fence first-Customer network work before it can create an unregistered object.
-- Pending outcomes never age out into permission to delete Auth or create a new
-- Customer: a missing result is not proof that Stripe performed no mutation.
create schema if not exists kova_private;
create table if not exists public.account_deletion_fences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.account_deletion_fences enable row level security;
revoke all on public.account_deletion_fences from public, anon, authenticated;
grant all on public.account_deletion_fences to service_role;

create table public.stripe_customer_creation_requests (
  environment text not null check (environment in ('sandbox', 'live')),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null default gen_random_uuid(),
  state text not null default 'pending' check (state in ('pending', 'mapped')),
  requested_at timestamptz not null default now(),
  primary key (environment, user_id)
);
alter table public.stripe_customer_creation_requests enable row level security;
revoke all on public.stripe_customer_creation_requests from public, anon, authenticated;
grant all on public.stripe_customer_creation_requests to service_role;

create function public.claim_stripe_customer_creation(_user_id uuid, _environment text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare request_row public.stripe_customer_creation_requests%rowtype;
begin
  if _user_id is null or _environment not in ('sandbox', 'live') then
    raise exception 'stripe_customer_creation_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_user_id::text, 20260903204500));
  if exists (select 1 from public.account_deletion_fences where user_id = _user_id) then
    raise exception 'account_deletion_pending';
  end if;
  insert into public.stripe_customer_creation_requests (user_id, environment)
  values (_user_id, _environment) on conflict do nothing;
  select * into strict request_row from public.stripe_customer_creation_requests
    where user_id = _user_id and environment = _environment for update;
  return jsonb_build_object('requestId', request_row.request_id,
    'requestedAt', request_row.requested_at, 'state', request_row.state);
end;
$$;
revoke all on function public.claim_stripe_customer_creation(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_customer_creation(uuid, text) to service_role;

create function public.complete_stripe_customer_creation(
  _user_id uuid, _environment text, _request_id uuid, _customer_id text
) returns text language plpgsql security invoker set search_path = '' as $$
declare customer_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended(_user_id::text, 20260903204500));
  if exists (select 1 from public.account_deletion_fences where user_id = _user_id) then
    raise exception 'account_deletion_pending';
  end if;
  if _customer_id !~ '^cus_[A-Za-z0-9]+$' or not exists (
    select 1 from public.stripe_customer_creation_requests
    where user_id = _user_id and environment = _environment and request_id = _request_id
  ) then raise exception 'stripe_customer_creation_mismatch'; end if;
  insert into public.stripe_customer_mappings (environment, stripe_customer_id, user_id)
    values (_environment, _customer_id, _user_id) on conflict do nothing;
  select stripe_customer_id into customer_id from public.stripe_customer_mappings
    where user_id = _user_id and environment = _environment;
  if customer_id is distinct from _customer_id then
    raise exception 'stripe_customer_mapping_conflict';
  end if;
  update public.stripe_customer_creation_requests set state = 'mapped'
    where user_id = _user_id and environment = _environment and request_id = _request_id;
  return customer_id;
end;
$$;
revoke all on function public.complete_stripe_customer_creation(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_stripe_customer_creation(uuid, text, uuid, text) to service_role;

create function public.prepare_stripe_account_deletion(_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(_user_id::text, 20260903204500));
  if not exists (select 1 from public.account_deletion_fences where user_id = _user_id) then
    raise exception 'account_deletion_fence_required';
  end if;
  if exists (select 1 from public.stripe_customer_creation_requests
    where user_id = _user_id and state = 'pending') then
    raise exception 'stripe_customer_creation_pending';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('environment', environment,
    'stripe_customer_id', stripe_customer_id)) from public.stripe_customer_mappings
    where user_id = _user_id), '[]'::jsonb);
end;
$$;
revoke all on function public.prepare_stripe_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_stripe_account_deletion(uuid) to service_role;

create function kova_private.reject_unsettled_customer_auth_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.id::text, 20260903204500));
  if exists (select 1 from public.stripe_customer_creation_requests
    where user_id = old.id and state = 'pending') then
    raise exception 'stripe_customer_creation_pending';
  end if;
  return old;
end;
$$;
revoke all on function kova_private.reject_unsettled_customer_auth_deletion() from public, anon, authenticated;
create trigger reject_unsettled_customer_auth_deletion before delete on auth.users
  for each row execute function kova_private.reject_unsettled_customer_auth_deletion();

commit;
