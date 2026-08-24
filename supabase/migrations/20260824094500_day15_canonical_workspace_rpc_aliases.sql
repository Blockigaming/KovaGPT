-- Day 15: canonical chat-workspace RPC names.
--
-- Production already exposes the canonical, atomic functions
-- (create_chat_message_version, accept_chat_message_version,
-- create_chat_branch, activate_chat_branch, save_chat_custom_rules,
-- delete_chat_custom_rules, pin_chat_source, unpin_chat_source,
-- get_chat_workspace_state, get_chat_context_bundle). Those implementations are
-- authoritative and this migration never replaces them.
--
-- Databases provisioned with the earlier kova_-prefixed spelling get thin
-- canonical aliases so one client contract works everywhere. Every alias is
-- created only when the canonical name is absent, is SECURITY DEFINER with a
-- fixed search_path, and is executable by authenticated/service_role only.

DO $migration$
DECLARE
  has_legacy boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'kova_record_message_version'
  ) INTO has_legacy;

  IF NOT has_legacy THEN
    RAISE NOTICE 'No legacy kova_ workspace functions; canonical functions are expected to exist already.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_chat_message_version'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.create_chat_message_version(
        p_chat_id text,
        p_message_id text,
        p_content text,
        p_original_content text DEFAULT NULL,
        p_instruction text DEFAULT NULL,
        p_source text DEFAULT 'inline_edit',
        p_branch_id uuid DEFAULT NULL,
        p_selection_start integer DEFAULT NULL,
        p_selection_end integer DEFAULT NULL,
        p_accept boolean DEFAULT true
      ) RETURNS public.chat_message_versions
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS 'SELECT public.kova_record_message_version(p_chat_id, p_message_id, p_source, p_content, p_branch_id, p_instruction, p_original_content, p_selection_start, p_selection_end, p_accept, 50)';
    $fn$;
    REVOKE ALL ON FUNCTION public.create_chat_message_version(text, text, text, text, text, text, uuid, integer, integer, boolean) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.create_chat_message_version(text, text, text, text, text, text, uuid, integer, integer, boolean) TO authenticated, service_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'accept_chat_message_version'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.accept_chat_message_version(p_version_id uuid)
      RETURNS public.chat_message_versions
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS 'SELECT public.kova_accept_message_version(p_version_id)';
    $fn$;
    REVOKE ALL ON FUNCTION public.accept_chat_message_version(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.accept_chat_message_version(uuid) TO authenticated, service_role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'activate_chat_branch'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.activate_chat_branch(p_branch_id uuid)
      RETURNS public.chat_branches
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_chat_id text;
      BEGIN
        SELECT chat_id INTO v_chat_id
        FROM public.chat_branches
        WHERE id = p_branch_id AND owner_id = auth.uid();
        IF v_chat_id IS NULL THEN
          RAISE EXCEPTION 'branch_not_found';
        END IF;
        RETURN public.kova_activate_chat_branch(v_chat_id, p_branch_id);
      END;
      $body$;
    $fn$;
    REVOKE ALL ON FUNCTION public.activate_chat_branch(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.activate_chat_branch(uuid) TO authenticated, service_role;
  END IF;
END
$migration$;
