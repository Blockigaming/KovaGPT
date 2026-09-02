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

commit;
