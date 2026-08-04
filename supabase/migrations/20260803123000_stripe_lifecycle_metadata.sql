alter table public.processed_stripe_events add column if not exists customer_id text;
alter table public.processed_stripe_events add column if not exists subscription_id text;
alter table public.processed_stripe_events add column if not exists invoice_id text;
alter table public.processed_stripe_events add column if not exists checkout_session_id text;
alter table public.processed_stripe_events add column if not exists retryable boolean not null default false;
alter table public.processed_stripe_events add column if not exists payload_hash text;
create index if not exists processed_stripe_events_subscription_order_idx on public.processed_stripe_events(subscription_id,event_created_at desc) where subscription_id is not null;
revoke all on public.processed_stripe_events from anon, authenticated;
