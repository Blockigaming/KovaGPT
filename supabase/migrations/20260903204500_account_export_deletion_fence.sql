-- Coordinate account deletion with asynchronous account exports. The fence is
-- service-only and survives cleanup retries until the auth user is deleted.

create table if not exists public.account_deletion_fences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_deletion_fences enable row level security;

revoke all on table public.account_deletion_fences from public, anon, authenticated;
grant all on table public.account_deletion_fences to service_role;

create or replace function kova_private.reject_export_while_account_deletion_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 20260903204500));
  if exists (
    select 1 from public.account_deletion_fences fence where fence.user_id = new.user_id
  ) then
    raise exception using errcode = 'P0001', message = 'account_deletion_pending';
  end if;
  return new;
end;
$$;

revoke all on function kova_private.reject_export_while_account_deletion_pending()
  from public, anon, authenticated;
grant execute on function kova_private.reject_export_while_account_deletion_pending()
  to service_role;

drop trigger if exists reject_export_while_account_deletion_pending
  on public.account_export_jobs;
create trigger reject_export_while_account_deletion_pending
before insert on public.account_export_jobs
for each row execute function kova_private.reject_export_while_account_deletion_pending();

create or replace function public.begin_account_export_account_deletion(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_user_id is null then raise exception 'account_deletion_principal_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));

  insert into public.account_deletion_fences (user_id, requested_at, updated_at)
  values (p_user_id, now(), now())
  on conflict (user_id) do update set updated_at = now();

  -- Revoke queued/terminal job downloads and recover processing jobs whose
  -- leases have already expired. A genuinely live worker keeps its lease so
  -- deletion cannot race an upload; a crashed worker cannot block deletion
  -- forever merely because the separate export scheduler is unavailable.
  update public.account_export_jobs
  set status = 'canceled',
      worker_id = case when status = 'processing' then null else worker_id end,
      lease_expires_at = case when status = 'processing' then null else lease_expires_at end,
      updated_at = now()
  where user_id = p_user_id
    and status <> 'expired'
    and (status <> 'processing' or lease_expires_at is null or lease_expires_at <= now());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.begin_account_export_account_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_account_export_account_deletion(uuid) to service_role;

-- Account deletion is an explicit, retryable workflow rather than a permanent
-- account state. If any post-fence cleanup or Auth deletion step aborts, remove
-- the fence so the still-active user can request another export. The advisory
-- lock serializes this transition with both begin() and export job insertion.
create or replace function public.cancel_account_export_account_deletion(p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_user_id is null then raise exception 'account_deletion_principal_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  delete from public.account_deletion_fences where user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.cancel_account_export_account_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_account_export_account_deletion(uuid) to service_role;
