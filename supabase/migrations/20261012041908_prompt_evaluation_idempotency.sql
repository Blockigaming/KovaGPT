-- Unapplied local proposal. Legacy evaluations remain unchanged (NULL request_id).
ALTER TABLE public.prompt_evaluations ADD COLUMN request_id uuid;
CREATE UNIQUE INDEX prompt_evaluations_owner_request_key
ON public.prompt_evaluations(user_id,request_id) WHERE request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.record_prompt_evaluation(
  p_request_id uuid, p_prompt_id uuid, p_rating integer, p_notes text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); saved public.prompt_evaluations%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_prompt_id IS NULL OR p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5
     OR p_notes IS NULL OR char_length(p_notes)>2000 THEN
    RAISE EXCEPTION 'Invalid evaluation' USING ERRCODE='22023';
  END IF;
  -- Serialize the same owner/request even when no receipt exists yet. A hash
  -- collision only serializes unrelated work; full owner/key comparisons follow.
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_request_id::text,0));
  PERFORM 1 FROM public.prompt_templates WHERE id=p_prompt_id AND user_id=actor FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prompt unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO saved FROM public.prompt_evaluations WHERE user_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF saved.prompt_id <> p_prompt_id OR saved.rating <> p_rating OR saved.notes <> p_notes THEN
      RAISE EXCEPTION 'Evaluation request identity was reused with different content' USING ERRCODE='22023';
    END IF;
    RETURN to_jsonb(saved)-'user_id';
  END IF;
  INSERT INTO public.prompt_evaluations(user_id,prompt_id,rating,notes,request_id)
    VALUES(actor,p_prompt_id,p_rating,p_notes,p_request_id) RETURNING * INTO saved;
  RETURN to_jsonb(saved)-'user_id';
END;
$$;
REVOKE ALL ON FUNCTION public.record_prompt_evaluation(uuid,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_prompt_evaluation(uuid,uuid,integer,text) TO authenticated;
