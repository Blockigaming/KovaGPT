create table if not exists public.processed_stripe_events (
  event_id text primary key,
  type text not null,
  environment text not null,
  processed_at timestamptz not null default now()
);

grant all on public.processed_stripe_events to service_role;

alter table public.processed_stripe_events enable row level security;
-- No policies for anon/authenticated; only service_role (webhook handler) writes/reads.
