-- Reconcile the observed first-release operator guard with verified Google
-- subject adoption. No account, credential, identity, or session is changed.
-- The existing Google RPC inserts its account before its owned identity; a
-- deferred constraint checks that proof before the RPC transaction may commit.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';

do $migration$
declare
  v_guard oid := to_regprocedure('kova_private.first_release_guard_owned_attachment()');
  v_inert oid := to_regprocedure('kova_private.first_release_inert_principal(uuid)');
  v_mailbox oid := to_regprocedure('kova_private.first_release_hosted_mailbox_conflict(text)');
  v_trigger oid;
begin
  select t.oid into v_trigger from pg_trigger t
   where t.tgrelid = 'kova_private.auth_accounts'::regclass
     and t.tgname = 'kova_first_release_owned_attachment' and not t.tgisinternal;
  -- A clean canonical source replay has no operator-only first-release guard.
  if v_guard is null and v_inert is null and v_mailbox is null and v_trigger is null then
    return;
  end if;
  if v_guard is null or v_inert is null or v_mailbox is null or v_trigger is null
     or md5(pg_get_functiondef(v_guard)) <> '0f9c6c5f255340905838663942496859'
     or md5(pg_get_functiondef(v_inert)) <> '11b9e4f8c7375aaa193146ce5b4b63ca'
     or md5(pg_get_functiondef(v_mailbox)) <> '27090e1f5005fc8eaf465f34a7402f4a'
     or not exists (select 1 from pg_trigger t where t.oid = v_trigger
       and t.tgfoid = v_guard and t.tgtype = 23 and t.tgenabled = 'O'
       and t.tgnargs = 0 and t.tgqual is null and t.tgattr = ''::int2vector
       and not t.tgdeferrable)
  then
    raise exception 'kova_google_attachment_guard_baseline_changed' using errcode = 'KVA02';
  end if;
  -- The older production RPC linked accounts by mailbox. Relaxing its guard
  -- without the reviewed subject-based replacement would retain that flaw.
  if coalesce(md5(pg_get_functiondef(to_regprocedure(
    'public.kova_auth_finish_google(uuid,text,text,boolean,text,text,timestamptz,timestamptz)'
  ))), '') <> '473b3bb240f6229cbfcc652cfca65f03' then
    raise exception 'kova_google_attachment_subject_rpc_required' using errcode = 'KVA02';
  end if;

  execute $ddl$
create function kova_private.first_release_google_attachment_matches(
  p_account_id uuid, p_legacy_id uuid, p_email text, p_require_owned_identity boolean
) returns boolean language sql stable security definer set search_path = '' set statement_timeout = '5s' as $body$
  select p_account_id is not null and p_legacy_id = p_account_id
    and p_email = lower(btrim(p_email))
    and exists (
      select 1 from auth.users u
       where u.id = p_account_id and lower(btrim(u.email)) = p_email
         and u.email_confirmed_at is not null and u.deleted_at is null
         and not coalesce(u.is_anonymous, false)
         and (u.banned_until is null or u.banned_until <= statement_timestamp())
         and not kova_private.first_release_inert_principal(u.id)
         and exists (
           select 1 from auth.identities h
            where h.user_id = u.id and h.provider = 'google'
              and h.provider_id is not null and char_length(h.provider_id) between 1 and 512
              and h.identity_data->>'sub' = h.provider_id
              and not exists (select 1 from auth.identities other_identity
                where other_identity.provider = 'google'
                  and other_identity.provider_id = h.provider_id
                  and other_identity.user_id <> u.id)
              and (not p_require_owned_identity or exists (
                select 1 from kova_private.auth_identities owned
                 where owned.account_id = u.id and owned.provider = 'google'
                   and owned.provider_subject = h.provider_id
                   and owned.normalized_email = p_email
                   and owned.verified_at is not null and owned.disabled_at is null
              ))
         )
    )
    and not exists (
      select 1 from auth.users other_user
       where lower(btrim(other_user.email)) = p_email and other_user.id <> p_account_id
         and not kova_private.first_release_inert_principal(other_user.id)
    )
$body$;
  $ddl$;
  execute $ddl$revoke all on function kova_private.first_release_google_attachment_matches(uuid,uuid,text,boolean) from public, anon, authenticated, service_role;$ddl$;

  execute $ddl$
create or replace function kova_private.first_release_guard_owned_attachment()
returns trigger language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $body$
declare
  v_attachment_changed boolean := true;
  v_google_candidate boolean;
  v_conflict uuid;
begin
  if tg_op = 'UPDATE' then
    v_attachment_changed := new.id is distinct from old.id
      or new.legacy_supabase_user_id is distinct from old.legacy_supabase_user_id;
  end if;
  v_google_candidate := coalesce(kova_private.first_release_google_attachment_matches(
    new.id, new.legacy_supabase_user_id, new.primary_email, false), false);
  if v_attachment_changed and (
    (new.legacy_supabase_user_id is not null and
      not kova_private.first_release_inert_principal(new.legacy_supabase_user_id))
    or (exists (select 1 from auth.users u where u.id = new.id) and
      not kova_private.first_release_inert_principal(new.id))
  ) and not v_google_candidate then
    raise exception 'kova_first_release_hosted_adoption_disabled' using errcode = 'KVA02';
  end if;
  v_conflict := kova_private.first_release_hosted_mailbox_conflict(new.primary_email);
  if v_conflict is not null and not (v_google_candidate and v_conflict = new.id) then
    raise exception 'kova_first_release_hosted_adoption_disabled' using errcode = 'KVA02';
  end if;
  return new;
end
$body$;
  $ddl$;

  execute $ddl$
create function kova_private.first_release_check_google_attachment()
returns trigger language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $body$
declare v_account kova_private.auth_accounts;
begin
  if tg_op = 'UPDATE' and new.id is not distinct from old.id
     and new.legacy_supabase_user_id is not distinct from old.legacy_supabase_user_id then
    return null;
  end if;
  select * into v_account from kova_private.auth_accounts where id = new.id;
  if not found then return null; end if;
  -- Inert compatibility bridges keep their existing first-release contract.
  if (v_account.legacy_supabase_user_id is null or
      kova_private.first_release_inert_principal(v_account.legacy_supabase_user_id))
     and (not exists(select 1 from auth.users u where u.id = v_account.id) or
       kova_private.first_release_inert_principal(v_account.id)) then
    return null;
  end if;
  -- Lock the hosted principal/subject until this transaction commits. The
  -- approved finish RPC also takes these locks before creating the account.
  perform 1 from auth.users u where u.id = v_account.id for share;
  perform 1 from auth.identities h where h.user_id = v_account.id and h.provider = 'google' for share;
  if v_account.email_verified_at is null or v_account.deleted_at is not null
     or v_account.suspended_until > statement_timestamp()
     or not coalesce(kova_private.first_release_google_attachment_matches(
       v_account.id, v_account.legacy_supabase_user_id, v_account.primary_email, true), false) then
    raise exception 'kova_google_attachment_verified_subject_required' using errcode = 'KVA02';
  end if;
  return null;
end
$body$;
  $ddl$;
  execute $ddl$revoke all on function kova_private.first_release_check_google_attachment() from public, anon, authenticated, service_role;$ddl$;
  execute $ddl$
create constraint trigger kova_first_release_google_attachment_proof
after insert or update on kova_private.auth_accounts
deferrable initially deferred for each row
execute function kova_private.first_release_check_google_attachment();
  $ddl$;
end
$migration$;

commit;
