-- Delete Project Storage objects before cascading relational metadata. The
-- durable job row survives Project deletion so interrupted requests are safely
-- resumable. Applying this migration remains an operator-controlled release
-- step; the application never mutates live Storage or schema at build time.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS projects_owner_deletion_requested_idx
  ON public.projects(owner_id, deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.project_deletion_jobs (
  project_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested'
    CHECK (
      status IN (
        'requested',
        'waiting_for_files',
        'deleting_storage',
        'storage_failed',
        'metadata_finalizing',
        'completed'
      )
    ),
  attempt_id uuid,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text
    CHECK (
      last_error_code IS NULL
      OR (
        char_length(last_error_code) BETWEEN 1 AND 80
        AND last_error_code ~ '^[a-z0-9_]+$'
      )
    ),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_deletion_jobs_retry_idx
  ON public.project_deletion_jobs(status, lease_until, updated_at)
  WHERE status <> 'completed';

ALTER TABLE public.project_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_deletion_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.project_deletion_jobs TO service_role;

-- Only the durable coordinator may transition a Project into deletion. Once
-- marked, direct Project edits stay fenced even for service-role callers.
CREATE OR REPLACE FUNCTION public.project_deletion_project_write_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deletion_requested_at IS NOT NULL THEN
      RAISE EXCEPTION
        USING ERRCODE = '55000', MESSAGE = 'project_deletion_state_invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.deletion_requested_at IS NOT NULL THEN
    RAISE EXCEPTION
      USING ERRCODE = '55000', MESSAGE = 'project_deletion_pending';
  END IF;

  IF NEW.deletion_requested_at IS NOT NULL
    AND (
      (to_jsonb(NEW) - 'deletion_requested_at' - 'updated_at')
        IS DISTINCT FROM
      (to_jsonb(OLD) - 'deletion_requested_at' - 'updated_at')
      OR NOT EXISTS (
        SELECT 1
        FROM public.project_deletion_jobs AS j
        WHERE j.project_id = OLD.id
          AND j.owner_id = OLD.owner_id
          AND j.status <> 'completed'
      )
    )
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '55000', MESSAGE = 'project_deletion_state_invalid';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.project_deletion_project_write_fence()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_deletion_write_fence ON public.projects;
CREATE TRIGGER projects_deletion_write_fence
BEFORE INSERT OR UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_project_write_fence();

-- Reject Project-workspace mutations after the deletion marker is visible.
-- The metadata finalizer may still cascade child deletes in its fenced
-- transaction.
CREATE OR REPLACE FUNCTION public.project_deletion_child_write_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_project_id uuid;
  new_project_id uuid;
  project_row record;
BEGIN
  -- Auth removes the parent user before cascading this membership delete.
  -- Ordinary API deletes still see a live user and remain fenced.
  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'project_members'
    AND NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = (to_jsonb(OLD)->>'user_id')::uuid)
  THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'project_file_chunks'
    AND EXISTS (
      SELECT 1 FROM public.project_files pf
      JOIN public.account_deletion_fences f ON f.user_id=(to_jsonb(pf)->>'account_cleanup_user_id')::uuid
      WHERE pf.id=(to_jsonb(OLD)->>'file_id')::uuid AND pf.status='deleting'
    )
  THEN RETURN OLD; END IF;

  IF TG_OP <> 'INSERT' THEN
    old_project_id := OLD.project_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_project_id := NEW.project_id;
  END IF;

  FOR project_row IN
    SELECT p.id, p.deletion_requested_at
    FROM public.projects AS p
    WHERE p.id = old_project_id OR p.id = new_project_id
    ORDER BY p.id
  LOOP
    IF project_row.deletion_requested_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.project_deletion_jobs AS j
        WHERE j.project_id = project_row.id
          AND j.status = 'metadata_finalizing'
          AND j.attempt_id IS NOT NULL
      )
    THEN
      RAISE EXCEPTION
        USING ERRCODE = '55000', MESSAGE = 'project_deletion_pending';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.project_deletion_child_write_fence()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS project_activity_deletion_write_fence ON public.project_activity;
CREATE TRIGGER project_activity_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_activity
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

DROP TRIGGER IF EXISTS project_chats_deletion_write_fence ON public.project_chats;
CREATE TRIGGER project_chats_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_chats
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

DROP TRIGGER IF EXISTS project_comments_deletion_write_fence ON public.project_comments;
CREATE TRIGGER project_comments_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_comments
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

DROP TRIGGER IF EXISTS project_file_chunks_deletion_write_fence ON public.project_file_chunks;
CREATE TRIGGER project_file_chunks_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_file_chunks
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

DROP TRIGGER IF EXISTS project_invites_deletion_write_fence ON public.project_invites;
CREATE TRIGGER project_invites_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_invites
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

DROP TRIGGER IF EXISTS project_members_deletion_write_fence ON public.project_members;
CREATE TRIGGER project_members_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_members
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

DROP TRIGGER IF EXISTS project_memory_deletion_write_fence ON public.project_memory;
CREATE TRIGGER project_memory_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_memory
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

DROP TRIGGER IF EXISTS project_notes_deletion_write_fence ON public.project_notes;
CREATE TRIGGER project_notes_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_notes
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

DROP TRIGGER IF EXISTS project_tasks_deletion_write_fence ON public.project_tasks;
CREATE TRIGGER project_tasks_deletion_write_fence
BEFORE INSERT OR UPDATE OR DELETE ON public.project_tasks
FOR EACH ROW EXECUTE FUNCTION public.project_deletion_child_write_fence();

-- Authenticated clients must not bypass Storage-first cleanup with a direct
-- DELETE. Only the service-role finalizer below can open the trigger gate.
REVOKE DELETE ON TABLE public.projects FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "owner can delete project" ON public.projects;

CREATE OR REPLACE FUNCTION public.project_file_deletion_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deletion_requested timestamptz;
BEGIN
  -- A departing account can trigger SET NULL while a different owner's
  -- Project is frozen. Permit only the FK-owned columns to lose a deleted
  -- identity; never permit unrelated content/state changes through this path.
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'uploaded_by' - 'storage_owner_id' - 'updated_at')
      IS NOT DISTINCT FROM
        (to_jsonb(OLD) - 'uploaded_by' - 'storage_owner_id' - 'updated_at')
    AND (
      NEW.uploaded_by IS NOT DISTINCT FROM OLD.uploaded_by
      OR (OLD.uploaded_by IS NOT NULL AND NEW.uploaded_by IS NULL
        AND NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = OLD.uploaded_by))
    )
    AND (
      NEW.storage_owner_id IS NOT DISTINCT FROM OLD.storage_owner_id
      OR (OLD.storage_owner_id IS NOT NULL AND NEW.storage_owner_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = OLD.storage_owner_id))
    )
    AND (NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
      OR NEW.storage_owner_id IS DISTINCT FROM OLD.storage_owner_id)
  THEN
    RETURN NEW;
  END IF;

  -- Account cleanup can reserve an uploader's files even when another
  -- owner's Project is frozen. The account-write fence separately validates
  -- that this update changes only the cleanup marker and lease state.
  IF TG_OP='UPDATE' AND to_jsonb(OLD)->>'account_cleanup_user_id' IS NULL
    AND to_jsonb(NEW)->>'account_cleanup_user_id' IS NOT NULL
    AND NEW.status='deleting' AND NEW.delete_attempt_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.account_deletion_fences
      WHERE user_id=(to_jsonb(NEW)->>'account_cleanup_user_id')::uuid)
  THEN RETURN NEW; END IF;

  -- Single-file finalizers use DELETE, not UPDATE. Every insert/update is
  -- fenced once Project deletion begins so an expired uploader cannot publish
  -- a new object after the coordinator's final Storage sweep.

  SELECT p.deletion_requested_at
  INTO deletion_requested
  FROM public.projects AS p
  WHERE p.id = NEW.project_id
  FOR KEY SHARE;

  IF NOT FOUND OR deletion_requested IS NOT NULL THEN
    RAISE EXCEPTION
      USING ERRCODE = '55000', MESSAGE = 'project_deletion_pending';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.project_file_deletion_fence()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS project_files_deletion_fence ON public.project_files;
DROP TRIGGER IF EXISTS project_files_upload_deletion_fence ON public.project_files;
DROP TRIGGER IF EXISTS project_files_delete_deletion_fence ON public.project_files;
CREATE TRIGGER project_files_deletion_fence
BEFORE INSERT OR UPDATE ON public.project_files
FOR EACH ROW EXECUTE FUNCTION public.project_file_deletion_fence();

CREATE OR REPLACE FUNCTION public.claim_project_deletion(
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
  project_owner uuid;
  job public.project_deletion_jobs;
  active_file_operations bigint;
BEGIN
  IF p_user_id IS NULL OR p_project_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION
      USING ERRCODE = '22023', MESSAGE = 'invalid_project_deletion_claim';
  END IF;

  SELECT p.owner_id
  INTO project_owner
  FROM public.projects AS p
  WHERE p.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT *
    INTO job
    FROM public.project_deletion_jobs AS j
    WHERE j.project_id = p_project_id
      AND j.owner_id = p_user_id;

    IF FOUND AND job.status = 'completed' THEN
      RETURN jsonb_build_object(
        'state', 'completed',
        'projectId', p_project_id,
        'retryAfter', 0
      );
    END IF;
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_not_found';
  END IF;

  IF project_owner <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_not_found';
  END IF;

  INSERT INTO public.project_deletion_jobs(project_id, owner_id)
  VALUES (p_project_id, project_owner)
  ON CONFLICT (project_id) DO NOTHING;

  SELECT *
  INTO job
  FROM public.project_deletion_jobs AS j
  WHERE j.project_id = p_project_id
  FOR UPDATE;

  IF job.owner_id <> project_owner OR job.status = 'completed' THEN
    RAISE EXCEPTION
      USING ERRCODE = '55000', MESSAGE = 'project_deletion_state_invalid';
  END IF;

  UPDATE public.projects
  SET deletion_requested_at = now()
  WHERE id = p_project_id
    AND deletion_requested_at IS NULL;

  IF job.status = 'deleting_storage'
    AND job.lease_until > now()
    AND job.attempt_id IS DISTINCT FROM p_attempt_id
  THEN
    RETURN jsonb_build_object(
      'state', 'busy',
      'projectId', p_project_id,
      'retryAfter', 2
    );
  END IF;

  SELECT count(*)
  INTO active_file_operations
  FROM public.project_files AS pf
  WHERE pf.project_id = p_project_id
    AND (
      (
        pf.status IN ('pending', 'upload_failed', 'cleanup_failed')
        AND pf.upload_lease_until > now()
      )
      OR (
        pf.status = 'deleting'
        AND pf.delete_lease_until > now()
      )
    );

  IF active_file_operations > 0 THEN
    UPDATE public.project_deletion_jobs
    SET status = 'waiting_for_files',
        attempt_id = NULL,
        lease_until = NULL,
        last_error_code = 'project_file_operations_settling',
        updated_at = now()
    WHERE project_id = p_project_id;

    RETURN jsonb_build_object(
      'state', 'waiting_for_files',
      'projectId', p_project_id,
      'retryAfter', 5
    );
  END IF;

  UPDATE public.project_deletion_jobs
  SET status = 'deleting_storage',
      attempt_id = p_attempt_id,
      lease_until = now() + interval '2 minutes',
      attempt_count = attempt_count + 1,
      started_at = coalesce(started_at, now()),
      last_error_code = NULL,
      updated_at = now()
  WHERE project_id = p_project_id;

  RETURN jsonb_build_object(
    'state', 'claimed',
    'projectId', p_project_id,
    'retryAfter', 0
  );
END
$$;

REVOKE ALL ON FUNCTION public.claim_project_deletion(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_deletion(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.renew_project_deletion(
  p_user_id uuid,
  p_project_id uuid,
  p_attempt_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  renewed boolean;
BEGIN
  UPDATE public.project_deletion_jobs
  SET lease_until = now() + interval '2 minutes',
      updated_at = now()
  WHERE project_id = p_project_id
    AND owner_id = p_user_id
    AND status = 'deleting_storage'
    AND attempt_id = p_attempt_id
  RETURNING true INTO renewed;

  RETURN coalesce(renewed, false);
END
$$;

REVOKE ALL ON FUNCTION public.renew_project_deletion(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_project_deletion(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fail_project_deletion(
  p_user_id uuid,
  p_project_id uuid,
  p_attempt_id uuid,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  failed boolean;
BEGIN
  IF p_error_code IS NULL
    OR char_length(p_error_code) NOT BETWEEN 1 AND 80
    OR p_error_code !~ '^[a-z0-9_]+$'
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '22023', MESSAGE = 'invalid_project_deletion_error';
  END IF;

  UPDATE public.project_deletion_jobs
  SET status = 'storage_failed',
      attempt_id = NULL,
      lease_until = NULL,
      last_error_code = p_error_code,
      updated_at = now()
  WHERE project_id = p_project_id
    AND owner_id = p_user_id
    AND status = 'deleting_storage'
    AND attempt_id = p_attempt_id
  RETURNING true INTO failed;

  RETURN coalesce(failed, false);
END
$$;

REVOKE ALL ON FUNCTION public.fail_project_deletion(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_project_deletion(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.project_storage_first_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.project_deletion_jobs AS j
    WHERE j.project_id = OLD.id
      AND j.owner_id = OLD.owner_id
      AND j.status = 'metadata_finalizing'
      AND j.attempt_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      USING ERRCODE = '55000', MESSAGE = 'project_storage_cleanup_required';
  END IF;
  RETURN OLD;
END
$$;

REVOKE ALL ON FUNCTION public.project_storage_first_delete_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS projects_storage_first_delete_guard ON public.projects;
CREATE TRIGGER projects_storage_first_delete_guard
BEFORE DELETE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.project_storage_first_delete_guard();

CREATE OR REPLACE FUNCTION public.finalize_project_deletion(
  p_user_id uuid,
  p_project_id uuid,
  p_attempt_id uuid,
  p_retained_paths text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  project_owner uuid;
  job public.project_deletion_jobs;
  charged record;
BEGIN
  IF p_user_id IS NULL OR p_project_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION
      USING ERRCODE = '22023', MESSAGE = 'invalid_project_deletion_finalize';
  END IF;

  SELECT p.owner_id
  INTO project_owner
  FROM public.projects AS p
  WHERE p.id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT *
    INTO job
    FROM public.project_deletion_jobs AS j
    WHERE j.project_id = p_project_id
      AND j.owner_id = p_user_id;

    IF FOUND AND job.status = 'completed' THEN
      RETURN jsonb_build_object('deleted', false, 'completed', true);
    END IF;
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_not_found';
  END IF;

  IF project_owner <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_not_found';
  END IF;

  SELECT *
  INTO job
  FROM public.project_deletion_jobs AS j
  WHERE j.project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND
    OR job.owner_id <> p_user_id
    OR job.status <> 'deleting_storage'
    OR job.attempt_id <> p_attempt_id
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '55000', MESSAGE = 'project_deletion_lease_lost';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.project_files AS pf
    WHERE pf.project_id = p_project_id
      AND (
        (
        pf.status IN ('pending', 'upload_failed', 'cleanup_failed')
        AND pf.upload_lease_until > now()
      )
      OR (
        pf.status = 'deleting'
        AND pf.delete_lease_until > now()
      )
      )
  ) THEN
    RAISE EXCEPTION
      USING ERRCODE = '55000', MESSAGE = 'project_file_operations_settling';
  END IF;

  UPDATE public.project_deletion_jobs
  SET status = 'metadata_finalizing',
      updated_at = now()
  WHERE project_id = p_project_id;

  FOR charged IN
    SELECT pf.* FROM public.project_files pf WHERE pf.project_id=p_project_id ORDER BY pf.id FOR UPDATE
  LOOP
    PERFORM public.settle_project_source_storage_charge(charged.id,charged.storage_path,charged.storage_owner_id,
      charged.size_bytes,charged.storage_charged,NOT (charged.storage_path=ANY(p_retained_paths)));
  END LOOP;

  -- Preserve historical Work/audit records while detaching the deleted
  -- Project. These references deliberately do not cascade in the base schema.
  UPDATE public.agent_resource_promotions SET project_id = NULL WHERE project_id = p_project_id;
  UPDATE public.agent_resource_relationships SET project_id = NULL WHERE project_id = p_project_id;
  UPDATE public.agent_resource_activity SET project_id = NULL WHERE project_id = p_project_id;

  DELETE FROM public.projects
  WHERE id = p_project_id
    AND owner_id = p_user_id;

  UPDATE public.project_deletion_jobs
  SET status = 'completed',
      attempt_id = NULL,
      lease_until = NULL,
      last_error_code = NULL,
      completed_at = now(),
      updated_at = now()
  WHERE project_id = p_project_id;

  RETURN jsonb_build_object('deleted', true, 'completed', false);
END
$$;

REVOKE ALL ON FUNCTION public.finalize_project_deletion(uuid, uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_project_deletion(uuid, uuid, uuid, text[])
  TO service_role;
