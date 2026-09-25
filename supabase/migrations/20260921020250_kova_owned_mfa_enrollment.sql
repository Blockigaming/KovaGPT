create function public.kova_auth_begin_totp_enrollment(
  p_session_digest_hex text, p_secret_envelope text,
  p_friendly_name text default 'Authenticator app', p_now timestamptz default now()
) returns table(factor_id uuid, email text)
language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
#variable_conflict use_column
declare v_session kova_private.auth_sessions; v_account kova_private.auth_accounts; v_factor_id uuid;
begin
  if char_length(p_secret_envelope) not between 20 and 4096 or
     char_length(btrim(p_friendly_name)) not between 1 and 120 then
    raise exception 'kova_auth_invalid_mfa_enrollment';
  end if;
  select s.* into v_session from kova_private.auth_sessions s
    join kova_private.auth_accounts a on a.id = s.account_id
   where s.token_digest = kova_private.require_digest(p_session_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and a.deleted_at is null and (a.suspended_until is null or a.suspended_until <= p_now)
   for update of s;
  if v_session.id is null then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_account from kova_private.auth_accounts where id = v_session.account_id for update;
  if exists(select 1 from kova_private.auth_mfa_factors f where f.account_id = v_account.id
    and f.state = 'active' and f.disabled_at is null) and v_session.assurance_level <> 'aal2' then
    raise exception 'kova_auth_mfa_required';
  end if;
  update kova_private.auth_mfa_factors set state = 'disabled', disabled_at = p_now, updated_at = p_now
   where account_id = v_account.id and state = 'pending';
  insert into kova_private.auth_mfa_factors(
    account_id, factor_type, state, friendly_name, secret_ciphertext, created_at, updated_at
  ) values (
    v_account.id, 'totp', 'pending', btrim(p_friendly_name), convert_to(p_secret_envelope, 'utf8'), p_now, p_now
  ) returning id into v_factor_id;
  perform kova_private.audit(v_account.id, v_session.id, 'mfa_enrollment_started', 'success', '{}', p_now);
  return query select v_factor_id, v_account.primary_email;
end
$$;

create function public.kova_auth_read_totp_enrollment(
  p_session_digest_hex text, p_factor_id uuid, p_now timestamptz default now()
) returns table(factor_id uuid, secret_envelope text)
language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select f.id, convert_from(f.secret_ciphertext, 'utf8')
    from kova_private.auth_sessions s
    join kova_private.auth_accounts a on a.id = s.account_id
    join kova_private.auth_mfa_factors f on f.account_id = a.id
   where s.token_digest = kova_private.require_digest(p_session_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and a.deleted_at is null and f.id = p_factor_id and f.factor_type = 'totp'
     and f.state = 'pending' and f.disabled_at is null
$$;

create function public.kova_auth_activate_totp(
  p_session_digest_hex text, p_factor_id uuid, p_recovery_digest_hexes text[],
  p_now timestamptz default now()
) returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_session kova_private.auth_sessions; v_factor kova_private.auth_mfa_factors; v_digest text;
begin
  if coalesce(array_length(p_recovery_digest_hexes, 1), 0) <> 8 then
    raise exception 'kova_auth_invalid_recovery_codes';
  end if;
  select s.* into v_session from kova_private.auth_sessions s
    join kova_private.auth_accounts a on a.id = s.account_id
   where s.token_digest = kova_private.require_digest(p_session_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and a.deleted_at is null for update of s;
  if v_session.id is null then raise exception 'kova_auth_invalid_session'; end if;
  select * into v_factor from kova_private.auth_mfa_factors
   where id = p_factor_id and account_id = v_session.account_id and factor_type = 'totp'
     and state = 'pending' and disabled_at is null for update;
  if v_factor.id is null then raise exception 'kova_auth_invalid_mfa_enrollment'; end if;
  update kova_private.auth_mfa_factors set state = 'active', verified_at = p_now, updated_at = p_now
   where id = v_factor.id;
  update kova_private.auth_accounts set mfa_required = true, updated_at = p_now
   where id = v_session.account_id;
  update kova_private.auth_sessions set assurance_level = 'aal2', last_seen_at = p_now
   where id = v_session.id;
  delete from kova_private.auth_mfa_recovery_codes where account_id = v_session.account_id;
  foreach v_digest in array p_recovery_digest_hexes loop
    insert into kova_private.auth_mfa_recovery_codes(account_id, code_digest, created_at)
    values(v_session.account_id, kova_private.require_digest(v_digest), p_now);
  end loop;
  update kova_private.auth_sessions set revoked_at = p_now
   where account_id = v_session.account_id and id <> v_session.id and revoked_at is null;
  perform kova_private.audit(v_session.account_id, v_session.id, 'mfa_enabled', 'success',
    jsonb_build_object('factor_id', v_factor.id), p_now);
  return true;
end
$$;

create function public.kova_auth_list_totp_factors(
  p_session_digest_hex text, p_now timestamptz default now()
) returns table(factor_id uuid, friendly_name text, verified_at timestamptz, recovery_codes_remaining bigint)
language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
  select f.id, f.friendly_name, f.verified_at,
    (select count(*) from kova_private.auth_mfa_recovery_codes r
      where r.account_id = a.id and r.consumed_at is null)
    from kova_private.auth_sessions s
    join kova_private.auth_accounts a on a.id = s.account_id
    join kova_private.auth_mfa_factors f on f.account_id = a.id
   where s.token_digest = kova_private.require_digest(p_session_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and a.deleted_at is null and f.factor_type = 'totp' and f.state = 'active'
     and f.disabled_at is null and s.assurance_level = 'aal2'
   order by f.verified_at, f.id
$$;

create function public.kova_auth_remove_totp_factor(
  p_session_digest_hex text, p_factor_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare v_session kova_private.auth_sessions; v_changed integer;
begin
  select s.* into v_session from kova_private.auth_sessions s
    join kova_private.auth_accounts a on a.id = s.account_id
   where s.token_digest = kova_private.require_digest(p_session_digest_hex)
     and s.revoked_at is null and s.expires_at > p_now and s.session_epoch = a.session_epoch
     and a.deleted_at is null and s.assurance_level = 'aal2' for update of s;
  if v_session.id is null then raise exception 'kova_auth_mfa_required'; end if;
  update kova_private.auth_mfa_factors set state = 'disabled', disabled_at = p_now, updated_at = p_now
   where id = p_factor_id and account_id = v_session.account_id and factor_type = 'totp'
     and state = 'active' and disabled_at is null;
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then raise exception 'kova_auth_invalid_mfa_factor'; end if;
  if not exists(select 1 from kova_private.auth_mfa_factors where account_id = v_session.account_id
    and state = 'active' and disabled_at is null) then
    update kova_private.auth_accounts set mfa_required = false, updated_at = p_now
     where id = v_session.account_id;
    delete from kova_private.auth_mfa_recovery_codes where account_id = v_session.account_id;
  end if;
  update kova_private.auth_sessions set revoked_at = p_now
   where account_id = v_session.account_id and id <> v_session.id and revoked_at is null;
  perform kova_private.audit(v_session.account_id, v_session.id, 'mfa_removed', 'success',
    jsonb_build_object('factor_id', p_factor_id), p_now);
  return true;
end
$$;

revoke all on function public.kova_auth_begin_totp_enrollment(text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_read_totp_enrollment(text,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_activate_totp(text,uuid,text[],timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_list_totp_factors(text,timestamptz) from public, anon, authenticated;
revoke all on function public.kova_auth_remove_totp_factor(text,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.kova_auth_begin_totp_enrollment(text,text,text,timestamptz) to service_role;
grant execute on function public.kova_auth_read_totp_enrollment(text,uuid,timestamptz) to service_role;
grant execute on function public.kova_auth_activate_totp(text,uuid,text[],timestamptz) to service_role;
grant execute on function public.kova_auth_list_totp_factors(text,timestamptz) to service_role;
grant execute on function public.kova_auth_remove_totp_factor(text,uuid,timestamptz) to service_role;
