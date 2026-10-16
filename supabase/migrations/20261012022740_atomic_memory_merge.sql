-- Adds a transaction boundary only. Does not modify existing memory records.
CREATE FUNCTION public.merge_memory_records(p_source text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  ids uuid[];
  keep uuid;
  expected integer;
  matched integer;
  changed integer;
  project_count integer;
  merged text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF p_source IS NULL OR p_source NOT IN ('conversation','project') OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid memory merge' USING ERRCODE='22023';
  END IF;
  expected := jsonb_array_length(p_items);
  IF expected < 2 OR expected > 30 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) item
    WHERE jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'content') IS DISTINCT FROM 'string'
      OR char_length(item->>'content') > 100000
  ) THEN RAISE EXCEPTION 'Invalid memory merge' USING ERRCODE='22023'; END IF;
  SELECT array_agg((item->>'id')::uuid ORDER BY ord) INTO ids
    FROM jsonb_array_elements(p_items) WITH ORDINALITY rows(item,ord);
  IF (SELECT count(DISTINCT id) FROM unnest(ids) id) <> expected THEN
    RAISE EXCEPTION 'Select distinct memories' USING ERRCODE='22023';
  END IF;
  keep := ids[1];
  SELECT string_agg(content,E'\n\n' ORDER BY first_ord) INTO merged FROM (
    SELECT btrim(item->>'content') content,min(ord) first_ord
    FROM jsonb_array_elements(p_items) WITH ORDINALITY rows(item,ord)
    GROUP BY btrim(item->>'content')
  ) parts;
  IF char_length(merged) > 2000 OR nullif(btrim(merged),'') IS NULL THEN
    RAISE EXCEPTION 'Merged memory must contain 1 to 2000 characters' USING ERRCODE='22023';
  END IF;
  IF p_source='conversation' THEN
    PERFORM id FROM public.chat_memories WHERE id=ANY(ids) AND user_id=actor ORDER BY id FOR UPDATE;
    SELECT count(*) INTO matched FROM public.chat_memories m
      JOIN jsonb_array_elements(p_items) item ON m.id=(item->>'id')::uuid
      WHERE m.user_id=actor AND m.summary=item->>'content';
    IF matched<>expected THEN RAISE EXCEPTION 'Memories changed or access was lost. Review before merging.' USING ERRCODE='40001'; END IF;
    UPDATE public.chat_memories SET summary=merged,updated_at=clock_timestamp() WHERE id=keep AND user_id=actor;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'Memory update denied' USING ERRCODE='42501'; END IF;
    DELETE FROM public.chat_memories WHERE id=ANY(ids) AND id<>keep AND user_id=actor;
  ELSE
    PERFORM id FROM public.project_memory WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
    SELECT count(*),count(DISTINCT m.project_id) INTO matched,project_count FROM public.project_memory m
      JOIN jsonb_array_elements(p_items) item ON m.id=(item->>'id')::uuid
      WHERE m.content=item->>'content';
    IF matched<>expected THEN RAISE EXCEPTION 'Memories changed or access was lost. Review before merging.' USING ERRCODE='40001'; END IF;
    IF project_count<>1 THEN RAISE EXCEPTION 'Select memories from the same project' USING ERRCODE='22023'; END IF;
    UPDATE public.project_memory SET content=merged WHERE id=keep;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'Memory update denied' USING ERRCODE='42501'; END IF;
    DELETE FROM public.project_memory WHERE id=ANY(ids) AND id<>keep;
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>expected-1 THEN RAISE EXCEPTION 'Memory deletion denied; merge was rolled back' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('id',keep,'content',merged,'removedIds',to_jsonb(ids[2:expected]));
END;
$$;
REVOKE ALL ON FUNCTION public.merge_memory_records(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_memory_records(text,jsonb) TO authenticated, service_role;
