-- Tickets record their authenticated authority, never infer it from a UUID.
-- Legacy and owned session IDs may collide without granting cross-authority access.
-- Optional Sites installations are upgraded only when their source schema exists.
do $migration$
begin
  if to_regclass('public.kova_site_access_sessions') is null then return; end if;
  execute $ddl$
alter table public.kova_site_access_sessions add column auth_provider text not null default 'supabase' check (auth_provider in ('supabase','kova'));
$ddl$;
  execute $ddl$
create function kova_private.site_authorized_session(p_user uuid,p_session uuid,p_provider text)
returns boolean language sql stable security definer set search_path = '' set statement_timeout = '5s' as $$
 select case
   when p_provider = 'supabase' then public.kova_auth_legacy_session_allowed(p_user)
     and kova_private.site_auth_session_current(p_user,p_session)
   when p_provider = 'kova' then kova_private.site_principal_current(p_user)
     and public.kova_auth_directory_email(p_user) is not null
     and kova_private.legacy_principal_permitted(p_user)
     and exists (
       select 1 from kova_private.auth_sessions s
       join kova_private.auth_accounts a on a.id=s.account_id
       where s.id=p_session and s.account_id=p_user
         and s.created_at <= statement_timestamp() and s.expires_at > statement_timestamp()
         and s.revoked_at is null and s.session_epoch=a.session_epoch
         and a.email_verified_at is not null and a.deleted_at is null
         and (a.suspended_until is null or a.suspended_until <= statement_timestamp())
         and (not (a.mfa_required or kova_private.legacy_mfa_required(a.id)) or s.assurance_level='aal2')
     )
   else false end
$$;
$ddl$;
  execute $ddl$
create function public.check_kova_owned_site_auth_session(p_user uuid,p_session uuid)
returns boolean language sql stable security invoker set search_path = '' set statement_timeout = '5s' as $$
 select kova_private.site_authorized_session(p_user,p_session,'kova')
$$;
$ddl$;
  execute $ddl$
CREATE FUNCTION kova_private.issue_site_ticket_authorized(p_user uuid,p_site uuid,p_token_hash text,p_auth_session uuid,p_preview uuid,p_provider text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE site public.kova_sites;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR NOT kova_private.site_authorized_session(p_user,p_auth_session,p_provider) THEN RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,20260903204500));
 SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR NOT kova_private.site_principal_current(site.owner_id) THEN RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501'; END IF;
 IF p_preview IS NOT NULL THEN
  IF site.owner_id<>p_user OR NOT EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=p_preview AND site_id=p_site AND state='ready') THEN RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501'; END IF;
 ELSIF site.published_version_id IS NULL OR (site.owner_id<>p_user AND site.visibility<>'public' AND NOT EXISTS(SELECT 1 FROM public.kova_site_viewers WHERE site_id=p_site AND viewer_id=p_user)) THEN
  RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM public.kova_site_access_sessions WHERE user_id=p_user AND expires_at>now())>=100 THEN RAISE EXCEPTION 'site_session_capacity' USING ERRCODE='54000'; END IF;
 INSERT INTO public.kova_site_access_sessions(token_hash,site_id,user_id,publication_epoch,preview_version_id,auth_session_id,auth_provider,state,expires_at)
  VALUES(p_token_hash,p_site,p_user,site.publication_epoch,p_preview,p_auth_session,p_provider,'ticket',now()+interval '60 seconds');
 RETURN jsonb_build_object('slug',site.slug);
END;$$;
$ddl$;
  execute $ddl$
create or replace function public.issue_kova_site_ticket(p_user uuid,p_site uuid,p_token_hash text,p_auth_session uuid,p_preview uuid default null)
returns jsonb language sql security invoker set search_path = '' set statement_timeout = '10s' as $$
 select kova_private.issue_site_ticket_authorized(p_user,p_site,p_token_hash,p_auth_session,p_preview,'supabase')
$$;
$ddl$;
  execute $ddl$
create function public.issue_kova_owned_site_ticket(p_user uuid,p_site uuid,p_token_hash text,p_auth_session uuid,p_preview uuid default null)
returns jsonb language sql security invoker set search_path = '' set statement_timeout = '10s' as $$
 select kova_private.issue_site_ticket_authorized(p_user,p_site,p_token_hash,p_auth_session,p_preview,'kova')
$$;
$ddl$;
  execute $ddl$
CREATE OR REPLACE FUNCTION public.redeem_kova_site_ticket(p_site uuid,p_ticket_hash text,p_session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE ticket public.kova_site_access_sessions; site public.kova_sites;
BEGIN
 IF p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR NOT kova_private.site_principal_current(site.owner_id) THEN RETURN NULL; END IF;
 SELECT * INTO ticket FROM public.kova_site_access_sessions WHERE token_hash=p_ticket_hash AND site_id=p_site AND state='ticket' AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR ticket.publication_epoch<>site.publication_epoch OR NOT kova_private.site_authorized_session(ticket.user_id,ticket.auth_session_id,ticket.auth_provider) THEN RETURN NULL; END IF;
 IF ticket.preview_version_id IS NOT NULL THEN
  IF ticket.user_id<>site.owner_id OR NOT EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=ticket.preview_version_id AND site_id=p_site AND state='ready') THEN RETURN NULL; END IF;
 ELSIF site.published_version_id IS NULL OR (ticket.user_id<>site.owner_id AND site.visibility<>'public' AND NOT EXISTS(SELECT 1 FROM public.kova_site_viewers WHERE site_id=p_site AND viewer_id=ticket.user_id)) THEN RETURN NULL; END IF;
 DELETE FROM public.kova_site_access_sessions WHERE token_hash=p_ticket_hash;
 INSERT INTO public.kova_site_access_sessions(token_hash,site_id,user_id,publication_epoch,preview_version_id,auth_session_id,auth_provider,state,expires_at)
  VALUES(p_session_hash,p_site,ticket.user_id,site.publication_epoch,ticket.preview_version_id,ticket.auth_session_id,ticket.auth_provider,'session',now()+interval '15 minutes');
 RETURN jsonb_build_object('slug',site.slug);
END;$$;
$ddl$;
  execute $ddl$
CREATE OR REPLACE FUNCTION public.read_kova_site_asset(p_site uuid,p_slug text,p_path text,p_session_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='10s' AS $$
DECLARE site public.kova_sites; session public.kova_site_access_sessions; v_version uuid; file public.kova_site_files;
BEGIN
 SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR NOT kova_private.site_principal_current(site.owner_id) THEN RETURN NULL; END IF;
 IF p_session_hash IS NOT NULL THEN
  SELECT * INTO session FROM public.kova_site_access_sessions WHERE token_hash=p_session_hash AND site_id=p_site AND state='session' AND expires_at>now();
  IF FOUND AND session.publication_epoch=site.publication_epoch AND kova_private.site_authorized_session(session.user_id,session.auth_session_id,session.auth_provider) THEN
   IF session.preview_version_id IS NOT NULL THEN
    IF session.user_id=site.owner_id AND EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=session.preview_version_id AND site_id=p_site AND state='ready') THEN v_version:=session.preview_version_id; END IF;
   ELSIF session.user_id=site.owner_id OR site.visibility='public' OR EXISTS(SELECT 1 FROM public.kova_site_viewers WHERE site_id=p_site AND viewer_id=session.user_id) THEN v_version:=site.published_version_id;
   END IF;
  END IF;
 END IF;
 -- Invalid private capabilities never reveal previews; the current public
 -- publication remains independently readable by anonymous visitors.
 IF v_version IS NULL AND site.visibility='public' THEN v_version:=site.published_version_id; END IF;
 IF v_version IS NULL OR NOT EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=v_version AND site_id=p_site AND state='ready') THEN RETURN NULL; END IF;
 IF p_slug<>site.slug THEN
  IF EXISTS(SELECT 1 FROM public.kova_site_aliases WHERE site_id=p_site AND slug=p_slug) THEN RETURN jsonb_build_object('redirectSlug',site.slug); END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO file FROM public.kova_site_files f WHERE f.site_id=p_site AND f.version_id=v_version AND f.path=p_path;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('base64',file.content_base64,'type',file.mime_type,'sha256',file.sha256,'size',file.size_bytes,'versionId',file.version_id);
END;$$;
$ddl$;
  execute $ddl$
revoke all on function kova_private.site_authorized_session(uuid,uuid,text) from public,anon,authenticated; grant execute on function kova_private.site_authorized_session(uuid,uuid,text) to service_role;
$ddl$;
  execute $ddl$
revoke all on function public.check_kova_owned_site_auth_session(uuid,uuid) from public,anon,authenticated; grant execute on function public.check_kova_owned_site_auth_session(uuid,uuid) to service_role;
$ddl$;
  execute $ddl$
revoke all on function kova_private.issue_site_ticket_authorized(uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated; grant execute on function kova_private.issue_site_ticket_authorized(uuid,uuid,text,uuid,uuid,text) to service_role;
$ddl$;
  execute $ddl$
revoke all on function public.issue_kova_site_ticket(uuid,uuid,text,uuid,uuid) from public,anon,authenticated; grant execute on function public.issue_kova_site_ticket(uuid,uuid,text,uuid,uuid) to service_role;
$ddl$;
  execute $ddl$
revoke all on function public.issue_kova_owned_site_ticket(uuid,uuid,text,uuid,uuid) from public,anon,authenticated; grant execute on function public.issue_kova_owned_site_ticket(uuid,uuid,text,uuid,uuid) to service_role;
$ddl$;
  execute $ddl$
revoke all on function public.redeem_kova_site_ticket(uuid,text,text) from public,anon,authenticated; grant execute on function public.redeem_kova_site_ticket(uuid,text,text) to service_role;
$ddl$;
  execute $ddl$
revoke all on function public.read_kova_site_asset(uuid,text,text,text) from public,anon,authenticated; grant execute on function public.read_kova_site_asset(uuid,text,text,text) to service_role;
$ddl$;
end
$migration$;
