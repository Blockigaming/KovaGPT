-- Fence insertion already removes memory/search data through existing triggers.
-- Treat every existing/new fence as irreversible; only final Auth deletion clears it.
alter table public.account_deletion_fences
  add column started_at timestamptz not null default now();

create function kova_private.preserve_started_account_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.user_id::text,20260903204500));
  if tg_op='UPDATE' then
    if new.user_id is distinct from old.user_id or new.started_at is distinct from old.started_at
      or new.requested_at is distinct from old.requested_at then
      raise exception 'account_deletion_irreversible' using errcode='42501';
    end if;
    return new;
  end if;
  -- The Auth FK cascade runs after its parent row has disappeared. No service
  -- operation may clear the fence while that identity still exists.
  if exists(select 1 from auth.users where id=old.user_id) then
    raise exception 'account_deletion_irreversible' using errcode='42501';
  end if;
  return old;
end $$;
revoke all on function kova_private.preserve_started_account_deletion() from public,anon,authenticated;
create trigger preserve_started_account_deletion before update or delete on public.account_deletion_fences
  for each row execute function kova_private.preserve_started_account_deletion();
revoke delete,truncate on public.account_deletion_fences from service_role;

-- Retain the old entry point for older application instances, but never undo
-- irreversible cleanup. An old caller cannot reopen a partly erased account.
create or replace function public.cancel_account_export_account_deletion(p_user_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_user_id is null then raise exception 'account_deletion_principal_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,20260903204500));
  return false;
end $$;
revoke all on function public.cancel_account_export_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.cancel_account_export_account_deletion(uuid) to service_role;

-- Called with the already verified principal by the account endpoint. Keeping
-- this service-only permits authenticated deletion retries while other features
-- continue to reject a pending fence; no Auth table privilege is widened.
create function public.read_account_deletion_state(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_started timestamptz;
begin
  if p_user_id is null then raise exception 'account_deletion_principal_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,20260903204500));
  select started_at into v_started from public.account_deletion_fences where user_id=p_user_id;
  if found then return jsonb_build_object('state','deleting','startedAt',v_started); end if;
  if not kova_private.auth_user_exists(p_user_id) then return jsonb_build_object('state','deleted','startedAt',null); end if;
  return jsonb_build_object('state','active','startedAt',null);
end $$;
revoke all on function public.read_account_deletion_state(uuid) from public,anon,authenticated;
grant execute on function public.read_account_deletion_state(uuid) to service_role;
