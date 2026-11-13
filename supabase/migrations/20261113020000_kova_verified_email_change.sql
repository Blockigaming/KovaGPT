begin;
create table kova_private.auth_email_changes (
  account_id uuid primary key references kova_private.auth_accounts(id) on delete cascade,
  session_id uuid not null references kova_private.auth_sessions(id) on delete cascade,
  old_email text not null,
  new_email text not null,
  old_proof bytea not null,
  new_proof bytea not null,
  expires_at timestamptz not null
);
alter table kova_private.auth_email_changes enable row level security;
revoke all on kova_private.auth_email_changes from public, anon, authenticated;

create function public.kova_auth_change_email(
  p_session text, p_owner uuid, p_email text, p_old_proof text, p_new_proof text,
  p_old_mail jsonb default null, p_new_mail jsonb default null
) returns text
language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare
  caller record;
  account kova_private.auth_accounts;
  pending kova_private.auth_email_changes;
  stamp timestamptz := clock_timestamp();
  old_digest bytea := kova_private.require_digest(p_old_proof);
  new_digest bytea := kova_private.require_digest(p_new_proof);
begin
  select * into caller from public.kova_auth_resolve_session(p_session, stamp);
  if caller.account_id is distinct from p_owner or caller.email_verified is distinct from true then
    return 'session';
  end if;
  if p_email is null or p_email <> lower(btrim(p_email)) or char_length(p_email) not between 3 and 320
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return 'invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kova_auth_email:' || p_email, 0));
  select * into account from kova_private.auth_accounts where id = p_owner for update;
  if not exists (
    select 1 from public.kova_auth_resolve_session(p_session, stamp) s where s.account_id = p_owner
  ) or exists (select 1 from public.account_deletion_fences where user_id = p_owner) then
    return 'session';
  end if;
  if exists (select 1 from kova_private.auth_identities where account_id = p_owner and provider = 'google')
     or not exists (
       select 1 from kova_private.auth_identities where account_id = p_owner and provider = 'email'
         and normalized_email = account.primary_email and disabled_at is null and verified_at is not null
     ) then
    return 'provider';
  end if;
  if p_email = account.primary_email
     or exists (select 1 from kova_private.auth_accounts where primary_email = p_email)
     or exists (select 1 from kova_private.auth_identities where normalized_email = p_email)
     or exists (select 1 from auth.users where lower(email) = p_email) then
    return 'unavailable';
  end if;
  if p_old_mail is not null and p_new_mail is not null then
    if p_old_mail->>'to' is distinct from account.primary_email
       or p_new_mail->>'to' is distinct from p_email
       or p_old_mail->>'purpose' is distinct from 'auth'
       or p_new_mail->>'purpose' is distinct from 'auth' then
      return 'invalid';
    end if;
    insert into kova_private.auth_email_changes values (
      p_owner, caller.session_id, account.primary_email, p_email, old_digest, new_digest,
      stamp + interval '20 minutes'
    ) on conflict (account_id) do update set session_id = excluded.session_id,
      old_email = excluded.old_email, new_email = excluded.new_email,
      old_proof = excluded.old_proof, new_proof = excluded.new_proof, expires_at = excluded.expires_at;
    perform public.enqueue_email('auth_emails', p_old_mail);
    perform public.enqueue_email('auth_emails', p_new_mail);
    return 'sent';
  end if;
  select * into pending from kova_private.auth_email_changes where account_id = p_owner for update;
  if pending.account_id is null or pending.expires_at <= stamp
     or pending.session_id <> caller.session_id or pending.old_email <> account.primary_email
     or pending.new_email <> p_email or pending.old_proof <> old_digest or pending.new_proof <> new_digest then
    return 'invalid';
  end if;
  update kova_private.auth_identities set normalized_email = p_email, provider_subject = p_email,
    verified_at = stamp, updated_at = stamp where account_id = p_owner and provider = 'email';
  update kova_private.auth_accounts set primary_email = p_email, email_verified_at = stamp,
    session_epoch = session_epoch + 1, updated_at = stamp where id = p_owner;
  update kova_private.auth_sessions set revoked_at = coalesce(revoked_at, stamp) where account_id = p_owner;
  update kova_private.auth_credentials set revision = revision + 1, updated_at = stamp where account_id = p_owner;
  update kova_private.auth_password_recoveries set consumed_at = coalesce(consumed_at, stamp) where account_id = p_owner;
  update kova_private.auth_email_verifications set consumed_at = coalesce(consumed_at, stamp) where account_id = p_owner;
  update kova_private.auth_mfa_login_challenges set consumed_at = coalesce(consumed_at, stamp) where account_id = p_owner;
  update kova_private.auth_session_handoffs set consumed_at = coalesce(consumed_at, stamp) where account_id = p_owner;
  delete from kova_private.auth_email_changes where account_id = p_owner;
  perform kova_private.retire_legacy_auth(p_owner, stamp);
  perform kova_private.audit(p_owner, null, 'email_changed', 'success', '{}', stamp);
  return 'changed';
end;
$$;
revoke all on function public.kova_auth_change_email(text,uuid,text,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.kova_auth_change_email(text,uuid,text,text,text,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
