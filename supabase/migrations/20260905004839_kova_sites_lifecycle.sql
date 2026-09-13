-- Kova Sites stores bounded immutable file snapshots transactionally. User HTML
-- is served only by the separately configured isolated-origin asset process.
CREATE TABLE public.kova_sites (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 100),
 slug text NOT NULL CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
 revision bigint NOT NULL DEFAULT 1, publication_epoch bigint NOT NULL DEFAULT 0,
 visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
 published_version_id uuid, publication_id uuid, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kova_sites_owner_idx ON public.kova_sites(owner_id,created_at,id);
CREATE TABLE public.kova_site_versions (
 id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES public.kova_sites(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 0 AND 8388608),
 file_count integer NOT NULL CHECK(file_count BETWEEN 1 AND 64),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','retired')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(site_id,id)
);
CREATE TABLE public.kova_site_files (
 site_id uuid NOT NULL, version_id uuid NOT NULL, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 path text NOT NULL CHECK(char_length(path) BETWEEN 1 AND 200 AND path ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]*$' AND path !~ '(^|/)\.\.?(/|$)' AND path !~ '//'),
 mime_type text NOT NULL, content_base64 text NOT NULL CHECK(octet_length(content_base64)<=2796204),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 0 AND 2097152),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(version_id,path), FOREIGN KEY(site_id,version_id) REFERENCES public.kova_site_versions(site_id,id) ON DELETE CASCADE
);
CREATE TABLE public.kova_site_aliases (
 site_id uuid NOT NULL REFERENCES public.kova_sites(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 slug text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site_id,slug)
);
CREATE TABLE public.kova_site_viewers (
 site_id uuid NOT NULL REFERENCES public.kova_sites(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 viewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 viewer_label text NOT NULL CHECK(length(viewer_label) BETWEEN 3 AND 254),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site_id,viewer_id)
);
CREATE TABLE public.kova_site_receipts (
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 mutation_id uuid NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,mutation_id)
);
-- No Auth FK: physical retirement work survives account cascades. Publication
-- revocation is immediate; this queue releases bytes and charges once per version.
CREATE TABLE public.kova_site_retirements (
 version_id uuid PRIMARY KEY, owner_id uuid NOT NULL, size_bytes bigint NOT NULL,
 settled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.kova_site_access_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 site_id uuid NOT NULL REFERENCES public.kova_sites(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 publication_epoch bigint NOT NULL, preview_version_id uuid,
 auth_session_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('ticket','session')), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kova_site_access_expiry_idx ON public.kova_site_access_sessions(expires_at);
DO $$DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['kova_sites','kova_site_versions','kova_site_files','kova_site_aliases','kova_site_viewers','kova_site_receipts','kova_site_retirements','kova_site_access_sessions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',name);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',name);
 END LOOP;
END;$$;

CREATE FUNCTION kova_private.site_principal_current(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user AND u.deleted_at IS NULL
  AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false)
  AND (u.banned_until IS NULL OR u.banned_until<=now()))
  AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_user)
  AND NOT EXISTS(SELECT 1 FROM public.banned_users WHERE user_id=p_user);
$$;
REVOKE ALL ON FUNCTION kova_private.site_principal_current(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kova_private.site_principal_current(uuid) TO service_role;

-- Supabase deletes auth.sessions rows on sign-out/revocation. Keep Auth
-- internals private while checking the exact session that issued a Site ticket.
CREATE FUNCTION kova_private.site_auth_session_current(p_user uuid,p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT kova_private.site_principal_current(p_user) AND EXISTS(
  SELECT 1 FROM auth.sessions s WHERE s.id=p_session AND s.user_id=p_user
   AND ((to_jsonb(s)->>'not_after') IS NULL OR (to_jsonb(s)->>'not_after')::timestamptz>now()));
$$;
REVOKE ALL ON FUNCTION kova_private.site_auth_session_current(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION kova_private.site_auth_session_current(uuid,uuid) TO service_role;
CREATE FUNCTION public.check_kova_site_auth_session(p_user uuid,p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT kova_private.site_auth_session_current(p_user,p_session);
$$;
REVOKE ALL ON FUNCTION public.check_kova_site_auth_session(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_kova_site_auth_session(uuid,uuid) TO service_role;

CREATE FUNCTION public.mutate_kova_site(p_owner uuid,p_site uuid,p_mutation uuid,p_revision bigint,p_action text,p_payload jsonb,p_storage_limit bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE site public.kova_sites; previous public.kova_site_receipts; fingerprint text; result jsonb; version_id uuid; file jsonb; total bigint:=0; viewer uuid; target public.kova_site_versions;
BEGIN
 IF p_owner IS NULL OR p_site IS NULL OR p_mutation IS NULL OR p_revision IS NULL OR p_revision<0
  OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR pg_column_size(p_payload)>12582912
 THEN RAISE EXCEPTION 'site_request_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 IF NOT kova_private.site_principal_current(p_owner) THEN RAISE EXCEPTION 'site_account_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':'||p_mutation::text,20260905004839));
 fingerprint:=md5(jsonb_build_object('site',p_site,'revision',p_revision,'action',p_action,'payload',p_payload)::text);
 SELECT * INTO previous FROM public.kova_site_receipts WHERE owner_id=p_owner AND mutation_id=p_mutation;
 IF FOUND THEN
  IF previous.request_hash<>fingerprint THEN RAISE EXCEPTION 'site_idempotency_conflict' USING ERRCODE='40001'; END IF;
  RETURN previous.result;
 END IF;
 IF (SELECT count(*) FROM public.kova_site_receipts WHERE owner_id=p_owner)>=10000 THEN RAISE EXCEPTION 'site_receipt_capacity' USING ERRCODE='54000'; END IF;
 IF p_action='create' THEN
  IF p_revision<>0 OR (SELECT count(*) FROM public.kova_sites WHERE owner_id=p_owner AND deleted_at IS NULL)>=20 THEN RAISE EXCEPTION 'site_capacity' USING ERRCODE='54000'; END IF;
  INSERT INTO public.kova_sites(id,owner_id,title,slug) VALUES(p_site,p_owner,p_payload->>'title',p_payload->>'slug') RETURNING * INTO site;
  INSERT INTO public.kova_site_aliases(site_id,owner_id,slug) VALUES(p_site,p_owner,site.slug);
 ELSE
  SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND owner_id=p_owner FOR UPDATE;
  IF NOT FOUND OR site.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'site_not_found' USING ERRCODE='P0002'; END IF;
  IF site.revision<>p_revision THEN RAISE EXCEPTION 'site_revision_conflict' USING ERRCODE='40001'; END IF;
  IF p_action='saveVersion' THEN
   version_id:=(p_payload->>'versionId')::uuid;
   IF (SELECT count(*) FROM public.kova_site_versions WHERE site_id=p_site AND state='ready')>=20 THEN RAISE EXCEPTION 'site_version_capacity' USING ERRCODE='54000'; END IF;
   IF jsonb_typeof(p_payload->'files') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'files') NOT BETWEEN 1 AND 64 THEN RAISE EXCEPTION 'site_file_limit' USING ERRCODE='22023'; END IF;
   FOR file IN SELECT value FROM jsonb_array_elements(p_payload->'files') LOOP
    IF octet_length(file->>'base64')>2796204 OR (file->>'size')::bigint IS DISTINCT FROM octet_length(decode(file->>'base64','base64'))
      OR (file->>'size')::bigint NOT BETWEEN 0 AND 2097152 OR file->>'path' ~ '(^|/)__kova'
      OR file->>'type' NOT IN('text/html','text/css','text/javascript','application/json','text/plain','text/markdown','text/csv','image/svg+xml','image/png','image/jpeg','image/webp','image/gif','image/avif','image/x-icon','font/woff','font/woff2')
    THEN RAISE EXCEPTION 'site_file_invalid' USING ERRCODE='22023'; END IF;
    total:=total+(file->>'size')::bigint;
   END LOOP;
   IF total>8388608 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'files') f WHERE f->>'path'='index.html' AND f->>'type'='text/html')
    OR (SELECT count(DISTINCT lower(f->>'path')) FROM jsonb_array_elements(p_payload->'files') f)<>jsonb_array_length(p_payload->'files')
   THEN RAISE EXCEPTION 'site_manifest_invalid' USING ERRCODE='22023'; END IF;
   IF p_storage_limit IS NULL OR p_storage_limit<=0 OR NOT public.try_add_storage_bytes(p_owner,total,p_storage_limit) THEN RAISE EXCEPTION 'site_storage_limit' USING ERRCODE='54000'; END IF;
   INSERT INTO public.kova_site_versions(id,site_id,owner_id,manifest_sha256,size_bytes,file_count)
    VALUES(version_id,p_site,p_owner,p_payload->>'manifestSha256',total,jsonb_array_length(p_payload->'files'));
   INSERT INTO public.kova_site_files(site_id,version_id,owner_id,path,mime_type,content_base64,size_bytes,sha256)
    SELECT p_site,version_id,p_owner,f->>'path',f->>'type',f->>'base64',(f->>'size')::integer,f->>'sha256' FROM jsonb_array_elements(p_payload->'files') f;
  ELSIF p_action='rename' THEN
   IF (SELECT count(*) FROM public.kova_site_aliases WHERE site_id=p_site)>=200 AND NOT EXISTS(SELECT 1 FROM public.kova_site_aliases WHERE site_id=p_site AND slug=p_payload->>'slug') THEN RAISE EXCEPTION 'site_alias_capacity' USING ERRCODE='54000'; END IF;
   UPDATE public.kova_sites SET title=p_payload->>'title',slug=p_payload->>'slug' WHERE id=p_site;
   INSERT INTO public.kova_site_aliases(site_id,owner_id,slug) VALUES(p_site,p_owner,p_payload->>'slug') ON CONFLICT DO NOTHING;
  ELSIF p_action='publish' THEN
   SELECT * INTO target FROM public.kova_site_versions WHERE id=(p_payload->>'versionId')::uuid AND site_id=p_site AND owner_id=p_owner AND state='ready';
   IF NOT FOUND THEN RAISE EXCEPTION 'site_version_unavailable' USING ERRCODE='P0002'; END IF;
   UPDATE public.kova_sites SET published_version_id=target.id,publication_id=p_mutation,publication_epoch=publication_epoch+1,visibility=p_payload->>'visibility' WHERE id=p_site;
  ELSIF p_action='unpublish' THEN
   UPDATE public.kova_sites SET published_version_id=NULL,publication_id=NULL,publication_epoch=publication_epoch+1,visibility='private' WHERE id=p_site;
  ELSIF p_action='grantViewer' THEN
   viewer:=kova_private.verified_auth_user_for_email(p_payload->>'email');
   IF viewer IS NULL OR NOT kova_private.site_principal_current(viewer) THEN RAISE EXCEPTION 'site_viewer_unavailable' USING ERRCODE='22023'; END IF;
   IF (SELECT count(*) FROM public.kova_site_viewers WHERE site_id=p_site)>=50 THEN RAISE EXCEPTION 'site_viewer_capacity' USING ERRCODE='54000'; END IF;
   INSERT INTO public.kova_site_viewers(site_id,owner_id,viewer_id,viewer_label) VALUES(p_site,p_owner,viewer,lower(trim(p_payload->>'email'))) ON CONFLICT(site_id,viewer_id) DO UPDATE SET viewer_label=excluded.viewer_label;
  ELSIF p_action='revokeViewer' THEN
   DELETE FROM public.kova_site_viewers WHERE site_id=p_site AND viewer_id=(p_payload->>'viewerId')::uuid;
   UPDATE public.kova_sites SET publication_epoch=publication_epoch+1 WHERE id=p_site;
  ELSIF p_action IN('retireVersion','delete') THEN
   IF p_action='delete' THEN
    UPDATE public.kova_sites SET deleted_at=now(),published_version_id=NULL,publication_id=NULL,publication_epoch=publication_epoch+1,visibility='private' WHERE id=p_site;
    DELETE FROM public.kova_site_viewers WHERE site_id=p_site;
   ELSIF site.published_version_id=(p_payload->>'versionId')::uuid THEN RAISE EXCEPTION 'site_version_published' USING ERRCODE='40001'; END IF;
   INSERT INTO public.kova_site_retirements(version_id,owner_id,size_bytes)
    SELECT id,owner_id,size_bytes FROM public.kova_site_versions WHERE site_id=p_site AND (p_action='delete' OR id=(p_payload->>'versionId')::uuid) ON CONFLICT DO NOTHING;
   UPDATE public.kova_site_versions SET state='retired' WHERE site_id=p_site AND state='ready' AND (p_action='delete' OR id=(p_payload->>'versionId')::uuid);
  ELSE RAISE EXCEPTION 'site_action_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.kova_sites SET revision=revision+1,updated_at=now() WHERE id=p_site RETURNING * INTO site;
 END IF;
 result:=jsonb_build_object('siteId',site.id,'revision',site.revision,'versionId',version_id,'publicationId',site.publication_id);
 INSERT INTO public.kova_site_receipts(owner_id,mutation_id,request_hash,result) VALUES(p_owner,p_mutation,fingerprint,result);
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.mutate_kova_site(uuid,uuid,uuid,bigint,text,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_kova_site(uuid,uuid,uuid,bigint,text,jsonb,bigint) TO service_role;

CREATE FUNCTION public.cleanup_kova_site_versions(p_owner uuid DEFAULT NULL,p_limit integer DEFAULT 5)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE entry public.kova_site_retirements; n integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'site_cleanup_invalid' USING ERRCODE='22023'; END IF;
 FOR entry IN SELECT * FROM public.kova_site_retirements WHERE settled_at IS NULL AND (p_owner IS NULL OR owner_id=p_owner) ORDER BY created_at,version_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  DELETE FROM public.kova_site_versions WHERE id=entry.version_id AND owner_id=entry.owner_id AND state='retired';
  UPDATE public.user_storage SET bytes_used=greatest(0,bytes_used-entry.size_bytes),updated_at=now() WHERE user_id=entry.owner_id;
  UPDATE public.kova_site_retirements SET settled_at=now() WHERE version_id=entry.version_id AND settled_at IS NULL;
  n:=n+1;
 END LOOP;
 -- Receipts cover retry windows, then stop consuming owner capacity. Expired
 -- access tokens contain no useful authority and are removed in bounded pages.
 DELETE FROM public.kova_site_access_sessions WHERE token_hash IN(SELECT token_hash FROM public.kova_site_access_sessions WHERE expires_at<now() ORDER BY expires_at LIMIT 200);
 DELETE FROM public.kova_site_receipts WHERE (owner_id,mutation_id) IN(SELECT owner_id,mutation_id FROM public.kova_site_receipts WHERE created_at<now()-interval '8 days' ORDER BY created_at LIMIT 200);
 RETURN n;
END;$$;
REVOKE ALL ON FUNCTION public.cleanup_kova_site_versions(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_kova_site_versions(uuid,integer) TO service_role;

CREATE FUNCTION public.read_kova_sites(p_owner uuid,p_site uuid DEFAULT NULL,p_version uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE site public.kova_sites; items jsonb; versions jsonb; viewers jsonb;
BEGIN
 IF NOT kova_private.site_principal_current(p_owner) THEN RAISE EXCEPTION 'site_account_unavailable' USING ERRCODE='42501'; END IF;
 IF p_site IS NULL THEN
  SELECT coalesce(jsonb_agg(row ORDER BY row.created_at DESC,row.id),'[]') INTO items FROM(SELECT id,title,slug,revision,visibility,published_version_id,publication_id,created_at FROM public.kova_sites WHERE owner_id=p_owner AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 20) row;
  RETURN jsonb_build_object('sites',items);
 END IF;
 SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND owner_id=p_owner AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'site_not_found' USING ERRCODE='P0002'; END IF;
 IF p_version IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=p_version AND site_id=p_site AND state='ready') THEN RAISE EXCEPTION 'site_version_unavailable' USING ERRCODE='P0002'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('path',path,'base64',content_base64) ORDER BY path),'[]') INTO items FROM public.kova_site_files WHERE version_id=p_version AND site_id=p_site AND owner_id=p_owner;
  RETURN jsonb_build_object('files',items);
 END IF;
 SELECT coalesce(jsonb_agg(row ORDER BY row.created_at DESC,row.id),'[]') INTO versions FROM(SELECT id,manifest_sha256,size_bytes,file_count,created_at FROM public.kova_site_versions WHERE site_id=p_site AND owner_id=p_owner AND state='ready' ORDER BY created_at DESC,id LIMIT 20) row;
 SELECT coalesce(jsonb_agg(row ORDER BY row.created_at,row.viewer_id),'[]') INTO viewers FROM(SELECT viewer_id,viewer_label,created_at FROM public.kova_site_viewers WHERE site_id=p_site AND owner_id=p_owner ORDER BY created_at,viewer_id LIMIT 50) row;
 RETURN jsonb_build_object('site',to_jsonb(site),'versions',versions,'viewers',viewers);
END;$$;
REVOKE ALL ON FUNCTION public.read_kova_sites(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_kova_sites(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.issue_kova_site_ticket(p_user uuid,p_site uuid,p_token_hash text,p_auth_session uuid,p_preview uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE site public.kova_sites;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR NOT kova_private.site_auth_session_current(p_user,p_auth_session) THEN RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,20260903204500));
 SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR NOT kova_private.site_principal_current(site.owner_id) THEN RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501'; END IF;
 IF p_preview IS NOT NULL THEN
  IF site.owner_id<>p_user OR NOT EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=p_preview AND site_id=p_site AND state='ready') THEN RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501'; END IF;
 ELSIF site.published_version_id IS NULL OR (site.owner_id<>p_user AND site.visibility<>'public' AND NOT EXISTS(SELECT 1 FROM public.kova_site_viewers WHERE site_id=p_site AND viewer_id=p_user)) THEN
  RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM public.kova_site_access_sessions WHERE user_id=p_user AND expires_at>now())>=100 THEN RAISE EXCEPTION 'site_session_capacity' USING ERRCODE='54000'; END IF;
 INSERT INTO public.kova_site_access_sessions(token_hash,site_id,user_id,publication_epoch,preview_version_id,auth_session_id,state,expires_at)
  VALUES(p_token_hash,p_site,p_user,site.publication_epoch,p_preview,p_auth_session,'ticket',now()+interval '60 seconds');
 RETURN jsonb_build_object('slug',site.slug);
END;$$;
REVOKE ALL ON FUNCTION public.issue_kova_site_ticket(uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_kova_site_ticket(uuid,uuid,text,uuid,uuid) TO service_role;

CREATE FUNCTION public.redeem_kova_site_ticket(p_site uuid,p_ticket_hash text,p_session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ticket public.kova_site_access_sessions; site public.kova_sites;
BEGIN
 IF p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'site_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR NOT kova_private.site_principal_current(site.owner_id) THEN RETURN NULL; END IF;
 SELECT * INTO ticket FROM public.kova_site_access_sessions WHERE token_hash=p_ticket_hash AND site_id=p_site AND state='ticket' AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR ticket.publication_epoch<>site.publication_epoch OR NOT kova_private.site_auth_session_current(ticket.user_id,ticket.auth_session_id) THEN RETURN NULL; END IF;
 IF ticket.preview_version_id IS NOT NULL THEN
  IF ticket.user_id<>site.owner_id OR NOT EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=ticket.preview_version_id AND site_id=p_site AND state='ready') THEN RETURN NULL; END IF;
 ELSIF site.published_version_id IS NULL OR (ticket.user_id<>site.owner_id AND site.visibility<>'public' AND NOT EXISTS(SELECT 1 FROM public.kova_site_viewers WHERE site_id=p_site AND viewer_id=ticket.user_id)) THEN RETURN NULL; END IF;
 DELETE FROM public.kova_site_access_sessions WHERE token_hash=p_ticket_hash;
 INSERT INTO public.kova_site_access_sessions(token_hash,site_id,user_id,publication_epoch,preview_version_id,auth_session_id,state,expires_at)
  VALUES(p_session_hash,p_site,ticket.user_id,site.publication_epoch,ticket.preview_version_id,ticket.auth_session_id,'session',now()+interval '15 minutes');
 RETURN jsonb_build_object('slug',site.slug);
END;$$;
REVOKE ALL ON FUNCTION public.redeem_kova_site_ticket(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_kova_site_ticket(uuid,text,text) TO service_role;

-- Called only by the isolated asset process. It serves exact ready snapshots,
-- never accepts caller-selected owner IDs, and rechecks revocation on each file.
CREATE FUNCTION public.read_kova_site_asset(p_site uuid,p_slug text,p_path text,p_session_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE site public.kova_sites; session public.kova_site_access_sessions; v_version uuid; file public.kova_site_files;
BEGIN
 SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR NOT kova_private.site_principal_current(site.owner_id) THEN RETURN NULL; END IF;
 IF p_session_hash IS NOT NULL THEN
  SELECT * INTO session FROM public.kova_site_access_sessions WHERE token_hash=p_session_hash AND site_id=p_site AND state='session' AND expires_at>now();
  IF FOUND AND session.publication_epoch=site.publication_epoch AND kova_private.site_auth_session_current(session.user_id,session.auth_session_id) THEN
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
REVOKE ALL ON FUNCTION public.read_kova_site_asset(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_kova_site_asset(uuid,text,text,text) TO service_role;

CREATE FUNCTION public.verify_kova_site_publication(p_owner uuid,p_site uuid,p_version uuid,p_publication uuid,p_manifest_sha256 text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT kova_private.site_principal_current(p_owner) AND EXISTS(
  SELECT 1 FROM public.kova_sites s JOIN public.kova_site_versions v ON v.id=s.published_version_id AND v.site_id=s.id
  WHERE s.id=p_site AND s.owner_id=p_owner AND s.deleted_at IS NULL AND s.publication_id=p_publication
    AND v.id=p_version AND v.owner_id=p_owner AND v.state='ready' AND v.manifest_sha256=p_manifest_sha256);
$$;
REVOKE ALL ON FUNCTION public.verify_kova_site_publication(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_kova_site_publication(uuid,uuid,uuid,uuid,text) TO service_role;

-- Enforce immutable snapshots even if a future service route accidentally tries
-- to edit one in place. Ordinary mutation paths can only retire a version.
CREATE FUNCTION kova_private.fence_kova_site_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='kova_site_versions' THEN
   IF (to_jsonb(NEW)-'state') IS NOT DISTINCT FROM (to_jsonb(OLD)-'state') AND OLD.state='ready' AND NEW.state='retired' THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'site_snapshot_immutable' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text,20260903204500));
 IF NOT kova_private.site_principal_current(NEW.owner_id)
  OR NOT EXISTS(SELECT 1 FROM public.kova_sites WHERE id=NEW.site_id AND owner_id=NEW.owner_id AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'site_account_unavailable' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='kova_site_files' THEN
  IF NOT EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=NEW.version_id AND site_id=NEW.site_id AND owner_id=NEW.owner_id AND state='ready') THEN
   RAISE EXCEPTION 'site_snapshot_unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION kova_private.fence_kova_site_snapshot() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER kova_site_versions_immutable BEFORE INSERT OR UPDATE ON public.kova_site_versions FOR EACH ROW EXECUTE FUNCTION kova_private.fence_kova_site_snapshot();
CREATE TRIGGER kova_site_files_immutable BEFORE INSERT OR UPDATE ON public.kova_site_files FOR EACH ROW EXECUTE FUNCTION kova_private.fence_kova_site_snapshot();
