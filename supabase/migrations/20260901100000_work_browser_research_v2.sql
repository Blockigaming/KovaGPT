-- Work browser-research v2.
--
-- Forward-only source migration. It adds a separately gated browser/research
-- runtime, durable tool/evidence settlement, and kind-specific claims. Nothing
-- here enables Work, applies a migration, starts a worker, or deploys Azure.

alter table public.agent_jobs
  drop constraint if exists agent_jobs_team_only;
alter table public.agent_jobs
  drop constraint if exists agent_jobs_kind_v3_check;
alter table public.agent_jobs
  add constraint agent_jobs_kind_v3_check
  check (kind in ('team', 'browser'));

alter table public.work_runtime_controls_v2
  add column if not exists browser_enabled boolean not null default false,
  add column if not exists browser_active_source_sha text,
  add column if not exists browser_activated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.work_runtime_controls_v2'::regclass
      and conname = 'work_runtime_browser_sha_v2_check'
  ) then
    alter table public.work_runtime_controls_v2
      add constraint work_runtime_browser_sha_v2_check
      check (
        browser_active_source_sha is null
        or browser_active_source_sha ~ '^[a-f0-9]{40}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.work_runtime_controls_v2'::regclass
      and conname = 'work_runtime_browser_enabled_v2_check'
  ) then
    alter table public.work_runtime_controls_v2
      add constraint work_runtime_browser_enabled_v2_check
      check (not browser_enabled or browser_active_source_sha is not null);
  end if;
end
$$;

update public.work_runtime_controls_v2
set
  browser_enabled = false,
  browser_active_source_sha = null,
  browser_activated_at = null,
  updated_at = now()
where singleton = 'global';

create table if not exists public.work_browser_worker_heartbeats_v2 (
  environment text primary key,
  worker_revision text not null,
  source_sha text not null check (source_sha ~ '^[a-f0-9]{40}$'),
  status text not null check (status in ('running', 'healthy', 'failed', 'draining')),
  active_jobs integer not null default 0 check (active_jobs between 0 and 16),
  capacity integer not null default 1 check (capacity between 1 and 16),
  last_seen_at timestamptz not null default now(),
  safe_error text,
  updated_at timestamptz not null default now(),
  check (environment ~ '^[a-z0-9][a-z0-9-]{0,49}$'),
  check (length(worker_revision) between 1 and 200),
  check (safe_error is null or length(safe_error) <= 500)
);

alter table public.work_browser_worker_heartbeats_v2 enable row level security;

create or replace function public.work_browser_runtime_enabled_v2(
  p_source_sha text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select controls.enabled
      and controls.browser_enabled
      and controls.active_source_sha is not null
      and controls.browser_active_source_sha is not null
      and controls.active_source_sha = controls.browser_active_source_sha
      and (p_source_sha is null or controls.browser_active_source_sha = p_source_sha)
    from public.work_runtime_controls_v2 controls
    where controls.singleton = 'global'
  ), false);
$$;

create or replace function public.set_work_browser_runtime_v2(
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
    raise exception 'work_browser_runtime_control_forbidden' using errcode = '42501';
  end if;
  if p_enabled and (p_source_sha is null or p_source_sha !~ '^[a-f0-9]{40}$') then
    raise exception 'work_browser_runtime_source_sha_required' using errcode = '22023';
  end if;

  select * into v_row
  from public.work_runtime_controls_v2
  where singleton = 'global'
  for update;
  if not found then
    raise exception 'work_runtime_control_missing' using errcode = 'P0002';
  end if;
  if p_enabled and (not v_row.enabled or v_row.active_source_sha <> p_source_sha) then
    raise exception 'work_model_runtime_source_mismatch' using errcode = '55000';
  end if;

  update public.work_runtime_controls_v2
  set
    browser_enabled = p_enabled,
    browser_active_source_sha = case when p_enabled then p_source_sha else null end,
    browser_activated_at = case when p_enabled then now() else null end,
    updated_at = now()
  where singleton = 'global'
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.owner_create_browser_work_job_v2(
  p_objective text,
  p_project_id uuid,
  p_source_urls text[],
  p_idempotency_key text,
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
  v_url text;
  v_domain text;
  v_urls text[] := '{}'::text[];
  v_domains text[] := '{}'::text[];
begin
  if v_user_id is null then
    raise exception 'work_auth_required' using errcode = '42501';
  end if;
  if not public.work_runtime_enabled_v2()
    or not public.work_browser_runtime_enabled_v2() then
    raise exception 'work_browser_runtime_unavailable' using errcode = '55000';
  end if;
  if nullif(btrim(p_objective), '') is null or length(p_objective) > 12000 then
    raise exception 'work_objective_invalid' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception 'work_idempotency_key_invalid' using errcode = '22023';
  end if;
  if p_token_budget not between 1000 and 50000 then
    raise exception 'work_token_budget_invalid' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_source_urls, '{}'::text[])) not between 1 and 10 then
    raise exception 'work_browser_source_count_invalid' using errcode = '22023';
  end if;

  foreach v_url in array p_source_urls loop
    v_url := btrim(v_url);
    if length(v_url) > 2000
      or v_url !~ '^https://[A-Za-z0-9.-]+(?:[/?#][^[:space:]]*)?$' then
      raise exception 'work_browser_source_url_invalid' using errcode = '22023';
    end if;

    v_domain := lower(substring(v_url from '^https://([^/?#:]+)'));
    if v_domain is null
      or v_domain = 'localhost'
      or v_domain like '%.localhost'
      or v_domain like '%.local'
      or v_domain ~ '^[0-9.]+$'
      or v_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
      raise exception 'work_browser_source_host_invalid' using errcode = '22023';
    end if;

    if not v_url = any(v_urls) then
      v_urls := array_append(v_urls, v_url);
    end if;
    if not v_domain = any(v_domains) then
      v_domains := array_append(v_domains, v_domain);
    end if;
  end loop;

  if cardinality(v_urls) not between 1 and 10
    or cardinality(v_urls) <> cardinality(p_source_urls) then
    raise exception 'work_browser_sources_duplicate_or_invalid' using errcode = '22023';
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

  select * into v_row
  from public.agent_jobs
  where owner_id = v_user_id
    and idempotency_key = p_idempotency_key
    and deleted_at is null;
  if found then
    return v_row;
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
      'browser',
      'queued',
      jsonb_build_object(
        'version', 3,
        'objective', btrim(p_objective),
        'sourceUrls', to_jsonb(v_urls),
        'allowedDomains', to_jsonb(v_domains),
        'toolPolicy', jsonb_build_object(
          'allowed_tools', jsonb_build_array('browser.read'),
          'max_pages', cardinality(v_urls),
          'downloads', false,
          'writes', false
        )
      ),
      0,
      0,
      3,
      now(),
      v_tier,
      p_idempotency_key,
      v_domains,
      jsonb_build_object(
        'allowed_tools', jsonb_build_array('browser.read'),
        'max_pages', cardinality(v_urls),
        'downloads', false,
        'writes', false
      ),
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
      'version', 3,
      'runtime', 'browser_research_v2',
      'entitlement', v_tier,
      'project_id', p_project_id,
      'source_count', cardinality(v_urls),
      'token_budget', p_token_budget
    )
  );

  return v_row;
end;
$$;

create or replace function public.claim_work_job_kind_v3(
  p_kind text,
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
  if p_kind not in ('team', 'browser') then
    raise exception 'work_kind_invalid' using errcode = '22023';
  end if;
  if not public.work_runtime_enabled_v2(p_source_sha) then
    raise exception 'work_runtime_unavailable' using errcode = '55000';
  end if;
  if p_kind = 'browser' and not public.work_browser_runtime_enabled_v2(p_source_sha) then
    raise exception 'work_browser_runtime_unavailable' using errcode = '55000';
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

  v_capacity := greatest(1, least(coalesce(p_capacity, 1), 16));
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
  where job.kind = p_kind
    and job.status in ('queued', 'retrying')
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
      'source_sha', p_source_sha,
      'runtime', case
        when p_kind = 'browser' then 'browser_research_v2'
        else 'model_only_v2'
      end
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
language sql
security definer
set search_path = public
as $$
  select *
  from public.claim_work_job_kind_v3(
    'team',
    p_worker_id,
    p_worker_revision,
    p_source_sha,
    p_capacity,
    p_lease_seconds
  );
$$;

create or replace function public.claim_browser_work_job_v2(
  p_worker_id text,
  p_worker_revision text,
  p_source_sha text,
  p_capacity integer default 1,
  p_lease_seconds integer default 300
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
language sql
security definer
set search_path = public
as $$
  select *
  from public.claim_work_job_kind_v3(
    'browser',
    p_worker_id,
    p_worker_revision,
    p_source_sha,
    p_capacity,
    p_lease_seconds
  );
$$;

create or replace function public.record_work_browser_tool_result_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_state_version bigint,
  p_idempotency_key text,
  p_destination text,
  p_status text,
  p_response_payload jsonb default null,
  p_safe_error text default null,
  p_evidence jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_attempt public.agent_job_attempts_v2%rowtype;
  v_tool public.agent_job_tool_calls_v2%rowtype;
  v_host text;
  v_evidence jsonb;
  v_path text;
  v_kind text;
  v_mime text;
  v_hash text;
  v_bytes bigint;
  v_metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_status not in ('succeeded', 'failed') then
    raise exception 'work_browser_tool_status_invalid' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200 then
    raise exception 'work_tool_idempotency_invalid' using errcode = '22023';
  end if;
  if p_destination is null
    or length(p_destination) > 2000
    or p_destination !~ '^https://[A-Za-z0-9.-]+(?:[/?#][^[:space:]]*)?$' then
    raise exception 'work_browser_destination_invalid' using errcode = '22023';
  end if;
  if p_response_payload is not null
    and (jsonb_typeof(p_response_payload) <> 'object' or pg_column_size(p_response_payload) > 262144) then
    raise exception 'work_browser_response_invalid' using errcode = '22023';
  end if;
  if p_safe_error is not null and length(p_safe_error) > 500 then
    raise exception 'work_browser_safe_error_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_evidence, '[]'::jsonb)) <> 'array'
    or pg_column_size(coalesce(p_evidence, '[]'::jsonb)) > 65536 then
    raise exception 'work_browser_evidence_invalid' using errcode = '22023';
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
    and kind = 'browser'
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
    where tool.value = 'browser.read'
  ) then
    raise exception 'work_browser_tool_not_allowed' using errcode = '42501';
  end if;

  v_host := lower(substring(p_destination from '^https://([^/?#:]+)'));
  if v_host is null or not v_host = any(v_job.allowed_domains) then
    raise exception 'work_browser_destination_not_allowlisted' using errcode = '42501';
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
    request_payload,
    response_payload,
    safe_error,
    completed_at
  ) values (
    p_job_id,
    p_attempt_id,
    v_job.owner_id,
    'browser.read',
    'low',
    p_destination,
    p_idempotency_key,
    p_status,
    jsonb_build_object('url', p_destination),
    p_response_payload,
    p_safe_error,
    now()
  )
  on conflict (job_id, idempotency_key) do update set
    attempt_id = excluded.attempt_id,
    status = excluded.status,
    response_payload = excluded.response_payload,
    safe_error = excluded.safe_error,
    completed_at = now(),
    updated_at = now()
  returning * into v_tool;

  for v_evidence in
    select value
    from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) item(value)
  loop
    if jsonb_typeof(v_evidence) <> 'object' then
      raise exception 'work_browser_evidence_item_invalid' using errcode = '22023';
    end if;

    v_path := v_evidence ->> 'storage_path';
    v_kind := v_evidence ->> 'kind';
    v_mime := v_evidence ->> 'mime_type';
    v_hash := v_evidence ->> 'integrity_hash';
    v_metadata := coalesce(v_evidence -> 'metadata', '{}'::jsonb);
    begin
      v_bytes := (v_evidence ->> 'byte_size')::bigint;
    exception
      when invalid_text_representation then
        raise exception 'work_browser_evidence_size_invalid' using errcode = '22023';
    end;

    if v_path is null
      or length(v_path) > 1000
      or v_path not like format('%s/%s/%%', v_job.owner_id, v_job.id)
      or v_kind not in ('screenshot', 'text', 'json', 'network', 'citation', 'artifact')
      or v_mime not in ('image/png', 'image/jpeg', 'text/plain', 'application/json')
      or v_bytes not between 0 and 10485760
      or v_hash !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(v_metadata) <> 'object'
      or pg_column_size(v_metadata) > 32768 then
      raise exception 'work_browser_evidence_item_invalid' using errcode = '22023';
    end if;

    insert into public.agent_job_evidence_v2 (
      job_id,
      attempt_id,
      owner_id,
      kind,
      storage_path,
      mime_type,
      byte_size,
      integrity_hash,
      metadata
    ) values (
      p_job_id,
      p_attempt_id,
      v_job.owner_id,
      v_kind,
      v_path,
      v_mime,
      v_bytes,
      v_hash,
      v_metadata || jsonb_build_object('tool_call_id', v_tool.id)
    )
    on conflict (job_id, storage_path) do update set
      attempt_id = excluded.attempt_id,
      kind = excluded.kind,
      mime_type = excluded.mime_type,
      byte_size = excluded.byte_size,
      integrity_hash = excluded.integrity_hash,
      metadata = excluded.metadata;
  end loop;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    p_job_id,
    'tool_completed',
    jsonb_build_object(
      'tool_call_id', v_tool.id,
      'tool', 'browser.read',
      'status', p_status,
      'destination_host', v_host,
      'evidence_count', jsonb_array_length(coalesce(p_evidence, '[]'::jsonb))
    )
  );

  return v_tool.id;
end;
$$;

create or replace function public.settle_work_browser_success_v2(
  p_job_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_state_version bigint,
  p_provider_request_id text,
  p_provider_receipt text,
  p_usage jsonb,
  p_result jsonb,
  p_report_title text,
  p_report_storage_path text,
  p_report_byte_size bigint,
  p_report_integrity_hash text
)
returns public.agent_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.agent_jobs%rowtype;
  v_settled public.agent_jobs%rowtype;
  v_evidence jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;

  select * into v_job
  from public.agent_jobs
  where id = p_job_id and kind = 'browser'
  for update;
  if not found then
    raise exception 'work_browser_job_not_found' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_report_title), '') is null or length(p_report_title) > 240 then
    raise exception 'work_browser_report_title_invalid' using errcode = '22023';
  end if;
  if p_report_storage_path is null
    or length(p_report_storage_path) > 1000
    or p_report_storage_path not like format('%s/%s/%%', v_job.owner_id, v_job.id)
    or p_report_byte_size not between 1 and 10485760
    or p_report_integrity_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'work_browser_report_invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.agent_job_tool_calls_v2 tool_call
    where tool_call.job_id = p_job_id
      and tool_call.status = 'succeeded'
      and tool_call.tool_name = 'browser.read'
  ) then
    raise exception 'work_browser_has_no_successful_sources' using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.agent_job_evidence_v2 evidence
    where evidence.job_id = p_job_id
      and evidence.attempt_id = p_attempt_id
  ) then
    raise exception 'work_browser_has_no_evidence' using errcode = '55000';
  end if;

  insert into public.agent_job_evidence_v2 (
    job_id,
    attempt_id,
    owner_id,
    kind,
    storage_path,
    mime_type,
    byte_size,
    integrity_hash,
    metadata
  ) values (
    p_job_id,
    p_attempt_id,
    v_job.owner_id,
    'artifact',
    p_report_storage_path,
    'text/plain',
    p_report_byte_size,
    p_report_integrity_hash,
    jsonb_build_object('role', 'research_report')
  )
  on conflict (job_id, storage_path) do update set
    attempt_id = excluded.attempt_id,
    byte_size = excluded.byte_size,
    integrity_hash = excluded.integrity_hash,
    metadata = excluded.metadata;

  select * into v_settled
  from public.settle_work_success_v2(
    p_job_id,
    p_attempt_id,
    p_lease_token,
    p_state_version,
    p_provider_request_id,
    p_provider_receipt,
    p_usage,
    p_result
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', evidence.id,
    'kind', evidence.kind,
    'storage_path', evidence.storage_path,
    'integrity_hash', evidence.integrity_hash
  ) order by evidence.created_at), '[]'::jsonb)
  into v_evidence
  from public.agent_job_evidence_v2 evidence
  where evidence.job_id = p_job_id;

  insert into public.agent_deliverables (
    owner_id,
    run_id,
    project_id,
    type,
    deliverable_key,
    title,
    mime_type,
    storage_reference,
    source_evidence,
    revision,
    status,
    integrity_hash
  ) values (
    v_job.owner_id,
    p_job_id,
    v_job.project_id,
    'research_report',
    p_job_id,
    btrim(p_report_title),
    'text/markdown',
    p_report_storage_path,
    v_evidence,
    1,
    'ready',
    p_report_integrity_hash
  )
  on conflict (owner_id, deliverable_key, revision) do update set
    title = excluded.title,
    mime_type = excluded.mime_type,
    storage_reference = excluded.storage_reference,
    source_evidence = excluded.source_evidence,
    status = 'ready',
    integrity_hash = excluded.integrity_hash;

  insert into public.agent_job_events (job_id, event_type, payload)
  values (
    p_job_id,
    'task_completed',
    jsonb_build_object(
      'runtime', 'browser_research_v2',
      'deliverable_key', p_job_id,
      'evidence_count', jsonb_array_length(v_evidence)
    )
  );

  return v_settled;
end;
$$;

create or replace function public.record_work_browser_worker_heartbeat_v2(
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
    or p_active_jobs not between 0 and 16
    or p_capacity not between 1 and 16
    or (p_safe_error is not null and length(p_safe_error) > 500) then
    raise exception 'work_browser_heartbeat_invalid' using errcode = '22023';
  end if;

  insert into public.work_browser_worker_heartbeats_v2 (
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
    p_worker_revision,
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

create or replace function public.work_browser_worker_readiness_v2(
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
  v_heartbeat public.work_browser_worker_heartbeats_v2%rowtype;
  v_due integer;
  v_expired integer;
  v_runtime boolean;
  v_age integer;
  v_stale integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'work_execution_forbidden' using errcode = '42501';
  end if;
  if p_environment !~ '^[a-z0-9][a-z0-9-]{0,49}$'
    or p_expected_source_sha !~ '^[a-f0-9]{40}$' then
    raise exception 'work_browser_readiness_input_invalid' using errcode = '22023';
  end if;

  v_stale := greatest(30, least(coalesce(p_stale_seconds, 300), 3600));
  select * into v_heartbeat
  from public.work_browser_worker_heartbeats_v2 heartbeat
  where heartbeat.environment = p_environment;

  select count(*) into v_due
  from public.agent_jobs job
  where job.kind = 'browser'
    and job.status in ('queued', 'retrying')
    and job.deleted_at is null
    and job.cancel_requested_at is null
    and coalesce(job.retry_after, job.available_at) <= now();

  select count(*) into v_expired
  from public.agent_job_attempts_v2 attempt
  join public.agent_jobs job on job.id = attempt.job_id
  where job.kind = 'browser'
    and attempt.status = 'running'
    and attempt.lease_expires_at <= now();

  v_runtime := public.work_browser_runtime_enabled_v2(p_expected_source_sha);
  v_age := case
    when v_heartbeat.environment is null then null
    else extract(epoch from (now() - v_heartbeat.last_seen_at))::integer
  end;

  return query select
    coalesce(
      v_heartbeat.status = 'healthy'
      and v_heartbeat.source_sha = p_expected_source_sha
      and v_age between 0 and v_stale
      and v_expired = 0
      and v_runtime,
      false
    ),
    v_heartbeat.status,
    v_heartbeat.worker_revision,
    v_heartbeat.source_sha,
    v_age,
    coalesce(v_heartbeat.active_jobs, 0),
    coalesce(v_heartbeat.capacity, 0),
    v_due,
    v_expired,
    v_runtime;
end;
$$;

revoke all on function public.work_browser_runtime_enabled_v2(text)
  from public, anon, authenticated;
revoke all on function public.set_work_browser_runtime_v2(boolean, text)
  from public, anon, authenticated;
revoke all on function public.owner_create_browser_work_job_v2(text, uuid, text[], text, integer)
  from public, anon;
revoke all on function public.claim_work_job_kind_v3(text, text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_work_job_v2(text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.claim_browser_work_job_v2(text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.record_work_browser_tool_result_v2(uuid, uuid, uuid, bigint, text, text, text, jsonb, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.settle_work_browser_success_v2(uuid, uuid, uuid, bigint, text, text, jsonb, jsonb, text, text, bigint, text)
  from public, anon, authenticated;
revoke all on function public.record_work_browser_worker_heartbeat_v2(text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.work_browser_worker_readiness_v2(text, text, integer)
  from public, anon, authenticated;

grant execute on function public.owner_create_browser_work_job_v2(text, uuid, text[], text, integer)
  to authenticated;
grant execute on function public.work_browser_runtime_enabled_v2(text)
  to service_role;
grant execute on function public.set_work_browser_runtime_v2(boolean, text)
  to service_role;
grant execute on function public.claim_work_job_kind_v3(text, text, text, text, integer, integer)
  to service_role;
grant execute on function public.claim_work_job_v2(text, text, text, integer, integer)
  to service_role;
grant execute on function public.claim_browser_work_job_v2(text, text, text, integer, integer)
  to service_role;
grant execute on function public.record_work_browser_tool_result_v2(uuid, uuid, uuid, bigint, text, text, text, jsonb, text, jsonb)
  to service_role;
grant execute on function public.settle_work_browser_success_v2(uuid, uuid, uuid, bigint, text, text, jsonb, jsonb, text, text, bigint, text)
  to service_role;
grant execute on function public.record_work_browser_worker_heartbeat_v2(text, text, text, text, integer, integer, text)
  to service_role;
grant execute on function public.work_browser_worker_readiness_v2(text, text, integer)
  to service_role;
