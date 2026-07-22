-- Connectors, scheduled tasks, sharing, settings, billing usage, and audit foundations.
-- Tokens are never readable through anon/authenticated clients; service operations perform refresh/execution.

create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  status text not null default 'connected' check (status in ('connected','connection_expired','reauthorization_required','permission_incomplete','error','temporarily_unavailable')),
  account_email text,
  safe_identity text,
  granted_scopes text[] not null default '{}',
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  expires_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

create table if not exists public.scheduled_task_runs (
  id text primary key,
  task_id uuid not null references public.scheduled_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_for timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null check (status in ('scheduled','running','complete','failed','canceled','skipped_duplicate')),
  result_summary text,
  delivery_status text check (delivery_status in ('pending','sent','failed','not_configured')),
  failure_type text check (failure_type in ('temporary','permanent','authorization','timeout')),
  retry_eligible boolean not null default false,
  safe_logs text[] not null default '{}',
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  unique(task_id, scheduled_for)
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_run_id text references public.scheduled_task_runs(id) on delete set null,
  channel text not null check (channel in ('in_app','email')),
  status text not null check (status in ('pending','sent','failed','retry','disabled')),
  preview text not null,
  failure text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table if not exists public.chat_share_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  token_hash text not null unique,
  mode text not null default 'snapshot' check (mode in ('snapshot','live')),
  status text not null default 'active' check (status in ('private','active','revoked','expired')),
  snapshot_version integer default 1,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.account_audit_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  safe_description text not null,
  actor_id uuid,
  target_id text,
  result text not null check (result in ('success','failure')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.connected_accounts enable row level security;
alter table public.scheduled_task_runs enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.chat_share_links enable row level security;
alter table public.user_preferences enable row level security;
alter table public.account_audit_entries enable row level security;

create policy if not exists "connected accounts owner read" on public.connected_accounts for select using (auth.uid() = user_id);
create policy if not exists "connected accounts owner delete" on public.connected_accounts for delete using (auth.uid() = user_id);
create policy if not exists "task runs owner read" on public.scheduled_task_runs for select using (auth.uid() = user_id);
create policy if not exists "notifications owner read" on public.notification_deliveries for select using (auth.uid() = user_id);
create policy if not exists "share links owner crud" on public.chat_share_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy if not exists "preferences owner crud" on public.user_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy if not exists "audit owner read" on public.account_audit_entries for select using (auth.uid() = user_id);

create index if not exists idx_connected_accounts_user_provider on public.connected_accounts(user_id, provider);
create index if not exists idx_scheduled_task_runs_user_task on public.scheduled_task_runs(user_id, task_id, scheduled_for desc);
create index if not exists idx_notification_deliveries_user on public.notification_deliveries(user_id, created_at desc);
create index if not exists idx_chat_share_links_token on public.chat_share_links(token_hash);
create index if not exists idx_account_audit_entries_user on public.account_audit_entries(user_id, created_at desc);
