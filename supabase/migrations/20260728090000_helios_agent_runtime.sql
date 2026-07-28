-- Project Helios: durable worker queue, evidence, deliverables, and agent notifications.
create table public.agent_workers (
  id text primary key, version text not null, state text not null check (state in ('ready','degraded','draining','stopped')),
  concurrency integer not null check (concurrency between 1 and 64), active_jobs integer not null default 0,
  last_seen_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null, kind text not null check (kind in ('browser','team')),
  status text not null default 'queued' check (status in ('queued','leased','running','approval_required','paused','retrying','completed','failed','cancelling','cancelled')),
  input jsonb not null default '{}', result jsonb, error text, priority integer not null default 0,
  attempts integer not null default 0, max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  worker_id text references public.agent_workers(id) on delete set null, lease_expires_at timestamptz,
  available_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index agent_jobs_queue_idx on public.agent_jobs (status, available_at, priority desc, created_at);
create table public.agent_run_events (
  id bigint generated always as identity primary key, job_id uuid not null references public.agent_jobs(id) on delete cascade,
  event_type text not null, payload jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.agent_deliverables (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.agent_jobs(id) on delete cascade, specialist_task_id text,
  project_id uuid references public.projects(id) on delete set null,
  type text not null check (type in ('project_artifact','project_file','library_document','research_report','context_pack_candidate','markdown','json','csv')),
  deliverable_key uuid not null default gen_random_uuid(), title text not null, mime_type text not null, storage_reference text not null, source_evidence jsonb not null default '[]',
  revision integer not null default 1 check (revision > 0), status text not null default 'ready' check (status in ('draft','ready','superseded','deleted')),
  integrity_hash text not null check (integrity_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
  unique (owner_id, deliverable_key, revision)
);
create table public.agent_notifications (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('approval_required','run_paused','run_failed','run_completed','deliverable_ready','scheduled_run_started','scheduled_run_completed','connector_authorization_lost')),
  title text not null, body text not null, run_id uuid references public.agent_jobs(id) on delete cascade,
  connector_account_id uuid, action_url text, read_at timestamptz, created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);
create index agent_notifications_owner_idx on public.agent_notifications(owner_id, created_at desc);
create table public.agent_approvals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.agent_jobs(id) on delete cascade, specialist_task_id text,
  tool text not null, reason text not null, destination text not null, risk text not null check (risk in ('low','medium','high')),
  request_metadata jsonb not null default '{}', status text not null default 'pending' check (status in ('pending','approved','denied','expired')),
  created_at timestamptz not null default now(), decided_at timestamptz
);

alter table public.agent_workers enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_run_events enable row level security;
alter table public.agent_deliverables enable row level security;
alter table public.agent_notifications enable row level security;
alter table public.agent_approvals enable row level security;
create policy "Owners read agent jobs" on public.agent_jobs for select using (auth.uid() = owner_id);
create policy "Owners create agent jobs" on public.agent_jobs for insert with check (auth.uid() = owner_id and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and (p.owner_id = auth.uid() or exists (select 1 from public.project_members pm where pm.project_id=p.id and pm.user_id=auth.uid())))));
create policy "Owners read job events" on public.agent_run_events for select using (exists (select 1 from public.agent_jobs j where j.id = job_id and j.owner_id = auth.uid()));
create policy "Owners manage deliverables" on public.agent_deliverables for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id and exists (select 1 from public.agent_jobs j where j.id = run_id and j.owner_id = auth.uid()) and (project_id is null or exists (select 1 from public.projects p where p.id = project_id and (p.owner_id=auth.uid() or exists (select 1 from public.project_members pm where pm.project_id=p.id and pm.user_id=auth.uid() and pm.role in ('owner','editor'))))));
create policy "Owners read notifications" on public.agent_notifications for select using (auth.uid() = owner_id);
create policy "Owners update notifications" on public.agent_notifications for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Owners delete notifications" on public.agent_notifications for delete using (auth.uid() = owner_id);
create policy "Owners read approvals" on public.agent_approvals for select using (auth.uid() = owner_id);
create or replace function public.control_agent_job(p_job_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path=public as $$
declare next_status text; current_status text; current_worker text;
begin
  if p_action not in ('pause','resume','cancel') then raise exception 'Invalid action'; end if;
  select status,worker_id into current_status,current_worker from agent_jobs where id=p_job_id and owner_id=auth.uid() for update;
  if current_status is null then raise exception 'Run not found'; end if;
  if p_action='pause' and current_status in ('queued','leased','running','retrying') then next_status='paused';
  elsif p_action='resume' and current_status='paused' and current_worker is null then next_status='queued';
  elsif p_action='resume' and current_status='approval_required' then next_status='queued';
  elsif p_action='cancel' and (current_status in ('leased','running') or (current_status='paused' and current_worker is not null)) then next_status='cancelling';
  elsif p_action='cancel' and current_status in ('queued','retrying','paused','approval_required') then next_status='cancelled';
  elsif p_action='cancel' and current_status='cancelling' then next_status='cancelling';
  else raise exception 'Invalid state transition'; end if;
  update agent_jobs set status=next_status,worker_id=case when next_status='cancelled' then null else worker_id end,lease_expires_at=case when next_status='cancelled' then null else lease_expires_at end,completed_at=case when next_status='cancelled' then now() else completed_at end,updated_at=now() where id=p_job_id;
  return jsonb_build_object('id',p_job_id,'status',next_status);
end $$;
create or replace function public.decide_agent_approval(p_approval_id uuid,p_decision text,p_edited_request jsonb default null) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_decision not in ('approved','denied') then raise exception 'Invalid decision'; end if;
  update agent_approvals set status=p_decision,request_metadata=coalesce(p_edited_request,request_metadata),decided_at=now() where id=p_approval_id and owner_id=auth.uid() and status='pending';
  if not found then raise exception 'Approval not pending'; end if;
end $$;
grant execute on function public.control_agent_job(uuid,text) to authenticated;
grant execute on function public.decide_agent_approval(uuid,text,jsonb) to authenticated;

create or replace function public.lease_agent_job(p_worker_id text, p_lease_seconds integer)
returns setof public.agent_jobs language plpgsql security definer set search_path = public as $$
declare selected_id uuid;
begin
  select id into selected_id from agent_jobs where status in ('queued','retrying') and available_at <= now()
    order by priority desc, created_at for update skip locked limit 1;
  if selected_id is null then return; end if;
  return query update agent_jobs set status='leased', worker_id=p_worker_id, lease_expires_at=now()+make_interval(secs => least(greatest(p_lease_seconds,15),900)), attempts=attempts+1, started_at=coalesce(started_at,now()), updated_at=now() where id=selected_id returning *;
end $$;
create or replace function public.recover_expired_agent_leases() returns integer language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  update agent_jobs set status=case when status='cancelling' then 'cancelled' when status='paused' then 'paused' when attempts < max_attempts then 'retrying' else 'failed' end,
    error=case when status in ('cancelling','paused') then error else 'Worker lease expired' end, worker_id=null, lease_expires_at=null, available_at=now(), updated_at=now(), completed_at=case when status='cancelling' or (status<>'paused' and attempts >= max_attempts) then now() else completed_at end
    where status in ('leased','running','cancelling','paused') and lease_expires_at < now();
  get diagnostics affected = row_count; return affected;
end $$;
create or replace function public.complete_agent_job(p_job_id uuid,p_worker_id text,p_result jsonb) returns void language plpgsql security definer set search_path=public as $$
begin update agent_jobs set status='completed',result=p_result,completed_at=now(),lease_expires_at=null,updated_at=now() where id=p_job_id and worker_id=p_worker_id and status in ('leased','running'); if not found then raise exception 'Lease not owned'; end if; end $$;
create or replace function public.heartbeat_agent_job(p_job_id uuid,p_worker_id text,p_lease_seconds integer) returns text language plpgsql security definer set search_path=public as $$
declare current_status text;
begin
  update agent_jobs set status=case when status='leased' then 'running' else status end,
    lease_expires_at=now()+make_interval(secs => least(greatest(p_lease_seconds,15),900)),updated_at=now()
    where id=p_job_id and worker_id=p_worker_id and status in ('leased','running') returning status into current_status;
  if current_status is null then select status into current_status from agent_jobs where id=p_job_id; end if;
  return current_status;
end $$;
create or replace function public.settle_interrupted_agent_job(p_job_id uuid,p_worker_id text) returns text language plpgsql security definer set search_path=public as $$
declare settled_status text;
begin
  update agent_jobs set status=case when status='cancelling' then 'cancelled' when status='paused' then 'paused' else 'retrying' end,
    worker_id=null,lease_expires_at=null,available_at=now(),completed_at=case when status='cancelling' then now() else completed_at end,updated_at=now()
    where id=p_job_id and worker_id=p_worker_id and status in ('leased','running','paused','cancelling') returning status into settled_status;
  if settled_status is null then select status into settled_status from agent_jobs where id=p_job_id; end if;
  return settled_status;
end $$;
create or replace function public.fail_agent_job(p_job_id uuid,p_worker_id text,p_error text) returns void language plpgsql security definer set search_path=public as $$
begin update agent_jobs set status=case when attempts<max_attempts then 'retrying' else 'failed' end,error=left(p_error,1000),available_at=now()+make_interval(secs=>least(60,power(2,attempts)::int)),worker_id=null,lease_expires_at=null,completed_at=case when attempts>=max_attempts then now() else null end,updated_at=now() where id=p_job_id and worker_id=p_worker_id and status in ('leased','running'); end $$;
create or replace function public.release_agent_lease(p_job_id uuid,p_worker_id text) returns void language plpgsql security definer set search_path=public as $$ begin perform settle_interrupted_agent_job(p_job_id,p_worker_id); end $$;
revoke all on function public.lease_agent_job(text,integer) from public, anon, authenticated;
revoke all on function public.recover_expired_agent_leases() from public, anon, authenticated;
revoke all on function public.complete_agent_job(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.heartbeat_agent_job(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.settle_interrupted_agent_job(uuid,text) from public, anon, authenticated;
revoke all on function public.fail_agent_job(uuid,text,text) from public, anon, authenticated;
revoke all on function public.release_agent_lease(uuid,text) from public, anon, authenticated;
grant execute on function public.lease_agent_job(text,integer) to service_role;
grant execute on function public.recover_expired_agent_leases() to service_role;
grant execute on function public.complete_agent_job(uuid,text,jsonb) to service_role;
grant execute on function public.heartbeat_agent_job(uuid,text,integer) to service_role;
grant execute on function public.settle_interrupted_agent_job(uuid,text) to service_role;
grant execute on function public.fail_agent_job(uuid,text,text) to service_role;
grant execute on function public.release_agent_lease(uuid,text) to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values ('agent-evidence','agent-evidence',false,10485760,array['image/png','image/jpeg','text/plain','application/json']) on conflict (id) do nothing;
create policy "Owners read agent evidence" on storage.objects for select using (bucket_id='agent-evidence' and (storage.foldername(name))[1]=auth.uid()::text);
