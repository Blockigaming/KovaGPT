-- No existing rule content is changed. Current clients must deploy with this
-- revision-aware RPC; older unconditional SQL writers are not a safe fallback.
CREATE FUNCTION public.touch_chat_rules_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT isfinite(OLD.updated_at) THEN RAISE EXCEPTION 'Invalid saved rules revision'; END IF;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_chat_rules_revision() FROM PUBLIC;
DROP TRIGGER IF EXISTS chat_custom_rules_set_updated_at ON public.chat_custom_rules;
CREATE TRIGGER chat_custom_rules_set_updated_at BEFORE UPDATE ON public.chat_custom_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_chat_rules_revision();

CREATE FUNCTION public.compare_and_save_chat_rules(
  p_chat_id text, p_expected_updated_at timestamptz,
  p_operation text, p_instructions text, p_enabled boolean
)
RETURNS public.chat_custom_rules
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  owner uuid := auth.uid();
  saved public.chat_custom_rules%rowtype;
BEGIN
  IF owner IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(p_chat_id), '') IS NULL OR p_operation NOT IN ('save','clear','enabled')
    OR p_operation IS NULL OR p_enabled IS NULL OR char_length(coalesce(p_instructions,'')) > 8000
    OR (p_expected_updated_at IS NOT NULL AND NOT isfinite(p_expected_updated_at)) THEN
    RAISE EXCEPTION 'Invalid chat rules request' USING ERRCODE = '22023';
  END IF;
  IF p_expected_updated_at IS NULL THEN
    INSERT INTO public.chat_custom_rules(owner_id,chat_id,instructions,enabled)
      VALUES (owner,btrim(p_chat_id),CASE WHEN p_operation='save' THEN coalesce(p_instructions,'') ELSE '' END,
        CASE WHEN p_operation='clear' THEN true ELSE p_enabled END)
      ON CONFLICT (owner_id,chat_id) DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE public.chat_custom_rules SET
      instructions = CASE p_operation WHEN 'clear' THEN '' WHEN 'enabled' THEN instructions ELSE coalesce(p_instructions,'') END,
      enabled = CASE WHEN p_operation='clear' THEN true ELSE p_enabled END
      WHERE owner_id=owner AND chat_id=btrim(p_chat_id) AND updated_at=p_expected_updated_at
      RETURNING * INTO saved;
  END IF;
  IF saved.id IS NULL THEN
    RAISE EXCEPTION 'Rules changed. Review the latest saved rules before retrying.' USING ERRCODE = '40001';
  END IF;
  -- Clear retains an empty versioned record, so an old absent-record save
  -- cannot resurrect cleared instructions after the reset.
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.compare_and_save_chat_rules(text,timestamptz,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compare_and_save_chat_rules(text,timestamptz,text,text,boolean) TO authenticated, service_role;
