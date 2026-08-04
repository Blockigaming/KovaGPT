alter table public.subscriptions add column if not exists last_stripe_event_created_at timestamptz;
alter table public.subscriptions add column if not exists last_stripe_event_id text;
alter table public.processed_stripe_events add column if not exists event_created_at timestamptz;
alter table public.processed_stripe_events add column if not exists object_id text;
alter table public.processed_stripe_events add column if not exists outcome text not null default 'claimed';
create index if not exists subscriptions_stripe_order_idx on public.subscriptions(stripe_subscription_id,environment,last_stripe_event_created_at desc);
create index if not exists processed_stripe_events_order_idx on public.processed_stripe_events(event_created_at desc);
