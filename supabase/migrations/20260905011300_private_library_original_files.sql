-- Original Office/PDF bytes remain private and use the same durable cleanup ledger as other uploads.
ALTER TABLE public.account_storage_artifacts DROP CONSTRAINT account_storage_artifacts_bucket_check;
ALTER TABLE public.account_storage_artifacts ADD CONSTRAINT account_storage_artifacts_bucket_check CHECK(bucket IN ('library-images','project-files','library-files'));
create or replace function public.reserve_account_storage_artifact(
  p_generation uuid, p_owner_id uuid, p_requester_id uuid, p_bucket text, p_storage_path text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_user uuid;
begin
  if p_generation is null or p_owner_id is null or p_requester_id is null
    or p_bucket is null or p_bucket not in ('library-images','project-files','library-files')
    or p_storage_path is null or position(p_generation::text in p_storage_path) = 0
    or (p_bucket = 'library-images' and (
      p_owner_id <> p_requester_id or p_storage_path !~ ('^' || p_owner_id::text || '/' || p_generation::text || '\.(png|jpg|jpeg|webp|gif)$')
    )) or (p_bucket = 'library-files' and (
      p_owner_id <> p_requester_id or p_storage_path !~ ('^' || p_owner_id::text || '/' || p_generation::text || '\.(pdf|docx|xlsx|pptx)$')
    )) then raise exception 'invalid_storage_artifact'; end if;
  -- Match the account deletion fence and use the same order for two principals.
  for v_user in select distinct x from unnest(array[p_owner_id,p_requester_id]) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended(v_user::text, 20260903204500));
    if not kova_private.auth_user_exists(v_user)
      or exists (select 1 from public.account_deletion_fences where user_id = v_user)
    then return false; end if;
  end loop;
  insert into public.account_storage_artifacts(generation,owner_id,requester_id,bucket,storage_path)
  values(p_generation,p_owner_id,p_requester_id,p_bucket,p_storage_path)
  on conflict(generation) do nothing;
  return exists (select 1 from public.account_storage_artifacts where generation = p_generation
    and owner_id = p_owner_id and requester_id = p_requester_id and bucket = p_bucket
    and storage_path = p_storage_path and state = 'pending' and lease_expires_at > now());
end;
$$;


CREATE TABLE public.library_file_uploads (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL,
 generation uuid NOT NULL UNIQUE,
 storage_path text NOT NULL UNIQUE,
 file_name text NOT NULL,
 mime_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 extracted_text text NOT NULL DEFAULT '' CHECK(octet_length(extracted_text)<=200000),
 state text NOT NULL CHECK(state IN ('pending','ready','deleting','deleted','failed')),
 delete_requested boolean NOT NULL DEFAULT false,
 quota_charged boolean NOT NULL DEFAULT false,
 failure_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.library_file_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_file_uploads FROM public,anon,authenticated;
GRANT ALL ON public.library_file_uploads TO service_role;
CREATE INDEX library_file_uploads_owner ON public.library_file_uploads(owner_id,id);

CREATE FUNCTION public.reserve_library_file_upload(p_owner uuid,p_id uuid,p_generation uuid,p_name text,p_mime text,p_size bigint,p_sha256 text,p_text text,p_storage_limit bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_file_uploads; ext text; path text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 IF p_owner IS NULL OR p_id IS NULL OR p_generation IS NULL OR NOT kova_private.auth_user_exists(p_owner)
 OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RAISE EXCEPTION 'library_account_unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||p_id::text,20260905011300));
 ext := lower(substring(p_name from '\.([^.]+)$'));
 IF p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 200 OR p_name ~ '[[:cntrl:]/\\]' OR ext IS NULL
 OR NOT ((ext='pdf' AND p_mime='application/pdf')
 OR (ext='docx' AND p_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
 OR (ext='xlsx' AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 OR (ext='pptx' AND p_mime='application/vnd.openxmlformats-officedocument.presentationml.presentation'))
 OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 10485760 OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$'
 OR p_text IS NULL OR octet_length(p_text)>200000 OR p_storage_limit IS NULL OR p_storage_limit<1
 THEN RAISE EXCEPTION 'library_file_invalid'; END IF;
 SELECT * INTO row FROM public.library_file_uploads WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF row.owner_id<>p_owner OR row.delete_requested OR row.state IN ('deleting','deleted') OR (row.state='failed' AND row.failure_expires_at<=now())
  OR row.file_name<>p_name OR row.mime_type<>p_mime OR row.size_bytes<>p_size OR row.sha256<>p_sha256 OR row.extracted_text<>p_text
  THEN RAISE EXCEPTION 'library_file_conflict'; END IF;
  IF row.state='ready' THEN RETURN to_jsonb(row); END IF;
  IF row.state='pending' THEN
   IF EXISTS(SELECT 1 FROM public.account_storage_artifacts WHERE generation=row.generation AND state='pending' AND lease_expires_at>now())
   THEN RETURN to_jsonb(row); END IF;
   RAISE EXCEPTION 'library_file_cleanup_pending';
  END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM public.user_library_items WHERE id=p_id) THEN RAISE EXCEPTION 'library_file_conflict'; END IF;
 END IF;
 IF (SELECT count(*) FROM public.library_file_uploads WHERE owner_id=p_owner AND id<>p_id AND state<>'deleted')>=1000 THEN RAISE EXCEPTION 'library_file_count_limit'; END IF;
 IF NOT public.try_add_storage_bytes(p_owner,p_size,p_storage_limit) THEN RAISE EXCEPTION 'library_storage_limit'; END IF;
 path:=p_owner::text||'/'||p_generation::text||'.'||ext;
 IF NOT public.reserve_account_storage_artifact(p_generation,p_owner,p_owner,'library-files',path) THEN RAISE EXCEPTION 'library_account_unavailable'; END IF;
 INSERT INTO public.library_file_uploads(id,owner_id,generation,storage_path,file_name,mime_type,size_bytes,sha256,extracted_text,state,quota_charged)
 VALUES(p_id,p_owner,p_generation,path,p_name,p_mime,p_size,p_sha256,p_text,'pending',true)
 ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,storage_path=excluded.storage_path,state='pending',quota_charged=true,failure_expires_at=NULL,updated_at=now()
 RETURNING * INTO row;
 RETURN to_jsonb(row);
END;
$$;

CREATE FUNCTION public.settle_library_file_upload(p_owner uuid,p_id uuid,p_generation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_file_uploads; obj storage.objects;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 IF NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RETURN false; END IF;
 SELECT * INTO row FROM public.library_file_uploads WHERE id=p_id AND owner_id=p_owner AND generation=p_generation FOR UPDATE;
 IF NOT FOUND OR row.delete_requested OR row.state NOT IN ('pending','ready') THEN RETURN false; END IF;
 IF row.state='ready' THEN RETURN EXISTS(SELECT 1 FROM public.user_library_items WHERE id=p_id AND user_id=p_owner AND file_url=row.storage_path AND metadata->>'storage_generation'=p_generation::text); END IF;
 SELECT * INTO obj FROM storage.objects WHERE bucket_id='library-files' AND name=row.storage_path;
 IF NOT FOUND OR obj.metadata->>'size' IS DISTINCT FROM row.size_bytes::text OR obj.metadata->>'mimetype' IS DISTINCT FROM row.mime_type THEN RETURN false; END IF;
 IF NOT public.settle_account_storage_artifact(p_generation,p_owner,p_owner,'library-files',row.storage_path) THEN RETURN false; END IF;
 INSERT INTO public.user_library_items(id,user_id,title,item_type,source,content_text,file_url,file_name,file_type,file_size,metadata)
 VALUES(p_id,p_owner,row.file_name,'upload','upload',row.extracted_text,row.storage_path,row.file_name,row.mime_type,row.size_bytes,
 jsonb_build_object('file_bucket','library-files','storage_generation',p_generation,'sha256',row.sha256,'original_document',true));
 UPDATE public.library_file_uploads SET state='ready',updated_at=now() WHERE id=p_id;
 RETURN true;
END;
$$;

CREATE FUNCTION public.read_library_file(p_owner uuid,p_id uuid,p_generation uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_file_uploads;
BEGIN
 IF p_owner IS NULL OR NOT kova_private.auth_user_exists(p_owner) OR EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RETURN NULL; END IF;
 SELECT u.* INTO row FROM public.library_file_uploads u JOIN public.user_library_items i ON i.id=u.id AND i.user_id=u.owner_id
 WHERE u.id=p_id AND u.owner_id=p_owner AND u.state='ready' AND NOT u.delete_requested
 AND (p_generation IS NULL OR u.generation=p_generation) AND i.file_url=u.storage_path
 AND i.metadata->>'storage_generation'=u.generation::text AND i.metadata->>'file_bucket'='library-files';
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN to_jsonb(row)-'extracted_text';
END;
$$;

CREATE FUNCTION public.retire_library_file(p_owner uuid,p_id uuid,p_generation uuid,p_delete boolean DEFAULT true)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_file_uploads;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 SELECT * INTO row FROM public.library_file_uploads WHERE id=p_id AND owner_id=p_owner AND generation=p_generation FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF row.state='deleted' THEN RETURN true; END IF;
 -- A failed producer cannot erase a concurrently completed idempotent save.
 IF NOT p_delete AND row.state='ready' THEN RETURN false; END IF;
 UPDATE public.library_file_uploads SET state='deleting',delete_requested=delete_requested OR p_delete,updated_at=now() WHERE id=p_id;
 UPDATE public.account_storage_artifacts SET state='retired',next_cleanup_at=now() WHERE generation=p_generation
 AND owner_id=p_owner AND requester_id=p_owner AND bucket='library-files' AND storage_path=row.storage_path;
 RETURN FOUND;
END;
$$;

CREATE FUNCTION kova_private.protect_library_file_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Ordinary Library creates share this lock with original-file reservations.
 PERFORM pg_advisory_xact_lock(hashtextextended('library-item:'||coalesce(new.id,old.id)::text,20260905011300));
 IF current_setting('role',true)='service_role' OR auth.role()='service_role' THEN RETURN coalesce(new,old); END IF;
 IF EXISTS(SELECT 1 FROM public.library_file_uploads WHERE id=coalesce(new.id,old.id))
 OR (TG_OP<>'DELETE' AND new.metadata->>'file_bucket'='library-files') THEN
  IF TG_OP='UPDATE' AND (to_jsonb(new)-ARRAY['title','folder_id','updated_at'])=(to_jsonb(old)-ARRAY['title','folder_id','updated_at']) THEN RETURN new; END IF;
  RAISE EXCEPTION 'library_file_managed_write_required';
 END IF;
 RETURN coalesce(new,old);
END;
$$;
CREATE TRIGGER protect_library_file_metadata BEFORE INSERT OR UPDATE OR DELETE ON public.user_library_items FOR EACH ROW EXECUTE FUNCTION kova_private.protect_library_file_metadata();

CREATE OR REPLACE FUNCTION public.record_account_storage_artifact_cleanup(p_generation uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE artifact public.account_storage_artifacts; row public.library_file_uploads; erase boolean;
BEGIN
 UPDATE public.account_storage_artifacts SET last_cleanup_at=now() WHERE generation=p_generation AND state='retired' RETURNING * INTO artifact;
 IF NOT FOUND THEN RETURN false; END IF;
 IF artifact.bucket='library-images' THEN
  DELETE FROM public.user_library_items WHERE user_id=artifact.owner_id AND file_url=artifact.storage_path AND item_type='image' AND metadata->>'storage_generation'=p_generation::text;
 ELSIF artifact.bucket='library-files' THEN
  SELECT * INTO row FROM public.library_file_uploads WHERE generation=p_generation AND owner_id=artifact.owner_id FOR UPDATE;
  IF FOUND THEN
   DELETE FROM public.user_library_items WHERE id=row.id AND user_id=row.owner_id AND file_url=artifact.storage_path AND metadata->>'storage_generation'=p_generation::text;
   IF row.quota_charged THEN PERFORM public.release_project_storage_bytes(row.owner_id,row.size_bytes); END IF;
   erase:=row.delete_requested OR (row.failure_expires_at IS NOT NULL AND row.failure_expires_at<=now());
   UPDATE public.library_file_uploads SET state=CASE WHEN erase THEN 'deleted' ELSE 'failed' END,quota_charged=false,delete_requested=erase,
    failure_expires_at=CASE WHEN erase THEN NULL ELSE coalesce(failure_expires_at,now()+interval '24 hours') END,
    extracted_text=CASE WHEN erase THEN '' ELSE extracted_text END,
    file_name=CASE WHEN erase THEN '' ELSE file_name END,
    mime_type=CASE WHEN erase THEN '' ELSE mime_type END,
    size_bytes=CASE WHEN erase THEN 1 ELSE size_bytes END,
    sha256=CASE WHEN erase THEN repeat('0',64) ELSE sha256 END,updated_at=now() WHERE id=row.id;
  END IF;
 END IF;
 RETURN true;
END;
$$;

CREATE FUNCTION public.prepare_library_file_account_deletion(p_owner uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row public.library_file_uploads;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
 IF NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner) THEN RAISE EXCEPTION 'account_deletion_fence_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.library_file_uploads u JOIN public.account_storage_artifacts a ON a.generation=u.generation WHERE u.owner_id=p_owner AND u.state='pending' AND a.state='pending' AND a.lease_expires_at>now()) THEN RETURN false; END IF;
 FOR row IN SELECT * FROM public.library_file_uploads WHERE owner_id=p_owner AND state NOT IN ('deleted','failed') ORDER BY id LIMIT 25 FOR UPDATE LOOP
  PERFORM public.retire_library_file(p_owner,row.id,row.generation,true);
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.library_file_uploads WHERE owner_id=p_owner AND state NOT IN ('deleted','failed')) THEN RETURN false; END IF;
 DELETE FROM public.library_file_uploads WHERE owner_id=p_owner;
 RETURN true;
END;
$$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('library-files','library-files',false,10485760,ARRAY['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No anon/authenticated Storage policies: only the verified service lifecycle writes or reads original bytes.
REVOKE ALL ON FUNCTION public.reserve_library_file_upload(uuid,uuid,uuid,text,text,bigint,text,text,bigint),
 public.settle_library_file_upload(uuid,uuid,uuid),public.read_library_file(uuid,uuid,uuid),public.retire_library_file(uuid,uuid,uuid,boolean),
 public.prepare_library_file_account_deletion(uuid),kova_private.protect_library_file_metadata() FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_library_file_upload(uuid,uuid,uuid,text,text,bigint,text,text,bigint),
 public.settle_library_file_upload(uuid,uuid,uuid),public.read_library_file(uuid,uuid,uuid),public.retire_library_file(uuid,uuid,uuid,boolean),
 public.prepare_library_file_account_deletion(uuid) TO service_role;
