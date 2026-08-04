CREATE TABLE IF NOT EXISTS public.ai_generation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  user_id uuid,
  guest_ip_hash text,
  conversation_id text,
  mode text NOT NULL,
  plan text NOT NULL,
  premium boolean NOT NULL DEFAULT false,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  estimated_input_tokens integer NOT NULL DEFAULT 0,
  reserved_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  actual_cost_usd numeric,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  latency_ms integer,
  tools jsonb,
  error text,
  context_trimmed boolean NOT NULL DEFAULT false,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT ai_generation_events_idempotency_key_unique UNIQUE (idempotency_key)
);

GRANT ALL ON public.ai_generation_events TO service_role;
ALTER TABLE public.ai_generation_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ai_generation_events_user_period_idx
  ON public.ai_generation_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_generation_events_guest_idx
  ON public.ai_generation_events (guest_ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_generation_events_running_idx
  ON public.ai_generation_events (status, lease_expires_at);

CREATE OR REPLACE FUNCTION public.acquire_ai_generation(
  p_request_id text,
  p_idempotency_key text,
  p_user_id uuid,
  p_guest_ip_hash text,
  p_conversation_id text,
  p_mode text,
  p_plan text,
  p_premium boolean,
  p_model text,
  p_estimated_input integer,
  p_reserved_tokens integer,
  p_estimated_cost numeric,
  p_context_trimmed boolean,
  p_daily_limit integer,
  p_monthly_limit integer,
  p_premium_limit integer,
  p_guest_limit integer,
  p_global_concurrency integer,
  p_principal_concurrency integer,
  p_lease_seconds integer,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS TABLE (event_id uuid, decision text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_id uuid;
  v_running_global integer;
  v_running_principal integer;
  v_daily integer;
  v_monthly integer;
  v_premium integer;
  v_guest integer;
BEGIN
  UPDATE public.ai_generation_events
     SET status = 'timed_out', finalized_at = v_now
   WHERE status = 'running' AND lease_expires_at < v_now;

  IF EXISTS (SELECT 1 FROM public.ai_generation_events WHERE idempotency_key = p_idempotency_key) THEN
    RETURN QUERY SELECT NULL::uuid, 'duplicate'::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_running_global
    FROM public.ai_generation_events WHERE status = 'running';
  IF v_running_global >= p_global_concurrency THEN
    RETURN QUERY SELECT NULL::uuid, 'global_concurrency'::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_running_principal
    FROM public.ai_generation_events
   WHERE status = 'running'
     AND ((p_user_id IS NOT NULL AND user_id = p_user_id)
       OR (p_user_id IS NULL AND p_guest_ip_hash IS NOT NULL AND guest_ip_hash = p_guest_ip_hash));
  IF v_running_principal >= p_principal_concurrency THEN
    RETURN QUERY SELECT NULL::uuid, 'principal_concurrency'::text;
    RETURN;
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT coalesce(sum(greatest(reserved_tokens, coalesce(input_tokens,0) + coalesce(output_tokens,0))), 0)
      INTO v_daily
      FROM public.ai_generation_events
     WHERE user_id = p_user_id AND created_at >= v_now - interval '1 day';
    IF v_daily >= p_daily_limit THEN
      RETURN QUERY SELECT NULL::uuid, 'daily_tokens'::text;
      RETURN;
    END IF;

    SELECT coalesce(sum(greatest(reserved_tokens, coalesce(input_tokens,0) + coalesce(output_tokens,0))), 0)
      INTO v_monthly
      FROM public.ai_generation_events
     WHERE user_id = p_user_id AND created_at >= p_period_start AND created_at < p_period_end;
    IF v_monthly >= p_monthly_limit THEN
      RETURN QUERY SELECT NULL::uuid, 'monthly_tokens'::text;
      RETURN;
    END IF;

    IF p_premium THEN
      SELECT count(*) INTO v_premium
        FROM public.ai_generation_events
       WHERE user_id = p_user_id AND premium
         AND created_at >= p_period_start AND created_at < p_period_end;
      IF v_premium >= p_premium_limit THEN
        RETURN QUERY SELECT NULL::uuid, 'premium_quota'::text;
        RETURN;
      END IF;
    END IF;
  ELSIF p_guest_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_guest
      FROM public.ai_generation_events
     WHERE guest_ip_hash = p_guest_ip_hash AND created_at >= v_now - interval '1 day';
    IF v_guest >= p_guest_limit THEN
      RETURN QUERY SELECT NULL::uuid, 'guest_quota'::text;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.ai_generation_events (
    request_id, idempotency_key, user_id, guest_ip_hash, conversation_id, mode, plan, premium,
    model, estimated_input_tokens, reserved_tokens, estimated_cost_usd, context_trimmed,
    period_start, period_end, lease_expires_at
  ) VALUES (
    p_request_id, p_idempotency_key, p_user_id, p_guest_ip_hash, p_conversation_id, p_mode, p_plan,
    coalesce(p_premium, false), p_model, greatest(coalesce(p_estimated_input,0),0),
    greatest(coalesce(p_reserved_tokens,0),0), greatest(coalesce(p_estimated_cost,0),0),
    coalesce(p_context_trimmed,false), p_period_start, p_period_end,
    v_now + make_interval(secs => greatest(coalesce(p_lease_seconds,120),10))
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'accepted'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_ai_generation(text,text,uuid,text,text,text,text,boolean,text,integer,integer,numeric,boolean,integer,integer,integer,integer,integer,integer,integer,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_ai_generation(text,text,uuid,text,text,text,text,boolean,text,integer,integer,numeric,boolean,integer,integer,integer,integer,integer,integer,integer,timestamptz,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_ai_generation(
  p_event_id uuid,
  p_status text,
  p_input integer,
  p_cached integer,
  p_output integer,
  p_reasoning integer,
  p_actual_cost numeric,
  p_latency integer,
  p_tools jsonb,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.ai_generation_events
     SET status = p_status,
         input_tokens = greatest(coalesce(p_input,0),0),
         cached_input_tokens = greatest(coalesce(p_cached,0),0),
         output_tokens = greatest(coalesce(p_output,0),0),
         reasoning_tokens = greatest(coalesce(p_reasoning,0),0),
         actual_cost_usd = greatest(coalesce(p_actual_cost,0),0),
         latency_ms = greatest(coalesce(p_latency,0),0),
         tools = p_tools,
         error = p_error,
         finalized_at = now()
   WHERE id = p_event_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_ai_generation(uuid,text,integer,integer,integer,integer,numeric,integer,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_ai_generation(uuid,text,integer,integer,integer,integer,numeric,integer,jsonb,text) TO service_role;