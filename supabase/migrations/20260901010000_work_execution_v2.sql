-- Canonical Work execution v2 protocol.
--
-- This is a forward-only source migration. The runtime remains disabled until
-- an explicit service-role activation pins an approved worker source SHA.
-- Historical agent_jobs, agent_runs, events, approvals, and deliverables remain
-- intact. Direct authenticated writes remain prohibited.

alter table public.agent_jobs
  add column if not exists entitlement_snapshot text,
  add column if not exists idempotency_key text,
  add column if not exists allowed_domains text[] not null default '{}'::text[],
  add column if not exists tool_policy jsonb not null default '{"allowed_tools":[]}'::jsonb,
  add column if not exists token_budget integer not null default 12000,
  add column if not exists tokens_used integer not null default 0,
  add column if not exists state_version bigint not null default 1,
  add column if not exists lease_token uuid,
  add column if not exists current_attempt_id uuid,
  add column if not exists requested_action text,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists retry_after timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists source_sha text,
  add column if not exists last_checkpoint_sequence integer not null default 0,
  add column if not exists blocked_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_jobs'::regclass
      and conname = 'agent_jobs_entitlement_snapshot_v2_check'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_entitlement_snapshot_v2_check
      check (entitlement_snapshot is null or entitlement_snapshot in ('plus', 'pro'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_jobs'::regclass
      and conname = 'agent_jobs_idempotency_key_v2_check'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_idempotency_key_v2_check
      check (idempotency_key is null or length(idempotency_key) between 8 and 200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_jobs'::regclass
      and conname = 'agent_jobs_allowed_domains_v2_check'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_allowed_domains_v2_check
      check (cardinality(allowed_domains) <= 50);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_jobs'::regclass
      and conname = 'agent_jobs_tool_policy_v2_check'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_tool_policy_v2_check
      check (jsonb_typeof(tool_policy) = 'object' and pg_column_size(tool_policy) <= 32768);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_jobs'::regclass
      and conname = 'agent_jobs_token_budget_v2_check'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_token_budget_v2_check
      check (token_budget between 1000 and 200000 and tokens_used between 0 and 200000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_jobs'::regclass
      and conname = 'agent_jobs_state_version_v2_check'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_state_version_v2_check
      check (state_version > 0 and last_checkpoint_sequence >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_jobs'::regclass
      and conname = 'agent_jobs_requested_action_v2_check'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_requested_action_v2_check
      check (requested_action is null or requested_action in ('pause', 'cancel'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_jobs'::regclass
      and conname = 'agent_jobs_source_sha_v2_check'
  ) then
    alter table public.agent_jobs
      add constraint agent_jobs_source_sha_v2_check
      check (source_sha is null or source_sha ~ '^[a-f0-9]{40}$');
  end if;
end
$$;

create unique index if not exists agent_jobs_owner_idempotency_v2_idx
  on public.agent_jobs (owner_id, idempotency_key)
  where idempotency_key is not null and deleted_at is null;

create index if not exists agent_jobs_work_queue_v2_idx
  on public.agent_jobs (
    coalesce(retry_after, available_at),
    priority desc,
    created_at,
    id
  )
  where status in ('queued', 'retrying')
    and deleted_at is null
    and cancel_requested_at is null;

create table if not exists public.work_runtime_controls_v2 (
  singleton text primary key default 'global' check (singleton = 'global'),
  enabled boolean not null default false,
  active_source_sha text,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  check (active_source_sha is null or active_source_sha ~ '^[a-f0-9]{40}$'),
  check (not enabled or active_source_sha is not null)
);

insert into public.work_runtime_controls_v2 (singleton, enabled)
values ('global', false)
on conflict (singleton) do nothing;

create table if not exists public.agent_job_attempts_v2 (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.agent_jobs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 10),
  worker_id text not null references public.agent_workers(id) on delete restrict,
  worker_revision text not null,
  source_sha text not null check (source_sha ~ '^[a-f0-9]{40}$'),
  lease_token uuid not null default gen_random_uuid() unique,
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  status text not null default 'running'
    check (status in (
      'running',
      'waiting_approval',
      'succeeded',
      'failed',
      'cancelled',
      'expired',
      'uncertain'
    )),
  provider_request_id text,
  provider_receipt text,
  usage jsonb not null default '{}'::jsonb,
  result_summary text,
  failure_type text,
  safe_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, attempt_number),
  unique (id, job_id),
  check (length(worker_id) between 1 and 240),
  check (length(worker_revision) between 1 and 200),
  check (provider_request_id is null or length(provider_request_id) <= 200),
  check (provider_receipt is null or length(provider_receipt) <= 500),
  check (result_summary is null or length(result_summary) <= 12000),
  check (safe_error is null or length(safe_error) <= 500),
  check (jsonb_typeof(usage) = 'object' and pg_column_size(usage) <= 32768)
);

create index if not exists agent_job_attempts_v2_job_idx
  on public.agent_job_attempts_v2 (job_id, attempt_number desc);

create index if not exists agent_job_attempts_v2_expired_idx
  on public.agent_job_attempts_v2 (lease_expires_at, id)
  where status = 'running';

create table if not exists public.agent_job_checkpoints_v2 (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.agent_jobs(id) on delete cascade,
  attempt_id uuid not null references public.agent_job_attempts_v2(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence between 1 and 10000),
  phase text not null
    check (phase in ('planning', 'executing', 'tool', 'approval', 'finalizing')),
  checkpoint_state jsonb not null,
  integrity_hash text not null check (integrity_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, attempt_id, sequence),
  check (jsonb_typeof(checkpoint_state) = 'object' and pg_column_size(checkpoint_state) <= 262144)
);

create index if not exists agent_job_checkpoints_v2_job_idx
  on public.agent_job_checkpoints_v2 (job_id, sequence desc);

create table if not exists public.agent_job_tool_calls_v2 (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.agent_jobs(id) on delete cascade,
  attempt_id uuid not null references public.agent_job_attempts_v2(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  risk text not null check (risk in ('low', 'medium', 'high')),
  destination text not null,
  idempotency_key text not null,
  status text not null default 'requested'
    check (status in (
      'requested',
      'approval_required',
      'approved',
      'denied',
      'running',
      'succeeded',
      'failed',
      'cancelled'
    )),
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb,
  approval_id uuid references public.agent_approvals(id) on delete set null,
  safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (job_id, idempotency_key),
  check (length(tool_name) between 1 and 120),
  check (length(destination) between 1 and 500),
  check (length(idempotency_key) between 8 and 200),
  check (jsonb_typeof(request_payload) = 'object' and pg_column_size(request_payload) <= 65536),
  check (response_payload is null or pg_column_size(response_payload) <= 262144),
  check (safe_error is null or length(safe_error) <= 500)
);

create index if not exists agent_job_tool_calls_v2_job_idx
  on public.agent_job_tool_calls_v2 (job_id, created_at);

create table if not exists public.agent_job_evidence_v2 (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.agent_jobs(id) on delete cascade,
  attempt_id uuid references public.agent_job_attempts_v2(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null
    check (kind in ('screenshot', 'text', 'json', 'network', 'citation', 'artifact')),
  storage_path text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size between 0 and 10485760),
  integrity_hash text not null check (integrity_hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, storage_path),
  check (length(storage_path) between 1 and 1000),
  check (length(mime_type) between 1 and 200),
  check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 32768)
);

create index if not exists agent_job_evidence_v2_job_idx
  on public.agent_job_evidence_v2 (job_id, created_at);

create table if not exists public.work_worker_heartbeats_v2 (
  environment text primary key,
  worker_revision text not null,
  source_sha text not null check (source_sha ~ '^[a-f0-9]{40}$'),
  status text not null check (status in ('running', 'healthy', 'failed', 'draining')),
  active_jobs integer not null default 0 check (active_jobs between 0 and 64),
  capacity integer not null default 1 check (capacity between 1 and 64),
  last_seen_at timestamptz not null default now(),
  safe_error text,
  updated_at timestamptz not null default now(),
  check (environment ~ '^[a-z0-9][a-z0-9-]{0,49}$'),
  check (length(worker_revision) between 1 and 200),
  check (safe_error is null or length(safe_error) <= 500)
);

alter table public.work_runtime_controls_v2 enable row level security;
alter table public.agent_job_attempts_v2 enable row level security;
alter table public.agent_job_checkpoints_v2 enable row level security;
alter table public.agent_job_tool_calls_v2 enable row level security;
alter table public.agent_job_evidence_v2 enable row level security;
alter table public.work_worker_heartbeats_v2 enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_job_attempts_v2'
      and policyname = 'Owners read Work attempts v2'
  ) then
    execute 'create policy "Owners read Work attempts v2" on public.agent_job_attempts_v2 for select using (auth.uid() = owner_id)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_job_checkpoints_v2'
      and policyname = 'Owners read Work checkpoints v2'
  ) then
    execute 'create policy "Owners read Work checkpoints v2" on public.agent_job_checkpoints_v2 for select using (auth.uid() = owner_id)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_job_tool_calls_v2'
      and policyname = 'Owners read Work tool calls v2'
  ) then
    execute 'create policy "Owners read Work tool calls v2" on public.agent_job_tool_calls_v2 for select using (auth.uid() = owner_id)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_job_evidence_v2'
      and policyname = 'Owners read Work evidence v2'
  ) then
    execute 'create policy "Owners read Work evidence v2" on public.agent_job_evidence_v2 for select using (auth.uid() = owner_id)';
  end if;
end
$$;

-- The old compatibility trigger rejected every insert. Direct authenticated
-- inserts remain denied by RLS; the owner RPC below is the only creation path.
drop trigger if exists enforce_supported_agent_job_kind on public.agent_jobs;

create or replace function public.work_plan_tier_v2(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case public.user_plan_tier(p_user_id)
    when 'pro' then 'pro'
    when 'plus' then 'plus'
    else 'free'
  end;
$$;

create or replace function public.work_max_concurrency_v2(p_tier text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_tier
    when 'pro' then 3
    when 'plus' then 1
    else 0
  end;
$$;

create or replace function public.work_runtime_enabled_v2(p_source_sha text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select controls.enabled
      and controls.active_source_sha is not null
      and (p_source_sha is null or controls.active_source_sha = p_source_sha)
    from public.work_runtime_controls_v2 controls
    where controls.singleton = 'global'
  ), false);
$$;

create or replace function public.set_work_runtime_v2(
  p_enabled boolean,
  p_source_sha text default null
)
returns public.work_runtime_controls_v2
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.work_runtime_controls_v2%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_runtime_control_forbidden' using errcode = '42501';
  end if;
  if p_enabled and (p_source_sha is null or p_source_sha !~ '^[a-f0-9]{40}$') then
    raise exception 'work_runtime_source_sha_required' using errcode = '22023';
  end if;

  insert into public.work_runtime_controls_v2 (
    singleton,
    enabled,
    active_source_sha,
    activated_at,
    updated_at
  ) values (
    'global',
    p_enabled,
    case when p_enabled then p_source_sha else null end,
    case when p_enabled then now() else null end,
    now()
  )
  on conflict (singleton) do update set
    enabled = excluded.enabled,
    active_source_sha = excluded.active_source_sha,
    activated_at = excluded.activated_at,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.owner_create_work_job_v2(
  p_objective text,
  p_project_id uuid,
  p_idempotency_key text,
  p_allowed_domains text[] default '{}'::text[],
  p_tool_policy jsonb default '{"allowed_tools":[]}'::jsonb,
  p_token_budget integer default 12000
)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text;
  v_limit integer;
  v_active integer;
  v_row public.agent_jobs%rowtype;
  v_domains text[];
begin
  if v_user_id is null then
    raise exception 'work_auth_required' using errcode = '42501';
  end if;
  if not public.work_runtime_enabled_v2() then
    raise exception 'work_runtime_unavailable' using errcode = '55000';
  end if;
  if nullif(btrim(p_objective), '') is null or length(p_objective) > 12000 then
    raise exception 'work_objective_invalid' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception 'work_idempotency_key_invalid' using errcode = '22023';
  end if;
  if p_token_budget not between 1000 and 200000 then
    raise exception 'work_token_budget_invalid' using errcode = '22023';
  end if;
  if p_tool_policy is null
    or jsonb_typeof(p_tool_policy) <> 'object'
    or pg_column_size(p_tool_policy) > 32768 then
    raise exception 'work_tool_policy_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(domain order by domain), '{}'::text[])
  into v_domains
  from (
    select distinct lower(btrim(value)) as domain
    from unnest(coalesce(p_allowed_domains, '{}'::text[])) value
    where nullif(btrim(value), '') is not null
      and lower(btrim(value)) ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$'
    limit 50
  ) normalized;

  if cardinality(coalesce(p_allowed_domains, '{}'::text[])) <> cardinality(v_domains) then
    raise exception 'work_allowed_domains_invalid' using errcode = '22023';
  end if;

  if p_project_id is not null and not exists (
    select 1
    from public.projects project
    where project.id = p_project_id
      and (
        project.owner_id = v_user_id
        or exists (
          select 1
          from public.project_members member
          where member.project_id = project.id
            and member.user_id = v_user_id
            and member.role in ('owner', 'editor')
        )
      )
  ) then
    raise exception 'work_project_write_access_required' using errcode = '42501';
  end if;

  v_tier := public.work_plan_tier_v2(v_user_id);
  v_limit := public.work_max_concurrency_v2(v_tier);
  if v_limit = 0 then
    raise exception 'work_paid_plan_required' using errcode = '42501';
  end if;

  select count(*) into v_active
  from public.agent_jobs job
  where job.owner_id = v_user_id
    and job.deleted_at is null
    and job.status in (
      'queued',
      'leased',
      'running',
      'approval_required',
      'paused',
      'retrying',
      'cancelling'
    );
  if v_active >= v_limit then
    raise exception 'work_concurrency_limit_reached' using errcode = '54000';
  end if;

  select * into v_row
  from public.agent_jobs
  where owner_id = v_user_id
    and idempotency_key = p_idempotency_key
    and deleted_at is null;
  if found then
    return v_row;
  end if;

  begin
    insert into public.agent_jobs (
      owner_id,
      project_id,
      kind,
      status,
      input,
      priority,
      attempts,
      max_attempts,
      available_at,
      entitlement_snapshot,
      idempotency_key,
      allowed_domains,
      tool_policy,
      token_budget,
      state_version
    ) values (
      v_user_id,
      p_project_id,
      'team',
      'queued',
      jsonb_build_object(
        'version', 2,
        'objective', btrim(p_objective),
        'allowedDomains', to_jsonb(v_domains),
        'toolPolicy', p_tool_policy
      ),
      0,
      0,
      3,
      now(),
      v_tier,
      p_idempotency_key,
      v_domains,
      p_tool_policy,
      p_token_budget,
      1
    ) returning * into v_row;
  exception
    when unique_violation then
      select * into v_row
      from public.agent_jobs
      where owner_id = v_user_id
        and idempotency_key = p_idempotency_key
        and deleted_at is null;
      if not found then
        raise;
      end if;
  end;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    v_row.id,
    'created',
    jsonb_build_object(
      'version', 2,
      'entitlement', v_tier,
      'project_id', p_project_id,
      'token_budget', p_token_budget
    )
  );

  return v_row;
end;
$$;

create or replace function public.owner_control_work_job_v2(
  p_job_id uuid,
  p_action text
)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.agent_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception 'work_auth_required' using errcode = '42501';
  end if;
  if p_action not in ('pause', 'resume', 'cancel', 'delete') then
    raise exception 'work_control_action_invalid' using errcode = '22023';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = p_job_id
    and owner_id = v_user_id
    and deleted_at is null
  for update;
  if not found then
    raise exception 'work_job_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'delete' then
    if v_job.status not in ('completed', 'failed', 'cancelled') then
      raise exception 'work_active_job_cannot_be_deleted' using errcode = '55000';
    end if;
    update public.agent_jobs
    set deleted_at = now(), updated_at = now(), state_version = state_version + 1
    where id = p_job_id
    returning * into v_job;
  elsif p_action = 'resume' then
    if not public.work_runtime_enabled_v2() then
      raise exception 'work_runtime_unavailable' using errcode = '55000';
    end if;
    if v_job.status <> 'paused' then
      raise exception 'work_invalid_state_transition' using errcode = '55000';
    end if;
    update public.agent_jobs
    set
      status = 'queued',
      available_at = now(),
      paused_at = null,
      requested_action = null,
      cancel_requested_at = null,
      blocked_reason = null,
      state_version = state_version + 1,
      updated_at = now()
    where id = p_job_id
    returning * into v_job;
  elsif p_action in ('pause', 'cancel') and v_job.status in ('leased', 'running', 'cancelling') then
    update public.agent_jobs
    set
      status = 'cancelling',
      requested_action = p_action,
      cancel_requested_at = now(),
      state_version = state_version + 1,
      updated_at = now()
    where id = p_job_id
    returning * into v_job;
  elsif p_action = 'pause' and v_job.status in ('queued', 'retrying', 'approval_required') then
    update public.agent_jobs
    set
      status = 'paused',
      paused_at = now(),
      requested_action = null,
      cancel_requested_at = null,
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      current_attempt_id = null,
      state_version = state_version + 1,
      updated_at = now()
    where id = p_job_id
    returning * into v_job;
  elsif p_action = 'cancel'
    and v_job.status in ('queued', 'retrying', 'approval_required', 'paused') then
    update public.agent_jobs
    set
      status = 'cancelled',
      completed_at = now(),
      requested_action = null,
      cancel_requested_at = now(),
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      current_attempt_id = null,
      state_version = state_version + 1,
      updated_at = now()
    where id = p_job_id
    returning * into v_job;
  else
    raise exception 'work_invalid_state_transition' using errcode = '55000';
  end if;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    p_job_id,
    'owner_command',
    jsonb_build_object('action', p_action, 'status', v_job.status, 'state_version', v_job.state_version)
  );

  return v_job;
end;
$$;

create or replace function public.claim_work_job_v2(
  p_worker_id text,
  p_worker_revision text,
  p_source_sha text,
  p_capacity integer default 1,
  p_lease_seconds integer default 180
)
returns table (
  job_id uuid,
  owner_id uuid,
  attempt_id uuid,
  attempt_number integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  state_version bigint,
  input jsonb,
  tool_policy jsonb,
  allowed_domains text[],
  entitlement text,
  token_budget integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_attempt_number integer;
  v_lease_seconds integer;
  v_capacity integer;
  v_tier text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if not public.work_runtime_enabled_v2(p_source_sha) then
    raise exception 'work_runtime_unavailable' using errcode = '55000';
  end if;
  if nullif(btrim(p_worker_id), '') is null or length(p_worker_id) > 240 then
    raise exception 'work_worker_id_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_worker_revision), '') is null or length(p_worker_revision) > 200 then
    raise exception 'work_worker_revision_invalid' using errcode = '22023';
  end if;
  if p_source_sha !~ '^[a-f0-9]{40}$' then
    raise exception 'work_source_sha_invalid' using errcode = '22023';
  end if;

  v_capacity := greatest(1, least(coalesce(p_capacity, 1), 64));
  v_lease_seconds := greatest(60, least(coalesce(p_lease_seconds, 180), 900));

  insert into public.agent_workers (
    id,
    version,
    state,
    concurrency,
    active_jobs,
    last_seen_at
  ) values (
    p_worker_id,
    p_worker_revision,
    'ready',
    v_capacity,
    0,
    now()
  )
  on conflict (id) do update set
    version = excluded.version,
    state = 'ready',
    concurrency = excluded.concurrency,
    last_seen_at = now();

  select job.* into v_job
  from public.agent_jobs job
  where job.status in ('queued', 'retrying')
    and job.deleted_at is null
    and job.cancel_requested_at is null
    and coalesce(job.retry_after, job.available_at) <= now()
    and public.work_plan_tier_v2(job.owner_id) in ('plus', 'pro')
    and job.attempts < job.max_attempts
    and (
      select count(*)
      from public.agent_jobs active_job
      where active_job.owner_id = job.owner_id
        and active_job.id <> job.id
        and active_job.deleted_at is null
        and active_job.status in ('leased', 'running', 'approval_required', 'cancelling')
    ) < public.work_max_concurrency_v2(public.work_plan_tier_v2(job.owner_id))
  order by coalesce(job.retry_after, job.available_at), job.priority desc, job.created_at, job.id
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  v_tier := public.work_plan_tier_v2(v_job.owner_id);
  v_attempt_number := v_job.attempts + 1;

  insert into public.agent_job_attempts_v2 (
    job_id,
    owner_id,
    attempt_number,
    worker_id,
    worker_revision,
    source_sha,
    lease_expires_at
  ) values (
    v_job.id,
    v_job.owner_id,
    v_attempt_number,
    p_worker_id,
    p_worker_revision,
    p_source_sha,
    now() + make_interval(secs => v_lease_seconds)
  ) returning * into v_attempt;

  update public.agent_jobs
  set
    status = 'leased',
    attempts = v_attempt_number,
    worker_id = p_worker_id,
    lease_token = v_attempt.lease_token,
    lease_expires_at = v_attempt.lease_expires_at,
    current_attempt_id = v_attempt.id,
    retry_after = null,
    source_sha = p_source_sha,
    entitlement_snapshot = v_tier,
    started_at = coalesce(started_at, now()),
    blocked_reason = null,
    updated_at = now()
  where id = v_job.id
  returning * into v_job;

  update public.agent_workers
  set active_jobs = active_jobs + 1, last_seen_at = now()
  where id = p_worker_id;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    v_job.id,
    'claimed',
    jsonb_build_object(
      'attempt_id', v_attempt.id,
      'attempt_number', v_attempt.attempt_number,
      'worker_revision', p_worker_revision,
      'source_sha', p_source_sha
    )
  );

  return query select
    v_job.id,
    v_job.owner_id,
    v_attempt.id,
    v_attempt.attempt_number,
    v_attempt.lease_token,
    v_attempt.lease_expires_at,
    v_job.state_version,
    v_job.input,
    v_job.tool_policy,
    v_job.allowed_domains,
    v_job.entitlement_snapshot,
    v_job.token_budget;
end;
$$;

create or replace function public.heartbeat_work_job_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_state_version bigint,
  p_lease_seconds integer default 180
)
returns table (
  status text,
  requested_action text,
  lease_expires_at timestamptz,
  state_version bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_lease_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;

  select * into v_attempt
  from public.agent_job_attempts_v2
  where id = p_attempt_id
    and job_id = p_job_id
    and lease_token = p_lease_token
  for update;
  if not found or v_attempt.status <> 'running' or v_attempt.lease_expires_at <= now() then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = p_job_id
    and current_attempt_id = p_attempt_id
    and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;

  if v_job.requested_action is not null then
    return query select
      v_job.status,
      v_job.requested_action,
      v_attempt.lease_expires_at,
      v_job.state_version;
    return;
  end if;
  if v_job.state_version <> p_state_version then
    raise exception 'work_state_changed' using errcode = '40001';
  end if;
  if v_job.status not in ('leased', 'running') then
    raise exception 'work_job_not_running' using errcode = '55000';
  end if;

  v_lease_seconds := greatest(60, least(coalesce(p_lease_seconds, 180), 900));

  update public.agent_job_attempts_v2
  set
    lease_expires_at = now() + make_interval(secs => v_lease_seconds),
    heartbeat_at = now(),
    updated_at = now()
  where id = p_attempt_id
  returning * into v_attempt;

  update public.agent_jobs
  set
    status = 'running',
    lease_expires_at = v_attempt.lease_expires_at,
    updated_at = now()
  where id = p_job_id
  returning * into v_job;

  update public.agent_workers
  set last_seen_at = now()
  where id = v_attempt.worker_id;

  return query select
    v_job.status,
    v_job.requested_action,
    v_attempt.lease_expires_at,
    v_job.state_version;
end;
$$;

create or replace function public.checkpoint_work_job_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_state_version bigint,
  p_sequence integer,
  p_phase text,
  p_checkpoint_state jsonb,
  p_integrity_hash text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_id bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_phase not in ('planning', 'executing', 'tool', 'approval', 'finalizing') then
    raise exception 'work_checkpoint_phase_invalid' using errcode = '22023';
  end if;
  if p_integrity_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'work_checkpoint_hash_invalid' using errcode = '22023';
  end if;
  if p_checkpoint_state is null
    or jsonb_typeof(p_checkpoint_state) <> 'object'
    or pg_column_size(p_checkpoint_state) > 262144 then
    raise exception 'work_checkpoint_state_invalid' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.agent_job_attempts_v2
  where id = p_attempt_id
    and job_id = p_job_id
    and lease_token = p_lease_token
  for update;
  if not found or v_attempt.status <> 'running' or v_attempt.lease_expires_at <= now() then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = p_job_id
    and current_attempt_id = p_attempt_id
    and lease_token = p_lease_token
  for update;
  if not found
    or v_job.state_version <> p_state_version
    or v_job.requested_action is not null
    or v_job.status not in ('leased', 'running') then
    raise exception 'work_state_changed' using errcode = '40001';
  end if;
  if p_sequence <> v_job.last_checkpoint_sequence + 1 then
    raise exception 'work_checkpoint_sequence_invalid' using errcode = '22023';
  end if;

  insert into public.agent_job_checkpoints_v2 (
    job_id,
    attempt_id,
    owner_id,
    sequence,
    phase,
    checkpoint_state,
    integrity_hash
  ) values (
    p_job_id,
    p_attempt_id,
    v_job.owner_id,
    p_sequence,
    p_phase,
    p_checkpoint_state,
    p_integrity_hash
  ) returning id into v_id;

  update public.agent_jobs
  set last_checkpoint_sequence = p_sequence, updated_at = now()
  where id = p_job_id;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    p_job_id,
    'checkpoint',
    jsonb_build_object('sequence', p_sequence, 'phase', p_phase, 'integrity_hash', p_integrity_hash)
  );

  return v_id;
end;
$$;

create or replace function public.append_work_event_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_state_version bigint,
  p_event_type text,
  p_safe_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_event_type not in (
    'planning_started',
    'plan_ready',
    'task_started',
    'task_completed',
    'tool_requested',
    'tool_completed',
    'approval_requested',
    'finalizing',
    'log'
  ) then
    raise exception 'work_event_type_invalid' using errcode = '22023';
  end if;
  if p_safe_payload is null
    or jsonb_typeof(p_safe_payload) <> 'object'
    or pg_column_size(p_safe_payload) > 32768 then
    raise exception 'work_event_payload_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.agent_job_attempts_v2 attempt
    join public.agent_jobs job
      on job.id = attempt.job_id
      and job.current_attempt_id = attempt.id
    where attempt.id = p_attempt_id
      and attempt.job_id = p_job_id
      and attempt.lease_token = p_lease_token
      and attempt.status = 'running'
      and attempt.lease_expires_at > now()
      and job.state_version = p_state_version
      and job.requested_action is null
      and job.status in ('leased', 'running')
  ) then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (p_job_id, p_event_type, p_safe_payload)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.request_work_approval_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_state_version bigint,
  p_tool_name text,
  p_reason text,
  p_destination text,
  p_risk text,
  p_request_payload jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_tool_call public.agent_job_tool_calls_v2%rowtype;
  v_approval public.agent_approvals%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_risk not in ('low', 'medium', 'high') then
    raise exception 'work_tool_risk_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_tool_name), '') is null or length(p_tool_name) > 120 then
    raise exception 'work_tool_name_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 1000 then
    raise exception 'work_approval_reason_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_destination), '') is null or length(p_destination) > 500 then
    raise exception 'work_tool_destination_invalid' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception 'work_tool_idempotency_invalid' using errcode = '22023';
  end if;
  if p_request_payload is null
    or jsonb_typeof(p_request_payload) <> 'object'
    or pg_column_size(p_request_payload) > 65536 then
    raise exception 'work_tool_request_invalid' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.agent_job_attempts_v2
  where id = p_attempt_id
    and job_id = p_job_id
    and lease_token = p_lease_token
  for update;
  if not found or v_attempt.status <> 'running' or v_attempt.lease_expires_at <= now() then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = p_job_id
    and current_attempt_id = p_attempt_id
    and lease_token = p_lease_token
  for update;
  if not found
    or v_job.state_version <> p_state_version
    or v_job.requested_action is not null
    or v_job.status not in ('leased', 'running') then
    raise exception 'work_state_changed' using errcode = '40001';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_job.tool_policy -> 'allowed_tools', '[]'::jsonb)) tool(value)
    where tool.value = p_tool_name
  ) then
    raise exception 'work_tool_not_allowed' using errcode = '42501';
  end if;

  select * into v_tool_call
  from public.agent_job_tool_calls_v2
  where job_id = p_job_id and idempotency_key = p_idempotency_key;
  if found and v_tool_call.approval_id is not null then
    return v_tool_call.approval_id;
  end if;

  insert into public.agent_job_tool_calls_v2 (
    job_id,
    attempt_id,
    owner_id,
    tool_name,
    risk,
    destination,
    idempotency_key,
    status,
    request_payload
  ) values (
    p_job_id,
    p_attempt_id,
    v_job.owner_id,
    btrim(p_tool_name),
    p_risk,
    btrim(p_destination),
    p_idempotency_key,
    'approval_required',
    p_request_payload
  ) returning * into v_tool_call;

  insert into public.agent_approvals (
    owner_id,
    run_id,
    tool,
    reason,
    destination,
    risk,
    request_metadata,
    status
  ) values (
    v_job.owner_id,
    p_job_id,
    btrim(p_tool_name),
    btrim(p_reason),
    btrim(p_destination),
    p_risk,
    p_request_payload,
    'pending'
  ) returning * into v_approval;

  update public.agent_job_tool_calls_v2
  set approval_id = v_approval.id, updated_at = now()
  where id = v_tool_call.id;

  update public.agent_job_attempts_v2
  set
    status = 'waiting_approval',
    completed_at = now(),
    updated_at = now()
  where id = p_attempt_id;

  update public.agent_jobs
  set
    status = 'approval_required',
    worker_id = null,
    lease_token = null,
    lease_expires_at = null,
    current_attempt_id = p_attempt_id,
    updated_at = now()
  where id = p_job_id;

  update public.agent_workers
  set active_jobs = greatest(active_jobs - 1, 0), last_seen_at = now()
  where id = v_attempt.worker_id;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    p_job_id,
    'approval_requested',
    jsonb_build_object(
      'approval_id', v_approval.id,
      'tool_call_id', v_tool_call.id,
      'tool', p_tool_name,
      'risk', p_risk
    )
  );

  return v_approval.id;
end;
$$;

create or replace function public.owner_decide_work_approval_v2(
  p_approval_id uuid,
  p_decision text,
  p_edited_request jsonb default null
)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_approval public.agent_approvals%rowtype;
  v_job public.agent_jobs%rowtype;
  v_tool_call public.agent_job_tool_calls_v2%rowtype;
begin
  if v_user_id is null then
    raise exception 'work_auth_required' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'denied') then
    raise exception 'work_approval_decision_invalid' using errcode = '22023';
  end if;
  if p_decision = 'approved' and not public.work_runtime_enabled_v2() then
    raise exception 'work_runtime_unavailable' using errcode = '55000';
  end if;
  if p_edited_request is not null
    and (jsonb_typeof(p_edited_request) <> 'object' or pg_column_size(p_edited_request) > 65536) then
    raise exception 'work_approval_request_invalid' using errcode = '22023';
  end if;

  select * into v_approval
  from public.agent_approvals
  where id = p_approval_id
    and owner_id = v_user_id
    and status = 'pending'
  for update;
  if not found then
    raise exception 'work_approval_not_pending' using errcode = '55000';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = v_approval.run_id
    and owner_id = v_user_id
    and deleted_at is null
  for update;
  if not found or v_job.status <> 'approval_required' then
    raise exception 'work_approval_job_state_invalid' using errcode = '55000';
  end if;

  select * into v_tool_call
  from public.agent_job_tool_calls_v2
  where approval_id = p_approval_id
  for update;
  if not found then
    raise exception 'work_tool_call_not_found' using errcode = 'P0002';
  end if;

  update public.agent_approvals
  set
    status = p_decision,
    request_metadata = coalesce(p_edited_request, request_metadata),
    decided_at = now()
  where id = p_approval_id;

  update public.agent_job_tool_calls_v2
  set
    status = p_decision,
    request_payload = coalesce(p_edited_request, request_payload),
    completed_at = case when p_decision = 'denied' then now() else null end,
    updated_at = now()
  where id = v_tool_call.id;

  if p_decision = 'approved' then
    update public.agent_jobs
    set
      status = 'queued',
      available_at = now(),
      current_attempt_id = null,
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      blocked_reason = null,
      state_version = state_version + 1,
      updated_at = now()
    where id = v_job.id
    returning * into v_job;
  else
    update public.agent_jobs
    set
      status = 'cancelled',
      completed_at = now(),
      current_attempt_id = null,
      worker_id = null,
      lease_token = null,
      lease_expires_at = null,
      blocked_reason = 'approval_denied',
      state_version = state_version + 1,
      updated_at = now()
    where id = v_job.id
    returning * into v_job;
  end if;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    v_job.id,
    'approval_decided',
    jsonb_build_object('approval_id', p_approval_id, 'decision', p_decision)
  );

  return v_job;
end;
$$;

create or replace function public.settle_work_success_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_state_version bigint,
  p_provider_request_id text,
  p_provider_receipt text,
  p_usage jsonb,
  p_result jsonb
)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_summary text;
  v_tokens integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_result is null or pg_column_size(p_result) > 524288 then
    raise exception 'work_result_invalid' using errcode = '22023';
  end if;
  if p_usage is null or jsonb_typeof(p_usage) <> 'object' or pg_column_size(p_usage) > 32768 then
    raise exception 'work_usage_invalid' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.agent_job_attempts_v2
  where id = p_attempt_id
    and job_id = p_job_id
    and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;
  if v_attempt.status = 'succeeded' then
    select * into v_job from public.agent_jobs where id = p_job_id;
    return v_job;
  end if;
  if v_attempt.status <> 'running' or v_attempt.lease_expires_at <= now() then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = p_job_id
    and current_attempt_id = p_attempt_id
    and lease_token = p_lease_token
  for update;
  if not found
    or v_job.status not in ('leased', 'running')
    or v_job.state_version <> p_state_version
    or v_job.requested_action is not null then
    raise exception 'work_state_changed' using errcode = '40001';
  end if;

  v_summary := left(coalesce(nullif(btrim(p_result ->> 'summary'), ''), 'Work completed.'), 12000);
  begin
    v_tokens := greatest(0, least(coalesce((p_usage ->> 'total_tokens')::integer, 0), 200000));
  exception
    when invalid_text_representation then
      raise exception 'work_usage_invalid' using errcode = '22023';
  end;

  update public.agent_job_attempts_v2
  set
    status = 'succeeded',
    provider_request_id = nullif(left(coalesce(p_provider_request_id, ''), 200), ''),
    provider_receipt = nullif(left(coalesce(p_provider_receipt, ''), 500), ''),
    usage = p_usage,
    result_summary = v_summary,
    completed_at = now(),
    updated_at = now()
  where id = p_attempt_id;

  update public.agent_jobs
  set
    status = 'completed',
    result = p_result,
    error = null,
    tokens_used = least(200000, tokens_used + v_tokens),
    worker_id = null,
    lease_token = null,
    lease_expires_at = null,
    current_attempt_id = null,
    requested_action = null,
    cancel_requested_at = null,
    completed_at = now(),
    updated_at = now()
  where id = p_job_id
  returning * into v_job;

  update public.agent_workers
  set active_jobs = greatest(active_jobs - 1, 0), last_seen_at = now()
  where id = v_attempt.worker_id;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    p_job_id,
    'completed',
    jsonb_build_object(
      'attempt_id', p_attempt_id,
      'attempt_number', v_attempt.attempt_number,
      'summary', left(v_summary, 500),
      'total_tokens', v_tokens
    )
  );

  insert into public.agent_notifications (
    owner_id,
    type,
    title,
    body,
    run_id,
    action_url
  ) values (
    v_job.owner_id,
    'run_completed',
    'Work completed',
    left(v_summary, 500),
    p_job_id,
    '/work'
  );

  return v_job;
end;
$$;

create or replace function public.settle_work_failure_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_state_version bigint,
  p_failure_type text,
  p_safe_error text,
  p_retryable boolean
)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_retry boolean;
  v_backoff integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_failure_type not in ('temporary', 'permanent', 'authorization', 'timeout', 'policy') then
    raise exception 'work_failure_type_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_safe_error), '') is null or length(p_safe_error) > 500 then
    raise exception 'work_safe_error_invalid' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.agent_job_attempts_v2
  where id = p_attempt_id
    and job_id = p_job_id
    and lease_token = p_lease_token
  for update;
  if not found or v_attempt.status <> 'running' or v_attempt.lease_expires_at <= now() then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = p_job_id
    and current_attempt_id = p_attempt_id
    and lease_token = p_lease_token
  for update;
  if not found
    or v_job.state_version <> p_state_version
    or v_job.requested_action is not null then
    raise exception 'work_state_changed' using errcode = '40001';
  end if;

  v_retry := p_retryable and v_attempt.attempt_number < v_job.max_attempts;
  v_backoff := least(3600, 30 * power(2, least(v_attempt.attempt_number - 1, 6))::integer);

  update public.agent_job_attempts_v2
  set
    status = 'failed',
    failure_type = p_failure_type,
    safe_error = btrim(p_safe_error),
    completed_at = now(),
    updated_at = now()
  where id = p_attempt_id;

  update public.agent_jobs
  set
    status = case when v_retry then 'retrying' else 'failed' end,
    error = btrim(p_safe_error),
    retry_after = case when v_retry then now() + make_interval(secs => v_backoff) else null end,
    available_at = case when v_retry then now() + make_interval(secs => v_backoff) else available_at end,
    worker_id = null,
    lease_token = null,
    lease_expires_at = null,
    current_attempt_id = null,
    completed_at = case when v_retry then null else now() end,
    updated_at = now()
  where id = p_job_id
  returning * into v_job;

  update public.agent_workers
  set active_jobs = greatest(active_jobs - 1, 0), last_seen_at = now()
  where id = v_attempt.worker_id;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    p_job_id,
    case when v_retry then 'retry_scheduled' else 'failed' end,
    jsonb_build_object(
      'attempt_id', p_attempt_id,
      'attempt_number', v_attempt.attempt_number,
      'failure_type', p_failure_type,
      'retryable', v_retry,
      'retry_after', v_job.retry_after
    )
  );

  if not v_retry then
    insert into public.agent_notifications (
      owner_id,
      type,
      title,
      body,
      run_id,
      action_url
    ) values (
      v_job.owner_id,
      'run_failed',
      'Work failed',
      left(btrim(p_safe_error), 500),
      p_job_id,
      '/work'
    );
  end if;

  return v_job;
end;
$$;

create or replace function public.settle_work_owner_action_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid
)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_action text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;

  select * into v_attempt
  from public.agent_job_attempts_v2
  where id = p_attempt_id
    and job_id = p_job_id
    and lease_token = p_lease_token
  for update;
  if not found or v_attempt.status <> 'running' then
    raise exception 'work_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = p_job_id
    and current_attempt_id = p_attempt_id
    and lease_token = p_lease_token
  for update;
  if not found or v_job.requested_action not in ('pause', 'cancel') then
    raise exception 'work_owner_action_missing' using errcode = '55000';
  end if;

  v_action := v_job.requested_action;

  update public.agent_job_attempts_v2
  set status = 'cancelled', completed_at = now(), updated_at = now()
  where id = p_attempt_id;

  update public.agent_jobs
  set
    status = case when v_action = 'pause' then 'paused' else 'cancelled' end,
    paused_at = case when v_action = 'pause' then now() else paused_at end,
    completed_at = case when v_action = 'cancel' then now() else null end,
    worker_id = null,
    lease_token = null,
    lease_expires_at = null,
    current_attempt_id = null,
    requested_action = null,
    cancel_requested_at = case when v_action = 'cancel' then cancel_requested_at else null end,
    updated_at = now()
  where id = p_job_id
  returning * into v_job;

  update public.agent_workers
  set active_jobs = greatest(active_jobs - 1, 0), last_seen_at = now()
  where id = v_attempt.worker_id;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    p_job_id,
    'owner_action_settled',
    jsonb_build_object('action', v_action, 'status', v_job.status, 'attempt_id', p_attempt_id)
  );

  if v_action = 'pause' then
    insert into public.agent_notifications (
      owner_id,
      type,
      title,
      body,
      run_id,
      action_url
    ) values (
      v_job.owner_id,
      'run_paused',
      'Work paused',
      'The Work run was paused safely.',
      p_job_id,
      '/work'
    );
  end if;

  return v_job;
end;
$$;

create or replace function public.recover_expired_work_attempts_v2()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_job public.agent_jobs%rowtype;
  v_recovered integer := 0;
  v_retry boolean;
  v_backoff integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;

  for v_attempt in
    select attempt.*
    from public.agent_job_attempts_v2 attempt
    where attempt.status = 'running'
      and attempt.lease_expires_at <= now()
    order by attempt.lease_expires_at, attempt.id
    for update skip locked
  loop
    select * into v_job
    from public.agent_jobs
    where id = v_attempt.job_id
    for update;

    update public.agent_job_attempts_v2
    set
      status = 'expired',
      failure_type = 'timeout',
      safe_error = 'The Work worker lease expired before settlement.',
      completed_at = now(),
      updated_at = now()
    where id = v_attempt.id;

    if found and v_job.current_attempt_id = v_attempt.id then
      if v_job.requested_action in ('pause', 'cancel') then
        update public.agent_jobs
        set
          status = case when v_job.requested_action = 'pause' then 'paused' else 'cancelled' end,
          paused_at = case when v_job.requested_action = 'pause' then now() else paused_at end,
          completed_at = case when v_job.requested_action = 'cancel' then now() else null end,
          worker_id = null,
          lease_token = null,
          lease_expires_at = null,
          current_attempt_id = null,
          requested_action = null,
          cancel_requested_at = case
            when v_job.requested_action = 'cancel' then v_job.cancel_requested_at
            else null
          end,
          updated_at = now()
        where id = v_job.id;
      else
        v_retry := v_attempt.attempt_number < v_job.max_attempts;
        v_backoff := least(3600, 30 * power(2, least(v_attempt.attempt_number - 1, 6))::integer);

        update public.agent_jobs
        set
          status = case when v_retry then 'retrying' else 'failed' end,
          error = 'The Work worker lease expired before settlement.',
          retry_after = case
            when v_retry then now() + make_interval(secs => v_backoff)
            else null
          end,
          available_at = case
            when v_retry then now() + make_interval(secs => v_backoff)
            else available_at
          end,
          worker_id = null,
          lease_token = null,
          lease_expires_at = null,
          current_attempt_id = null,
          completed_at = case when v_retry then null else now() end,
          updated_at = now()
        where id = v_job.id;
      end if;

      insert into public.agent_job_events (job_id, event_type, payload)
      values (
        v_job.id,
        'lease_expired',
        jsonb_build_object(
          'attempt_id', v_attempt.id,
          'attempt_number', v_attempt.attempt_number,
          'requested_action', v_job.requested_action
        )
      );
    end if;

    update public.agent_workers
    set active_jobs = greatest(active_jobs - 1, 0), last_seen_at = now()
    where id = v_attempt.worker_id;

    v_recovered := v_recovered + 1;
  end loop;

  return v_recovered;
end;
$$;

create or replace function public.record_work_worker_heartbeat_v2(
  p_environment text,
  p_worker_revision text,
  p_source_sha text,
  p_status text,
  p_active_jobs integer,
  p_capacity integer,
  p_safe_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_environment !~ '^[a-z0-9][a-z0-9-]{0,49}$'
    or nullif(btrim(p_worker_revision), '') is null
    or length(p_worker_revision) > 200
    or p_source_sha !~ '^[a-f0-9]{40}$'
    or p_status not in ('running', 'healthy', 'failed', 'draining')
    or p_active_jobs not between 0 and 64
    or p_capacity not between 1 and 64
    or (p_safe_error is not null and length(p_safe_error) > 500) then
    raise exception 'work_worker_heartbeat_invalid' using errcode = '22023';
  end if;

  insert into public.work_worker_heartbeats_v2 (
    environment,
    worker_revision,
    source_sha,
    status,
    active_jobs,
    capacity,
    last_seen_at,
    safe_error,
    updated_at
  ) values (
    p_environment,
    btrim(p_worker_revision),
    p_source_sha,
    p_status,
    p_active_jobs,
    p_capacity,
    now(),
    p_safe_error,
    now()
  )
  on conflict (environment) do update set
    worker_revision = excluded.worker_revision,
    source_sha = excluded.source_sha,
    status = excluded.status,
    active_jobs = excluded.active_jobs,
    capacity = excluded.capacity,
    last_seen_at = now(),
    safe_error = excluded.safe_error,
    updated_at = now();
end;
$$;

create or replace function public.work_worker_readiness_v2(
  p_environment text,
  p_expected_source_sha text,
  p_stale_seconds integer default 300
)
returns table (
  healthy boolean,
  worker_status text,
  worker_revision text,
  source_sha text,
  heartbeat_age_seconds integer,
  active_jobs integer,
  capacity integer,
  due_jobs integer,
  expired_attempts integer,
  runtime_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_heartbeat public.work_worker_heartbeats_v2%rowtype;
  v_stale integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_environment !~ '^[a-z0-9][a-z0-9-]{0,49}$'
    or p_expected_source_sha !~ '^[a-f0-9]{40}$' then
    raise exception 'work_readiness_input_invalid' using errcode = '22023';
  end if;

  v_stale := greatest(30, least(coalesce(p_stale_seconds, 300), 3600));
  select * into v_heartbeat
  from public.work_worker_heartbeats_v2
  where environment = p_environment;

  return query select
    coalesce(
      v_heartbeat.status = 'healthy'
      and v_heartbeat.source_sha = p_expected_source_sha
      and v_heartbeat.last_seen_at >= now() - make_interval(secs => v_stale)
      and public.work_runtime_enabled_v2(p_expected_source_sha)
      and not exists (
        select 1
        from public.agent_job_attempts_v2 attempt
        where attempt.status = 'running'
          and attempt.lease_expires_at <= now()
      ),
      false
    ),
    v_heartbeat.status,
    v_heartbeat.worker_revision,
    v_heartbeat.source_sha,
    case
      when v_heartbeat.last_seen_at is null then null
      else extract(epoch from (now() - v_heartbeat.last_seen_at))::integer
    end,
    coalesce(v_heartbeat.active_jobs, 0),
    coalesce(v_heartbeat.capacity, 0),
    (
      select count(*)::integer
      from public.agent_jobs job
      where job.status in ('queued', 'retrying')
        and job.deleted_at is null
        and job.cancel_requested_at is null
        and coalesce(job.retry_after, job.available_at) <= now()
    ),
    (
      select count(*)::integer
      from public.agent_job_attempts_v2 attempt
      where attempt.status = 'running'
        and attempt.lease_expires_at <= now()
    ),
    public.work_runtime_enabled_v2(p_expected_source_sha);
end;
$$;

revoke all on table public.work_runtime_controls_v2 from anon, authenticated;
revoke all on table public.agent_job_attempts_v2 from anon, authenticated;
revoke all on table public.agent_job_checkpoints_v2 from anon, authenticated;
revoke all on table public.agent_job_tool_calls_v2 from anon, authenticated;
revoke all on table public.agent_job_evidence_v2 from anon, authenticated;
revoke all on table public.work_worker_heartbeats_v2 from anon, authenticated;

grant select on public.agent_job_attempts_v2 to authenticated;
grant select on public.agent_job_checkpoints_v2 to authenticated;
grant select on public.agent_job_tool_calls_v2 to authenticated;
grant select on public.agent_job_evidence_v2 to authenticated;

revoke all on function public.work_plan_tier_v2(uuid)
  from public, anon, authenticated;
revoke all on function public.work_max_concurrency_v2(text)
  from public, anon, authenticated;
revoke all on function public.work_runtime_enabled_v2(text)
  from public, anon, authenticated;
revoke all on function public.set_work_runtime_v2(boolean, text)
  from public, anon, authenticated;
revoke all on function public.owner_create_work_job_v2(text, uuid, text, text[], jsonb, integer)
  from public, anon;
revoke all on function public.owner_control_work_job_v2(uuid, text)
  from public, anon;
revoke all on function public.claim_work_job_v2(text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_work_job_v2(uuid, uuid, uuid, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.checkpoint_work_job_v2(uuid, uuid, uuid, bigint, integer, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.append_work_event_v2(uuid, uuid, uuid, bigint, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.request_work_approval_v2(uuid, uuid, uuid, bigint, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.owner_decide_work_approval_v2(uuid, text, jsonb)
  from public, anon;
revoke all on function public.settle_work_success_v2(uuid, uuid, uuid, bigint, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.settle_work_failure_v2(uuid, uuid, uuid, bigint, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.settle_work_owner_action_v2(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.recover_expired_work_attempts_v2()
  from public, anon, authenticated;
revoke all on function public.record_work_worker_heartbeat_v2(text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.work_worker_readiness_v2(text, text, integer)
  from public, anon, authenticated;

grant execute on function public.owner_create_work_job_v2(text, uuid, text, text[], jsonb, integer)
  to authenticated;
grant execute on function public.owner_control_work_job_v2(uuid, text)
  to authenticated;
grant execute on function public.owner_decide_work_approval_v2(uuid, text, jsonb)
  to authenticated;

grant execute on function public.work_plan_tier_v2(uuid) to service_role;
grant execute on function public.work_max_concurrency_v2(text) to service_role;
grant execute on function public.work_runtime_enabled_v2(text) to service_role;
grant execute on function public.set_work_runtime_v2(boolean, text) to service_role;
grant execute on function public.claim_work_job_v2(text, text, text, integer, integer)
  to service_role;
grant execute on function public.heartbeat_work_job_v2(uuid, uuid, uuid, bigint, integer)
  to service_role;
grant execute on function public.checkpoint_work_job_v2(uuid, uuid, uuid, bigint, integer, text, jsonb, text)
  to service_role;
grant execute on function public.append_work_event_v2(uuid, uuid, uuid, bigint, text, jsonb)
  to service_role;
grant execute on function public.request_work_approval_v2(uuid, uuid, uuid, bigint, text, text, text, text, jsonb, text)
  to service_role;
grant execute on function public.settle_work_success_v2(uuid, uuid, uuid, bigint, text, text, jsonb, jsonb)
  to service_role;
grant execute on function public.settle_work_failure_v2(uuid, uuid, uuid, bigint, text, text, boolean)
  to service_role;
grant execute on function public.settle_work_owner_action_v2(uuid, uuid, uuid)
  to service_role;
grant execute on function public.recover_expired_work_attempts_v2() to service_role;
grant execute on function public.record_work_worker_heartbeat_v2(text, text, text, text, integer, integer, text)
  to service_role;
grant execute on function public.work_worker_readiness_v2(text, text, integer)
  to service_role;

-- Keep the product and runtime disabled after schema installation. Activation
-- is a separate service-role operation tied to a reviewed exact source SHA.
update public.work_runtime_controls_v2
set enabled = false,
    active_source_sha = null,
    activated_at = null,
    updated_at = now()
where singleton = 'global';
