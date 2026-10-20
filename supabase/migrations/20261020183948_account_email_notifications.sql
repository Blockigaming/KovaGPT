-- Dormant account-event email preferences/outbox. No provider calls, polling or
-- queue drain occurs on installation. Requested verification/recovery messages
-- retain their separate challenge-bound path and cannot be disabled here.
begin;

create function kova_private.account_email_defaults() returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select '{"password_changed":true,"security_method_added":true,"security_method_changed":true,"security_method_removed":true,"account_deletion_scheduled":true,"account_deleted":true,"new_login":false,"email_changed":false,"account_recovered":false}'::jsonb
$$;

create table kova_private.account_email_preferences (
  account_id uuid primary key,
  preferences jsonb not null check (jsonb_typeof(preferences) = 'object'),
  updated_at timestamptz not null default now()
);
alter table kova_private.account_email_preferences enable row level security;
revoke all on kova_private.account_email_preferences from public, anon, authenticated, service_role;

-- The short-lived recipient snapshot deliberately has no account FK: an actual
-- deletion must commit before its final notice can be dispatched. Terminal
-- outcomes redact the recipient; explicit dispatch/purge also redacts expiry.
create table kova_private.account_email_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (char_length(source_key) between 1 and 160),
  account_id uuid not null,
  event_type text not null check (event_type in (
    'password_changed','security_method_added','security_method_changed','security_method_removed',
    'account_deletion_scheduled','account_deleted','new_login','email_changed','account_recovered')),
  recipient text check (recipient is null or char_length(recipient) between 3 and 320),
  occurred_at timestamptz not null,
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'
    and metadata-'deletion_scheduled_for'='{}'::jsonb
    and (not (metadata ? 'deletion_scheduled_for') or jsonb_typeof(metadata->'deletion_scheduled_for')='string')),
  deletion_opt_in boolean not null default false,
  status text not null default 'pending' check (status in ('awaiting_deletion','pending','leased','sending','sent','failed','uncertain','suppressed','expired')),
  lease_token uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  check (expires_at > occurred_at),
  check ((status in ('leased','sending')) = (lease_token is not null and lease_until is not null))
);
create index account_email_pending_expiry_idx on kova_private.account_email_events(expires_at)
  where recipient is not null;
alter table kova_private.account_email_events enable row level security;
revoke all on kova_private.account_email_events from public, anon, authenticated, service_role;

-- Existing owned authority wins even when its UUID bridge is deliberately
-- banned as a hosted-login identity. A deleted/suspended owned account never
-- falls back to that bridge's hosted email.
create function kova_private.account_email_recipient(p_account_id uuid) returns text
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_account kova_private.auth_accounts; v_user auth.users; v_email text;
begin
  select * into v_account from kova_private.auth_accounts where id = p_account_id;
  if found then
    if v_account.deleted_at is not null or v_account.email_verified_at is null
      or (v_account.suspended_until is not null and v_account.suspended_until > statement_timestamp()) then return null; end if;
    v_email := v_account.primary_email;
  else
    select * into v_user from auth.users where id = p_account_id;
    if not found or v_user.deleted_at is not null or v_user.email_confirmed_at is null
      or coalesce(v_user.is_anonymous,false)
      or (v_user.banned_until is not null and v_user.banned_until > statement_timestamp()) then return null; end if;
    v_email := lower(btrim(v_user.email));
  end if;
  if v_email is null or char_length(v_email) > 320 or v_email ~ '[[:cntrl:][:space:]]'
    or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then return null; end if;
  return v_email;
end
$$;

create function kova_private.account_email_preferences_for(p_account_id uuid) returns jsonb
language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select kova_private.account_email_defaults() || coalesce(
    (select preferences from kova_private.account_email_preferences where account_id = p_account_id), '{}'::jsonb)
$$;

create function public.account_email_get_preferences(p_account_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
begin
  if p_account_id is null or kova_private.account_email_recipient(p_account_id) is null then
    raise exception 'account_email_account_unavailable';
  end if;
  return kova_private.account_email_preferences_for(p_account_id);
end
$$;

create function public.account_email_update_preferences(p_account_id uuid, p_preferences jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_defaults jsonb := kova_private.account_email_defaults(); v_result jsonb;
begin
  if p_account_id is null or kova_private.account_email_recipient(p_account_id) is null then
    raise exception 'account_email_account_unavailable';
  end if;
  if p_preferences is null or jsonb_typeof(p_preferences) <> 'object'
    or p_preferences = '{}'::jsonb or octet_length(p_preferences::text) > 2048
    or exists(select 1 from jsonb_each(p_preferences) p where not (v_defaults ? p.key) or jsonb_typeof(p.value) <> 'boolean') then
    raise exception 'account_email_preferences_invalid';
  end if;
  -- ON CONFLICT's row lock merges with the latest committed map rather than a
  -- stale caller snapshot, preserving independent concurrent preference edits.
  insert into kova_private.account_email_preferences(account_id,preferences)
    values(p_account_id,v_defaults || p_preferences)
  on conflict (account_id) do update set
    preferences = kova_private.account_email_preferences.preferences || p_preferences,
    updated_at = statement_timestamp()
  returning preferences into v_result;
  return v_defaults || v_result;
end
$$;

create function kova_private.enqueue_account_email(
  p_account_id uuid,p_event_type text,p_source_key text,p_occurred_at timestamptz,p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_email text; v_preferences jsonb; v_id uuid;
begin
  if p_account_id is null or not (kova_private.account_email_defaults() ? p_event_type)
    or p_source_key is null or char_length(p_source_key) not between 1 and 160
    or p_occurred_at is null or not isfinite(p_occurred_at) then
    raise exception 'account_email_event_invalid';
  end if;
  v_email := kova_private.account_email_recipient(p_account_id);
  v_preferences := kova_private.account_email_preferences_for(p_account_id);
  if v_email is null or v_preferences->p_event_type <> 'true'::jsonb then return null; end if;
  insert into kova_private.account_email_events(source_key,account_id,event_type,recipient,occurred_at,expires_at,deletion_opt_in,metadata)
    values(p_source_key,p_account_id,p_event_type,v_email,p_occurred_at,
      statement_timestamp()+interval '24 hours',p_event_type='account_deleted',p_metadata)
  on conflict (source_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from kova_private.account_email_events where source_key=p_source_key; end if;
  return v_id;
end
$$;

-- The service caller must first validate and re-read the existing authoritative
-- lifecycle result. Its policy RPC SQL is maintained outside this source tree,
-- so this explicit enqueue boundary cannot claim transaction-atomic delivery.
-- Browser-supplied event success, account IDs and recipient addresses never call it.
create function public.account_email_record_lifecycle(
  p_account_id uuid,p_event_type text,p_event_key text,p_occurred_at timestamptz,p_metadata jsonb
) returns uuid
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_deadline timestamptz;
begin
  if p_event_type not in ('account_deletion_scheduled','account_recovered') or p_event_type is null
    or p_event_key is null or char_length(p_event_key) not between 1 and 80
    or p_event_key !~ '^[a-zA-Z0-9:_.-]+$'
    or p_occurred_at is null or not isfinite(p_occurred_at)
    or p_occurred_at>statement_timestamp()+interval '1 minute'
    or p_occurred_at<statement_timestamp()-interval '15 minutes'
    or p_metadata is null or jsonb_typeof(p_metadata)<>'object'
    or (p_metadata-'deletion_scheduled_for')<>'{}'::jsonb then
    raise exception 'account_email_lifecycle_invalid';
  end if;
  if p_metadata ? 'deletion_scheduled_for' then
    if jsonb_typeof(p_metadata->'deletion_scheduled_for')<>'string' or char_length(p_metadata->>'deletion_scheduled_for')>40 then
      raise exception 'account_email_lifecycle_invalid';
    end if;
    begin
      v_deadline:=(p_metadata->>'deletion_scheduled_for')::timestamptz;
      if not isfinite(v_deadline) or p_metadata->>'deletion_scheduled_for' <>
        to_char(v_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then
        raise exception 'account_email_lifecycle_invalid';
      end if;
    exception when others then raise exception 'account_email_lifecycle_invalid'; end;
  end if;
  if p_event_type='account_deletion_scheduled' and not (p_metadata ? 'deletion_scheduled_for') then
    raise exception 'account_email_lifecycle_invalid';
  end if;
  if kova_private.account_email_recipient(p_account_id) is null then raise exception 'account_email_account_unavailable'; end if;
  return kova_private.enqueue_account_email(p_account_id,p_event_type,
    'lifecycle:'||p_account_id::text||':'||p_event_type||':'||p_event_key,p_occurred_at,p_metadata);
end
$$;

-- Call only after the existing policy finalization confirmation, immediately
-- before its actual Auth delete. True acknowledges preparation, including a
-- deliberate opt-out; it never means mail was sent or an account was deleted.
create function public.account_email_prepare_account_deletion(p_account_id uuid,p_attempt_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_id uuid;
begin
  if p_account_id is null or p_attempt_id is null then raise exception 'account_email_deletion_invalid'; end if;
  if exists(select 1 from kova_private.auth_accounts where id=p_account_id) then
    -- Notification eligibility cannot add a new restriction to the existing
    -- deletion flow. The application retains its own provider/cutover gate.
    return true;
  end if;
  if kova_private.account_email_recipient(p_account_id) is null then return true; end if;
  v_id:=kova_private.enqueue_account_email(p_account_id,'account_deleted',
    'account-deleted:'||p_account_id::text,statement_timestamp());
  if v_id is not null then
    update kova_private.account_email_events set status='awaiting_deletion' where id=v_id and status in ('awaiting_deletion','pending') and recipient is not null;
  end if;
  if kova_private.account_email_preferences_for(p_account_id)->'account_deleted'='true'::jsonb then
    update kova_private.account_email_events set recipient=kova_private.account_email_recipient(p_account_id),
      occurred_at=statement_timestamp(),expires_at=statement_timestamp()+interval '24 hours',updated_at=statement_timestamp()
      where source_key='account-deleted:'||p_account_id::text and status='awaiting_deletion';
  end if;
  return true;
end
$$;

create function kova_private.account_email_from_audit() returns trigger
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_event text;
begin
  if new.outcome <> 'success' or new.account_id is null then return new; end if;
  v_event := case
    when new.event_type in ('password_changed','password_recovered') then 'password_changed'
    when new.event_type in ('mfa_enabled','passkey_registered') then 'security_method_added'
    when new.event_type in ('mfa_recovery_codes_regenerated','passkey_renamed') then 'security_method_changed'
    when new.event_type in ('mfa_removed','passkey_removed') then 'security_method_removed'
    when new.event_type in ('password_login','mfa_login','mfa_recovery_login','passkey_login','oauth_handoff_consumed') then 'new_login'
    when new.event_type = 'google_email_changed' then 'email_changed'
    else null end;
  if v_event is not null then
    perform kova_private.enqueue_account_email(new.account_id,v_event,'owned-audit:'||new.id::text,new.occurred_at);
  end if;
  return new;
end
$$;
create trigger kova_account_email_audit after insert on kova_private.auth_audit_events
  for each row execute function kova_private.account_email_from_audit();

create function kova_private.account_email_before_delete() returns trigger
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
begin
  -- Removing the inert hosted UUID bridge does not delete the surviving owned
  -- account. Its saved opt-outs and owned notices must remain authoritative.
  if exists(select 1 from kova_private.auth_accounts where id=old.id) then
    return old;
  end if;
  -- Only a prepared real finalization marker may become a deletion notice.
  -- UUID bridge cleanup without a marker cannot synthesize an account event.
  -- Preserve the separate, unaccepted owned-Auth finalization gate.
  update kova_private.account_email_events e set
    status=case when not exists(select 1 from kova_private.auth_accounts where id=old.id)
      and e.recipient is not distinct from kova_private.account_email_recipient(old.id)
      and kova_private.account_email_preferences_for(old.id)->'account_deleted'='true'::jsonb
      and e.expires_at>statement_timestamp() then 'pending' else 'suppressed' end,
    recipient=case when not exists(select 1 from kova_private.auth_accounts where id=old.id)
      and e.recipient is not distinct from kova_private.account_email_recipient(old.id)
      and kova_private.account_email_preferences_for(old.id)->'account_deleted'='true'::jsonb
      and e.expires_at>statement_timestamp() then e.recipient else null end,
    occurred_at=case when e.expires_at>statement_timestamp() then statement_timestamp() else e.occurred_at end,
    updated_at=statement_timestamp()
    where e.account_id=old.id and e.event_type='account_deleted' and e.status='awaiting_deletion';
  delete from kova_private.account_email_preferences where account_id=old.id;
  -- Other pending events must not outlive their owner or become deletion mail.
  update kova_private.account_email_events set status='suppressed',recipient=null,
    lease_token=null,lease_until=null,updated_at=statement_timestamp()
    where account_id=old.id and event_type<>'account_deleted' and status in ('pending','leased');
  return old;
end
$$;
create trigger kova_account_email_deleted before delete on auth.users
  for each row execute function kova_private.account_email_before_delete();

create function kova_private.account_email_dispatch_allowed(p_event kova_private.account_email_events) returns boolean
language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
begin
  if p_event.recipient is null or p_event.expires_at <= statement_timestamp() then return false; end if;
  if p_event.event_type='account_deleted' then
    return p_event.deletion_opt_in and not exists(select 1 from auth.users where id=p_event.account_id)
      and not exists(select 1 from kova_private.auth_accounts where id=p_event.account_id);
  end if;
  return kova_private.account_email_recipient(p_event.account_id) is not distinct from p_event.recipient
    and kova_private.account_email_preferences_for(p_event.account_id)->p_event.event_type = 'true'::jsonb;
end
$$;

create function public.account_email_claim_dispatch(p_event_ids uuid[],p_not_before timestamptz)
returns table(id uuid,event_type text,recipient text,occurred_at timestamptz,metadata jsonb,lease_token uuid,lease_expires_at timestamptz)
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_event kova_private.account_email_events; v_now timestamptz:=statement_timestamp();
begin
  if p_event_ids is null or array_ndims(p_event_ids)<>1 or cardinality(p_event_ids) not between 1 and 5
    or array_position(p_event_ids,null) is not null
    or (select count(distinct x) from unnest(p_event_ids) x)<>cardinality(p_event_ids)
    or p_not_before is null or not isfinite(p_not_before) or p_not_before>v_now
    or p_not_before<v_now-interval '15 minutes' then raise exception 'account_email_dispatch_scope_invalid'; end if;
  -- Cleanup is explicit and bounded, not an installed timer or a queue drain.
  perform public.account_email_purge_expired(100);
  for v_event in select e.* from kova_private.account_email_events e
    where e.id=any(p_event_ids) and e.status='pending' and e.occurred_at>=p_not_before
    order by e.id for update skip locked loop
    if not kova_private.account_email_dispatch_allowed(v_event) then
      update kova_private.account_email_events set status='suppressed',recipient=null,updated_at=v_now where id=v_event.id;
      continue;
    end if;
    update kova_private.account_email_events set status='leased',lease_token=gen_random_uuid(),lease_until=v_now+interval '2 minutes',updated_at=v_now
      where id=v_event.id returning * into v_event;
    id:=v_event.id;event_type:=v_event.event_type;recipient:=v_event.recipient;occurred_at:=v_event.occurred_at;
    metadata:=v_event.metadata;lease_token:=v_event.lease_token;lease_expires_at:=v_event.lease_until;return next;
  end loop;
end
$$;

create function public.account_email_prepare_dispatch(p_event_id uuid,p_lease_token uuid) returns boolean
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_event kova_private.account_email_events;
begin
  select * into v_event from kova_private.account_email_events where id=p_event_id for update;
  if not found or v_event.status<>'leased' or v_event.lease_token is distinct from p_lease_token
    or v_event.lease_until<=statement_timestamp() then return false; end if;
  if not kova_private.account_email_dispatch_allowed(v_event) then
    update kova_private.account_email_events set status='suppressed',recipient=null,lease_token=null,lease_until=null,updated_at=statement_timestamp() where id=p_event_id;
    return false;
  end if;
  update kova_private.account_email_events set status='sending',updated_at=statement_timestamp() where id=p_event_id;
  return true;
end
$$;

create function public.account_email_finish_dispatch(p_event_id uuid,p_lease_token uuid,p_outcome text) returns boolean
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
begin
  if p_outcome is null or p_outcome not in ('sent','failed','uncertain') then raise exception 'account_email_dispatch_outcome_invalid'; end if;
  update kova_private.account_email_events set status=p_outcome,recipient=null,
    lease_token=null,lease_until=null,updated_at=statement_timestamp()
    where id=p_event_id and (status='sending' or (status='leased' and p_outcome='failed'))
      and lease_token=p_lease_token and lease_until>statement_timestamp();
  return found;
end
$$;

create function public.account_email_purge_expired(p_limit integer default 100) returns integer
language plpgsql volatile security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_count integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'account_email_purge_limit_invalid'; end if;
  with expired as (
    select id from kova_private.account_email_events where recipient is not null
      and (expires_at<=statement_timestamp() or (status in ('leased','sending') and lease_until<=statement_timestamp()))
      order by expires_at,id limit p_limit for update skip locked
  ) update kova_private.account_email_events e set recipient=null,
      status=case when e.expires_at<=statement_timestamp() then 'expired' else 'uncertain' end,
      lease_token=null,lease_until=null,updated_at=statement_timestamp()
    from expired x where e.id=x.id;
  get diagnostics v_count=row_count; return v_count;
end
$$;

revoke all on function kova_private.account_email_defaults() from public,anon,authenticated,service_role;
revoke all on function kova_private.account_email_recipient(uuid) from public,anon,authenticated,service_role;
revoke all on function kova_private.account_email_preferences_for(uuid) from public,anon,authenticated,service_role;
revoke all on function kova_private.enqueue_account_email(uuid,text,text,timestamptz,jsonb) from public,anon,authenticated,service_role;
revoke all on function kova_private.account_email_from_audit() from public,anon,authenticated,service_role;
revoke all on function kova_private.account_email_before_delete() from public,anon,authenticated,service_role;
revoke all on function kova_private.account_email_dispatch_allowed(kova_private.account_email_events) from public,anon,authenticated,service_role;
revoke all on function public.account_email_get_preferences(uuid) from public,anon,authenticated;
revoke all on function public.account_email_update_preferences(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.account_email_claim_dispatch(uuid[],timestamptz) from public,anon,authenticated;
revoke all on function public.account_email_prepare_dispatch(uuid,uuid) from public,anon,authenticated;
revoke all on function public.account_email_finish_dispatch(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.account_email_purge_expired(integer) from public,anon,authenticated;
revoke all on function public.account_email_record_lifecycle(uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.account_email_prepare_account_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.account_email_get_preferences(uuid),public.account_email_update_preferences(uuid,jsonb),
  public.account_email_claim_dispatch(uuid[],timestamptz),public.account_email_prepare_dispatch(uuid,uuid),
  public.account_email_finish_dispatch(uuid,uuid,text),public.account_email_purge_expired(integer),
  public.account_email_record_lifecycle(uuid,text,text,timestamptz,jsonb),
  public.account_email_prepare_account_deletion(uuid,uuid) to service_role;

-- The checked-in source has no SQL definitions for the separately maintained
-- kova_policy_schedule_deletion/recover_deletion functions. Their scheduling/
-- recovery emissions remain gated until those authoritative transactions can
-- enqueue atomically; no HTTP-success claim is substituted for that state.
commit;
