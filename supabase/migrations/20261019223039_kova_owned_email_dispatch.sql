-- Source-only: no cron, provider call, queue drain, or activation. Each claim is
-- restricted to the current bounded run's exact message IDs and recipients.
begin;

create table kova_private.auth_email_dispatches (
  idempotency_key text primary key,
  queue_id bigint not null unique,
  message_id text not null,
  recipient text not null,
  label text not null check (label in ('kova-auth-verification','kova-auth-recovery')),
  token_digest_hex text not null check (token_digest_hex ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('retry','leased','sent','suppressed','failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  deadline timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table kova_private.auth_email_dispatches enable row level security;
revoke all on kova_private.auth_email_dispatches from public, anon, authenticated, service_role;

-- No token is consumed or returned by this helper. Recovery is also pinned to
-- the account epoch and verified mailbox in the original challenge.
create function kova_private.auth_email_challenge_expiry(
  p_label text, p_recipient text, p_digest text, p_now timestamptz
) returns timestamptz language plpgsql stable security definer
set search_path = '' set statement_timeout = '5s' as $$
declare v_expiry timestamptz;
begin
  if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then return null; end if;
  if p_label = 'kova-auth-verification' then
    select v.expires_at into v_expiry
      from kova_private.auth_email_verifications v
      join kova_private.auth_accounts a on a.id = v.account_id
      join kova_private.auth_identities i on i.id = v.identity_id and i.account_id = a.id
     where v.token_digest = decode(p_digest,'hex') and v.consumed_at is null
       and v.expires_at > p_now and a.primary_email = p_recipient
       and a.deleted_at is null and (a.suspended_until is null or a.suspended_until <= p_now)
       and not a.mfa_required and not kova_private.legacy_mfa_required(a.id)
       and kova_private.legacy_principal_permitted(a.id)
       and i.normalized_email = p_recipient and i.provider = 'email'
       and i.disabled_at is null and i.verified_at is null
       and exists(select 1 from kova_private.auth_credentials c where c.account_id = a.id
         and c.credential_type = 'password' and c.disabled_at is null and c.activated_at is null);
  elsif p_label = 'kova-auth-recovery' then
    select r.expires_at into v_expiry
      from kova_private.auth_password_recoveries r
      join kova_private.auth_accounts a on a.id = r.account_id
     where r.token_digest = decode(p_digest,'hex') and r.consumed_at is null
       and r.expires_at > p_now and a.primary_email = p_recipient
       and r.verified_email = p_recipient and r.account_epoch = a.session_epoch
       and a.email_verified_at is not null and a.deleted_at is null
       and (a.suspended_until is null or a.suspended_until <= p_now)
       and not a.mfa_required and not kova_private.legacy_mfa_required(a.id)
       and kova_private.legacy_principal_permitted(a.id)
       and exists(select 1 from kova_private.auth_identities i where i.account_id = a.id
         and i.normalized_email = p_recipient and i.verified_at is not null and i.disabled_at is null);
  end if;
  return v_expiry;
end
$$;
revoke all on function kova_private.auth_email_challenge_expiry(text,text,text,timestamptz)
 from public, anon, authenticated, service_role;

-- Dead letters contain diagnostic metadata only, never action links, recipients,
-- provider errors, HTML, or plaintext bearer tokens.
create function kova_private.close_auth_email_dispatch(
  p_queue_id bigint, p_status text, p_code text, p_provider_id text default null
) returns void language plpgsql security definer set search_path = ''
set statement_timeout = '5s' as $$
declare v_row kova_private.auth_email_dispatches;
begin
  update kova_private.auth_email_dispatches set status = p_status, lease_token = null,
    lease_until = null, updated_at = clock_timestamp() where queue_id = p_queue_id returning * into v_row;
  if not found then return; end if;
  insert into public.email_send_log(message_id,template_name,recipient_email,status,error_message,metadata)
    values(v_row.message_id,v_row.label,v_row.recipient,p_status,p_code,
      jsonb_build_object('attempts',v_row.attempts,'provider_id',p_provider_id))
    on conflict (message_id) where status = 'sent' do nothing;
  if p_status = 'failed' then
    perform public.move_to_dlq('auth_emails','auth_emails_dlq',p_queue_id,
      jsonb_build_object('message_id',v_row.message_id,'label',v_row.label,'error_code',p_code));
  else
    perform public.delete_email('auth_emails',p_queue_id);
  end if;
end
$$;
revoke all on function kova_private.close_auth_email_dispatch(bigint,text,text,text)
 from public, anon, authenticated, service_role;

create function public.kova_auth_claim_email_dispatch(
  p_lease_token uuid, p_message_ids text[], p_recipients text[], p_not_before timestamptz
) returns table(queue_id bigint,payload jsonb,attempt integer,lease_expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  v_now timestamptz := clock_timestamp(); v_q record;
  v_row kova_private.auth_email_dispatches;
  v_key text; v_label text; v_recipient text; v_digest text; v_issued timestamptz;
  v_expiry timestamptz; v_ttl integer; v_deadline timestamptz; v_iteration integer;
begin
  if p_lease_token is null or coalesce(cardinality(p_message_ids),0) not between 1 and 5
    or coalesce(cardinality(p_recipients),0) not between 1 and 5
    or exists(select 1 from unnest(p_message_ids) x where x is null or x !~ '^[A-Za-z0-9_-]{43}$')
    or exists(select 1 from unnest(p_recipients) x where x is null or x <> lower(btrim(x))
      or char_length(x) > 320 or x !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or p_not_before is null or not isfinite(p_not_before)
    or p_not_before < v_now - interval '1 hour' or p_not_before > v_now then
    raise exception 'kova_auth_email_scope_invalid';
  end if;
  if exists(select 1 from public.email_send_state where id=1 and retry_after_until > v_now) then return; end if;
  select least(60,greatest(1,auth_email_ttl_minutes)) into v_ttl from public.email_send_state where id=1;
  if v_ttl is null then raise exception 'kova_auth_email_queue_unconfigured'; end if;
  for v_iteration in 1..5 loop
    -- PGMQ's own queue projection/visibility fields. Unlike read_email_batch,
    -- this takes no visibility lease on any historical or out-of-scope message.
    select q.msg_id,q.message into v_q from pgmq.q_auth_emails q
     where q.vt <= clock_timestamp() and q.enqueued_at >= p_not_before
       and q.message->>'message_id' = any(p_message_ids)
       and q.message->>'to' = any(p_recipients)
       and q.message->>'label' in ('kova-auth-verification','kova-auth-recovery')
     order by q.msg_id for update skip locked limit 1;
    if not found then return; end if;
    v_now := clock_timestamp();
    v_key := v_q.message->>'idempotency_key'; v_label := v_q.message->>'label';
    v_recipient := v_q.message->>'to'; v_digest := split_part(v_key,':',2);
    begin v_issued := (v_q.message->>'queued_at')::timestamptz;
    exception when others then v_issued := null; end;
    -- Scope is pinned before any deletion or DLQ action. Malformed unrelated
    -- records never enter this branch, and remain untouched in their own queue.
    if v_key is null or v_key <> v_label || ':' || v_digest or v_digest !~ '^[a-f0-9]{64}$'
      or v_q.message->>'purpose' is distinct from 'auth'
      or v_issued is null or not isfinite(v_issued) or v_issued < p_not_before or v_issued > v_now
      or pg_column_size(v_q.message) > 16384 then
      perform public.move_to_dlq('auth_emails','auth_emails_dlq',v_q.msg_id,
        jsonb_build_object('error_code','invalid_envelope'));
      continue;
    end if;
    v_expiry := kova_private.auth_email_challenge_expiry(v_label,v_recipient,v_digest,v_now);
    v_deadline := least(v_issued + make_interval(mins=>v_ttl),v_issued + interval '1 hour',coalesce(v_expiry,v_now));
    insert into kova_private.auth_email_dispatches(idempotency_key,queue_id,message_id,recipient,label,
      token_digest_hex,status,deadline) values(v_key,v_q.msg_id,v_q.message->>'message_id',
      v_recipient,v_label,v_digest,'retry',v_deadline) on conflict do nothing;
    select * into v_row from kova_private.auth_email_dispatches where idempotency_key=v_key for update;
    if not found then raise exception 'kova_auth_email_claim_conflict'; end if;
    v_now := clock_timestamp();
    v_expiry := kova_private.auth_email_challenge_expiry(v_label,v_recipient,v_digest,v_now);
    v_deadline := least(v_issued + make_interval(mins=>v_ttl),v_issued + interval '1 hour',coalesce(v_expiry,v_now));
    if v_row.queue_id <> v_q.msg_id then
      perform public.delete_email('auth_emails',v_q.msg_id); continue;
    end if;
    if v_row.status in ('sent','suppressed','failed') then
      perform public.delete_email('auth_emails',v_q.msg_id); continue;
    end if;
    if v_row.lease_until > v_now or v_row.next_attempt_at > v_now then
      update pgmq.q_auth_emails set vt=greatest(v_row.lease_until,v_row.next_attempt_at,v_now+interval '1 second') where msg_id=v_q.msg_id;
      continue;
    end if;
    if exists(select 1 from public.suppressed_emails where lower(email)=v_recipient) then
      perform kova_private.close_auth_email_dispatch(v_q.msg_id,'suppressed','recipient_suppressed'); continue;
    end if;
    if v_expiry is null or v_row.deadline <= v_now or v_deadline <= v_now or v_row.attempts >= 5 then
      perform kova_private.close_auth_email_dispatch(v_q.msg_id,'failed','challenge_unavailable'); continue;
    end if;
    update kova_private.auth_email_dispatches set status='leased',attempts=attempts+1,
      lease_token=p_lease_token,lease_until=v_now+interval '60 seconds',deadline=least(deadline,v_deadline),
      updated_at=v_now where idempotency_key=v_key returning * into v_row;
    update pgmq.q_auth_emails set vt=v_row.lease_until,read_ct=read_ct+1 where msg_id=v_q.msg_id;
    return query select v_q.msg_id,v_q.message,v_row.attempts,v_row.lease_until;
    return;
  end loop;
end
$$;

create function public.kova_auth_prepare_email_dispatch(p_queue_id bigint,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_row kova_private.auth_email_dispatches; v_now timestamptz;
begin
  perform 1 from pgmq.q_auth_emails where msg_id=p_queue_id for update;
  if not found then return false; end if;
  select * into v_row from kova_private.auth_email_dispatches where queue_id=p_queue_id for update;
  v_now := clock_timestamp();
  if not found or v_row.status <> 'leased' or v_row.lease_token is distinct from p_lease_token
    or v_row.lease_until <= v_now + interval '15 seconds' then return false; end if;
  if exists(select 1 from public.suppressed_emails where lower(email)=v_row.recipient) then
    perform kova_private.close_auth_email_dispatch(p_queue_id,'suppressed','recipient_suppressed'); return false;
  end if;
  if v_row.deadline <= v_now + interval '15 seconds' or
    kova_private.auth_email_challenge_expiry(v_row.label,v_row.recipient,v_row.token_digest_hex,v_now) is null then
    perform kova_private.close_auth_email_dispatch(p_queue_id,'failed','challenge_unavailable'); return false;
  end if;
  return true;
end
$$;

create function public.kova_auth_finish_email_dispatch(
  p_queue_id bigint,p_lease_token uuid,p_outcome text,p_error_code text default null,
  p_provider_id text default null,p_retry_after_seconds integer default null
) returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_row kova_private.auth_email_dispatches; v_now timestamptz; v_delay integer;
begin
  if p_outcome not in ('sent','failed','retry') or p_outcome is null
    or (p_error_code is not null and p_error_code !~ '^[a-z_]{1,64}$')
    or (p_provider_id is not null and p_provider_id !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    or (p_retry_after_seconds is not null and p_retry_after_seconds not between 1 and 3600) then
    raise exception 'kova_auth_email_result_invalid';
  end if;
  perform 1 from pgmq.q_auth_emails where msg_id=p_queue_id for update;
  if not found then return false; end if;
  select * into v_row from kova_private.auth_email_dispatches where queue_id=p_queue_id for update;
  v_now := clock_timestamp();
  if not found or v_row.status <> 'leased' or v_row.lease_token is distinct from p_lease_token
    or v_row.lease_until <= v_now then return false; end if;
  if p_outcome='sent' then
    if p_provider_id is null then raise exception 'kova_auth_email_result_invalid'; end if;
    perform kova_private.close_auth_email_dispatch(p_queue_id,'sent',null,p_provider_id);
  elsif p_outcome='failed' then
    perform kova_private.close_auth_email_dispatch(p_queue_id,'failed',coalesce(p_error_code,'provider_rejected'));
  else
    v_delay := greatest(least(300,60 * (2 ^ greatest(0,v_row.attempts-1))::integer),coalesce(p_retry_after_seconds,1));
    if v_row.attempts >= 5 or v_now+make_interval(secs=>v_delay) >= v_row.deadline then
      perform kova_private.close_auth_email_dispatch(p_queue_id,'failed','retry_exhausted');
    else
      update kova_private.auth_email_dispatches set status='retry',lease_token=null,lease_until=null,
        next_attempt_at=v_now+make_interval(secs=>v_delay),updated_at=v_now where queue_id=p_queue_id;
      update pgmq.q_auth_emails set vt=v_now+make_interval(secs=>v_delay) where msg_id=p_queue_id;
      if p_retry_after_seconds is not null then
        update public.email_send_state set retry_after_until=greatest(retry_after_until,v_now+make_interval(secs=>v_delay)),
          updated_at=v_now where id=1;
      end if;
    end if;
  end if;
  return true;
end
$$;

revoke all on function public.kova_auth_claim_email_dispatch(uuid,text[],text[],timestamptz) from public,anon,authenticated;
revoke all on function public.kova_auth_prepare_email_dispatch(bigint,uuid) from public,anon,authenticated;
revoke all on function public.kova_auth_finish_email_dispatch(bigint,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.kova_auth_claim_email_dispatch(uuid,text[],text[],timestamptz) to service_role;
grant execute on function public.kova_auth_prepare_email_dispatch(bigint,uuid) to service_role;
grant execute on function public.kova_auth_finish_email_dispatch(bigint,uuid,text,text,text,integer) to service_role;
commit;
