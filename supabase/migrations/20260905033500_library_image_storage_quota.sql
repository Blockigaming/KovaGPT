-- Immutable image bytes are charged before external I/O. The ledger survives
-- Auth deletion and keeps retryable cleanup paths even after successful removal.
CREATE TABLE public.library_image_uploads(
 generation uuid PRIMARY KEY,owner_id uuid NOT NULL,item_id uuid,storage_path text NOT NULL UNIQUE,
 size_bytes bigint NOT NULL CHECK(size_bytes>0),sha256 text CHECK(sha256 IS NULL OR sha256~'^[0-9a-f]{64}$'),
 mime_type text,save_fingerprint text,state text NOT NULL CHECK(state IN('pending','ready','retired')),
 legacy boolean NOT NULL DEFAULT false,quota_charged boolean NOT NULL DEFAULT true,
 lease_expires_at timestamptz NOT NULL DEFAULT now()+interval '3 minutes',created_at timestamptz NOT NULL DEFAULT now(),
 next_cleanup_at timestamptz NOT NULL DEFAULT now(),last_cleanup_at timestamptz,
 CHECK(length(storage_path)<=1024 AND split_part(storage_path,'/',1)=owner_id::text)
);
ALTER TABLE public.library_image_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_image_uploads FROM public,anon,authenticated;
GRANT ALL ON public.library_image_uploads TO service_role;
CREATE UNIQUE INDEX library_image_active_item_idx ON public.library_image_uploads(item_id) WHERE item_id IS NOT NULL AND state IN('pending','ready');
CREATE INDEX library_image_owner_idx ON public.library_image_uploads(owner_id,state,generation);
CREATE INDEX library_image_cleanup_idx ON public.library_image_uploads(next_cleanup_at,generation) WHERE state='retired';

-- Backfill actual Storage metadata, never caller-controlled Library.file_size.
-- Missing legacy sizes are charged at the bucket's conservative 8 MiB envelope.
INSERT INTO public.library_image_uploads(generation,owner_id,item_id,storage_path,size_bytes,mime_type,state,legacy)
SELECT coalesce(a.generation,gen_random_uuid()),split_part(o.name,'/',1)::uuid,
 (SELECT l.id FROM public.user_library_items l WHERE l.user_id=split_part(o.name,'/',1)::uuid AND l.item_type='image' AND l.file_url=o.name ORDER BY l.id LIMIT 1),
 o.name,CASE WHEN o.metadata->>'size'~'^[0-9]{1,12}$' AND (o.metadata->>'size')::bigint>0 THEN (o.metadata->>'size')::bigint ELSE 8388608 END,
 o.metadata->>'mimetype','ready',true
FROM storage.objects o LEFT JOIN public.account_storage_artifacts a ON a.bucket='library-images' AND a.storage_path=o.name
WHERE o.bucket_id='library-images' AND length(o.name)<=1024
 AND split_part(o.name,'/',1)~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
INSERT INTO public.user_storage(user_id,bytes_used,updated_at)
SELECT owner_id,sum(size_bytes),now() FROM public.library_image_uploads WHERE kova_private.auth_user_exists(owner_id) GROUP BY owner_id
ON CONFLICT(user_id) DO UPDATE SET bytes_used=public.user_storage.bytes_used+excluded.bytes_used,updated_at=now();

-- Only the authenticated application server can upload an immutable image
-- after quota reservation. Browser-prefix Storage writes bypass that contract.
DROP POLICY IF EXISTS "Users upload to own library folder" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own library images" ON storage.objects;

CREATE FUNCTION public.reserve_library_image_upload(p_owner uuid,p_id uuid,p_generation uuid,p_size bigint,p_sha256 text,p_mime text,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_image_uploads; path text; storage_limit bigint;
BEGIN
 IF p_owner IS NULL OR p_id IS NULL OR p_generation IS NULL OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 8388608 OR p_sha256 IS NULL OR p_sha256!~'^[0-9a-f]{64}$' OR p_fingerprint IS NULL OR p_fingerprint!~'^[0-9a-f]{64}$' OR p_mime IS NULL OR p_mime NOT IN('image/png','image/jpeg','image/jpg','image/webp','image/gif') THEN RAISE EXCEPTION 'library_image_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_id::text,20260905011300));
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RAISE EXCEPTION 'account_deletion_in_progress';END IF;
 SELECT * INTO row FROM public.library_image_uploads WHERE item_id=p_id AND state IN('pending','ready') FOR UPDATE;
 IF FOUND THEN
  IF row.owner_id<>p_owner OR row.save_fingerprint IS DISTINCT FROM p_fingerprint OR row.sha256 IS DISTINCT FROM p_sha256 OR row.size_bytes<>p_size OR row.mime_type<>p_mime THEN RAISE EXCEPTION 'library_image_conflict';END IF;
  IF row.state='pending' AND row.lease_expires_at<=now() THEN RAISE EXCEPTION 'library_image_cleanup_pending';END IF;
  RETURN to_jsonb(row);
 END IF;
 IF EXISTS(SELECT 1 FROM public.user_library_items WHERE id=p_id) OR EXISTS(SELECT 1 FROM public.library_image_uploads WHERE generation=p_generation OR (item_id=p_id AND quota_charged)) THEN RAISE EXCEPTION 'library_image_conflict';END IF;
 IF (SELECT count(*) FROM public.library_image_uploads WHERE owner_id=p_owner)>=50000 THEN RAISE EXCEPTION 'library_image_count_limit';END IF;
 storage_limit:=CASE public.effective_user_plan_tier(p_owner) WHEN 'plus' THEN 26843545600 WHEN 'pro' THEN 26843545600 ELSE 524288000 END;
 IF NOT public.try_add_storage_bytes(p_owner,p_size,storage_limit) THEN RAISE EXCEPTION 'library_storage_limit';END IF;
 path:=p_owner::text||'/'||p_generation::text||CASE p_mime WHEN 'image/png' THEN '.png' WHEN 'image/webp' THEN '.webp' WHEN 'image/gif' THEN '.gif' ELSE '.jpg' END;
 IF NOT public.reserve_account_storage_artifact(p_generation,p_owner,p_owner,'library-images',path) THEN RAISE EXCEPTION 'library_image_unavailable';END IF;
 INSERT INTO public.library_image_uploads(generation,owner_id,item_id,storage_path,size_bytes,sha256,mime_type,save_fingerprint,state)
 VALUES(p_generation,p_owner,p_id,path,p_size,p_sha256,p_mime,p_fingerprint,'pending') RETURNING * INTO row;
 RETURN to_jsonb(row);
END;$$;

CREATE FUNCTION public.settle_library_image_upload(p_owner uuid,p_id uuid,p_generation uuid,p_fingerprint text,p_title text,p_prompt text,p_source text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_image_uploads;
BEGIN
 IF p_title IS NULL OR length(p_title) NOT BETWEEN 1 AND 200 OR length(coalesce(p_prompt,''))>2000 OR p_source IS NULL OR p_source NOT IN('images','upload') THEN RAISE EXCEPTION 'library_image_invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_id::text,20260905011300));
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RETURN false;END IF;
 SELECT * INTO row FROM public.library_image_uploads WHERE owner_id=p_owner AND item_id=p_id AND generation=p_generation AND save_fingerprint=p_fingerprint FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF row.state='ready' THEN RETURN EXISTS(SELECT 1 FROM public.user_library_items WHERE id=p_id AND user_id=p_owner AND file_url=row.storage_path AND metadata->>'storage_generation'=p_generation::text);END IF;
 IF row.state<>'pending' OR row.lease_expires_at<=now() OR NOT row.quota_charged THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='library-images' AND o.name=row.storage_path AND o.metadata->>'size'=row.size_bytes::text AND o.metadata->>'mimetype'=row.mime_type) THEN RETURN false;END IF;
 IF NOT public.settle_account_storage_artifact(p_generation,p_owner,p_owner,'library-images',row.storage_path) THEN RETURN false;END IF;
 INSERT INTO public.user_library_items(id,user_id,title,item_type,source,content_text,file_url,file_name,file_type,file_size,metadata)
 VALUES(p_id,p_owner,p_title,'image',p_source,p_prompt,row.storage_path,split_part(row.storage_path,'/',2),row.mime_type,row.size_bytes,
 jsonb_build_object('library_save_fingerprint',row.save_fingerprint,'storage_generation',p_generation));
 UPDATE public.library_image_uploads SET state='ready' WHERE generation=p_generation;
 RETURN true;
END;$$;

CREATE FUNCTION public.retire_library_image_upload(p_owner uuid,p_id uuid,p_generation uuid,p_delete boolean DEFAULT false,p_content_generation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_image_uploads;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_id::text,20260905011300));
 SELECT * INTO row FROM public.library_image_uploads WHERE owner_id=p_owner AND generation=p_generation FOR UPDATE;
 IF NOT FOUND OR (row.item_id IS DISTINCT FROM p_id AND NOT EXISTS(SELECT 1 FROM public.user_library_items WHERE id=p_id AND user_id=p_owner AND file_url=row.storage_path AND item_type='image')) THEN RETURN NULL;END IF;
 IF p_delete AND (p_content_generation IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_library_items WHERE id=p_id AND user_id=p_owner AND file_url=row.storage_path AND content_generation=p_content_generation)) THEN RETURN NULL;END IF;
 IF NOT p_delete AND row.state='ready' THEN RETURN NULL;END IF;
 IF p_delete AND EXISTS(SELECT 1 FROM public.user_library_items WHERE user_id=p_owner AND file_url=row.storage_path AND id<>p_id) THEN
  DELETE FROM public.user_library_items WHERE id=p_id AND user_id=p_owner AND file_url=row.storage_path;
  RETURN jsonb_build_object('shared',true);
 END IF;
 UPDATE public.library_image_uploads SET state='retired',next_cleanup_at=now() WHERE generation=p_generation RETURNING * INTO row;
 UPDATE public.account_storage_artifacts SET state='retired',next_cleanup_at=now() WHERE generation=p_generation AND owner_id=p_owner AND bucket='library-images' AND storage_path=row.storage_path;
 RETURN to_jsonb(row);
END;$$;

CREATE FUNCTION public.read_library_image_upload(p_owner uuid,p_id uuid,p_delete boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RETURN NULL;END IF;
 RETURN (SELECT to_jsonb(u) FROM public.library_image_uploads u JOIN public.user_library_items l ON l.user_id=u.owner_id AND l.file_url=u.storage_path WHERE l.id=p_id AND l.user_id=p_owner AND l.item_type='image' AND (u.state='ready' OR (p_delete AND u.state='retired')));
END;$$;

CREATE FUNCTION public.record_library_image_cleanup(p_owner uuid,p_generation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_image_uploads;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 SELECT * INTO row FROM public.library_image_uploads WHERE owner_id=p_owner AND generation=p_generation AND state='retired' FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='library-images' AND name=row.storage_path) THEN RETURN false;END IF;
 DELETE FROM public.user_library_items WHERE user_id=p_owner AND file_url=row.storage_path AND item_type='image';
 IF row.quota_charged THEN PERFORM public.release_project_storage_bytes(p_owner,row.size_bytes);END IF;
 UPDATE public.library_image_uploads SET quota_charged=false,last_cleanup_at=now(),save_fingerprint=NULL,sha256=NULL,mime_type=NULL WHERE generation=p_generation;
 UPDATE public.account_storage_artifacts SET state='retired',last_cleanup_at=now(),next_cleanup_at=now()+interval '5 minutes' WHERE generation=p_generation AND owner_id=p_owner AND bucket='library-images' AND storage_path=row.storage_path;
 RETURN true;
END;$$;

CREATE FUNCTION public.claim_library_image_cleanup(p_owner uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS SETOF public.library_image_uploads LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_cleanup_limit';END IF;
 WITH expired AS(SELECT generation FROM public.library_image_uploads WHERE state='pending' AND lease_expires_at<=now() AND (p_owner IS NULL OR owner_id=p_owner) ORDER BY lease_expires_at,generation LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.library_image_uploads u SET state='retired',next_cleanup_at=now() FROM expired e WHERE u.generation=e.generation;
 RETURN QUERY WITH selected AS(SELECT generation FROM public.library_image_uploads WHERE state='retired' AND (p_owner IS NULL OR owner_id=p_owner) AND (next_cleanup_at<=now() OR (p_owner IS NOT NULL AND last_cleanup_at IS NULL)) ORDER BY next_cleanup_at,generation LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.library_image_uploads u SET next_cleanup_at=now()+interval '5 minutes' FROM selected s WHERE u.generation=s.generation RETURNING u.*;
END;$$;

CREATE FUNCTION public.prepare_library_image_account_deletion(p_owner uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 IF NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RAISE EXCEPTION 'account_deletion_fence_required';END IF;
 IF EXISTS(SELECT 1 FROM public.library_image_uploads WHERE owner_id=p_owner AND state='pending' AND lease_expires_at>now()) THEN RETURN false;END IF;
 WITH selected AS(SELECT generation FROM public.library_image_uploads WHERE owner_id=p_owner AND state<>'retired' ORDER BY generation LIMIT 25 FOR UPDATE)
 UPDATE public.library_image_uploads u SET state='retired',next_cleanup_at=now() FROM selected s WHERE u.generation=s.generation;
 UPDATE public.account_storage_artifacts a SET state='retired',next_cleanup_at=now() FROM public.library_image_uploads u WHERE u.owner_id=p_owner AND u.state='retired' AND a.generation=u.generation AND a.bucket='library-images' AND a.owner_id=p_owner;
 RETURN NOT EXISTS(SELECT 1 FROM public.library_image_uploads WHERE owner_id=p_owner AND (state<>'retired' OR quota_charged OR last_cleanup_at IS NULL));
END;$$;

-- Direct metadata deletion still creates a durable obligation. New managed
-- references and byte identities may only be published by the verified server.
CREATE FUNCTION kova_private.protect_library_image_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE managed boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(new.user_id,old.user_id)::text,20260903204500));
 IF TG_OP='DELETE' THEN
  IF old.item_type='image' AND NOT EXISTS(SELECT 1 FROM public.user_library_items WHERE user_id=old.user_id AND file_url=old.file_url AND id<>old.id) THEN
   UPDATE public.library_image_uploads SET state='retired',next_cleanup_at=now() WHERE owner_id=old.user_id AND storage_path=old.file_url;
  END IF;
  RETURN old;
 END IF;
 managed:=new.item_type='image' AND new.file_url IS NOT NULL AND new.file_url!~'^https?://';
 IF managed AND TG_OP='UPDATE' AND NOT(old.item_type='image' AND old.file_url IS NOT NULL AND old.file_url!~'^https?://') THEN RAISE EXCEPTION 'library_image_managed_write_required';END IF;
 IF TG_OP='UPDATE' AND old.item_type='image' AND old.file_url IS NOT NULL AND old.file_url!~'^https?://' AND (to_jsonb(new)-ARRAY['title','folder_id','updated_at'])<>(to_jsonb(old)-ARRAY['title','folder_id','updated_at']) THEN RAISE EXCEPTION 'library_image_immutable';END IF;
 IF managed AND TG_OP='INSERT' THEN
  IF NOT(current_setting('role',true)='service_role' OR auth.role()='service_role') OR NOT EXISTS(SELECT 1 FROM public.library_image_uploads u WHERE u.owner_id=new.user_id AND u.item_id=new.id AND u.storage_path=new.file_url AND u.generation::text=new.metadata->>'storage_generation' AND u.state='pending' AND u.quota_charged AND u.lease_expires_at>now() AND u.size_bytes=new.file_size AND u.mime_type=new.file_type) THEN RAISE EXCEPTION 'library_image_managed_write_required';END IF;
 END IF;
 RETURN new;
END;$$;
CREATE TRIGGER c_protect_library_image_metadata BEFORE INSERT OR UPDATE OR DELETE ON public.user_library_items FOR EACH ROW EXECUTE FUNCTION kova_private.protect_library_image_metadata();

ALTER FUNCTION public.record_account_storage_artifact_cleanup(uuid) RENAME TO record_account_storage_artifact_cleanup_before_image_quota;
CREATE FUNCTION public.record_account_storage_artifact_cleanup(p_generation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_image_uploads;
BEGIN
 SELECT * INTO row FROM public.library_image_uploads WHERE generation=p_generation;
 IF FOUND THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(row.owner_id::text,20260903204500));
  IF EXISTS(SELECT 1 FROM public.account_storage_artifacts WHERE generation=p_generation AND owner_id=row.owner_id AND bucket='library-images' AND state='retired' AND storage_path=row.storage_path) THEN
   UPDATE public.library_image_uploads SET state='retired' WHERE generation=p_generation;
   RETURN public.record_library_image_cleanup(row.owner_id,p_generation);
  END IF;
  RETURN false;
 END IF;
 RETURN public.record_account_storage_artifact_cleanup_before_image_quota(p_generation);
END;$$;

REVOKE ALL ON FUNCTION public.reserve_library_image_upload(uuid,uuid,uuid,bigint,text,text,text),public.settle_library_image_upload(uuid,uuid,uuid,text,text,text,text),public.retire_library_image_upload(uuid,uuid,uuid,boolean,uuid),public.read_library_image_upload(uuid,uuid,boolean),public.record_library_image_cleanup(uuid,uuid),public.claim_library_image_cleanup(uuid,integer),public.prepare_library_image_account_deletion(uuid),public.record_account_storage_artifact_cleanup(uuid),kova_private.protect_library_image_metadata() FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_library_image_upload(uuid,uuid,uuid,bigint,text,text,text),public.settle_library_image_upload(uuid,uuid,uuid,text,text,text,text),public.retire_library_image_upload(uuid,uuid,uuid,boolean,uuid),public.read_library_image_upload(uuid,uuid,boolean),public.record_library_image_cleanup(uuid,uuid),public.claim_library_image_cleanup(uuid,integer),public.prepare_library_image_account_deletion(uuid),public.record_account_storage_artifact_cleanup(uuid) TO service_role;
