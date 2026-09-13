-- Historical browser controls remain available while both legacy queues stay disabled.
-- Approval provenance is service-owned; no legacy freeform payload is backfilled.
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_id_owner_control_key ON public.agent_runs(id,owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS integration_approvals_id_owner_control_key ON public.integration_action_approvals(id,owner_id);
CREATE TABLE public.agent_run_approval_bindings (
  approval_id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(run_id,owner_id) REFERENCES public.agent_runs(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(approval_id,owner_id) REFERENCES public.integration_action_approvals(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX agent_run_approval_bindings_run_idx ON public.agent_run_approval_bindings(run_id,owner_id);
ALTER TABLE public.agent_run_approval_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_run_approval_bindings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON public.agent_run_approval_bindings TO service_role;

CREATE SCHEMA IF NOT EXISTS kova_private;
REVOKE ALL ON SCHEMA kova_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA kova_private TO authenticated;
CREATE FUNCTION kova_private.control_disabled_browser_run(p_run_id uuid,p_command text,p_approval_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  principal uuid:=auth.uid();
  prior_status text;
  next_status text;
  approval_status text;
  now_at timestamptz:=now();
BEGIN
  IF principal IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF p_command IS NULL OR p_command NOT IN ('pause','cancel','deny') THEN
    RAISE EXCEPTION 'browser_agent_unavailable' USING ERRCODE='0A000';
  END IF;
  IF (p_command='deny') IS DISTINCT FROM (p_approval_id IS NOT NULL) THEN
    RAISE EXCEPTION 'approval_id_required' USING ERRCODE='22023';
  END IF;
  SELECT status INTO prior_status FROM public.agent_runs
    WHERE id=p_run_id AND owner_id=principal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_run_not_found' USING ERRCODE='P0002'; END IF;
  IF prior_status IN ('completed','failed') OR (prior_status='cancelled' AND p_command='pause') THEN
    RAISE EXCEPTION 'agent_run_not_cancellable' USING ERRCODE='40001';
  END IF;
  IF p_command='pause' AND prior_status NOT IN ('queued','leased','planning','running','retry_wait','paused') THEN
    RAISE EXCEPTION 'agent_run_not_cancellable' USING ERRCODE='40001';
  END IF;
  IF p_command='deny' THEN
    SELECT a.status INTO approval_status FROM public.agent_run_approval_bindings b
      JOIN public.integration_action_approvals a ON a.id=b.approval_id AND a.owner_id=b.owner_id
      WHERE b.approval_id=p_approval_id AND b.run_id=p_run_id AND b.owner_id=principal
      FOR UPDATE OF a,b;
    IF NOT FOUND OR approval_status NOT IN ('pending','denied')
      OR prior_status NOT IN ('approval_needed','cancelled') THEN
      RAISE EXCEPTION 'approval_not_pending' USING ERRCODE='40001';
    END IF;
  END IF;
  next_status:=CASE WHEN p_command='pause' THEN 'paused' ELSE 'cancelled' END;
  IF next_status='cancelled' THEN
    -- Invalidate only independently bound approvals. Unbound legacy integration
    -- approvals may belong to unrelated actions and are never guessed at.
    UPDATE public.integration_action_approvals a SET status='denied',decided_at=coalesce(a.decided_at,now_at)
      FROM public.agent_run_approval_bindings b
      WHERE b.run_id=p_run_id AND b.owner_id=principal AND a.id=b.approval_id
        AND a.owner_id=principal AND a.status='pending';
    UPDATE public.agent_run_tasks SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,
      completed_at=coalesce(completed_at,now_at),updated_at=now_at
      WHERE run_id=p_run_id AND owner_id=principal
        AND status IN ('waiting','queued','leased','running','approval_needed','retry_wait','blocked');
  END IF;
  UPDATE public.agent_runs SET status=next_status,available_at=now_at,lease_owner=NULL,lease_expires_at=NULL,
    cancelled_at=CASE WHEN next_status='cancelled' THEN coalesce(cancelled_at,now_at) ELSE cancelled_at END,
    cancellation_category=CASE WHEN prior_status='cancelled' THEN cancellation_category
      WHEN p_command='deny' THEN 'approval_denied' WHEN p_command='cancel' THEN 'user_requested'
      ELSE cancellation_category END,updated_at=now_at
    WHERE id=p_run_id AND owner_id=principal;
  IF prior_status<>next_status OR NOT EXISTS(
    SELECT 1 FROM public.agent_run_events WHERE run_id=p_run_id AND owner_id=principal
      AND safe_payload->>'control_protocol'='legacy-browser-v1'
      AND safe_payload->>'result'=next_status
      AND (p_command<>'deny' OR safe_payload->>'approval_id'=p_approval_id::text)
  ) THEN
    INSERT INTO public.agent_run_events(run_id,owner_id,kind,safe_payload)
      VALUES(p_run_id,principal,CASE WHEN p_command='deny' THEN 'approval' ELSE 'log' END,
        jsonb_build_object('control_protocol','legacy-browser-v1','command',p_command,'result',next_status,
          'execution_enabled',false,'approval_id',p_approval_id));
  END IF;
  RETURN jsonb_build_object('status',next_status,'auditRecorded',true,'idempotent',prior_status=next_status);
END; $$;
REVOKE ALL ON FUNCTION kova_private.control_disabled_browser_run(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION kova_private.control_disabled_browser_run(uuid,text,uuid) TO authenticated;
CREATE FUNCTION public.control_disabled_browser_run(p_run_id uuid,p_command text,p_approval_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT kova_private.control_disabled_browser_run(p_run_id,p_command,p_approval_id)
$$;
REVOKE ALL ON FUNCTION public.control_disabled_browser_run(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.control_disabled_browser_run(uuid,text,uuid) TO authenticated;
