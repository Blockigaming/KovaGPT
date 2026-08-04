create table if not exists public.operational_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check(char_length(event_name) between 1 and 80),
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  check(jsonb_typeof(metadata) = 'object'),
  check(octet_length(metadata::text) <= 2048)
);
alter table public.operational_events enable row level security;
create policy "Owners read operational events" on public.operational_events for select to authenticated using(auth.uid()=owner_id);
create policy "Owners insert operational events" on public.operational_events for insert to authenticated with check(auth.uid()=owner_id);
create policy "Owners delete operational events" on public.operational_events for delete to authenticated using(auth.uid()=owner_id);
revoke all on public.operational_events from anon;
grant select,insert,delete on public.operational_events to authenticated;
create index if not exists operational_events_owner_time_idx on public.operational_events(owner_id,created_at desc);
create index if not exists operational_events_expiry_idx on public.operational_events(expires_at);
