-- Banned users: rows here block expensive actions server-side. Service role only.
create table public.banned_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  banned_at timestamptz not null default now()
);
grant all on public.banned_users to service_role;
alter table public.banned_users enable row level security;
-- No policies for authenticated/anon — table is invisible to end users.

-- Feature flags: maintenance kill-switches for chat, images, uploads, voice, signups.
create table public.feature_flags (
  name text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
grant select on public.feature_flags to authenticated, anon;
grant all on public.feature_flags to service_role;
alter table public.feature_flags enable row level security;
create policy "Flags are publicly readable"
  on public.feature_flags for select to authenticated, anon using (true);

insert into public.feature_flags (name, enabled) values
  ('chat', true),
  ('images', true),
  ('uploads', true),
  ('voice', true),
  ('signups', true)
on conflict (name) do nothing;