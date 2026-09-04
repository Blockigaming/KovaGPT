-- Durable, private account-data exports. Requests are created by an
-- authenticated server route, leased by a trusted worker, and removed after
-- their short download window. Export objects are never public.

create table if not exists public.account_export_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed', 'canceled', 'expired')),
  format_version integer not null default 1 check (format_version = 1),
  attempts integer not null default 0 check (attempts between 0 and 3),
  worker_id text,
  lease_expires_at timestamptz,
  storage_path text,
  content_sha256 text,
  size_bytes bigint check (size_bytes is null or size_bytes between 2 and 52428800),
  failure_code text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'complete' and storage_path is not null and content_sha256 is not null
      and size_bytes is not null and completed_at is not null and expires_at is not null)
    or status <> 'complete'
  )
);

alter table public.account_export_jobs enable row level security;

drop policy if exists "Users read own account exports" on public.account_export_jobs;
create policy "Users read own account exports"
on public.account_export_jobs for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.account_export_jobs from public, anon, authenticated;
grant select on table public.account_export_jobs to authenticated;
grant all on table public.account_export_jobs to service_role;

create index if not exists account_export_jobs_user_requested_idx
on public.account_export_jobs(user_id, requested_at desc);

create index if not exists account_export_jobs_claim_idx
on public.account_export_jobs(status, requested_at)
where status in ('queued', 'processing');

create unique index if not exists account_export_jobs_one_active_per_user
on public.account_export_jobs(user_id)
where status in ('queued', 'processing');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'account-exports',
  'account-exports',
  false,
  52428800,
  array['application/json']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
    order by job.requested_at
    for update skip locked
    limit p_limit
  )
  update public.account_export_jobs job
  set status = 'processing',
      attempts = job.attempts + 1,
      worker_id = btrim(p_worker_id),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(job.started_at, now()),
      failure_code = null,
      updated_at = now()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

create or replace function public.settle_account_export_success(
  p_job_id uuid,
  p_worker_id text,
  p_storage_path text,
  p_content_sha256 text,
  p_size_bytes bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
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
  p_retryable boolean
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
  returning status, user_id into v_status, v_user_id;

  if v_status = 'failed' then
    insert into public.account_audit_entries (
      user_id, event_type, safe_description, actor_id, target_id, result, metadata
    ) values (
      v_user_id, 'account_export', 'Account data export failed', v_user_id,
      p_job_id::text, 'failure', jsonb_build_object('failure_code', p_failure_code)
    );
  end if;
  return v_status;
end;
$$;

revoke all on function public.claim_account_export_jobs(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.settle_account_export_success(uuid, text, text, text, bigint)
  from public, anon, authenticated;
revoke all on function public.settle_account_export_failure(uuid, text, text, boolean)
  from public, anon, authenticated;

grant execute on function public.claim_account_export_jobs(text, integer, integer) to service_role;
grant execute on function public.settle_account_export_success(uuid, text, text, text, bigint)
  to service_role;
grant execute on function public.settle_account_export_failure(uuid, text, text, boolean)
  to service_role;
