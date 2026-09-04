-- Make Project file storage private, bounded, server-owned, and atomic with
-- project membership and per-plan count enforcement. Applying this migration
-- and creating/updating the bucket is an operator-controlled release step.

ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS storage_owner_id uuid,
  ADD COLUMN IF NOT EXISTS storage_charged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upload_quota_acquired boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upload_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS upload_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS delete_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS delete_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.project_files
  ALTER COLUMN uploaded_by DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_uploaded_by_fkey'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_uploaded_by_fkey
      FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_storage_owner_fkey'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_storage_owner_fkey
      FOREIGN KEY (storage_owner_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_name_length_check'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_name_length_check
      CHECK (content_sha256 IS NULL OR char_length(name) BETWEEN 1 AND 180) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_size_check'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_size_check
      CHECK (content_sha256 IS NULL OR size_bytes BETWEEN 0 AND 10485760) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_kind_check'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_kind_check
      CHECK (kind IN ('file', 'image', 'agent-deliverable')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_status_check'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_status_check
      CHECK (status IN ('pending', 'ready', 'upload_failed', 'cleanup_failed', 'deleting')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_upload_quota_check'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_upload_quota_check
      CHECK (
        content_sha256 IS NULL
        OR status <> 'ready'
        OR upload_quota_acquired
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_sha256_check'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_sha256_check
      CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_canonical_path_check'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_canonical_path_check
      CHECK (
        (
          kind IN ('file', 'image')
          AND content_sha256 IS NOT NULL
          AND storage_path ~ (
            '^' || project_id::text || '/' || id::text || E'\\.[a-z0-9]{1,12}$'
          )
        )
        OR (
          kind IN ('file', 'image')
          AND content_sha256 IS NULL
          AND char_length(storage_path) BETWEEN 1 AND 1024
          AND storage_path ~ ('^' || project_id::text || '/')
          AND storage_path !~ '(^|/)\.\.?(/|$)'
          AND storage_path !~ '[[:cntrl:]]'
        )
        OR (
          kind = 'agent-deliverable'
          AND char_length(storage_path) BETWEEN 1 AND 1024
          AND storage_path !~ '(^|/)\.\.?(/|$)'
          AND storage_path !~ '[[:cntrl:]]'
        )
      ) NOT VALID;
  END IF;
END
$$;

-- Uploads completed by the immediately preceding implementation already
-- consumed daily quota before this durable marker existed. Mark only those
-- canonical ready rows so a same-key retry neither fails the new invariant nor
-- charges the historical upload twice.
UPDATE public.project_files
SET upload_quota_acquired = true,
    updated_at = now()
WHERE content_sha256 IS NOT NULL
  AND status = 'ready'
  AND NOT upload_quota_acquired;

ALTER TABLE public.project_files
  VALIDATE CONSTRAINT project_files_upload_quota_check;

-- Historical Project uploads predate storage accounting. Charge each legacy
-- file/image row once to the owning Project so new reservations cannot exceed
-- the real cumulative storage budget. Agent deliverables remain references to
-- another bucket and are intentionally excluded.
WITH legacy_to_charge AS (
  SELECT
    pf.id,
    p.owner_id,
    greatest(pf.size_bytes, 0) AS charge_bytes
  FROM public.project_files AS pf
  JOIN public.projects AS p ON p.id = pf.project_id
  WHERE pf.kind IN ('file', 'image')
    AND pf.content_sha256 IS NULL
    AND NOT pf.storage_charged
),
charged AS (
  UPDATE public.project_files AS pf
  SET storage_owner_id = legacy.owner_id,
      storage_charged = legacy.charge_bytes > 0,
      updated_at = now()
  FROM legacy_to_charge AS legacy
  WHERE pf.id = legacy.id
  RETURNING legacy.owner_id, legacy.charge_bytes
),
totals AS (
  SELECT owner_id, sum(charge_bytes)::bigint AS charge_bytes
  FROM charged
  WHERE charge_bytes > 0
  GROUP BY owner_id
)
INSERT INTO public.user_storage(user_id, bytes_used, updated_at)
SELECT owner_id, charge_bytes, now()
FROM totals
ON CONFLICT (user_id) DO UPDATE
SET bytes_used = public.user_storage.bytes_used + EXCLUDED.bytes_used,
    updated_at = now();

-- Zero-byte legacy rows still retain the canonical charge owner so future
-- cleanup remains attributable even though no counter increment is required.
UPDATE public.project_files AS pf
SET storage_owner_id = p.owner_id,
    updated_at = now()
FROM public.projects AS p
WHERE pf.project_id = p.id
  AND pf.kind IN ('file', 'image')
  AND pf.content_sha256 IS NULL
  AND pf.storage_owner_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_files_project_storage_unique
  ON public.project_files(project_id, storage_path)
  WHERE content_sha256 IS NOT NULL AND kind IN ('file', 'image');
CREATE UNIQUE INDEX IF NOT EXISTS project_files_upload_idempotency_unique
  ON public.project_files(project_id, uploaded_by, idempotency_key)
  WHERE uploaded_by IS NOT NULL AND idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_files_status_idx
  ON public.project_files(project_id, status, created_at DESC);

REVOKE INSERT, UPDATE, DELETE ON public.project_files FROM authenticated;
GRANT SELECT ON public.project_files TO authenticated;

DROP POLICY IF EXISTS "files_select_members" ON public.project_files;
DROP POLICY IF EXISTS "files_write_editors" ON public.project_files;
DROP POLICY IF EXISTS "project_files_read" ON public.project_files;
DROP POLICY IF EXISTS "project_files_write" ON public.project_files;
DROP POLICY IF EXISTS "project_files_update" ON public.project_files;
DROP POLICY IF EXISTS "project_files_delete" ON public.project_files;

CREATE POLICY "files_select_members"
ON public.project_files
FOR SELECT
TO authenticated
USING (
  status = 'ready'
  AND EXISTS (
    SELECT 1
    FROM public.project_members AS pm
    WHERE pm.project_id = project_files.project_id
      AND pm.user_id = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION public.lock_project_for_file_operation(p_file_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_project_id uuid;
BEGIN
  SELECT pf.project_id
  INTO target_project_id
  FROM public.project_files AS pf
  WHERE pf.id = p_file_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM p.id
  FROM public.projects AS p
  WHERE p.id = target_project_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN target_project_id;
END
$$;

REVOKE ALL ON FUNCTION public.lock_project_for_file_operation(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_project_for_file_operation(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_project_file_upload(
  p_user_id uuid,
  p_project_id uuid,
  p_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_kind text,
  p_extension text,
  p_content_sha256 text,
  p_idempotency_key uuid,
  p_attempt_id uuid,
  p_file_cap integer,
  p_storage_limit bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  project_owner uuid;
  member_role public.project_role;
  existing public.project_files;
  file_id uuid;
  canonical_path text;
  current_count bigint;
BEGIN
  IF p_user_id IS NULL
    OR p_project_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_attempt_id IS NULL
    OR p_name IS NULL
    OR char_length(p_name) NOT BETWEEN 1 AND 180
    OR p_mime_type IS NULL
    OR char_length(p_mime_type) NOT BETWEEN 1 AND 200
    OR p_size_bytes IS NULL
    OR p_size_bytes NOT BETWEEN 0 AND 10485760
    OR p_kind IS NULL
    OR p_kind NOT IN ('file', 'image')
    OR p_extension IS NULL
    OR p_extension !~ '^[a-z0-9]{1,12}$'
    OR p_content_sha256 IS NULL
    OR p_content_sha256 !~ '^[0-9a-f]{64}$'
    OR p_file_cap IS NULL
    OR p_file_cap NOT BETWEEN 1 AND 200
    OR p_storage_limit IS NULL
    OR p_storage_limit < 1
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_project_file_reservation';
  END IF;

  SELECT p.owner_id, pm.role
  INTO project_owner, member_role
  FROM public.projects AS p
  JOIN public.project_members AS pm
    ON pm.project_id = p.id
   AND pm.user_id = p_user_id
  WHERE p.id = p_project_id
  FOR UPDATE OF p;

  IF project_owner IS NULL OR member_role NOT IN ('owner', 'editor') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_editor_access_required';
  END IF;

  SELECT *
  INTO existing
  FROM public.project_files
  WHERE project_id = p_project_id
    AND uploaded_by = p_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing.name <> p_name
      OR existing.mime_type IS DISTINCT FROM p_mime_type
      OR existing.size_bytes <> p_size_bytes
      OR existing.kind <> p_kind
      OR existing.content_sha256 IS DISTINCT FROM p_content_sha256
    THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'project_file_idempotency_conflict';
    END IF;
    IF existing.status = 'ready' THEN
      RETURN to_jsonb(existing) || jsonb_build_object(
        'reservationCreated', false,
        'inProgress', false
      );
    END IF;
    IF existing.status = 'deleting' THEN
      RAISE EXCEPTION
        USING ERRCODE = '55000', MESSAGE = 'project_file_delete_pending';
    END IF;
    IF existing.status IN ('pending', 'upload_failed', 'cleanup_failed')
      AND existing.upload_lease_until > now()
    THEN
      RETURN to_jsonb(existing) || jsonb_build_object(
        'reservationCreated', false,
        'inProgress', true
      );
    END IF;

    SELECT count(*)
    INTO current_count
    FROM public.project_files
    WHERE project_id = p_project_id
      AND id <> existing.id
      AND (
        status IN ('ready', 'deleting')
        OR (
          status IN ('pending', 'upload_failed', 'cleanup_failed')
          AND upload_lease_until > now()
        )
      );

    IF current_count >= p_file_cap THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'project_file_limit_reached';
    END IF;

    IF NOT existing.storage_charged
      AND p_size_bytes > 0
      AND NOT public.try_add_storage_bytes(project_owner, p_size_bytes, p_storage_limit)
    THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'project_storage_limit_reached';
    END IF;

    UPDATE public.project_files
    SET status = 'pending',
        storage_owner_id = project_owner,
        storage_charged = existing.storage_charged OR p_size_bytes > 0,
        upload_attempt_id = p_attempt_id,
        upload_lease_until = now() + interval '2 minutes',
        updated_at = now()
    WHERE id = existing.id
    RETURNING * INTO existing;
    RETURN to_jsonb(existing) || jsonb_build_object(
      'reservationCreated', false,
      'inProgress', false
    );
  END IF;

  SELECT count(*)
  INTO current_count
  FROM public.project_files
  WHERE project_id = p_project_id
    AND (
      status IN ('ready', 'deleting')
      OR (
        status IN ('pending', 'upload_failed', 'cleanup_failed')
        AND upload_lease_until > now()
      )
    );

  IF current_count >= p_file_cap THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'project_file_limit_reached';
  END IF;

  IF p_size_bytes > 0
    AND NOT public.try_add_storage_bytes(project_owner, p_size_bytes, p_storage_limit)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'project_storage_limit_reached';
  END IF;

  file_id := gen_random_uuid();
  canonical_path := p_project_id::text || '/' || file_id::text || '.' || p_extension;

  INSERT INTO public.project_files (
    id, project_id, name, storage_path, mime_type, size_bytes, kind,
    uploaded_by, storage_owner_id, status, content_sha256, idempotency_key,
    upload_attempt_id, upload_lease_until, storage_charged
  )
  VALUES (
    file_id, p_project_id, p_name, canonical_path, p_mime_type, p_size_bytes, p_kind,
    p_user_id, project_owner, 'pending', p_content_sha256, p_idempotency_key,
    p_attempt_id, now() + interval '2 minutes', p_size_bytes > 0
  )
  RETURNING * INTO existing;

  RETURN to_jsonb(existing) || jsonb_build_object(
    'reservationCreated', true,
    'inProgress', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.reserve_project_file_upload(
  uuid, uuid, text, text, bigint, text, text, text, uuid, uuid, integer, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_project_file_upload(
  uuid, uuid, text, text, bigint, text, text, text, uuid, uuid, integer, bigint
) TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_project_file_upload_quota(
  p_user_id uuid,
  p_file_id uuid,
  p_attempt_id uuid,
  p_daily_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.project_files;
  target_project_id uuid;
  allowed boolean;
BEGIN
  IF p_user_id IS NULL
    OR p_file_id IS NULL
    OR p_attempt_id IS NULL
    OR p_daily_limit IS NULL
    OR p_daily_limit NOT BETWEEN 1 AND 1000000
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '22023', MESSAGE = 'invalid_project_file_quota_acquisition';
  END IF;

  target_project_id := public.lock_project_for_file_operation(p_file_id);
  IF target_project_id IS NULL THEN
    RETURN jsonb_build_object('acquired', false, 'lost', true);
  END IF;

  SELECT *
  INTO target
  FROM public.project_files
  WHERE id = p_file_id
    AND project_id = target_project_id
    AND uploaded_by = p_user_id
    AND upload_attempt_id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('acquired', false, 'lost', true);
  END IF;

  IF target.upload_quota_acquired THEN
    RETURN jsonb_build_object('acquired', true, 'limitReached', false);
  END IF;

  IF target.status <> 'pending'
    OR target.upload_lease_until IS NULL
    OR target.upload_lease_until <= now()
  THEN
    RETURN jsonb_build_object('acquired', false, 'lost', true);
  END IF;

  allowed := public.try_increment_daily_usage(
    p_user_id,
    'uploads',
    1,
    p_daily_limit
  );
  IF NOT allowed THEN
    RETURN jsonb_build_object('acquired', false, 'limitReached', true);
  END IF;

  UPDATE public.project_files
  SET upload_quota_acquired = true,
      updated_at = now()
  WHERE id = target.id;

  RETURN jsonb_build_object('acquired', true, 'limitReached', false);
END
$$;

REVOKE ALL ON FUNCTION public.acquire_project_file_upload_quota(
  uuid, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_project_file_upload_quota(
  uuid, uuid, uuid, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.set_project_file_upload_state(
  p_file_id uuid,
  p_attempt_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_project_id uuid;
  changed boolean;
BEGIN
  IF p_file_id IS NULL
    OR p_attempt_id IS NULL
    OR p_status IS NULL
    OR p_status NOT IN ('pending', 'ready', 'upload_failed', 'cleanup_failed')
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '22023', MESSAGE = 'invalid_project_file_upload_state';
  END IF;

  target_project_id := public.lock_project_for_file_operation(p_file_id);
  IF target_project_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.project_files
  SET status = p_status,
      upload_lease_until = CASE
        WHEN p_status = 'pending' THEN now() + interval '2 minutes'
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = p_file_id
    AND project_id = target_project_id
    AND upload_attempt_id = p_attempt_id
  RETURNING true INTO changed;

  RETURN coalesce(changed, false);
END
$$;

REVOKE ALL ON FUNCTION public.set_project_file_upload_state(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_file_upload_state(uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.abort_project_file_upload(
  p_file_id uuid,
  p_attempt_id uuid
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
    RETURN jsonb_build_object('aborted', false);
  END IF;

  SELECT *
  INTO target
  FROM public.project_files
  WHERE id = p_file_id
    AND project_id = target_project_id
    AND upload_attempt_id = p_attempt_id
    AND status IN ('pending', 'upload_failed', 'cleanup_failed')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('aborted', false);
  END IF;

  IF target.storage_charged AND target.storage_owner_id IS NOT NULL AND target.size_bytes > 0 THEN
    UPDATE public.user_storage
    SET bytes_used = greatest(0, bytes_used - target.size_bytes), updated_at = now()
    WHERE user_id = target.storage_owner_id;
  END IF;

  DELETE FROM public.project_files WHERE id = target.id;
  RETURN jsonb_build_object('aborted', true);
END
$$;

REVOKE ALL ON FUNCTION public.abort_project_file_upload(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abort_project_file_upload(uuid, uuid)
  TO service_role;

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
  p_attempt_id uuid
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
  IF target.storage_charged
    AND target.storage_owner_id IS NOT NULL
    AND target.size_bytes > 0
  THEN
    UPDATE public.user_storage
    SET bytes_used = greatest(0, bytes_used - target.size_bytes),
        updated_at = now()
    WHERE user_id = target.storage_owner_id;
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'idempotent', false,
    'projectId', target.project_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.finalize_stale_project_file_cleanup(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stale_project_file_cleanup(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_project_file_delete(
  p_user_id uuid,
  p_file_id uuid,
  p_attempt_id uuid
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
  IF p_user_id IS NULL OR p_file_id IS NULL OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_project_file_delete';
  END IF;

  target_project_id := public.lock_project_for_file_operation(p_file_id);
  IF target_project_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'inProgress', false);
  END IF;

  SELECT pf.*
  INTO target
  FROM public.project_files AS pf
  JOIN public.project_members AS pm
    ON pm.project_id = pf.project_id
   AND pm.user_id = p_user_id
   AND pm.role IN ('owner', 'editor')
  WHERE pf.id = p_file_id
    AND pf.project_id = target_project_id
    AND pf.status IN ('ready', 'deleting')
  FOR UPDATE OF pf;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'inProgress', false);
  END IF;

  IF target.status = 'deleting' AND target.delete_lease_until > now() THEN
    RETURN jsonb_build_object('claimed', false, 'inProgress', true);
  END IF;

  UPDATE public.project_files
  SET status = 'deleting',
      delete_attempt_id = p_attempt_id,
      delete_lease_until = now() + interval '2 minutes',
      updated_at = now()
  WHERE id = target.id
  RETURNING * INTO target;

  RETURN to_jsonb(target) || jsonb_build_object(
    'claimed', true,
    'inProgress', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.claim_project_file_delete(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_file_delete(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.restore_project_file_delete(
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
  restored boolean;
BEGIN
  target_project_id := public.lock_project_for_file_operation(p_file_id);
  IF target_project_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.project_files
  SET status = 'ready',
      delete_attempt_id = NULL,
      delete_lease_until = NULL,
      updated_at = now()
  WHERE id = p_file_id
    AND project_id = target_project_id
    AND delete_attempt_id = p_attempt_id
    AND status = 'deleting'
  RETURNING true INTO restored;

  RETURN coalesce(restored, false);
END
$$;

REVOKE ALL ON FUNCTION public.restore_project_file_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_project_file_delete(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_project_file_delete(
  p_file_id uuid,
  p_attempt_id uuid
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
    AND delete_attempt_id = p_attempt_id
    AND status = 'deleting'
  FOR UPDATE;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.project_files WHERE id = p_file_id) THEN
      RETURN jsonb_build_object('deleted', true, 'idempotent', true);
    END IF;
    RETURN jsonb_build_object('deleted', false);
  END IF;

  DELETE FROM public.project_files WHERE id = target.id;
  IF target.storage_charged AND target.storage_owner_id IS NOT NULL AND target.size_bytes > 0 THEN
    UPDATE public.user_storage
    SET bytes_used = greatest(0, bytes_used - target.size_bytes), updated_at = now()
    WHERE user_id = target.storage_owner_id;
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'idempotent', false,
    'projectId', target.project_id
  );
END
$$;

REVOKE ALL ON FUNCTION public.finalize_project_file_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_project_file_delete(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_project_storage_bytes(
  p_user_id uuid,
  p_bytes bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  remaining bigint;
BEGIN
  IF p_user_id IS NULL OR p_bytes < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_storage_release';
  END IF;

  UPDATE public.user_storage
  SET bytes_used = greatest(0, bytes_used - p_bytes), updated_at = now()
  WHERE user_id = p_user_id
  RETURNING bytes_used INTO remaining;

  RETURN coalesce(remaining, 0);
END
$$;

REVOKE ALL ON FUNCTION public.release_project_storage_bytes(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_project_storage_bytes(uuid, bigint)
  TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-files',
  'project-files',
  false,
  10485760,
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf',
    'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values',
    'application/json'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "project_files_read" ON storage.objects;
DROP POLICY IF EXISTS "project_files_write" ON storage.objects;
DROP POLICY IF EXISTS "project_files_update" ON storage.objects;
DROP POLICY IF EXISTS "project_files_delete" ON storage.objects;

CREATE POLICY "project_files_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'project-files'
  AND EXISTS (
    SELECT 1
    FROM public.project_files AS pf
    JOIN public.project_members AS pm
      ON pm.project_id = pf.project_id
     AND pm.user_id = auth.uid()
    WHERE pf.storage_path = storage.objects.name
      AND pf.status = 'ready'
      AND pf.project_id::text = (storage.foldername(storage.objects.name))[1]
  )
);
