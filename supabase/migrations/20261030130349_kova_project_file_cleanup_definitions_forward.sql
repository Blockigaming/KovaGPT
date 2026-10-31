-- Add only four missing, canonical server-only Project cleanup definitions.
-- The bodies and their existing helper contracts come from reviewed source;
-- this is not a replay of the historical upload/storage migration. It changes
-- no table data, policies, helper definitions, buckets, quota or migration rows.
-- The one DO statement is atomic. Either no target exists or all four already
-- match exactly; partial/conflicting installation and privilege drift fail.
-- Existing identical definitions are retained with their OIDs and ACLs.
-- Future normal application cleanup can remove expired file rows and settle
-- their storage charges. Installing definitions itself performs no cleanup.
-- Operator rollback: only when the four catalog fingerprints and exact ACLs
-- below still match, and after checking no new dependent object was added,
-- DROP the four exact signatures with RESTRICT in one transaction. Refuse any
-- changed poststate. Do not use CASCADE or remove the migration ledger record.
-- This restores the prior known list/upload failure, cannot undo subsequent
-- application cleanup, and does not qualify an Auth or full database restore.
DO $repair$
DECLARE
  expected_targets jsonb := $targets$[{"signature":"public.claim_stale_project_file_cleanup(uuid,uuid,uuid)","name":"claim_stale_project_file_cleanup","body":"c0960073d2589953b6c1255ef5d0005e69f6eb0102bfe9ebe4effb631c67d541","result":"jsonb","argnames":["p_user_id","p_project_id","p_attempt_id"],"defaults":0,"defaultSql":null},{"signature":"public.renew_stale_project_file_cleanup(uuid,uuid)","name":"renew_stale_project_file_cleanup","body":"de55ebe2d140656708c28c9b075f55121c20b6c435195b6453ae6f9ef6bbd7f0","result":"boolean","argnames":["p_file_id","p_attempt_id"],"defaults":0,"defaultSql":null},{"signature":"public.fail_stale_project_file_cleanup(uuid,uuid)","name":"fail_stale_project_file_cleanup","body":"f1e2a1deae43f78868e853950bc9e436b039eaf277268b77a0b942ac7494d917","result":"boolean","argnames":["p_file_id","p_attempt_id"],"defaults":0,"defaultSql":null},{"signature":"public.finalize_stale_project_file_cleanup(uuid,uuid,boolean)","name":"finalize_stale_project_file_cleanup","body":"38c6ad6ba56fab0b07664a9aeeb6f3add24c0ebf03c86c1ab64b413ab22f5ce8","result":"jsonb","argnames":["p_file_id","p_attempt_id","p_storage_removed"],"defaults":1,"defaultSql":"true"}]$targets$::jsonb;
  expected_helpers jsonb := $helpers$[{"signature":"public.lock_project_for_file_operation(uuid)","name":"lock_project_for_file_operation","body":"d2fc4f706bb8403cb256ef96ccf7beae02ad0f163d69c1b4db672f632680f46d","result":"uuid","argnames":["p_file_id"],"defaults":0,"defaultSql":null},{"signature":"public.settle_project_source_storage_charge(uuid,text,uuid,bigint,boolean,boolean)","name":"settle_project_source_storage_charge","body":"c4bb897b0facde8491ecec25c8cfd7bc8fa525d0c599bf14efebebcfc568a8b4","result":"void","argnames":["p_file_id","p_path","p_owner","p_bytes","p_charged","p_removed"],"defaults":0,"defaultSql":null}]$helpers$::jsonb;
  expected_columns jsonb := $columns$[{"table":"project_files","column":"id","type":"uuid"},{"table":"project_files","column":"project_id","type":"uuid"},{"table":"project_files","column":"account_cleanup_user_id","type":"uuid"},{"table":"project_files","column":"status","type":"text"},{"table":"project_files","column":"upload_lease_until","type":"timestamp with time zone"},{"table":"project_files","column":"delete_lease_until","type":"timestamp with time zone"},{"table":"project_files","column":"updated_at","type":"timestamp with time zone"},{"table":"project_files","column":"upload_attempt_id","type":"uuid"},{"table":"project_files","column":"delete_attempt_id","type":"uuid"},{"table":"project_files","column":"storage_path","type":"text"},{"table":"project_files","column":"storage_owner_id","type":"uuid"},{"table":"project_files","column":"size_bytes","type":"bigint"},{"table":"project_files","column":"storage_charged","type":"boolean"},{"table":"projects","column":"id","type":"uuid"},{"table":"project_members","column":"project_id","type":"uuid"},{"table":"project_members","column":"user_id","type":"uuid"},{"table":"user_storage","column":"user_id","type":"uuid"},{"table":"user_storage","column":"bytes_used","type":"bigint"},{"table":"user_storage","column":"updated_at","type":"timestamp with time zone"},{"table":"project_storage_retained_charges","column":"file_id","type":"uuid"},{"table":"project_storage_retained_charges","column":"storage_path","type":"text"},{"table":"project_storage_retained_charges","column":"owner_id","type":"uuid"},{"table":"project_storage_retained_charges","column":"size_bytes","type":"bigint"}]$columns$::jsonb;
  item jsonb;
  proc_oid oid;
  metadata record;
  existing_targets integer;
  phase integer;
BEGIN
  IF current_user <> 'postgres'
     OR to_regrole('service_role') IS NULL OR to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'project_cleanup_forward_role_baseline';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(expected_columns) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=item->>'table' AND c.relkind='r'
        AND a.attname=item->>'column' AND a.attnum>0 AND NOT a.attisdropped
        AND format_type(a.atttypid,a.atttypmod)=item->>'type'
    ) THEN
      RAISE EXCEPTION 'project_cleanup_forward_column_drift: %.%',item->>'table',item->>'column';
    END IF;
  END LOOP;
  -- Helper validation precedes every target installation and identical replay.
  FOR item IN SELECT value FROM jsonb_array_elements(expected_helpers) LOOP

      proc_oid := to_regprocedure(item->>'signature');
      IF proc_oid IS NULL THEN
        RAISE EXCEPTION 'project_cleanup_forward_function_missing: %',item->>'signature';
      END IF;
      SELECT p.*,l.lanname INTO metadata
        FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=proc_oid;
      IF encode(sha256(convert_to(metadata.prosrc,'UTF8')),'hex') IS DISTINCT FROM item->>'body'
         OR pg_get_function_result(proc_oid) IS DISTINCT FROM item->>'result'
         OR to_jsonb(metadata.proargnames) IS DISTINCT FROM item->'argnames'
         OR metadata.pronargdefaults IS DISTINCT FROM (item->>'defaults')::integer
         OR pg_get_expr(metadata.proargdefaults,0) IS DISTINCT FROM item->>'defaultSql'
         OR metadata.lanname IS DISTINCT FROM 'plpgsql'
         OR NOT metadata.prosecdef
         OR metadata.provolatile IS DISTINCT FROM 'v'::"char"
         OR metadata.proisstrict OR metadata.proleakproof
         OR metadata.proparallel IS DISTINCT FROM 'u'::"char"
         OR metadata.prokind IS DISTINCT FROM 'f'::"char"
         OR metadata.proargmodes IS NOT NULL
         OR metadata.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
         OR pg_get_userbyid(metadata.proowner) IS DISTINCT FROM 'postgres'
      THEN
        RAISE EXCEPTION 'project_cleanup_forward_definition_drift: %',item->>'signature';
      END IF;
      IF (SELECT count(*) FROM aclexplode(coalesce(metadata.proacl,acldefault('f',metadata.proowner)))) <> 2
         OR EXISTS (
           SELECT 1 FROM aclexplode(coalesce(metadata.proacl,acldefault('f',metadata.proowner))) a
           WHERE a.grantee NOT IN (metadata.proowner,'service_role'::regrole)
             OR a.grantor <> metadata.proowner OR a.privilege_type <> 'EXECUTE'
             OR a.is_grantable
         )
         OR NOT has_function_privilege('service_role',proc_oid,'EXECUTE')
         OR has_function_privilege('anon',proc_oid,'EXECUTE')
         OR has_function_privilege('authenticated',proc_oid,'EXECUTE')
      THEN
        RAISE EXCEPTION 'project_cleanup_forward_acl_drift: %',item->>'signature';
      END IF;
      IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname=item->>'name') <> 1 THEN
        RAISE EXCEPTION 'project_cleanup_forward_overload_drift: %',item->>'name';
      END IF;
  END LOOP;
  SELECT count(*) INTO existing_targets FROM jsonb_array_elements(expected_targets) candidate(value)
    WHERE to_regprocedure(candidate.value->>'signature') IS NOT NULL;
  IF existing_targets NOT IN (0,4) THEN
    RAISE EXCEPTION 'project_cleanup_forward_partial_installation';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(expected_targets) LOOP
    IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=item->>'name')
       AND to_regprocedure(item->>'signature') IS NULL THEN
      RAISE EXCEPTION 'project_cleanup_forward_overload_drift: %',item->>'name';
    END IF;
  END LOOP;
  -- Check already-present definitions before considering any creation, then
  -- check all four postconditions inside the same atomic statement.
  FOR phase IN 0..1 LOOP
    IF phase=1 AND existing_targets=0 THEN
      EXECUTE $canonical$
CREATE OR REPLACE FUNCTION public.claim_stale_project_file_cleanup(
  p_user_id uuid,
  p_project_id uuid,
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  authorized_project uuid;
  target public.project_files;
  cleanup_kind text;
BEGIN
  IF p_user_id IS NULL OR p_project_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION
      USING ERRCODE = '22023', MESSAGE = 'invalid_project_file_cleanup_claim';
  END IF;

  SELECT p.id
  INTO authorized_project
  FROM public.projects AS p
  JOIN public.project_members AS pm
    ON pm.project_id = p.id
   AND pm.user_id = p_user_id
  WHERE p.id = p_project_id
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_not_found';
  END IF;

  SELECT pf.*
  INTO target
  FROM public.project_files AS pf
  WHERE pf.project_id = authorized_project
    AND pf.account_cleanup_user_id IS NULL
    AND (
      (
        pf.status IN ('pending', 'upload_failed', 'cleanup_failed')
        AND (pf.upload_lease_until IS NULL OR pf.upload_lease_until <= now())
      )
      OR (
        pf.status = 'deleting'
        AND (pf.delete_lease_until IS NULL OR pf.delete_lease_until <= now())
      )
    )
  ORDER BY pf.updated_at, pf.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'complete');
  END IF;

  IF target.status = 'deleting' THEN
    cleanup_kind := 'delete';
    UPDATE public.project_files
    SET delete_attempt_id = p_attempt_id,
        delete_lease_until = now() + interval '2 minutes',
        updated_at = now()
    WHERE id = target.id
    RETURNING * INTO target;
  ELSE
    cleanup_kind := 'upload';
    UPDATE public.project_files
    SET status = 'cleanup_failed',
        upload_attempt_id = p_attempt_id,
        upload_lease_until = now() + interval '2 minutes',
        updated_at = now()
    WHERE id = target.id
    RETURNING * INTO target;
  END IF;

  RETURN to_jsonb(target) || jsonb_build_object(
    'state', 'claimed',
    'cleanupKind', cleanup_kind
  );
END
$$;

REVOKE ALL ON FUNCTION public.claim_stale_project_file_cleanup(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stale_project_file_cleanup(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.renew_stale_project_file_cleanup(
  p_file_id uuid,
  p_attempt_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_project_id uuid;
  renewed boolean;
BEGIN
  target_project_id := public.lock_project_for_file_operation(p_file_id);
  IF target_project_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.project_files
  SET upload_lease_until = CASE
        WHEN status = 'cleanup_failed' THEN now() + interval '2 minutes'
        ELSE upload_lease_until
      END,
      delete_lease_until = CASE
        WHEN status = 'deleting' THEN now() + interval '2 minutes'
        ELSE delete_lease_until
      END,
      updated_at = now()
  WHERE id = p_file_id
    AND project_id = target_project_id
    AND (
      (status = 'cleanup_failed' AND upload_attempt_id = p_attempt_id)
      OR (status = 'deleting' AND delete_attempt_id = p_attempt_id)
    )
  RETURNING true INTO renewed;

  RETURN coalesce(renewed, false);
END
$$;

REVOKE ALL ON FUNCTION public.renew_stale_project_file_cleanup(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_stale_project_file_cleanup(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_stale_project_file_cleanup(
  p_file_id uuid,
  p_attempt_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_project_id uuid;
  failed boolean;
BEGIN
  target_project_id := public.lock_project_for_file_operation(p_file_id);
  IF target_project_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.project_files
  SET upload_lease_until = CASE
        WHEN status = 'cleanup_failed' THEN NULL
        ELSE upload_lease_until
      END,
      delete_lease_until = CASE
        WHEN status = 'deleting' THEN NULL
        ELSE delete_lease_until
      END,
      updated_at = now()
  WHERE id = p_file_id
    AND project_id = target_project_id
    AND (
      (status = 'cleanup_failed' AND upload_attempt_id = p_attempt_id)
      OR (status = 'deleting' AND delete_attempt_id = p_attempt_id)
    )
  RETURNING true INTO failed;

  RETURN coalesce(failed, false);
END
$$;

REVOKE ALL ON FUNCTION public.fail_stale_project_file_cleanup(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_stale_project_file_cleanup(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_stale_project_file_cleanup(
  p_file_id uuid,
  p_attempt_id uuid,
  p_storage_removed boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.project_files;
  target_project_id uuid;
BEGIN
  target_project_id := public.lock_project_for_file_operation(p_file_id);
  IF target_project_id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.project_files WHERE id = p_file_id) THEN
      RETURN jsonb_build_object('deleted', true, 'idempotent', true);
    END IF;
    RETURN jsonb_build_object('deleted', false);
  END IF;

  SELECT *
  INTO target
  FROM public.project_files
  WHERE id = p_file_id
    AND project_id = target_project_id
    AND (
      (status = 'cleanup_failed' AND upload_attempt_id = p_attempt_id)
      OR (status = 'deleting' AND delete_attempt_id = p_attempt_id)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.project_files WHERE id = p_file_id) THEN
      RETURN jsonb_build_object('deleted', true, 'idempotent', true);
    END IF;
    RETURN jsonb_build_object('deleted', false);
  END IF;

  DELETE FROM public.project_files WHERE id = target.id;
  PERFORM public.settle_project_source_storage_charge(target.id,target.storage_path,target.storage_owner_id,target.size_bytes,target.storage_charged,p_storage_removed);

  RETURN jsonb_build_object(
    'deleted', true,
    'idempotent', false,
    'projectId', target.project_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.finalize_stale_project_file_cleanup(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stale_project_file_cleanup(uuid, uuid, boolean)
  TO service_role;
$canonical$;
    END IF;
    IF existing_targets=4 OR phase=1 THEN
      FOR item IN SELECT value FROM jsonb_array_elements(expected_targets) LOOP

      proc_oid := to_regprocedure(item->>'signature');
      IF proc_oid IS NULL THEN
        RAISE EXCEPTION 'project_cleanup_forward_function_missing: %',item->>'signature';
      END IF;
      SELECT p.*,l.lanname INTO metadata
        FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=proc_oid;
      IF encode(sha256(convert_to(metadata.prosrc,'UTF8')),'hex') IS DISTINCT FROM item->>'body'
         OR pg_get_function_result(proc_oid) IS DISTINCT FROM item->>'result'
         OR to_jsonb(metadata.proargnames) IS DISTINCT FROM item->'argnames'
         OR metadata.pronargdefaults IS DISTINCT FROM (item->>'defaults')::integer
         OR pg_get_expr(metadata.proargdefaults,0) IS DISTINCT FROM item->>'defaultSql'
         OR metadata.lanname IS DISTINCT FROM 'plpgsql'
         OR NOT metadata.prosecdef
         OR metadata.provolatile IS DISTINCT FROM 'v'::"char"
         OR metadata.proisstrict OR metadata.proleakproof
         OR metadata.proparallel IS DISTINCT FROM 'u'::"char"
         OR metadata.prokind IS DISTINCT FROM 'f'::"char"
         OR metadata.proargmodes IS NOT NULL
         OR metadata.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
         OR pg_get_userbyid(metadata.proowner) IS DISTINCT FROM 'postgres'
      THEN
        RAISE EXCEPTION 'project_cleanup_forward_definition_drift: %',item->>'signature';
      END IF;
      IF (SELECT count(*) FROM aclexplode(coalesce(metadata.proacl,acldefault('f',metadata.proowner)))) <> 2
         OR EXISTS (
           SELECT 1 FROM aclexplode(coalesce(metadata.proacl,acldefault('f',metadata.proowner))) a
           WHERE a.grantee NOT IN (metadata.proowner,'service_role'::regrole)
             OR a.grantor <> metadata.proowner OR a.privilege_type <> 'EXECUTE'
             OR a.is_grantable
         )
         OR NOT has_function_privilege('service_role',proc_oid,'EXECUTE')
         OR has_function_privilege('anon',proc_oid,'EXECUTE')
         OR has_function_privilege('authenticated',proc_oid,'EXECUTE')
      THEN
        RAISE EXCEPTION 'project_cleanup_forward_acl_drift: %',item->>'signature';
      END IF;
      IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname=item->>'name') <> 1 THEN
        RAISE EXCEPTION 'project_cleanup_forward_overload_drift: %',item->>'name';
      END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$repair$;
