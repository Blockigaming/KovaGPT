-- Storage deletion spans an external API. Retire an exact immutable source
-- under the same path lock used by reference writers before removing bytes.
CREATE TABLE public.project_storage_source_provenance (
  storage_path text PRIMARY KEY,
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  uploaded_by uuid
);
CREATE TABLE public.project_storage_source_access (
  storage_path text NOT NULL,
  principal_id uuid NOT NULL,
  PRIMARY KEY(storage_path,principal_id)
);
CREATE TABLE public.project_storage_source_retirements (
  storage_path text PRIMARY KEY,
  retired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.project_storage_source_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_storage_source_retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_storage_source_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_storage_source_provenance,public.project_storage_source_retirements,public.project_storage_source_access FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.project_storage_source_provenance,public.project_storage_source_retirements,public.project_storage_source_access TO service_role;

INSERT INTO public.project_storage_source_provenance(storage_path,project_id,owner_id,uploaded_by)
SELECT DISTINCT ON (pf.storage_path) pf.storage_path,pf.project_id,p.owner_id,pf.uploaded_by
FROM public.project_files pf JOIN public.projects p ON p.id=pf.project_id
WHERE pf.kind IN ('file','image') AND pf.storage_path LIKE pf.project_id::text||'/%'
ORDER BY pf.storage_path,pf.id ON CONFLICT DO NOTHING;

-- Preserve source access only where existing references have independent proof.
-- A caller-written Work row by itself never creates this authority.
INSERT INTO public.project_storage_source_access(storage_path,principal_id)
SELECT substring(d.storage_reference FROM char_length('project-files:')+1),d.owner_id
FROM public.agent_deliverables d
WHERE d.storage_reference LIKE 'project-files:%' AND (
  EXISTS(SELECT 1 FROM public.project_storage_source_provenance sp
    WHERE 'project-files:'||sp.storage_path=d.storage_reference AND d.owner_id IN (sp.owner_id,sp.uploaded_by))
  OR EXISTS(SELECT 1 FROM public.project_files pf JOIN public.project_members pm ON pm.project_id=pf.project_id
    WHERE 'project-files:'||pf.storage_path=d.storage_reference AND pf.status='ready' AND pm.user_id=d.owner_id
      AND pf.kind IN ('file','image') AND pf.storage_path LIKE pf.project_id::text||'/%')
  OR EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='project-files' AND 'project-files:'||o.name=d.storage_reference
    AND coalesce(o.owner_id,to_jsonb(o)->>'owner')=d.owner_id::text)
  OR EXISTS(SELECT 1 FROM public.account_storage_artifacts a WHERE a.bucket='project-files' AND 'project-files:'||a.storage_path=d.storage_reference
    AND a.state='published' AND d.owner_id IN (a.owner_id,a.requester_id))
) ON CONFLICT DO NOTHING;

CREATE FUNCTION public.project_storage_source_write_fence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE path text; principal uuid; canonical boolean; source_project uuid; source_owner uuid;
BEGIN
  IF TG_TABLE_NAME='agent_deliverables' THEN
    IF NEW.status='deleted' OR NEW.storage_reference IS NULL OR NEW.storage_reference NOT LIKE 'project-files:%' THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND OLD.status<>'deleted' AND NEW.storage_reference=OLD.storage_reference
      AND NEW.owner_id=OLD.owner_id THEN RETURN NEW; END IF;
    path:=substring(NEW.storage_reference FROM char_length('project-files:')+1);
    principal:=NEW.owner_id;
  ELSE
    IF TG_OP='UPDATE' AND NEW.storage_path=OLD.storage_path AND NEW.project_id=OLD.project_id
      AND NOT (NEW.status='ready' AND OLD.status<>'ready') THEN RETURN NEW; END IF;
    path:=NEW.storage_path;
    canonical:=NEW.kind IN ('file','image') AND path LIKE NEW.project_id::text||'/%';
    principal:=NEW.uploaded_by;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(path,20260904234409));
  IF EXISTS(SELECT 1 FROM public.project_storage_source_retirements r WHERE r.storage_path=path) THEN
    RAISE EXCEPTION 'The source file was deleted and can no longer be restored.' USING ERRCODE='55000';
  END IF;
  IF TG_TABLE_NAME='project_files' THEN
    IF canonical THEN
      SELECT owner_id INTO source_owner FROM public.projects WHERE id=NEW.project_id;
      INSERT INTO public.project_storage_source_provenance VALUES(path,NEW.project_id,source_owner,principal)
        ON CONFLICT(storage_path) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;
  -- A caller-owned Work row alone is not proof of ownership of arbitrary
  -- private Storage. Check real source provenance before accepting a new ref.
  IF path LIKE '%/.uploads/%' OR path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' THEN
    RAISE EXCEPTION 'project_storage_source_unavailable' USING ERRCODE='42501';
  END IF;
  source_project:=split_part(path,'/',1)::uuid;
  IF EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=principal)
    OR EXISTS(SELECT 1 FROM public.project_files pf WHERE pf.storage_path=path AND pf.status<>'ready')
    OR NOT (
      EXISTS(SELECT 1 FROM public.project_members pm JOIN public.projects p ON p.id=pm.project_id
        WHERE p.id=source_project AND pm.user_id=principal AND p.deletion_requested_at IS NULL
          AND EXISTS(SELECT 1 FROM public.project_files pf WHERE pf.project_id=p.id AND pf.storage_path=path AND pf.status='ready' AND pf.kind IN ('file','image')))
      OR EXISTS(SELECT 1 FROM public.project_storage_source_provenance sp WHERE sp.storage_path=path AND principal IN (sp.owner_id,sp.uploaded_by)
        AND NOT EXISTS(SELECT 1 FROM public.project_files pf WHERE pf.storage_path=path AND pf.status<>'ready'))
      OR EXISTS(SELECT 1 FROM public.project_storage_source_access a WHERE a.storage_path=path AND a.principal_id=principal)
      OR EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='project-files' AND o.name=path AND coalesce(o.owner_id,to_jsonb(o)->>'owner')=principal::text)
      OR EXISTS(SELECT 1 FROM public.account_storage_artifacts a WHERE a.bucket='project-files' AND a.storage_path=path AND a.state='published' AND principal IN (a.owner_id,a.requester_id))
    ) THEN RAISE EXCEPTION 'project_storage_source_unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.project_storage_source_access VALUES(path,principal) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.project_storage_source_write_fence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER project_files_source_write_fence BEFORE INSERT OR UPDATE ON public.project_files
  FOR EACH ROW EXECUTE FUNCTION public.project_storage_source_write_fence();
CREATE TRIGGER agent_deliverables_source_write_fence BEFORE INSERT OR UPDATE ON public.agent_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.project_storage_source_write_fence();

CREATE FUNCTION public.claim_project_storage_source_cleanup(
  p_paths text[],p_project_id uuid DEFAULT NULL,p_account_id uuid DEFAULT NULL,p_file_ids uuid[] DEFAULT '{}'
) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE path text; retained text[]:='{}'; actors uuid[]; authorized boolean;
BEGIN
  IF p_paths IS NULL OR cardinality(p_paths)>1000 OR p_file_ids IS NULL OR cardinality(p_file_ids)>1000 THEN
    RAISE EXCEPTION 'invalid_project_storage_source_cleanup' USING ERRCODE='22023';
  END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.account_deletion_fences WHERE user_id=p_account_id) THEN
    RAISE EXCEPTION 'account_deletion_fence_required' USING ERRCODE='42501';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=p_project_id AND deletion_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION 'project_deletion_fence_required' USING ERRCODE='42501';
  END IF;
  IF p_project_id IS NULL AND p_account_id IS NULL AND cardinality(p_file_ids)=0 THEN
    RAISE EXCEPTION 'project_storage_source_cleanup_scope_required' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_file_ids) AS requested(file_id) WHERE NOT EXISTS(
    SELECT 1 FROM public.project_files pf WHERE pf.id=requested.file_id AND pf.status IN ('deleting','cleanup_failed')
  )) THEN RAISE EXCEPTION 'project_file_deletion_claim_required' USING ERRCODE='42501'; END IF;
  FOR path IN SELECT DISTINCT value FROM unnest(p_paths) value ORDER BY value LOOP
    IF path IS NULL OR char_length(path)>1024 OR path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' OR path ~ '(^|/)\.\.?(/|$)' THEN
      RAISE EXCEPTION 'invalid_project_storage_source_cleanup' USING ERRCODE='22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(path,20260904234409));
    IF EXISTS(SELECT 1 FROM public.project_files pf JOIN public.projects p ON p.id=pf.project_id
        WHERE pf.storage_path=path AND pf.project_id IS DISTINCT FROM p_project_id AND NOT pf.id=ANY(p_file_ids)
        AND (p_account_id IS NULL OR (pf.uploaded_by IS DISTINCT FROM p_account_id AND p.owner_id<>p_account_id)))
      OR EXISTS(SELECT 1 FROM public.agent_deliverables d WHERE d.storage_reference='project-files:'||path
        AND d.status IS DISTINCT FROM 'deleted' AND d.owner_id IS DISTINCT FROM p_account_id)
    THEN retained:=array_append(retained,path);CONTINUE;END IF;
    SELECT array_agg(DISTINCT actor) INTO actors FROM (
      SELECT p_account_id AS actor
      UNION SELECT pf.uploaded_by FROM public.project_files pf
        WHERE pf.storage_path=path AND (pf.id=ANY(p_file_ids) OR pf.project_id=p_project_id)
    ) a WHERE actor IS NOT NULL;
    authorized:=
      (p_project_id IS NOT NULL AND path LIKE p_project_id::text||'/%')
      OR EXISTS(SELECT 1 FROM public.project_files pf WHERE pf.id=ANY(p_file_ids) AND pf.storage_path=path AND pf.kind IN ('file','image') AND path LIKE pf.project_id::text||'/%')
      OR EXISTS(SELECT 1 FROM public.project_storage_source_provenance sp WHERE sp.storage_path=path AND (sp.owner_id=ANY(actors) OR sp.uploaded_by=ANY(actors)))
      OR EXISTS(SELECT 1 FROM public.project_storage_source_access a WHERE a.storage_path=path AND a.principal_id=ANY(actors))
      OR EXISTS(SELECT 1 FROM public.account_storage_artifacts a WHERE a.bucket='project-files' AND a.storage_path=path AND a.state='published' AND (a.owner_id=ANY(actors) OR a.requester_id=ANY(actors)))
      OR EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='project-files' AND o.name=path AND coalesce(o.owner_id,to_jsonb(o)->>'owner')=ANY(actors::text[]))
      OR EXISTS(SELECT 1 FROM public.project_storage_retained_charges c WHERE c.storage_path=path AND c.owner_id=ANY(actors));
    IF NOT coalesce(authorized,false) THEN retained:=array_append(retained,path);CONTINUE;END IF;
    INSERT INTO public.project_storage_source_retirements(storage_path) VALUES(path) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN retained;
END; $$;
REVOKE ALL ON FUNCTION public.claim_project_storage_source_cleanup(text[],uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_storage_source_cleanup(text[],uuid,uuid,uuid[]) TO service_role;
