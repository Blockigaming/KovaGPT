-- RLS policies on storage.objects for the private library-images bucket.
-- Path convention: <auth.uid()>/<filename>. First folder must equal user id.

CREATE POLICY "Users read own library images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'library-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users upload to own library folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'library-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users delete own library images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'library-images'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
