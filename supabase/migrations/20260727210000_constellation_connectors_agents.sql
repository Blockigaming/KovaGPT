-- Project Constellation: server-authoritative connectors, isolated data domains and agent runs.
-- Provider tokens are service-role only and encrypted by the application before insertion.

create table if not exists public.integration_providers (
  id text primary key,
  display_name text not null,
  category text not null,
  enabled boolean not null default false,
  configuration_version integer not null default 1,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_oauth_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  state_hash text not null unique,
  pkce_verifier_ciphertext text,
  nonce_hash text,
  requested_scopes text[] not null default '{}',
  return_path text not null default '/apps',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_linked_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  provider_id text not null,
  provider_account_id text not null,
  account_label text,
  status text not null default 'connected' check (status in ('connected','expired','revoked','permission_incomplete','error','deleting')),
  granted_scopes text[] not null default '{}',
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  credential_key_version integer not null default 1,
  health_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider_id, provider_account_id)
);

create table if not exists public.integration_workspace_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  provider_id text not null,
  enabled boolean not null default true,
  allowed_scopes text[] not null default '{}',
  writes_allowed boolean not null default false,
  configured_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique(workspace_id, provider_id)
);

create table if not exists public.integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  linked_account_id uuid not null references public.integration_linked_accounts(id) on delete cascade,
  kind text not null check (kind in ('initial','incremental','reindex','deletion')),
  status text not null default 'queued' check (status in ('queued','leased','running','retry_wait','completed','partial','failed','cancelled')),
  cursor_ciphertext text,
  attempt integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  processed_count integer not null default 0,
  deleted_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  linked_account_id uuid not null references public.integration_linked_accounts(id) on delete cascade,
  provider_subscription_id text not null,
  secret_reference text,
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','revoked','error')),
  created_at timestamptz not null default now()
);

create table if not exists public.integration_consents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  linked_account_id uuid references public.integration_linked_accounts(id) on delete cascade,
  scopes text[] not null,
  purpose text not null,
  decision text not null check (decision in ('granted','denied','revoked')),
  created_at timestamptz not null default now()
);

create table if not exists public.integration_action_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  linked_account_id uuid references public.integration_linked_accounts(id) on delete cascade,
  tool_name text not null,
  safe_summary text not null,
  shared_fields text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','denied','expired','consumed')),
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  linked_account_id uuid references public.integration_linked_accounts(id) on delete set null,
  provider_id text not null,
  event_type text not null,
  result text not null check (result in ('success','failure','denied')),
  safe_summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.integration_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  linked_account_id uuid references public.integration_linked_accounts(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','provider_revoked','local_deleted','completed','failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error_code text
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  project_id uuid,
  entitlement text not null check (entitlement in ('plus','pro','business','enterprise')),
  idempotency_key text not null,
  objective text not null,
  plan jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued','leased','planning','running','approval_needed','paused','retry_wait','failed','completed','cancelled')),
  attempt integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  policy jsonb not null default '{}'::jsonb,
  current_step integer not null default 0,
  usage jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 days'),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, idempotency_key)
);

create table if not exists public.agent_run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan','action','observation','approval','screenshot','artifact','log','error','result')),
  safe_payload jsonb not null default '{}'::jsonb,
  evidence_sha256 text,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_connections (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null, item_reference_ciphertext text not null, status text not null,
  consented_products text[] not null default '{}', country text not null, last_posted_at timestamptz,
  created_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.health_connections (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null, source_reference_ciphertext text not null, status text not null,
  consented_categories text[] not null default '{}', country text not null, last_accessed_at timestamptz,
  created_at timestamptz not null default now(), deleted_at timestamptz
);

alter table public.integration_oauth_states enable row level security;
alter table public.integration_linked_accounts enable row level security;
alter table public.integration_workspace_policies enable row level security;
alter table public.integration_sync_jobs enable row level security;
alter table public.integration_webhook_subscriptions enable row level security;
alter table public.integration_consents enable row level security;
alter table public.integration_action_approvals enable row level security;
alter table public.integration_audit_events enable row level security;
alter table public.integration_deletion_requests enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_events enable row level security;
alter table public.financial_connections enable row level security;
alter table public.health_connections enable row level security;

create policy "linked account owner read" on public.integration_linked_accounts for select using (auth.uid() = owner_id);
create policy "sync job owner read" on public.integration_sync_jobs for select using (auth.uid() = owner_id);
create policy "consent owner read" on public.integration_consents for select using (auth.uid() = owner_id);
create policy "approval owner read" on public.integration_action_approvals for select using (auth.uid() = owner_id);
create policy "approval owner decide" on public.integration_action_approvals for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "integration audit owner read" on public.integration_audit_events for select using (auth.uid() = owner_id);
create policy "deletion owner read" on public.integration_deletion_requests for select using (auth.uid() = owner_id);
create policy "agent run owner read" on public.agent_runs for select using (auth.uid() = owner_id);
create policy "agent event owner read" on public.agent_run_events for select using (auth.uid() = owner_id);
create policy "finance owner read" on public.financial_connections for select using (auth.uid() = owner_id);
create policy "health owner read" on public.health_connections for select using (auth.uid() = owner_id);

create index if not exists integration_accounts_owner_provider on public.integration_linked_accounts(owner_id, provider_id);
create index if not exists integration_sync_ready on public.integration_sync_jobs(status, available_at);
create index if not exists integration_audit_owner_time on public.integration_audit_events(owner_id, created_at desc);
create index if not exists agent_runs_queue on public.agent_runs(status, available_at);
create index if not exists agent_events_run_time on public.agent_run_events(run_id, created_at);
