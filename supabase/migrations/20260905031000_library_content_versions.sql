-- Immutable private Library history. Images and Work outputs retain their own managed lifecycle.
ALTER TABLE public.user_library_items ADD COLUMN content_generation uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.user_library_items ADD COLUMN content_revision bigint NOT NULL DEFAULT 1 CHECK(content_revision BETWEEN 1 AND 1000000);
ALTER TABLE public.user_library_items ADD COLUMN content_bytes_charged bigint NOT NULL DEFAULT 0 CHECK(content_bytes_charged>=0);
-- Count legacy current text without copying bodies or deleting pre-existing over-quota data.
UPDATE public.user_library_items SET content_bytes_charged=octet_length(coalesce(content_text,'')) WHERE coalesce(metadata->>'file_bucket','')<>'library-files' AND coalesce(metadata->>'work_output','false')<>'true';
INSERT INTO public.user_storage(user_id,bytes_used,updated_at) SELECT user_id,sum(content_bytes_charged),now() FROM public.user_library_items GROUP BY user_id HAVING sum(content_bytes_charged)>0
ON CONFLICT(user_id) DO UPDATE SET bytes_used=public.user_storage.bytes_used+excluded.bytes_used,updated_at=now();
CREATE FUNCTION kova_private.account_library_current_text() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid; bytes bigint; old_bytes bigint; tier text; storage_limit bigint; managed boolean;
BEGIN
 owner:=CASE WHEN TG_OP='DELETE' THEN old.user_id ELSE new.user_id END;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner::text,20260903204500));
 IF TG_OP='DELETE' THEN IF old.content_bytes_charged>0 THEN PERFORM public.release_project_storage_bytes(owner,old.content_bytes_charged);END IF;RETURN old;END IF;
 IF TG_OP='UPDATE' AND (new.user_id IS DISTINCT FROM old.user_id OR new.content_generation IS DISTINCT FROM old.content_generation) THEN RAISE EXCEPTION 'library_identity_immutable';END IF;
 IF NOT kova_private.auth_user_exists(owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=owner) THEN RAISE EXCEPTION 'library_account_unavailable';END IF;
 managed:=coalesce(new.metadata->>'file_bucket','')='library-files' OR coalesce(new.metadata->>'work_output','false')='true';
 IF managed AND TG_OP='INSERT' AND current_setting('role',true)<>'service_role' AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'library_managed_write_required';END IF;
 old_bytes:=CASE WHEN TG_OP='INSERT' THEN 0 ELSE old.content_bytes_charged END;
 bytes:=CASE WHEN managed THEN 0 ELSE octet_length(coalesce(new.content_text,'')) END;
 IF NOT managed AND bytes>300000 AND (TG_OP='INSERT' OR new.content_text IS DISTINCT FROM old.content_text) THEN RAISE EXCEPTION 'library_text_invalid';END IF;
 IF bytes>old_bytes THEN
  IF NOT kova_private.auth_user_exists(owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=owner) THEN RAISE EXCEPTION 'library_account_unavailable';END IF;
  tier:=public.effective_user_plan_tier(owner);
  storage_limit:=CASE WHEN tier IN('plus','pro') THEN 26843545600 ELSE 524288000 END;
  IF NOT public.try_add_storage_bytes(owner,bytes-old_bytes,storage_limit) THEN RAISE EXCEPTION 'library_storage_limit';END IF;
 ELSIF bytes<old_bytes THEN PERFORM public.release_project_storage_bytes(owner,old_bytes-bytes);END IF;
 new.content_bytes_charged:=bytes;RETURN new;
END $$;
CREATE TRIGGER b_account_library_current_text BEFORE INSERT OR UPDATE OR DELETE ON public.user_library_items FOR EACH ROW EXECUTE FUNCTION kova_private.account_library_current_text();
REVOKE ALL ON FUNCTION kova_private.account_library_current_text() FROM public,anon,authenticated;
CREATE TABLE public.library_file_versions (LIKE public.library_file_uploads INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE public.library_file_versions ADD PRIMARY KEY(generation);
ALTER TABLE public.library_file_versions ADD COLUMN revision bigint NOT NULL DEFAULT 1;
CREATE INDEX library_file_versions_owner_item ON public.library_file_versions(owner_id,id,created_at DESC,generation);
CREATE TABLE public.library_file_replacements (LIKE public.library_file_uploads INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE public.library_file_replacements ADD PRIMARY KEY(generation);
ALTER TABLE public.library_file_replacements ADD COLUMN base_generation uuid NOT NULL;
CREATE INDEX library_file_replacements_owner_item ON public.library_file_replacements(owner_id,id,created_at DESC,generation);
CREATE TABLE public.library_text_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id uuid NOT NULL,owner_id uuid NOT NULL,revision bigint NOT NULL,
 content_text text NOT NULL CHECK(octet_length(content_text)<=1200000),file_name text,file_type text,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 0 AND 1200000),quota_charged boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(item_id,revision)
);
CREATE INDEX library_text_versions_owner_item ON public.library_text_versions(owner_id,item_id,revision DESC);
ALTER TABLE public.library_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_file_replacements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_text_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_file_versions,public.library_file_replacements,public.library_text_versions FROM public,anon,authenticated;
GRANT ALL ON public.library_file_versions,public.library_file_replacements,public.library_text_versions TO service_role;

CREATE FUNCTION public.reserve_library_file_replacement(p_owner uuid,p_id uuid,p_generation uuid,p_expected_generation uuid,p_name text,p_mime text,p_size bigint,p_sha256 text,p_text text,p_storage_limit bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current public.library_file_uploads; replacement public.library_file_replacements; ext text; path text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_id::text,20260905011300));
 IF p_owner IS NULL OR NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RAISE EXCEPTION 'library_account_unavailable';END IF;
 SELECT * INTO current FROM public.library_file_uploads WHERE id=p_id AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND OR current.state<>'ready' OR current.delete_requested OR p_expected_generation IS NULL OR p_generation IS NULL THEN RAISE EXCEPTION 'library_file_conflict';END IF;
 ext:=lower(substring(p_name from '\.([^.]+)$'));
 IF p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 200 OR p_name ~ '[[:cntrl:]/\\]' OR ext IS NULL
 OR NOT ((ext='pdf' AND p_mime='application/pdf') OR (ext='docx' AND p_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document') OR (ext='xlsx' AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') OR (ext='pptx' AND p_mime='application/vnd.openxmlformats-officedocument.presentationml.presentation'))
 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 10485760 OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' OR p_text IS NULL OR octet_length(p_text)>200000 OR p_storage_limit IS NULL OR p_storage_limit<1 THEN RAISE EXCEPTION 'library_file_invalid';END IF;
 -- Completed lost-response retry is exact and cannot return an older current generation.
 SELECT * INTO replacement FROM public.library_file_replacements WHERE id=p_id AND owner_id=p_owner AND base_generation=p_expected_generation AND state='ready' AND generation=current.generation;
 IF FOUND AND current.file_name=p_name AND current.mime_type=p_mime AND current.size_bytes=p_size AND current.sha256=p_sha256 AND current.extracted_text=p_text THEN RETURN to_jsonb(current);END IF;
 IF current.generation<>p_expected_generation THEN RAISE EXCEPTION 'library_file_conflict';END IF;
 SELECT * INTO replacement FROM public.library_file_replacements WHERE id=p_id AND owner_id=p_owner AND state='pending' ORDER BY created_at DESC,generation LIMIT 1 FOR UPDATE;
 IF FOUND THEN
  IF replacement.base_generation=p_expected_generation AND replacement.file_name=p_name AND replacement.mime_type=p_mime AND replacement.size_bytes=p_size AND replacement.sha256=p_sha256 AND replacement.extracted_text=p_text
  AND EXISTS(SELECT 1 FROM public.account_storage_artifacts WHERE generation=replacement.generation AND state='pending' AND lease_expires_at>now()) THEN RETURN to_jsonb(replacement);END IF;
  RAISE EXCEPTION 'library_file_cleanup_pending';
 END IF;
 IF (SELECT count(*) FROM public.library_file_versions WHERE id=p_id AND owner_id=p_owner AND state<>'deleted')>=49 THEN RAISE EXCEPTION 'library_version_limit';END IF;
 IF (SELECT count(*) FROM public.library_file_replacements WHERE owner_id=p_owner)>=50000 THEN RAISE EXCEPTION 'library_version_limit';END IF;
 IF NOT public.try_add_storage_bytes(p_owner,p_size,p_storage_limit) THEN RAISE EXCEPTION 'library_storage_limit';END IF;
 path:=p_owner::text||'/'||p_generation::text||'.'||ext;
 IF NOT public.reserve_account_storage_artifact(p_generation,p_owner,p_owner,'library-files',path) THEN RAISE EXCEPTION 'library_account_unavailable';END IF;
 INSERT INTO public.library_file_replacements(id,owner_id,generation,storage_path,file_name,mime_type,size_bytes,sha256,extracted_text,state,quota_charged,base_generation)
 VALUES(p_id,p_owner,p_generation,path,p_name,p_mime,p_size,p_sha256,p_text,'pending',true,p_expected_generation) RETURNING * INTO replacement;
 RETURN to_jsonb(replacement);
END $$;
CREATE FUNCTION public.settle_library_file_replacement(p_owner uuid,p_id uuid,p_generation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current public.library_file_uploads; replacement public.library_file_replacements; obj storage.objects;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_id::text,20260905011300));
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RETURN false;END IF;
 SELECT * INTO current FROM public.library_file_uploads WHERE id=p_id AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND OR current.state<>'ready' OR current.delete_requested THEN RETURN false;END IF;
 SELECT * INTO replacement FROM public.library_file_replacements WHERE id=p_id AND owner_id=p_owner AND generation=p_generation FOR UPDATE;
 IF NOT FOUND OR replacement.delete_requested THEN RETURN false;END IF;
 IF replacement.state='ready' THEN RETURN current.generation=p_generation;END IF;
 IF replacement.state<>'pending' OR current.generation<>replacement.base_generation THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_library_items WHERE id=p_id AND user_id=p_owner AND metadata->>'storage_generation'=current.generation::text AND file_url=current.storage_path) THEN RETURN false;END IF;
 SELECT * INTO obj FROM storage.objects WHERE bucket_id='library-files' AND name=replacement.storage_path;
 IF NOT FOUND OR obj.metadata->>'size' IS DISTINCT FROM replacement.size_bytes::text OR obj.metadata->>'mimetype' IS DISTINCT FROM replacement.mime_type THEN RETURN false;END IF;
 IF NOT public.settle_account_storage_artifact(p_generation,p_owner,p_owner,'library-files',replacement.storage_path) THEN RETURN false;END IF;
 INSERT INTO public.library_file_versions SELECT current.*,i.content_revision FROM public.user_library_items i WHERE i.id=p_id AND i.user_id=p_owner;
 UPDATE public.library_file_uploads SET generation=replacement.generation,storage_path=replacement.storage_path,file_name=replacement.file_name,mime_type=replacement.mime_type,size_bytes=replacement.size_bytes,sha256=replacement.sha256,extracted_text=replacement.extracted_text,created_at=replacement.created_at,updated_at=now() WHERE id=p_id AND owner_id=p_owner;
 UPDATE public.user_library_items SET content_text=replacement.extracted_text,file_url=replacement.storage_path,file_name=replacement.file_name,file_type=replacement.mime_type,file_size=replacement.size_bytes,content_revision=content_revision+1,metadata=metadata||jsonb_build_object('storage_generation',p_generation,'sha256',replacement.sha256),updated_at=now() WHERE id=p_id AND user_id=p_owner;
 -- The live ledger now owns these bytes/quota; retain a non-content retry receipt.
 UPDATE public.library_file_replacements SET state='ready',quota_charged=false,extracted_text='',file_name='',mime_type='',sha256=repeat('0',64),size_bytes=1,updated_at=now() WHERE generation=p_generation;
 RETURN true;
END $$;
CREATE FUNCTION public.retire_library_file_replacement(p_owner uuid,p_id uuid,p_generation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_file_replacements;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 SELECT * INTO row FROM public.library_file_replacements WHERE id=p_id AND owner_id=p_owner AND generation=p_generation FOR UPDATE;
 IF NOT FOUND OR row.state='ready' THEN RETURN false;END IF;
 UPDATE public.library_file_replacements SET state='deleting',updated_at=now() WHERE generation=p_generation;
 UPDATE public.account_storage_artifacts SET state='retired',next_cleanup_at=now() WHERE generation=p_generation AND owner_id=p_owner AND bucket='library-files' AND storage_path=row.storage_path;
 RETURN FOUND;
END $$;
ALTER FUNCTION public.retire_library_file(uuid,uuid,uuid,boolean) RENAME TO retire_library_file_before_versions;
CREATE FUNCTION public.retire_library_file(p_owner uuid,p_id uuid,p_generation uuid,p_delete boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current public.library_file_uploads;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_id::text,20260905011300));
 SELECT * INTO current FROM public.library_file_uploads WHERE id=p_id AND owner_id=p_owner AND generation=p_generation FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF NOT public.retire_library_file_before_versions(p_owner,p_id,p_generation,p_delete) THEN RETURN false;END IF;
 IF p_delete THEN
  UPDATE public.library_file_versions SET state='deleting',delete_requested=true WHERE id=p_id AND owner_id=p_owner AND state<>'deleted';
  UPDATE public.library_file_replacements SET state=CASE WHEN state='ready' THEN state ELSE 'deleting' END,delete_requested=true WHERE id=p_id AND owner_id=p_owner;
  UPDATE public.account_storage_artifacts SET state='retired',next_cleanup_at=now() WHERE owner_id=p_owner AND bucket='library-files' AND generation IN(SELECT generation FROM public.library_file_versions WHERE id=p_id AND owner_id=p_owner UNION SELECT generation FROM public.library_file_replacements WHERE id=p_id AND owner_id=p_owner AND state<>'ready');
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.read_library_file_version(p_owner uuid,p_id uuid,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE value jsonb;
BEGIN
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RETURN NULL;END IF;
 value:=public.read_library_file(p_owner,p_id,p_generation);IF value IS NOT NULL THEN RETURN value;END IF;
 IF public.read_library_file(p_owner,p_id,NULL) IS NULL THEN RETURN NULL;END IF;
 SELECT to_jsonb(v)-'extracted_text' INTO value FROM public.library_file_versions v WHERE id=p_id AND owner_id=p_owner AND generation=p_generation AND state='ready' AND NOT delete_requested;
 RETURN value;
END $$;

ALTER FUNCTION public.record_account_storage_artifact_cleanup(uuid) RENAME TO record_account_storage_cleanup_before_versions;
CREATE FUNCTION public.record_account_storage_artifact_cleanup(p_generation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE artifact public.account_storage_artifacts; row public.library_file_versions; pending public.library_file_replacements; erase boolean;
BEGIN
 SELECT * INTO artifact FROM public.account_storage_artifacts WHERE generation=p_generation AND state='retired';IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(artifact.owner_id::text,20260903204500));
 SELECT * INTO row FROM public.library_file_versions WHERE generation=p_generation AND owner_id=artifact.owner_id FOR UPDATE;
 IF FOUND THEN
  IF row.quota_charged THEN PERFORM public.release_project_storage_bytes(row.owner_id,row.size_bytes);END IF;
  UPDATE public.library_file_versions SET state='deleted',delete_requested=true,quota_charged=false,extracted_text='',file_name='',mime_type='',size_bytes=1,sha256=repeat('0',64),updated_at=now() WHERE generation=p_generation;
  UPDATE public.account_storage_artifacts SET last_cleanup_at=now() WHERE generation=p_generation;RETURN true;
 END IF;
 SELECT * INTO pending FROM public.library_file_replacements WHERE generation=p_generation AND owner_id=artifact.owner_id AND state<>'ready' FOR UPDATE;
 IF FOUND THEN
  IF pending.quota_charged THEN PERFORM public.release_project_storage_bytes(pending.owner_id,pending.size_bytes);END IF;
  erase:=pending.delete_requested OR (pending.failure_expires_at IS NOT NULL AND pending.failure_expires_at<=now());
  UPDATE public.library_file_replacements SET state=CASE WHEN erase THEN 'deleted' ELSE 'failed' END,quota_charged=false,delete_requested=erase,failure_expires_at=CASE WHEN erase THEN NULL ELSE coalesce(failure_expires_at,now()+interval '24 hours') END,
  extracted_text=CASE WHEN erase THEN '' ELSE extracted_text END,file_name=CASE WHEN erase THEN '' ELSE file_name END,mime_type=CASE WHEN erase THEN '' ELSE mime_type END,size_bytes=CASE WHEN erase THEN 1 ELSE size_bytes END,sha256=CASE WHEN erase THEN repeat('0',64) ELSE sha256 END,updated_at=now() WHERE generation=p_generation;
  UPDATE public.account_storage_artifacts SET last_cleanup_at=now() WHERE generation=p_generation;RETURN true;
 END IF;
 RETURN public.record_account_storage_cleanup_before_versions(p_generation);
END $$;

-- Direct content replacement is no longer a history bypass. Existing title/folder operations remain ordinary RLS updates.
REVOKE UPDATE ON public.user_library_items FROM authenticated;
GRANT UPDATE(title,folder_id,updated_at) ON public.user_library_items TO authenticated;
CREATE FUNCTION public.replace_library_text(p_owner uuid,p_item uuid,p_generation uuid,p_revision bigint,p_text text,p_storage_limit bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item public.user_library_items; old_bytes bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_item::text,20260905011300));
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RAISE EXCEPTION 'library_account_unavailable';END IF;
 SELECT * INTO item FROM public.user_library_items WHERE id=p_item AND user_id=p_owner FOR UPDATE;
 IF NOT FOUND OR item.content_generation IS DISTINCT FROM p_generation THEN RAISE EXCEPTION 'library_revision_conflict';END IF;
 IF item.content_revision=p_revision+1 AND item.content_text=p_text AND EXISTS(SELECT 1 FROM public.library_text_versions WHERE item_id=p_item AND owner_id=p_owner AND revision=p_revision) THEN RETURN item.content_revision;END IF;
 IF item.content_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'library_revision_conflict';END IF;
 IF item.item_type NOT IN ('upload','document','code','chat_artifact','website_draft','other') OR item.file_url IS NOT NULL OR coalesce(item.metadata->>'work_output','false')='true' OR coalesce(item.metadata->>'file_bucket','')='library-files' THEN RAISE EXCEPTION 'library_replacement_unsupported';END IF;
 IF p_text IS NULL OR octet_length(p_text)>300000 OR p_storage_limit IS NULL OR p_storage_limit<1 THEN RAISE EXCEPTION 'library_text_invalid';END IF;
 IF item.content_text IS NOT DISTINCT FROM p_text THEN RETURN item.content_revision;END IF;
 IF (SELECT count(*) FROM public.library_text_versions WHERE item_id=p_item AND owner_id=p_owner)>=49 THEN RAISE EXCEPTION 'library_version_limit';END IF;
 old_bytes:=octet_length(coalesce(item.content_text,''));
 INSERT INTO public.library_text_versions(item_id,owner_id,revision,content_text,file_name,file_type,size_bytes) VALUES(p_item,p_owner,item.content_revision,coalesce(item.content_text,''),item.file_name,item.file_type,old_bytes);
 UPDATE public.user_library_items SET content_text=p_text,file_size=CASE WHEN file_size IS NULL THEN NULL ELSE octet_length(p_text) END,content_revision=content_revision+1,updated_at=now() WHERE id=p_item AND user_id=p_owner RETURNING content_revision INTO p_revision;
 IF NOT public.try_add_storage_bytes(p_owner,old_bytes,p_storage_limit) THEN RAISE EXCEPTION 'library_storage_limit';END IF;
 RETURN p_revision;
END $$;
CREATE FUNCTION kova_private.cleanup_library_text_versions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE bytes bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(old.user_id::text,20260903204500));
 SELECT coalesce(sum(size_bytes),0) INTO bytes FROM public.library_text_versions WHERE item_id=old.id AND owner_id=old.user_id AND quota_charged;
 IF bytes>0 THEN PERFORM public.release_project_storage_bytes(old.user_id,bytes);END IF;
 DELETE FROM public.library_text_versions WHERE item_id=old.id AND owner_id=old.user_id;RETURN old;
END $$;
CREATE TRIGGER a_cleanup_library_text_versions BEFORE DELETE ON public.user_library_items FOR EACH ROW EXECUTE FUNCTION kova_private.cleanup_library_text_versions();

ALTER FUNCTION public.prepare_library_file_account_deletion(uuid) RENAME TO prepare_library_file_deletion_before_versions;
CREATE FUNCTION public.prepare_library_file_account_deletion(p_owner uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ready boolean; bytes bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 IF NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RAISE EXCEPTION 'account_deletion_fence_required';END IF;
 IF EXISTS(SELECT 1 FROM public.library_file_replacements r JOIN public.account_storage_artifacts a ON a.generation=r.generation WHERE r.owner_id=p_owner AND r.state='pending' AND a.state='pending' AND a.lease_expires_at>now()) THEN RETURN false;END IF;
 ready:=public.prepare_library_file_deletion_before_versions(p_owner);
 UPDATE public.library_file_versions SET state='deleting',delete_requested=true WHERE owner_id=p_owner AND state='ready';
 UPDATE public.library_file_replacements SET state=CASE WHEN state='ready' THEN state ELSE 'deleting' END,delete_requested=true WHERE owner_id=p_owner AND state NOT IN ('deleted','failed');
 UPDATE public.account_storage_artifacts SET state='retired',next_cleanup_at=now() WHERE owner_id=p_owner AND bucket='library-files' AND generation IN(SELECT generation FROM public.library_file_versions WHERE owner_id=p_owner AND state<>'deleted' UNION SELECT generation FROM public.library_file_replacements WHERE owner_id=p_owner AND quota_charged);
 IF NOT ready OR EXISTS(SELECT 1 FROM public.library_file_versions WHERE owner_id=p_owner AND state<>'deleted') OR EXISTS(SELECT 1 FROM public.library_file_replacements WHERE owner_id=p_owner AND quota_charged) THEN RETURN false;END IF;
 DELETE FROM public.library_file_versions WHERE owner_id=p_owner;DELETE FROM public.library_file_replacements WHERE owner_id=p_owner;
 SELECT coalesce(sum(size_bytes),0) INTO bytes FROM public.library_text_versions WHERE owner_id=p_owner AND quota_charged;
 IF bytes>0 THEN PERFORM public.release_project_storage_bytes(p_owner,bytes);END IF;
 DELETE FROM public.library_text_versions WHERE owner_id=p_owner;RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reserve_library_file_replacement(uuid,uuid,uuid,uuid,text,text,bigint,text,text,bigint),public.settle_library_file_replacement(uuid,uuid,uuid),public.retire_library_file_replacement(uuid,uuid,uuid),public.retire_library_file(uuid,uuid,uuid,boolean),public.read_library_file_version(uuid,uuid,uuid),public.record_account_storage_artifact_cleanup(uuid),public.replace_library_text(uuid,uuid,uuid,bigint,text,bigint),public.prepare_library_file_account_deletion(uuid),kova_private.cleanup_library_text_versions() FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_library_file_replacement(uuid,uuid,uuid,uuid,text,text,bigint,text,text,bigint),public.settle_library_file_replacement(uuid,uuid,uuid),public.retire_library_file_replacement(uuid,uuid,uuid),public.retire_library_file(uuid,uuid,uuid,boolean),public.read_library_file_version(uuid,uuid,uuid),public.record_account_storage_artifact_cleanup(uuid),public.replace_library_text(uuid,uuid,uuid,bigint,text,bigint),public.prepare_library_file_account_deletion(uuid) TO service_role;

CREATE FUNCTION public.delete_library_text(p_owner uuid,p_item uuid,p_generation uuid,p_revision bigint) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item public.user_library_items;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_item::text,20260905011300));
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RETURN false;END IF;
 SELECT * INTO item FROM public.user_library_items WHERE id=p_item AND user_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RETURN true;END IF;
 IF item.content_generation IS DISTINCT FROM p_generation OR item.content_revision IS DISTINCT FROM p_revision OR item.file_url IS NOT NULL OR item.item_type='image' OR coalesce(item.metadata->>'work_output','false')='true' THEN RETURN false;END IF;
 DELETE FROM public.user_library_items WHERE id=p_item AND user_id=p_owner;RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.delete_library_text(uuid,uuid,uuid,bigint) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_library_text(uuid,uuid,uuid,bigint) TO service_role;
CREATE INDEX user_library_items_owner_recent_page ON public.user_library_items(user_id,created_at DESC,id DESC);
CREATE INDEX user_library_items_owner_name_page ON public.user_library_items(user_id,title,id);
CREATE INDEX user_library_items_owner_size_page ON public.user_library_items(user_id,file_size DESC,id DESC);
CREATE FUNCTION public.read_library_item(p_owner uuid,p_item uuid,p_generation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE value jsonb;
BEGIN
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RETURN NULL;END IF;
 SELECT to_jsonb(i) INTO value FROM public.user_library_items i WHERE id=p_item AND user_id=p_owner AND content_generation=p_generation;
 RETURN value;
END $$;
CREATE FUNCTION public.list_library_items_page(p_owner uuid,p_query text DEFAULT '',p_cursor jsonb DEFAULT NULL,p_folder text DEFAULT 'all',p_filter text DEFAULT 'all',p_sort text DEFAULT 'newest',p_favorites uuid[] DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE rows jsonb; result jsonb; last_row jsonb;
BEGIN
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RAISE EXCEPTION 'library_account_unavailable';END IF;
 IF p_query IS NULL OR length(p_query)>200 OR p_sort NOT IN('newest','oldest','name','size') OR p_filter NOT IN('all','favorites','images','documents','other') OR cardinality(p_favorites)>1000 OR p_folder IS NULL THEN RAISE EXCEPTION 'library_page_invalid';END IF;
 IF p_folder NOT IN('all','unfiled') AND p_folder !~ '^[a-f0-9-]{36}$' THEN RAISE EXCEPTION 'library_page_invalid';END IF;
 IF p_cursor IS NOT NULL AND (octet_length(p_cursor::text)>3000 OR p_cursor->>'sort' IS DISTINCT FROM p_sort OR p_cursor->>'query' IS DISTINCT FROM p_query OR p_cursor->>'folder' IS DISTINCT FROM p_folder OR p_cursor->>'filter' IS DISTINCT FROM p_filter OR p_cursor->>'id' IS NULL) THEN RAISE EXCEPTION 'library_page_invalid';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(page)),'[]') INTO rows FROM (
 SELECT i.id,i.title,i.item_type,i.source,i.file_url,i.file_name,i.file_type,i.file_size,i.folder_id,i.created_at,i.content_revision,i.content_generation,
 left(i.content_text,320) content_excerpt,(i.content_text IS NOT NULL) text_available,
 jsonb_build_object('file_bucket',i.metadata->'file_bucket','storage_generation',i.metadata->'storage_generation','work_output',i.metadata->'work_output') metadata
 FROM public.user_library_items i WHERE i.user_id=p_owner
 AND (p_folder='all' OR (p_folder='unfiled' AND i.folder_id IS NULL) OR i.folder_id::text=p_folder)
 AND (p_filter='all' OR (p_filter='favorites' AND i.id=ANY(p_favorites)) OR (p_filter='images' AND (i.item_type='image' OR i.file_type LIKE 'image/%')) OR (p_filter='documents' AND i.item_type IN('upload','document','code','chat_artifact','website_draft') AND i.item_type<>'image' AND coalesce(i.file_type,'') NOT LIKE 'image/%') OR (p_filter='other' AND i.item_type NOT IN('upload','document','code','chat_artifact','website_draft','image') AND coalesce(i.file_type,'') NOT LIKE 'image/%'))
 AND (p_query='' OR strpos(lower(concat_ws(' ',i.title,i.file_name,i.file_type,i.item_type,i.source,i.content_text)),lower(p_query))>0)
 AND (p_cursor IS NULL OR CASE p_sort
 WHEN 'newest' THEN (i.created_at,i.id)<((p_cursor->>'created_at')::timestamptz,(p_cursor->>'id')::uuid)
 WHEN 'oldest' THEN (i.created_at,i.id)>((p_cursor->>'created_at')::timestamptz,(p_cursor->>'id')::uuid)
 WHEN 'name' THEN (i.title,i.id)>(p_cursor->>'title',(p_cursor->>'id')::uuid)
 ELSE (coalesce(i.file_size,-1),i.id)<(coalesce((p_cursor->>'file_size')::bigint,-1),(p_cursor->>'id')::uuid) END)
 ORDER BY CASE WHEN p_sort='newest' THEN i.created_at END DESC,CASE WHEN p_sort='oldest' THEN i.created_at END ASC,CASE WHEN p_sort='name' THEN i.title END ASC,CASE WHEN p_sort='size' THEN coalesce(i.file_size,-1) END DESC,CASE WHEN p_sort IN('oldest','name') THEN i.id END ASC,CASE WHEN p_sort IN('newest','size') THEN i.id END DESC LIMIT 51
 ) page;
 SELECT coalesce(jsonb_agg(value),'[]') INTO result FROM jsonb_array_elements(rows) WITH ORDINALITY r(value,n) WHERE n<=50;
 last_row:=result->(jsonb_array_length(result)-1);
 RETURN jsonb_build_object('items',result,'cursor',CASE WHEN jsonb_array_length(rows)>50 THEN jsonb_build_object('id',last_row->'id','created_at',last_row->'created_at','title',last_row->'title','file_size',last_row->'file_size','sort',p_sort,'query',p_query,'folder',p_folder,'filter',p_filter) ELSE NULL END);
END $$;
CREATE FUNCTION public.read_library_version_history(p_owner uuid,p_item uuid,p_generation uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; versions jsonb;
BEGIN
 item:=public.read_library_item(p_owner,p_item,p_generation);IF item IS NULL THEN RETURN NULL;END IF;
 IF item#>>'{metadata,file_bucket}'='library-files' THEN
  IF public.read_library_file(p_owner,p_item,NULL) IS NULL THEN RETURN NULL;END IF;
  SELECT coalesce(jsonb_agg(v ORDER BY (v->>'revision')::bigint DESC),'[]') INTO versions FROM (
  SELECT jsonb_build_object('kind','original','generation',u.generation,'revision',(item->>'content_revision')::bigint,'file_name',u.file_name,'file_type',u.mime_type,'size_bytes',u.size_bytes,'created_at',u.created_at,'current',true) v FROM public.library_file_uploads u WHERE id=p_item AND owner_id=p_owner AND state='ready'
  UNION ALL SELECT jsonb_build_object('kind','original','generation',generation,'revision',revision,'file_name',file_name,'file_type',mime_type,'size_bytes',size_bytes,'created_at',created_at,'current',false) FROM public.library_file_versions WHERE id=p_item AND owner_id=p_owner AND state='ready' AND NOT delete_requested) entries;
 ELSE
  IF item->>'file_url' IS NOT NULL OR item->>'item_type'='image' OR item#>>'{metadata,work_output}'='true' THEN RETURN jsonb_build_object('supported',false,'versions','[]'::jsonb);END IF;
  SELECT coalesce(jsonb_agg(v ORDER BY (v->>'revision')::bigint DESC),'[]') INTO versions FROM (
  SELECT jsonb_build_object('kind','text','revision',(item->>'content_revision')::bigint,'file_name',item->'file_name','file_type',item->'file_type','size_bytes',octet_length(coalesce(item->>'content_text','')),'created_at',coalesce(item->'updated_at',item->'created_at'),'current',true) v
  UNION ALL SELECT jsonb_build_object('kind','text','revision',revision,'file_name',file_name,'file_type',file_type,'size_bytes',size_bytes,'created_at',created_at,'current',false) FROM public.library_text_versions WHERE item_id=p_item AND owner_id=p_owner) entries;
 END IF;
 RETURN jsonb_build_object('supported',true,'versions',versions);
END $$;
CREATE FUNCTION public.read_library_text_version(p_owner uuid,p_item uuid,p_generation uuid,p_revision bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; value jsonb;
BEGIN
 item:=public.read_library_item(p_owner,p_item,p_generation);IF item IS NULL OR item->>'file_url' IS NOT NULL OR item->>'item_type'='image' OR item#>>'{metadata,work_output}'='true' THEN RETURN NULL;END IF;
 IF (item->>'content_revision')::bigint=p_revision THEN RETURN jsonb_build_object('content_text',coalesce(item->>'content_text',''),'file_name',item->'file_name','file_type',item->'file_type','revision',p_revision);END IF;
 SELECT jsonb_build_object('content_text',content_text,'file_name',file_name,'file_type',file_type,'revision',revision) INTO value FROM public.library_text_versions WHERE item_id=p_item AND owner_id=p_owner AND revision=p_revision;RETURN value;
END $$;
REVOKE ALL ON FUNCTION public.read_library_item(uuid,uuid,uuid),public.list_library_items_page(uuid,text,jsonb,text,text,text,uuid[]),public.read_library_version_history(uuid,uuid,uuid),public.read_library_text_version(uuid,uuid,uuid,bigint) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_library_item(uuid,uuid,uuid),public.list_library_items_page(uuid,text,jsonb,text,text,text,uuid[]),public.read_library_version_history(uuid,uuid,uuid),public.read_library_text_version(uuid,uuid,uuid,bigint) TO service_role;
