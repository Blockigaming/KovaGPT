-- Export metadata never transfers immutable file bodies through the generic
-- account table collector. PostgreSQL obtains the stored text length separately.
CREATE VIEW public.kova_site_file_export_metadata WITH (security_invoker=true) AS
 SELECT site_id,version_id,owner_id,path,mime_type,size_bytes,sha256,
   octet_length(content_base64) AS content_base64_bytes
 FROM public.kova_site_files;
REVOKE ALL ON public.kova_site_file_export_metadata FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.kova_site_file_export_metadata TO service_role;

ALTER TABLE public.kova_site_retirements ADD COLUMN site_id uuid;
UPDATE public.kova_site_retirements r SET site_id=v.site_id
 FROM public.kova_site_versions v WHERE v.id=r.version_id;
CREATE INDEX kova_site_retirements_site_pending_idx ON public.kova_site_retirements(site_id) WHERE settled_at IS NULL;
CREATE INDEX kova_sites_deleted_idx ON public.kova_sites(deleted_at,id) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mutate_kova_site(p_owner uuid,p_site uuid,p_mutation uuid,p_revision bigint,p_action text,p_payload jsonb,p_storage_limit bigint)
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
  -- A caller cannot choose a retired public URL. Receipt replay above returns
  -- the original allocation; a fresh creation always receives a fresh identity.
  p_site:=gen_random_uuid();
  INSERT INTO public.kova_sites(id,owner_id,title,slug) VALUES(p_site,p_owner,p_payload->>'title',p_payload->>'slug') RETURNING * INTO site;
  INSERT INTO public.kova_site_aliases(site_id,owner_id,slug) VALUES(p_site,p_owner,site.slug);
 ELSE
  SELECT * INTO site FROM public.kova_sites WHERE id=p_site AND owner_id=p_owner FOR UPDATE;
  IF NOT FOUND OR site.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'site_not_found' USING ERRCODE='P0002'; END IF;
  IF site.revision<>p_revision THEN RAISE EXCEPTION 'site_revision_conflict' USING ERRCODE='40001'; END IF;
  IF p_action='saveVersion' THEN
   version_id:=gen_random_uuid();
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
   INSERT INTO public.kova_site_retirements(version_id,owner_id,size_bytes,site_id)
    SELECT id,owner_id,size_bytes,site_id FROM public.kova_site_versions WHERE site_id=p_site AND (p_action='delete' OR id=(p_payload->>'versionId')::uuid) ON CONFLICT DO NOTHING;
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

-- Every physical delete, charge release, and queue removal commits together.
-- No identity/owner/title tombstones are needed: creation and version allocation
-- now use database-generated IDs after the bounded idempotency receipt lookup.
CREATE OR REPLACE FUNCTION public.cleanup_kova_site_versions(p_owner uuid DEFAULT NULL,p_limit integer DEFAULT 5)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE entry public.kova_site_retirements; n integer:=0;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'site_cleanup_invalid' USING ERRCODE='22023'; END IF;
 FOR entry IN SELECT * FROM public.kova_site_retirements WHERE settled_at IS NULL AND (p_owner IS NULL OR owner_id=p_owner) ORDER BY created_at,version_id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  IF EXISTS(SELECT 1 FROM public.kova_site_versions WHERE id=entry.version_id AND (owner_id<>entry.owner_id OR state<>'retired')) THEN
   RAISE EXCEPTION 'site_cleanup_conflict' USING ERRCODE='40001';
  END IF;
  DELETE FROM public.kova_site_versions WHERE id=entry.version_id AND owner_id=entry.owner_id AND state='retired';
  UPDATE public.user_storage SET bytes_used=greatest(0,bytes_used-entry.size_bytes),updated_at=now() WHERE user_id=entry.owner_id;
  DELETE FROM public.kova_site_retirements WHERE version_id=entry.version_id;
  n:=n+1;
 END LOOP;
 -- Discard legacy settled obligations in bounded pages too. Their charges have
 -- already been released, so this path never touches the owner's quota.
 DELETE FROM public.kova_site_retirements WHERE version_id IN(
  SELECT version_id FROM public.kova_site_retirements WHERE settled_at IS NOT NULL
   AND (p_owner IS NULL OR owner_id=p_owner) ORDER BY settled_at,version_id LIMIT 200 FOR UPDATE SKIP LOCKED);
 -- Absence remains revocation for every reader and verifier. Aliases and access
 -- sessions cascade only after all immutable versions and obligations are gone.
 DELETE FROM public.kova_sites WHERE id IN(
  SELECT s.id FROM public.kova_sites s WHERE s.deleted_at IS NOT NULL
   AND (p_owner IS NULL OR s.owner_id=p_owner)
   AND NOT EXISTS(SELECT 1 FROM public.kova_site_versions v WHERE v.site_id=s.id)
   AND NOT EXISTS(SELECT 1 FROM public.kova_site_retirements r WHERE r.settled_at IS NULL
    AND (r.site_id=s.id OR (r.site_id IS NULL AND r.owner_id=s.owner_id)))
  ORDER BY s.deleted_at,s.id LIMIT p_limit FOR UPDATE OF s SKIP LOCKED);
 DELETE FROM public.kova_site_access_sessions WHERE token_hash IN(SELECT token_hash FROM public.kova_site_access_sessions WHERE expires_at<now() ORDER BY expires_at LIMIT 200);
 -- Receipts contain only opaque IDs/revisions and retain the existing eight-day
 -- ambiguous-retry window, then are deleted. They cannot restore a deleted row.
 DELETE FROM public.kova_site_receipts WHERE (owner_id,mutation_id) IN(SELECT owner_id,mutation_id FROM public.kova_site_receipts WHERE created_at<now()-interval '8 days' ORDER BY created_at LIMIT 200);
 RETURN n;
END;$$;
REVOKE ALL ON FUNCTION public.cleanup_kova_site_versions(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_kova_site_versions(uuid,integer) TO service_role;
