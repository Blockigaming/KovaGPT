-- Make Project file storage private, bounded, server-owned, and atomic with
-- project membership and per-plan count enforcement. Applying this migration
-- and creating/updating the bucket is an operator-controlled release step.

ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS storage_owner_id uuid,
  ADD COLUMN IF NOT EXISTS upload_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS upload_lease_until timestamptz,
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
      CHECK (char_length(name) BETWEEN 1 AND 180) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.project_files'::regclass
      AND conname = 'project_files_size_check'
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_size_check
      CHECK (size_bytes BETWEEN 0 AND 10485760) NOT VALID;
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
      CHECK (status IN ('pending', 'ready', 'upload_failed', 'cleanup_failed')) NOT VALID;
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
          AND storage_path ~ (
            '^' || project_id::text || '/' || id::text || E'\\.[a-z0-9]{1,12}$'
          )
        )
        OR (
          kind = 'agent-deliverable'
          AND split_part(storage_path, '/', 1) = project_id::text
        )
      ) NOT VALID;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS project_files_project_storage_unique
  ON public.project_files(project_id, storage_path);
CREATE UNIQUE INDEX IF NOT EXISTS project_files_upload_idempotency_unique
  ON public.project_files(project_id, uploaded_by, idempotency_key)
  WHERE uploaded_by IS NOT NULL AND idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_files_status_idx
  ON public.project_files(project_id, status, created_at DESC);

REVOKE INSERT, UPDATE, DELETE ON public.project_files FROM authenticated;
GRANT SELECT ON public.project_files TO authenticated;
DROP POLICY IF EXISTS "files_write_editors" ON public.project_files;

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
  p_file_cap integer
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
    OR p_size_bytes NOT BETWEEN 0 AND 10485760
    OR p_kind NOT IN ('file', 'image')
    OR p_extension !~ '^[a-z0-9]{1,12}$'
    OR p_content_sha256 !~ '^[0-9a-f]{64}$'
    OR p_file_cap NOT BETWEEN 1 AND 200
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
    IF existing.status = 'pending' AND existing.upload_lease_until > now() THEN
      RETURN to_jsonb(existing) || jsonb_build_object(
        'reservationCreated', false,
        'inProgress', true
      );
    END IF;
    UPDATE public.project_files
    SET status = 'pending',
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
    AND status IN ('pending', 'ready');

  IF current_count >= p_file_cap THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'project_file_limit_reached';
  END IF;

  file_id := gen_random_uuid();
  canonical_path := p_project_id::text || '/' || file_id::text || '.' || p_extension;

  INSERT INTO public.project_files (
    id, project_id, name, storage_path, mime_type, size_bytes, kind,
    uploaded_by, storage_owner_id, status, content_sha256, idempotency_key,
    upload_attempt_id, upload_lease_until
  )
  VALUES (
    file_id, p_project_id, p_name, canonical_path, p_mime_type, p_size_bytes, p_kind,
    p_user_id, p_user_id, 'pending', p_content_sha256, p_idempotency_key,
    p_attempt_id, now() + interval '2 minutes'
  )
  RETURNING * INTO existing;

  RETURN to_jsonb(existing) || jsonb_build_object(
    'reservationCreated', true,
    'inProgress', false
  );
END
$$;

REVOKE ALL ON FUNCTION public.reserve_project_file_upload(
  uuid, uuid, text, text, bigint, text, text, text, uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_project_file_upload(
  uuid, uuid, text, text, bigint, text, text, text, uuid, uuid, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_project_file_delete(
  p_user_id uuid,
  p_file_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.project_files;
BEGIN
  SELECT pf.*
  INTO target
  FROM public.project_files AS pf
  JOIN public.project_members AS pm
    ON pm.project_id = pf.project_id
   AND pm.user_id = p_user_id
   AND pm.role IN ('owner', 'editor')
  WHERE pf.id = p_file_id
  FOR UPDATE OF pf;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false);
  END IF;

  DELETE FROM public.project_files WHERE id = target.id;
  IF target.storage_owner_id IS NOT NULL AND target.size_bytes > 0 THEN
    UPDATE public.user_storage
    SET bytes_used = greatest(0, bytes_used - target.size_bytes), updated_at = now()
    WHERE user_id = target.storage_owner_id;
  END IF;

  RETURN jsonb_build_object('deleted', true, 'projectId', target.project_id);
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
    FROM public.project_members AS pm
    WHERE pm.project_id::text = (storage.foldername(name))[1]
      AND pm.user_id = auth.uid()
  )
);
