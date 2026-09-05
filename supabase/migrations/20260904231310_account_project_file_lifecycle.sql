-- Retain exact quota charges when live Work/Project references keep source
-- bytes after their original metadata is removed. Release once when collected.
CREATE TABLE IF NOT EXISTS public.project_storage_retained_charges (
  file_id uuid PRIMARY KEY,
  storage_path text NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0)
);
CREATE INDEX IF NOT EXISTS project_storage_retained_charges_path_idx ON public.project_storage_retained_charges(storage_path);
ALTER TABLE public.project_storage_retained_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_storage_retained_charges FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.project_storage_retained_charges TO service_role;

CREATE OR REPLACE FUNCTION public.settle_project_source_storage_charge(
  p_file_id uuid, p_path text, p_owner uuid, p_bytes bigint, p_charged boolean, p_removed boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE retained record;
BEGIN
  IF p_removed THEN
    IF p_charged AND p_owner IS NOT NULL AND p_bytes > 0 THEN
      UPDATE public.user_storage SET bytes_used=greatest(0,bytes_used-p_bytes),updated_at=now() WHERE user_id=p_owner;
    END IF;
    FOR retained IN DELETE FROM public.project_storage_retained_charges WHERE storage_path=p_path RETURNING owner_id,size_bytes LOOP
      UPDATE public.user_storage SET bytes_used=greatest(0,bytes_used-retained.size_bytes),updated_at=now() WHERE user_id=retained.owner_id;
    END LOOP;
  ELSIF p_charged AND p_bytes > 0 THEN
    INSERT INTO public.project_storage_retained_charges(file_id,storage_path,owner_id,size_bytes)
      VALUES(p_file_id,p_path,p_owner,p_bytes) ON CONFLICT(file_id) DO NOTHING;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.settle_project_source_storage_charge(uuid,text,uuid,bigint,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_project_source_storage_charge(uuid,text,uuid,bigint,boolean,boolean) TO service_role;

-- Account deletion must reserve file cleanup before Storage mutation and settle
-- the matching project owner's charge in the same transaction as metadata.
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS account_cleanup_user_id uuid;
CREATE INDEX IF NOT EXISTS project_files_account_cleanup_idx
  ON public.project_files(account_cleanup_user_id) WHERE account_cleanup_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_account_project_file_cleanup(
  p_user_id uuid, p_file_id uuid, p_attempt_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.project_files; project_owner uuid;
BEGIN
  IF p_user_id IS NULL OR p_file_id IS NULL OR p_attempt_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.account_deletion_fences WHERE user_id = p_user_id)
  THEN RAISE EXCEPTION 'account_deletion_fence_required' USING ERRCODE = '42501'; END IF;
  SELECT p.owner_id INTO project_owner FROM public.projects p
    JOIN public.project_files pf ON pf.project_id=p.id WHERE pf.id=p_file_id FOR UPDATE OF p;
  SELECT * INTO target FROM public.project_files WHERE id=p_file_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','missing'); END IF;
  IF target.uploaded_by IS DISTINCT FROM p_user_id AND project_owner IS DISTINCT FROM p_user_id
    AND target.account_cleanup_user_id IS DISTINCT FROM p_user_id
  THEN RAISE EXCEPTION 'account_file_scope_invalid' USING ERRCODE='42501'; END IF;
  IF target.account_cleanup_user_id IS NOT NULL THEN
    IF target.account_cleanup_user_id <> p_user_id THEN RETURN jsonb_build_object('state','busy'); END IF;
    RETURN to_jsonb(target) || jsonb_build_object('state','claimed');
  END IF;
  IF (target.status IN ('pending','upload_failed','cleanup_failed') AND target.upload_lease_until > now())
    OR (target.status='deleting' AND target.delete_lease_until > now())
  THEN RETURN jsonb_build_object('state','busy'); END IF;
  UPDATE public.project_files SET account_cleanup_user_id=p_user_id, status='deleting',
    delete_attempt_id=p_attempt_id, delete_lease_until=NULL,
    upload_attempt_id=NULL, upload_lease_until=NULL, updated_at=now()
    WHERE id=p_file_id RETURNING * INTO target;
  RETURN to_jsonb(target) || jsonb_build_object('state','claimed');
END; $$;
REVOKE ALL ON FUNCTION public.claim_account_project_file_cleanup(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_project_file_cleanup(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_account_project_file_cleanup(
  p_user_id uuid, p_file_id uuid, p_attempt_id uuid, p_storage_removed boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.project_files;
BEGIN
  IF p_user_id IS NULL OR p_file_id IS NULL OR p_attempt_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_user_id)
  THEN RAISE EXCEPTION 'account_deletion_fence_required' USING ERRCODE='42501'; END IF;
  PERFORM p.id FROM public.projects p JOIN public.project_files pf ON pf.project_id=p.id
    WHERE pf.id=p_file_id FOR UPDATE OF p;
  SELECT * INTO target FROM public.project_files WHERE id=p_file_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('deleted',true); END IF;
  IF target.account_cleanup_user_id IS DISTINCT FROM p_user_id OR target.delete_attempt_id IS DISTINCT FROM p_attempt_id
    OR target.status <> 'deleting'
  THEN RAISE EXCEPTION 'account_file_cleanup_claim_lost' USING ERRCODE='55000'; END IF;
  -- Remove children while their parent claim is still visible to its fence.
  DELETE FROM public.project_file_chunks WHERE file_id=p_file_id;
  DELETE FROM public.project_files WHERE id=p_file_id;
  PERFORM public.settle_project_source_storage_charge(target.id,target.storage_path,target.storage_owner_id,target.size_bytes,target.storage_charged,p_storage_removed);
  RETURN jsonb_build_object('deleted',true);
END; $$;
REVOKE ALL ON FUNCTION public.finalize_account_project_file_cleanup(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_account_project_file_cleanup(uuid,uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.project_file_account_write_fence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE principal uuid;
BEGIN
  -- The cleanup marker cannot be cleared by an upload retry or regular file RPC.
  IF TG_OP='UPDATE' AND OLD.account_cleanup_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'account_file_cleanup_pending' USING ERRCODE='55000';
  END IF;
  IF TG_OP='UPDATE' AND NEW.account_cleanup_user_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.account_deletion_fences WHERE user_id=NEW.account_cleanup_user_id)
    AND NEW.status='deleting' AND NEW.delete_attempt_id IS NOT NULL
    AND NEW.upload_attempt_id IS NULL AND NEW.upload_lease_until IS NULL
    AND (to_jsonb(NEW)-'account_cleanup_user_id'-'status'-'delete_attempt_id'-'delete_lease_until'-'upload_attempt_id'-'upload_lease_until'-'updated_at')
      IS NOT DISTINCT FROM
      (to_jsonb(OLD)-'account_cleanup_user_id'-'status'-'delete_attempt_id'-'delete_lease_until'-'upload_attempt_id'-'upload_lease_until'-'updated_at')
  THEN RETURN NEW; END IF;
  IF NEW.account_cleanup_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'account_file_cleanup_state_invalid' USING ERRCODE='55000';
  END IF;
  -- Serialize new storage producers with the durable account-deletion fence.
  FOR principal IN SELECT DISTINCT uid FROM unnest(ARRAY[NEW.uploaded_by,NEW.storage_owner_id]) uid
    WHERE uid IS NOT NULL ORDER BY uid
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(principal::text,20260903204500));
    IF EXISTS (SELECT 1 FROM public.account_deletion_fences WHERE user_id=principal) THEN
      RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE='55000';
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.project_file_account_write_fence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER project_files_account_write_fence BEFORE INSERT OR UPDATE ON public.project_files
  FOR EACH ROW EXECUTE FUNCTION public.project_file_account_write_fence();


-- Work may retain a service-owned source after its last Project row disappears.
-- Discover only unreferenced sources attributable to this account; other Auth
-- owners always retain authority over their objects. Missing ledger objects are
-- included so a failed quota settlement remains retryable after Storage removal.
CREATE OR REPLACE FUNCTION public.list_account_project_storage_objects(
  p_owner_id uuid, p_limit integer DEFAULT 1000
) RETURNS TABLE(name text,owner_id text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_owner_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_account_storage_discovery_arguments' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH own_paths AS (
    -- Work references are caller writable and cannot establish ownership of
    -- an unregistered, service-owned object belonging to somebody else.
    SELECT sp.storage_path AS path FROM public.project_storage_source_provenance sp
      WHERE p_owner_id IN (sp.owner_id,sp.uploaded_by)
    UNION SELECT a.storage_path FROM public.project_storage_source_access a WHERE a.principal_id=p_owner_id
    UNION SELECT a.storage_path FROM public.account_storage_artifacts a
      WHERE a.bucket='project-files' AND a.state='published' AND p_owner_id IN (a.owner_id,a.requester_id)
    UNION SELECT c.storage_path FROM public.project_storage_retained_charges c WHERE c.owner_id=p_owner_id
  ), candidates AS (
    SELECT o.name,coalesce(o.owner_id,to_jsonb(o)->>'owner') AS object_owner
      FROM storage.objects o WHERE o.bucket_id='project-files'
      AND coalesce(o.owner_id,to_jsonb(o)->>'owner')=p_owner_id::text
    UNION
    SELECT p.path,NULL::text FROM own_paths p
    WHERE (EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='project-files' AND o.name=p.path)
      OR EXISTS(SELECT 1 FROM public.project_storage_retained_charges c WHERE c.storage_path=p.path))
    AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='project-files' AND o.name=p.path
      AND coalesce(o.owner_id,to_jsonb(o)->>'owner') IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM public.agent_deliverables d
      WHERE d.storage_reference='project-files:'||p.path AND d.owner_id<>p_owner_id AND d.status IS DISTINCT FROM 'deleted')
    AND NOT EXISTS(SELECT 1 FROM public.project_files pf JOIN public.projects pr ON pr.id=pf.project_id
      WHERE pf.storage_path=p.path AND pf.uploaded_by IS DISTINCT FROM p_owner_id AND pr.owner_id<>p_owner_id)
  ) SELECT c.name,c.object_owner FROM candidates c ORDER BY c.name LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.list_account_project_storage_objects(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_project_storage_objects(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_account_project_storage_charges(p_paths text[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE retained record;
BEGIN
  IF p_paths IS NULL OR cardinality(p_paths)>1000 THEN
    RAISE EXCEPTION 'invalid_account_storage_settlement' USING ERRCODE='22023';
  END IF;
  FOR retained IN DELETE FROM public.project_storage_retained_charges c
    WHERE c.storage_path=ANY(p_paths)
      AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='project-files' AND o.name=c.storage_path)
    RETURNING c.owner_id,c.size_bytes
  LOOP
    UPDATE public.user_storage SET bytes_used=greatest(0,bytes_used-retained.size_bytes),updated_at=now()
      WHERE user_id=retained.owner_id;
  END LOOP;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.settle_account_project_storage_charges(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_account_project_storage_charges(text[]) TO service_role;
