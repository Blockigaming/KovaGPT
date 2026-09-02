-- Reconcile storage contracts that earlier INSERT ... ON CONFLICT DO NOTHING
-- migrations could not update, and make future postgres-owned public tables
-- and sequences deny browser-role access until a later migration grants it explicitly.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'library-images',
  'library-images',
  false,
  8388608,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agent-evidence',
  'agent-evidence',
  false,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'text/plain', 'application/json']
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Two historical migrations created equivalent read policies under different
-- names. Replace both with one role-scoped policy without changing ownership
-- semantics or granting upload access to browser roles.
DROP POLICY IF EXISTS "agent evidence owner read" ON storage.objects;
DROP POLICY IF EXISTS "Owners read agent evidence" ON storage.objects;

CREATE POLICY "Owners read agent evidence"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'agent-evidence'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ALTER DEFAULT PRIVILEGES is owner-specific. Supabase CLI migrations create
-- public objects as postgres, so lock only that proven owner. These statements
-- affect future objects; existing grants remain untouched.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
