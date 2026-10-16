-- Local proposal only. Apply after the existing prompt tables and prior release
-- migrations, with the matched server/client. No data backfill or legacy rewrite.
CREATE OR REPLACE FUNCTION public.touch_prompt_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NOT isfinite(OLD.updated_at) THEN
    RAISE EXCEPTION 'Prompt revision is invalid; operator review required';
  END IF;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
CREATE TRIGGER prompt_templates_monotonic_revision
BEFORE UPDATE ON public.prompt_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_prompt_revision();

CREATE OR REPLACE FUNCTION public.mutate_prompt_template(
  p_prompt_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_increment_use boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  actor uuid := auth.uid();
  prior public.prompt_templates%ROWTYPE;
  saved public.prompt_templates%ROWTYPE;
  next_version integer;
  entry jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_increment_use IS NULL OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RAISE EXCEPTION 'Invalid prompt mutation' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('name','body','variables','folder','favorite')) THEN
    RAISE EXCEPTION 'Invalid prompt fields' USING ERRCODE = '22023';
  END IF;
  IF p_increment_use THEN
    IF p_changes <> '{}'::jsonb OR p_expected_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'Usage increment cannot edit content' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_expected_updated_at IS NULL OR NOT isfinite(p_expected_updated_at) OR p_changes = '{}'::jsonb THEN
      RAISE EXCEPTION 'A captured prompt revision and changes are required' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_changes ? 'name' AND (jsonb_typeof(p_changes->'name') <> 'string' OR char_length(btrim(p_changes->>'name')) NOT BETWEEN 1 AND 120) OR
     p_changes ? 'body' AND (jsonb_typeof(p_changes->'body') <> 'string' OR char_length(btrim(p_changes->>'body')) NOT BETWEEN 1 AND 12000) OR
     p_changes ? 'folder' AND (jsonb_typeof(p_changes->'folder') <> 'string' OR char_length(btrim(p_changes->>'folder')) NOT BETWEEN 1 AND 80) OR
     p_changes ? 'favorite' AND jsonb_typeof(p_changes->'favorite') <> 'boolean' THEN
    RAISE EXCEPTION 'Invalid prompt values' USING ERRCODE = '22023';
  END IF;
  IF p_changes ? 'variables' THEN
    IF jsonb_typeof(p_changes->'variables') <> 'array' THEN RAISE EXCEPTION 'Invalid prompt variables' USING ERRCODE = '22023'; END IF;
    IF jsonb_array_length(p_changes->'variables') > 30 THEN RAISE EXCEPTION 'Invalid prompt variables' USING ERRCODE = '22023'; END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(p_changes->'variables') LOOP
      IF jsonb_typeof(entry) <> 'string' OR char_length(btrim(entry #>> '{}')) NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION 'Invalid prompt variable' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  -- Every supported mutation locks this parent row before version allocation or
  -- increment. RLS and explicit owner checks both apply (no privilege bypass).
  SELECT * INTO prior FROM public.prompt_templates
    WHERE id = p_prompt_id AND user_id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prompt unavailable' USING ERRCODE = '42501'; END IF;
  IF NOT p_increment_use AND prior.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'Prompt changed. Review saved prompt before saving.' USING ERRCODE = '40001';
  END IF;
  IF NOT p_increment_use AND (
    (p_changes ? 'name' AND btrim(p_changes->>'name') IS DISTINCT FROM prior.name) OR
    (p_changes ? 'body' AND btrim(p_changes->>'body') IS DISTINCT FROM prior.body) OR
    (p_changes ? 'variables' AND p_changes->'variables' IS DISTINCT FROM prior.variables)
  ) THEN
    SELECT coalesce(max(version),0) + 1 INTO next_version FROM public.prompt_versions
      WHERE prompt_id = p_prompt_id AND user_id = actor;
    INSERT INTO public.prompt_versions(prompt_id,user_id,version,name,body,variables)
      VALUES(prior.id,actor,next_version,prior.name,prior.body,prior.variables);
  END IF;
  UPDATE public.prompt_templates SET
    name = CASE WHEN p_changes ? 'name' THEN btrim(p_changes->>'name') ELSE name END,
    body = CASE WHEN p_changes ? 'body' THEN btrim(p_changes->>'body') ELSE body END,
    variables = CASE WHEN p_changes ? 'variables' THEN p_changes->'variables' ELSE variables END,
    folder = CASE WHEN p_changes ? 'folder' THEN btrim(p_changes->>'folder') ELSE folder END,
    favorite = CASE WHEN p_changes ? 'favorite' THEN (p_changes->>'favorite')::boolean ELSE favorite END,
    use_count = use_count + CASE WHEN p_increment_use THEN 1 ELSE 0 END,
    last_used_at = CASE WHEN p_increment_use THEN clock_timestamp() ELSE last_used_at END
  WHERE id = prior.id AND user_id = actor RETURNING * INTO saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prompt update denied; revision rolled back' USING ERRCODE = '42501'; END IF;
  RETURN to_jsonb(saved) - 'user_id';
END;
$$;
REVOKE ALL ON FUNCTION public.mutate_prompt_template(uuid,timestamptz,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mutate_prompt_template(uuid,timestamptz,jsonb,boolean) TO authenticated;

-- The legacy child policies checked only child.user_id. A caller could attach
-- their own history/evaluation row to another owner's prompt via its UUID.
-- Keep existing rows and policies; add an owner-consistency restriction.
CREATE POLICY prompt_versions_parent_owner ON public.prompt_versions
AS RESTRICTIVE FOR ALL TO authenticated
USING (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.prompt_templates p WHERE p.id = prompt_versions.prompt_id AND p.user_id = auth.uid()
))
WITH CHECK (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.prompt_templates p WHERE p.id = prompt_versions.prompt_id AND p.user_id = auth.uid()
));
CREATE POLICY prompt_evaluations_parent_owner ON public.prompt_evaluations
AS RESTRICTIVE FOR ALL TO authenticated
USING (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.prompt_templates p WHERE p.id = prompt_evaluations.prompt_id AND p.user_id = auth.uid()
))
WITH CHECK (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.prompt_templates p WHERE p.id = prompt_evaluations.prompt_id AND p.user_id = auth.uid()
));
