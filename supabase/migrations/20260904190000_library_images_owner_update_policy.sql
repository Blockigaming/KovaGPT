-- Permit idempotent retries to replace only the authenticated user's own
-- object in the private Library image bucket. Storage upload with upsert=true
-- performs an UPDATE when an interrupted save already left the object behind.
DROP POLICY IF EXISTS "Users update own library images" ON storage.objects;

CREATE POLICY "Users update own library images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'library-images'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'library-images'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);
