create table public.connector_write_preferences (
  owner_id uuid not null references auth.users(id) on delete cascade,
  connector text not null check (connector in ('gmail', 'google-calendar', 'github', 'onedrive', 'outlook')),
  target_id text not null check (length(target_id) between 1 and 64),
  allows_write boolean not null default false,
  primary key (owner_id, connector, target_id)
);

create table public.connector_directory_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'changes_requested')),
  revision integer not null default 0 check (revision >= 0),
  details jsonb not null check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 16000),
  review_note text check (length(review_note) <= 1000),
  updated_at timestamptz not null default now()
);
create index connector_directory_submissions_owner_idx
  on public.connector_directory_submissions (owner_id, updated_at desc);
create index connector_directory_submissions_status_idx
  on public.connector_directory_submissions (status, updated_at desc);

alter table public.connector_write_preferences enable row level security;
alter table public.connector_directory_submissions enable row level security;
revoke all on public.connector_write_preferences, public.connector_directory_submissions from public, anon, authenticated;
grant select, insert, update, delete on public.connector_write_preferences, public.connector_directory_submissions to service_role;
