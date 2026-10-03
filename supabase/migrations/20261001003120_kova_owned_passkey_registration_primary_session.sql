-- Complete the same recent-primary authorization accepted at registration start.
-- Recheck the audited five-minute session at completion; all password revision,
-- challenge ownership, one-use claim, RP and credential checks remain unchanged.
create or replace function public.kova_auth_finish_passkey_registration(
  p_session_digest_hex text, p_challenge_digest_hex text, p_claim_digest_hex text,
  p_credential_id text, p_public_key_hex text, p_counter bigint,
  p_backup_eligible boolean, p_backed_up boolean, p_transports text[],
  p_next_session_digest_hex text, p_expires_at timestamptz, p_now timestamptz default now()
) returns table(session_id uuid, account_id uuid, email text, email_verified boolean,
  assurance_level text, expires_at timestamptz)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_session kova_private.auth_sessions; v_next kova_private.auth_sessions;
  v_challenge kova_private.auth_passkey_challenges; v_passkey_id uuid;
begin
  v_session := kova_private.lock_auth_session(p_session_digest_hex, p_now);
  select * into v_challenge from kova_private.auth_passkey_challenges c
   where c.token_digest = kova_private.require_digest(p_challenge_digest_hex)
     and c.claim_digest = kova_private.require_digest(p_claim_digest_hex)
     and c.purpose = 'registration' and c.account_id = v_session.account_id
     and c.session_id = v_session.id and c.consumed_at is null
     and c.claimed_at <= p_now and c.created_at <= p_now and c.expires_at > p_now for update;
  if v_challenge.id is null then raise exception 'kova_auth_invalid_passkey_challenge'; end if;
  if v_challenge.password_credential_id is not null then
    perform 1 from kova_private.auth_credentials c where c.id = v_challenge.password_credential_id
      and c.account_id = v_session.account_id and c.revision = v_challenge.password_revision
      and c.credential_type = 'password' and c.activated_at is not null and c.disabled_at is null for share;
    if not found then raise exception 'kova_auth_reauthentication_required'; end if;
  elsif v_session.assurance_level <> 'aal2' and not kova_private.recent_primary_session(
    v_session.id, v_session.account_id, v_session.created_at, p_now
  ) then
    raise exception 'kova_auth_reauthentication_required';
  end if;
  if p_public_key_hex is null or p_public_key_hex !~ '^[0-9a-f]+$'
    or char_length(p_public_key_hex) not between 32 and 8192
    or coalesce(cardinality(p_transports), 0) > 10
    or exists(select 1 from unnest(p_transports) t where t is null or
      t not in ('usb','nfc','ble','internal','hybrid','cable','smart-card')) then
    raise exception 'kova_auth_invalid_passkey_request';
  end if;
  if (select count(*) from kova_private.auth_passkeys k where k.account_id = v_session.account_id
      and k.disabled_at is null) >= 10 then raise exception 'kova_auth_passkey_limit'; end if;
  insert into kova_private.auth_passkeys(account_id, rp_id, credential_id, public_key, user_handle,
    sign_count, backup_eligible, backed_up, transports, friendly_name, created_at)
  values(v_session.account_id, v_challenge.rp_id, p_credential_id, decode(p_public_key_hex, 'hex'),
    rtrim(translate(encode(convert_to(v_session.account_id::text, 'utf8'), 'base64'), '+/', '-_'), '='),
    p_counter, p_backup_eligible, p_backed_up, coalesce(p_transports, '{}'), v_challenge.friendly_name, p_now)
  returning id into v_passkey_id;
  update kova_private.auth_passkey_challenges set consumed_at = p_now where id = v_challenge.id;
  v_next := kova_private.rotate_security_session(v_session, p_next_session_digest_hex,
    'aal2', p_expires_at, 'passkey_registered', jsonb_build_object('passkey_id', v_passkey_id), p_now);
  return query select v_next.id, a.id, a.primary_email, true, v_next.assurance_level, v_next.expires_at
    from kova_private.auth_accounts a where a.id = v_next.account_id;
end
$$;

