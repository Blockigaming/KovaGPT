-- Legacy JWT-owned source objects must leave the departing Auth owner while
-- independently authorized collaborator references retain the exact bytes.
-- Each attempt permits one external copy only. Ambiguous attempts expire into
-- the existing permanent artifact sweep; no Storage rows are mutated by SQL.
CREATE TABLE public.project_storage_source_transfers (
  generation uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  source_path text NOT NULL,
  destination_path text NOT NULL UNIQUE,
  source_object_id uuid NOT NULL,
  source_version text,
  source_size bigint NOT NULL CHECK(source_size BETWEEN 0 AND 67108864),
  state text NOT NULL CHECK(state IN ('copying','published','retired')),
  content_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_storage_source_transfers_source_idx ON public.project_storage_source_transfers(owner_id,source_path,created_at DESC);
ALTER TABLE public.project_storage_source_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_storage_source_transfers FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.project_storage_source_transfers TO service_role;

-- Check current references using trusted provenance and exact promotion links.
-- Caller-writable Work rows without a previously verified source-access record
-- cannot acquire bytes through this maintenance operation.
CREATE FUNCTION kova_private.retained_source_references_valid(p_owner uuid,p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.agent_deliverables d
    WHERE d.storage_reference='project-files:'||p_path AND d.owner_id<>p_owner
      AND d.status IS DISTINCT FROM 'deleted'
      AND NOT EXISTS(SELECT 1 FROM public.project_storage_source_access a
        WHERE a.storage_path=p_path AND a.principal_id=d.owner_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.project_files pf JOIN public.projects p ON p.id=pf.project_id
    WHERE pf.storage_path=p_path AND pf.uploaded_by IS DISTINCT FROM p_owner AND p.owner_id<>p_owner
      AND NOT (
        (pf.kind IN ('file','image') AND pf.storage_path LIKE pf.project_id::text||'/%'
          AND EXISTS(SELECT 1 FROM public.project_storage_source_provenance sp
            WHERE sp.storage_path=p_path AND sp.project_id=pf.project_id))
        OR (pf.kind='agent-deliverable' AND EXISTS(
          SELECT 1 FROM public.agent_resource_promotions rp
          JOIN public.agent_deliverables d ON d.id=rp.deliverable_id
          JOIN public.project_storage_source_access a ON a.storage_path=p_path AND a.principal_id=d.owner_id
          WHERE rp.destination_type='project_file' AND rp.destination_id=pf.id AND rp.project_id=pf.project_id
            AND rp.status='completed' AND rp.owner_id=pf.uploaded_by AND d.owner_id=rp.owner_id
            AND d.status IS DISTINCT FROM 'deleted' AND d.storage_reference='project-files:'||p_path))
      )
  );
$$;
REVOKE ALL ON FUNCTION kova_private.retained_source_references_valid(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.claim_account_retained_source_transfer(p_owner_id uuid,p_source_path text,p_generation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.project_storage_source_transfers; obj storage.objects; destination text; bytes bigint;
BEGIN
  IF p_owner_id IS NULL OR p_generation IS NULL OR p_source_path IS NULL
    OR char_length(p_source_path)>1024 OR p_source_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
    OR p_source_path ~ '(^|/)\.\.?(/|$)' OR p_source_path ~ '[[:cntrl:]]' OR p_source_path LIKE '%/.uploads/%'
  THEN RAISE EXCEPTION 'invalid_retained_source_transfer' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text,20260903204500));
  IF NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner_id) THEN
    RAISE EXCEPTION 'account_deletion_fence_required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_path,20260904234409));
  SELECT * INTO previous FROM public.project_storage_source_transfers
    WHERE owner_id=p_owner_id AND source_path=p_source_path ORDER BY created_at DESC,generation LIMIT 1 FOR UPDATE;
  IF FOUND AND previous.state='published' THEN RETURN jsonb_build_object('state','published'); END IF;
  IF FOUND AND previous.state='copying' THEN
    IF EXISTS(SELECT 1 FROM public.account_storage_artifacts a WHERE a.generation=previous.generation
      AND a.state='pending' AND a.lease_expires_at>now()) THEN RETURN jsonb_build_object('state','busy'); END IF;
    UPDATE public.project_storage_source_transfers SET state='retired' WHERE generation=previous.generation;
    UPDATE public.account_storage_artifacts SET state='retired',next_cleanup_at=now()
      WHERE generation=previous.generation AND state='pending';
    INSERT INTO public.project_storage_source_retirements(storage_path) VALUES(previous.destination_path) ON CONFLICT DO NOTHING;
  END IF;
  -- Replayed claim IDs never authorize a second copy, even after an ambiguous
  -- response. A later attempt must use a fresh immutable destination.
  IF EXISTS(SELECT 1 FROM public.project_storage_source_transfers WHERE generation=p_generation) THEN
    RETURN jsonb_build_object('state','busy'); END IF;
  SELECT * INTO obj FROM storage.objects WHERE bucket_id='project-files' AND name=p_source_path;
  IF NOT FOUND OR coalesce(obj.owner_id,to_jsonb(obj)->>'owner') IS DISTINCT FROM p_owner_id::text THEN
    RAISE EXCEPTION 'retained_source_owner_mismatch' USING ERRCODE='42501'; END IF;
  IF NOT kova_private.retained_source_references_valid(p_owner_id,p_source_path) THEN
    RAISE EXCEPTION 'retained_source_provenance_invalid' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.agent_deliverables d WHERE d.storage_reference='project-files:'||p_source_path
      AND d.owner_id<>p_owner_id AND d.status IS DISTINCT FROM 'deleted')
    AND NOT EXISTS(SELECT 1 FROM public.project_files pf JOIN public.projects p ON p.id=pf.project_id
      WHERE pf.storage_path=p_source_path AND pf.uploaded_by IS DISTINCT FROM p_owner_id AND p.owner_id<>p_owner_id)
  THEN RETURN jsonb_build_object('state','unreferenced'); END IF;
  bytes:=(obj.metadata->>'size')::bigint;
  IF bytes IS NULL OR bytes NOT BETWEEN 0 AND 67108864 THEN
    RAISE EXCEPTION 'retained_source_size_invalid' USING ERRCODE='22023'; END IF;
  destination:=split_part(p_source_path,'/',1)||'/'||p_generation::text||'.'||
    CASE WHEN p_source_path ~ '\.[a-z0-9]{1,12}$' THEN substring(p_source_path FROM '\.([a-z0-9]{1,12})$') ELSE 'bin' END;
  -- This is the sole exception to ordinary producer reservation: exact owned
  -- bytes, a durable account fence, and independently verified survivors.
  INSERT INTO public.account_storage_artifacts(generation,owner_id,requester_id,bucket,storage_path,state,lease_expires_at)
    VALUES(p_generation,p_owner_id,p_owner_id,'project-files',destination,'pending',now()+interval '3 minutes');
  INSERT INTO public.project_storage_source_transfers(generation,owner_id,source_path,destination_path,source_object_id,source_version,source_size,state)
    VALUES(p_generation,p_owner_id,p_source_path,destination,obj.id,to_jsonb(obj)->>'version',bytes,'copying');
  INSERT INTO public.project_storage_source_retirements(storage_path) VALUES(p_source_path) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('state','copy','generation',p_generation,'source',p_source_path,'destination',destination,'size',bytes);
END; $$;
REVOKE ALL ON FUNCTION public.claim_account_retained_source_transfer(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_retained_source_transfer(uuid,text,uuid) TO service_role;

CREATE FUNCTION public.publish_account_retained_source_transfer(
  p_owner_id uuid,p_generation uuid,p_destination_id uuid,p_destination_version text,p_sha256 text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE attempt public.project_storage_source_transfers; obj storage.objects; dest storage.objects; principal uuid; project_row record;
BEGIN
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_destination_id IS NULL THEN
    RAISE EXCEPTION 'invalid_retained_source_verification' USING ERRCODE='22023'; END IF;
  SELECT * INTO attempt FROM public.project_storage_source_transfers WHERE generation=p_generation AND owner_id=p_owner_id;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Lock all reference owners before their deletion fences and all Projects
  -- before their lifecycle fences; publication changes no permissions or quota.
  FOR principal IN SELECT DISTINCT uid FROM (
    SELECT p_owner_id uid UNION SELECT d.owner_id FROM public.agent_deliverables d
      WHERE d.storage_reference='project-files:'||attempt.source_path
    UNION SELECT pf.uploaded_by FROM public.project_files pf WHERE pf.storage_path=attempt.source_path
    UNION SELECT p.owner_id FROM public.projects p JOIN public.project_files pf ON pf.project_id=p.id WHERE pf.storage_path=attempt.source_path
  ) principals WHERE uid IS NOT NULL ORDER BY uid LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(principal::text,20260903204500));
  END LOOP;
  FOR project_row IN SELECT p.id FROM public.projects p JOIN public.project_files pf ON pf.project_id=p.id
    WHERE pf.storage_path=attempt.source_path ORDER BY p.id FOR UPDATE OF p LOOP NULL; END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended(attempt.source_path,20260904234409));
  PERFORM pg_advisory_xact_lock(hashtextextended(attempt.destination_path,20260904234409));
  SELECT * INTO attempt FROM public.project_storage_source_transfers WHERE generation=p_generation AND owner_id=p_owner_id FOR UPDATE;
  PERFORM 1 FROM public.account_storage_artifacts WHERE generation=p_generation FOR UPDATE;
  IF attempt.state='published' THEN RETURN attempt.content_sha256=p_sha256; END IF;
  IF attempt.state<>'copying' OR NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_owner_id)
    OR NOT EXISTS(SELECT 1 FROM public.account_storage_artifacts a WHERE a.generation=p_generation
      AND a.owner_id=p_owner_id AND a.requester_id=p_owner_id AND a.bucket='project-files' AND a.storage_path=attempt.destination_path
      AND a.state='pending' AND a.lease_expires_at>now())
    OR EXISTS(SELECT 1 FROM public.project_storage_source_retirements WHERE storage_path=attempt.destination_path)
  THEN RETURN false; END IF;
  SELECT * INTO obj FROM storage.objects WHERE bucket_id='project-files' AND name=attempt.source_path;
  SELECT * INTO dest FROM storage.objects WHERE bucket_id='project-files' AND name=attempt.destination_path;
  IF obj.id IS DISTINCT FROM attempt.source_object_id OR (to_jsonb(obj)->>'version') IS DISTINCT FROM attempt.source_version
    OR coalesce(obj.owner_id,to_jsonb(obj)->>'owner') IS DISTINCT FROM p_owner_id::text
    OR (obj.metadata->>'size')::bigint IS DISTINCT FROM attempt.source_size
    OR dest.id IS DISTINCT FROM p_destination_id OR (to_jsonb(dest)->>'version') IS DISTINCT FROM p_destination_version
    OR coalesce(dest.owner_id,to_jsonb(dest)->>'owner') IS NOT NULL
    OR (dest.metadata->>'size')::bigint IS DISTINCT FROM attempt.source_size
  THEN RETURN false; END IF;
  IF NOT kova_private.retained_source_references_valid(p_owner_id,attempt.source_path) THEN RETURN false; END IF;
  -- A different account/Project deletion owns its cleanup. Retry after that
  -- operation settles rather than changing its in-flight metadata.
  IF EXISTS(SELECT 1 FROM public.agent_deliverables d JOIN public.account_deletion_fences f ON f.user_id=d.owner_id
      WHERE d.storage_reference='project-files:'||attempt.source_path AND d.owner_id<>p_owner_id AND d.status IS DISTINCT FROM 'deleted')
    OR EXISTS(SELECT 1 FROM public.project_files pf JOIN public.projects p ON p.id=pf.project_id
      WHERE pf.storage_path=attempt.source_path AND pf.uploaded_by IS DISTINCT FROM p_owner_id AND p.owner_id<>p_owner_id
      AND (p.deletion_requested_at IS NOT NULL OR pf.status<>'ready' OR pf.account_cleanup_user_id IS NOT NULL
        OR EXISTS(SELECT 1 FROM public.account_deletion_fences f WHERE f.user_id IN(pf.uploaded_by,pf.storage_owner_id,p.owner_id))))
  THEN RETURN false; END IF;
  INSERT INTO public.project_storage_source_provenance(storage_path,project_id,owner_id,uploaded_by)
    SELECT attempt.destination_path,sp.project_id,sp.owner_id,sp.uploaded_by FROM public.project_storage_source_provenance sp
    WHERE sp.storage_path=attempt.source_path ON CONFLICT DO NOTHING;
  INSERT INTO public.project_storage_source_access(storage_path,principal_id)
    SELECT attempt.destination_path,a.principal_id FROM public.project_storage_source_access a
    WHERE a.storage_path=attempt.source_path AND a.principal_id<>p_owner_id
      AND EXISTS(SELECT 1 FROM public.agent_deliverables d WHERE d.owner_id=a.principal_id
        AND d.storage_reference='project-files:'||attempt.source_path AND d.status IS DISTINCT FROM 'deleted')
    ON CONFLICT DO NOTHING;
  UPDATE public.agent_deliverables d SET storage_reference='project-files:'||attempt.destination_path
    WHERE d.storage_reference='project-files:'||attempt.source_path AND d.owner_id<>p_owner_id AND d.status IS DISTINCT FROM 'deleted';
  UPDATE public.project_files pf SET storage_path=attempt.destination_path
    FROM public.projects p WHERE p.id=pf.project_id AND pf.storage_path=attempt.source_path
      AND pf.uploaded_by IS DISTINCT FROM p_owner_id AND p.owner_id<>p_owner_id;
  -- Library promotions store the same durable source separately; update only
  -- an exact completed promotion owned by the verified surviving Work owner.
  UPDATE public.user_library_items li SET file_url='project-files:'||attempt.destination_path
    FROM public.agent_resource_promotions rp JOIN public.agent_deliverables d ON d.id=rp.deliverable_id
    WHERE rp.destination_type='library_document' AND rp.destination_id=li.id AND rp.status='completed'
      AND li.user_id=rp.owner_id AND d.owner_id=rp.owner_id AND d.owner_id<>p_owner_id
      AND d.status IS DISTINCT FROM 'deleted' AND d.storage_reference='project-files:'||attempt.destination_path
      AND li.file_url='project-files:'||attempt.source_path;
  -- Preserve charges exactly once; deleting the old bytes must not release a
  -- charge whose surviving content was merely moved to another immutable path.
  UPDATE public.project_storage_retained_charges SET storage_path=attempt.destination_path WHERE storage_path=attempt.source_path;
  UPDATE public.account_storage_artifacts SET state='published' WHERE generation=p_generation;
  UPDATE public.project_storage_source_transfers SET state='published',content_sha256=p_sha256 WHERE generation=p_generation;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.publish_account_retained_source_transfer(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_account_retained_source_transfer(uuid,uuid,uuid,text,text) TO service_role;
