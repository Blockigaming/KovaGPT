-- READ ONLY. NOT EXECUTED AGAINST ANY SHARED/PRODUCTION DATABASE BY THIS TASK.
-- Requires separately authorized operator with visibility across all owners.
-- Never interpret a filtered RLS result as a clean preflight.
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Preflight requires authorized all-owner visibility; result would be incomplete';
  END IF;
END $$;
SELECT 'prompt_versions' AS relation, count(*) AS owner_mismatch_count
FROM public.prompt_versions v JOIN public.prompt_templates p ON p.id=v.prompt_id
WHERE v.user_id IS DISTINCT FROM p.user_id
UNION ALL
SELECT 'prompt_evaluations', count(*)
FROM public.prompt_evaluations e JOIN public.prompt_templates p ON p.id=e.prompt_id
WHERE e.user_id IS DISTINCT FROM p.user_id;
-- Restricted investigation metadata only; no prompt bodies/notes in the output.
SELECT v.id AS history_id, v.prompt_id, v.user_id AS history_owner, p.user_id AS prompt_owner, v.version
FROM public.prompt_versions v JOIN public.prompt_templates p ON p.id=v.prompt_id
WHERE v.user_id IS DISTINCT FROM p.user_id ORDER BY v.prompt_id,v.version,v.id;
ROLLBACK;
