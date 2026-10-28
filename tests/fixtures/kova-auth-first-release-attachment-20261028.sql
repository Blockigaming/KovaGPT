-- Exact non-secret operator guard definitions captured read-only on 2026-10-28.
CREATE OR REPLACE FUNCTION kova_private.first_release_inert_principal(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
  select exists (
    select 1 from auth.users u where u.id = p_account_id
      and u.raw_app_meta_data->>'provider' = 'kova_shadow'
      and u.raw_app_meta_data->'providers' = '[]'::jsonb
      and u.raw_user_meta_data->'kova_shadow' = 'true'::jsonb
      and u.email = 'shadow+' || u.id || '@auth.invalid.kovagpt.com'
      and u.encrypted_password is null and u.email_confirmed_at is null
      and u.deleted_at is null and u.is_anonymous is false
      and u.banned_until = 'infinity'::timestamptz
      and not exists (select 1 from auth.identities i where i.user_id = u.id)
      and not exists (select 1 from auth.sessions s where s.user_id = u.id)
      and not exists (select 1 from auth.mfa_factors f where f.user_id = u.id)
  )
$function$;
CREATE OR REPLACE FUNCTION kova_private.first_release_hosted_mailbox_conflict(p_email text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
  select u.id from auth.users u
   where lower(btrim(u.email)) = lower(btrim(p_email))
     and not kova_private.first_release_inert_principal(u.id)
     and not exists (
       select 1 from kova_private.auth_accounts a
        where a.id = u.id and a.legacy_supabase_user_id = u.id
          and a.primary_email = lower(btrim(p_email))
     )
   order by u.id limit 1
$function$;
CREATE OR REPLACE FUNCTION kova_private.first_release_guard_owned_attachment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '5s'
AS $function$
declare v_attachment_changed boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_attachment_changed := new.id is distinct from old.id
      or new.legacy_supabase_user_id is distinct from old.legacy_supabase_user_id;
  end if;
  if v_attachment_changed and (
    (new.legacy_supabase_user_id is not null and
      not kova_private.first_release_inert_principal(new.legacy_supabase_user_id))
    or (exists (select 1 from auth.users u where u.id = new.id) and
      not kova_private.first_release_inert_principal(new.id))
  ) then
    raise exception 'kova_first_release_hosted_adoption_disabled' using errcode = 'KVA02';
  end if;
  if kova_private.first_release_hosted_mailbox_conflict(new.primary_email) is not null then
    raise exception 'kova_first_release_hosted_adoption_disabled' using errcode = 'KVA02';
  end if;
  return new;
end
$function$;
revoke all on function kova_private.first_release_inert_principal(uuid),
  kova_private.first_release_hosted_mailbox_conflict(text),
  kova_private.first_release_guard_owned_attachment()
  from public, anon, authenticated, service_role;
create trigger kova_first_release_owned_attachment before insert or update
  on kova_private.auth_accounts for each row
  execute function kova_private.first_release_guard_owned_attachment();
