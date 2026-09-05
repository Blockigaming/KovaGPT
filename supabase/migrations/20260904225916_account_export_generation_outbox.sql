-- Every upload attempt is registered before external I/O. These obligations
-- deliberately do not reference auth.users/jobs: a delayed Storage request can
-- complete after either row is gone. Retired paths are never forgotten merely
-- because one DELETE found no object. The scheduler keeps sweeping them.
-- Storage bytes remain managed exclusively through the Storage API.
alter table public.account_export_jobs add column if not exists upload_generation uuid;

create table public.account_export_artifacts (
  generation uuid primary key,
  job_id uuid not null,
  user_id uuid not null,
  storage_path text not null unique,
  state text not null check (state in ('pending', 'published', 'retired')),
  created_at timestamptz not null default now(),
  next_cleanup_at timestamptz not null default now(),
  last_cleanup_at timestamptz,
  cleanup_attempts bigint not null default 0,
  check (storage_path = user_id::text || '/' || job_id::text || '/' || generation::text || '.json')
);
alter table public.account_export_artifacts enable row level security;
revoke all on public.account_export_artifacts from public, anon, authenticated;
grant all on public.account_export_artifacts to service_role;
create index account_export_artifacts_cleanup_idx
  on public.account_export_artifacts(next_cleanup_at, generation) where state = 'retired';
create index account_export_artifacts_user_idx on public.account_export_artifacts(user_id);
create index account_export_artifacts_job_idx on public.account_export_artifacts(job_id);

create or replace function kova_private.track_account_export_artifact_lifetime()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    update public.account_export_artifacts
    set state = 'retired', next_cleanup_at = now()
    where job_id = old.id and state <> 'retired';
    return old;
  end if;
  update public.account_export_artifacts
  set state = 'retired', next_cleanup_at = now()
  where job_id = new.id and state <> 'retired'
    and (generation is distinct from new.upload_generation
         or new.status not in ('processing', 'complete'));
  if new.status = 'complete' then
    update public.account_export_artifacts set state = 'published'
    where generation = new.upload_generation and state = 'pending'
      and storage_path = new.storage_path;
  end if;
  return new;
end;
$$;
revoke all on function kova_private.track_account_export_artifact_lifetime()
  from public, anon, authenticated;
grant execute on function kova_private.track_account_export_artifact_lifetime() to service_role;
create trigger track_account_export_artifact_lifetime
  after update or delete on public.account_export_jobs
  for each row execute function kova_private.track_account_export_artifact_lifetime();

create or replace function public.register_account_export_artifact(
  p_job_id uuid, p_worker_id text, p_generation uuid
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.account_export_jobs;
  v_path text;
begin
  select * into v_job from public.account_export_jobs where id = p_job_id;
  if v_job.id is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_job.user_id::text, 20260903204500));
  select * into v_job from public.account_export_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'processing'
     or v_job.worker_id is distinct from p_worker_id
     or p_generation is null or v_job.upload_generation is distinct from p_generation
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= now()
     or exists (select 1 from public.account_deletion_fences where user_id = v_job.user_id)
  then return null; end if;
  v_path := v_job.user_id::text || '/' || v_job.id::text || '/' || p_generation::text || '.json';
  insert into public.account_export_artifacts(generation, job_id, user_id, storage_path, state)
  values (p_generation, v_job.id, v_job.user_id, v_path, 'pending')
  on conflict (generation) do nothing;
  -- A retired generation cannot be resurrected by a delayed registration retry.
  if not exists (select 1 from public.account_export_artifacts
    where generation = p_generation and job_id = v_job.id
      and storage_path = v_path and state = 'pending') then return null; end if;
  return v_path;
end;
$$;
revoke all on function public.register_account_export_artifact(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.register_account_export_artifact(uuid, text, uuid) to service_role;

create or replace function public.claim_account_export_jobs(
  p_worker_id text,
  p_limit integer default 2,
  p_lease_seconds integer default 180
)
returns setof public.account_export_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 8 and 120 then
    raise exception 'invalid_worker_id';
  end if;
  if p_limit is null or p_limit not between 1 and 5
     or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then
    raise exception 'invalid_lease';
  end if;

  update public.account_export_jobs
  set status = case when attempts >= 3 then 'failed' else 'queued' end,
      worker_id = null,
      lease_expires_at = null,
      failure_code = case when attempts >= 3 then 'worker_lease_exhausted' else failure_code end,
      updated_at = now()
  where status = 'processing' and lease_expires_at < now();

  return query
  with candidates as (
    select job.id
    from public.account_export_jobs job
    where job.status = 'queued' and job.attempts < 3
      and not exists (select 1 from public.account_deletion_fences fence where fence.user_id = job.user_id)
    order by job.requested_at
    for update skip locked
    limit p_limit
  )
  update public.account_export_jobs job
  set status = 'processing',
      attempts = job.attempts + 1,
      worker_id = btrim(p_worker_id),
      upload_generation = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(job.started_at, now()),
      failure_code = null,
      updated_at = now()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

drop function public.settle_account_export_success(uuid, text, text, text, bigint);
drop function public.settle_account_export_failure(uuid, text, text, boolean);

create or replace function public.settle_account_export_success(
  p_job_id uuid,
  p_worker_id text,
  p_storage_path text,
  p_content_sha256 text,
  p_size_bytes bigint,
  p_generation uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_owner_id uuid;
begin
  select user_id into v_owner_id from public.account_export_jobs where id = p_job_id;
  if v_owner_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_id::text, 20260903204500));
  if p_storage_path is null or char_length(p_storage_path) > 300
     or p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$'
     or p_content_sha256 !~ '^[0-9a-f]{64}$'
     or p_size_bytes not between 2 and 52428800 then
    raise exception 'invalid_export_artifact';
  end if;

  update public.account_export_jobs
  set status = 'complete',
      storage_path = p_storage_path,
      content_sha256 = p_content_sha256,
      size_bytes = p_size_bytes,
      completed_at = now(),
      expires_at = now() + interval '7 days',
      worker_id = null,
      lease_expires_at = null,
      failure_code = null,
      updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and worker_id = p_worker_id
    and p_generation is not null and upload_generation = p_generation
    and not exists (select 1 from public.account_deletion_fences fence where fence.user_id = v_owner_id)
    and exists (select 1 from public.account_export_artifacts artifact
      where artifact.generation = p_generation and artifact.job_id = p_job_id
        and artifact.storage_path = p_storage_path and artifact.state = 'pending')
    and lease_expires_at >= now()
    and p_storage_path like user_id::text || '/' || id::text || '/%'
  returning user_id into v_user_id;

  if v_user_id is null then return false; end if;

  insert into public.account_audit_entries (
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    v_user_id, 'account_export', 'Account data export completed', v_user_id,
    p_job_id::text, 'success', jsonb_build_object('format_version', 1)
  );
  return true;
end;
$$;

create or replace function public.settle_account_export_failure(
  p_job_id uuid,
  p_worker_id text,
  p_failure_code text,
  p_retryable boolean,
  p_generation uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_user_id uuid;
begin
  if p_retryable is null then raise exception 'invalid_retry_policy'; end if;
  if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{3,80}$' then
    raise exception 'invalid_failure_code';
  end if;

  update public.account_export_jobs
  set status = case when p_retryable and attempts < 3 then 'queued' else 'failed' end,
      worker_id = null,
      lease_expires_at = null,
      failure_code = p_failure_code,
      completed_at = case when p_retryable and attempts < 3 then null else now() end,
      updated_at = now()
  where id = p_job_id and status = 'processing' and worker_id = p_worker_id
    and p_generation is not null and upload_generation = p_generation
  returning status, user_id into v_status, v_user_id;

  if v_status = 'failed' then
    insert into public.account_audit_entries (
      user_id, event_type, safe_description, actor_id, target_id, result, metadata
    ) values (
      v_user_id, 'account_export', 'Account data export failed', v_user_id,
      p_job_id::text, 'failure', jsonb_build_object('failure_code', p_failure_code)
    );
  end if;
  return coalesce(v_status, 'superseded');
end;
$$;


revoke all on function public.claim_account_export_jobs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_account_export_jobs(text, integer, integer) to service_role;
revoke all on function public.settle_account_export_success(uuid, text, text, text, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_account_export_success(uuid, text, text, text, bigint, uuid) to service_role;
revoke all on function public.settle_account_export_failure(uuid, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.settle_account_export_failure(uuid, text, text, boolean, uuid) to service_role;

-- Lease a bounded, fairly ordered cleanup page. Scheduling its next pass before
-- network I/O means a crashing cleanup worker cannot monopolize the queue.
-- No successful/empty delete discards the obligation: the uploader may resume
-- afterwards. The retained row contains only identifiers, never export data.
create or replace function public.claim_account_export_artifact_cleanup(
  p_limit integer default 20, p_user_id uuid default null
) returns setof public.account_export_artifacts
language plpgsql security invoker set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid_cleanup_limit'; end if;
  with inactive as (
    select artifact.generation from public.account_export_artifacts artifact
    where artifact.state <> 'retired'
      and (p_user_id is null or artifact.user_id = p_user_id)
      and not exists (
        select 1 from public.account_export_jobs job
        where job.id = artifact.job_id and job.upload_generation = artifact.generation
          and ((job.status = 'processing' and job.lease_expires_at > now())
            or (job.status = 'complete' and job.storage_path = artifact.storage_path and job.expires_at > now()))
      )
    order by artifact.created_at, artifact.generation
    for update skip locked limit p_limit
  ) update public.account_export_artifacts artifact
    set state = 'retired', next_cleanup_at = now()
    from inactive where artifact.generation = inactive.generation;
  return query with candidates as (
    select artifact.generation from public.account_export_artifacts artifact
    where artifact.state = 'retired'
      and (p_user_id is null or artifact.user_id = p_user_id)
      and (p_user_id is not null or artifact.next_cleanup_at <= now())
    order by artifact.next_cleanup_at, artifact.generation
    for update skip locked limit p_limit
  ) update public.account_export_artifacts artifact
    set next_cleanup_at = now() + interval '15 minutes',
        last_cleanup_at = now(), cleanup_attempts = artifact.cleanup_attempts + 1
    from candidates where artifact.generation = candidates.generation
    returning artifact.*;
end;
$$;
revoke all on function public.claim_account_export_artifact_cleanup(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_account_export_artifact_cleanup(integer, uuid) to service_role;
