-- Registration is a separate request from the browser's Storage upload. Read
-- authoritative ownership so account deletion also finds unregistered bytes.
-- This helper never mutates storage.objects: actual deletion uses Storage API.
CREATE OR REPLACE FUNCTION public.list_account_project_storage_objects(
  p_owner_id uuid,
  p_limit integer DEFAULT 1000
)
RETURNS TABLE(name text, owner_id text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_owner_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'invalid_account_storage_discovery_arguments' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT o.name, coalesce(o.owner_id, to_jsonb(o)->>'owner')
  FROM storage.objects AS o
  WHERE o.bucket_id = 'project-files'
    AND (
      o.owner_id = p_owner_id::text
      OR (o.owner_id IS NULL AND to_jsonb(o)->>'owner' = p_owner_id::text)
    )
  ORDER BY o.name
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_account_project_storage_objects(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_project_storage_objects(uuid, integer)
  TO service_role;
