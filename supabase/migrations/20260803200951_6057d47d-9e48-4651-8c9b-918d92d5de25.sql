REVOKE EXECUTE ON FUNCTION public.save_writing_document(uuid, text, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_writing_document(uuid, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_writing_document(uuid, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_writing_document(uuid, text, text, integer, text) TO service_role;

DROP POLICY IF EXISTS project_files_update ON storage.objects;
CREATE POLICY project_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'project-files' AND public.can_edit_project(((storage.foldername(name))[1])::uuid, auth.uid()))
  WITH CHECK (bucket_id = 'project-files' AND public.can_edit_project(((storage.foldername(name))[1])::uuid, auth.uid()));