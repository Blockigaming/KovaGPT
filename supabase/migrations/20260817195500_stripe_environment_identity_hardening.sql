begin;

alter table public.subscriptions
  drop constraint if exists subscriptions_stripe_subscription_id_key;

alter table public.subscriptions
  add constraint subscriptions_stripe_subscription_environment_key
  unique (stripe_subscription_id, environment);

alter table public.processed_stripe_events
  drop constraint if exists processed_stripe_events_pkey;

alter table public.processed_stripe_events
  add constraint processed_stripe_events_pkey
  primary key (event_id, environment);

alter table public.subscriptions
  drop constraint if exists subscriptions_environment_check;

alter table public.subscriptions
  add constraint subscriptions_environment_check
  check (environment in ('sandbox', 'live')) not valid;

alter table public.subscriptions
  validate constraint subscriptions_environment_check;

alter table public.processed_stripe_events
  drop constraint if exists processed_stripe_events_environment_check;

alter table public.processed_stripe_events
  add constraint processed_stripe_events_environment_check
  check (environment in ('sandbox', 'live')) not valid;

alter table public.processed_stripe_events
  validate constraint processed_stripe_events_environment_check;

commit;
