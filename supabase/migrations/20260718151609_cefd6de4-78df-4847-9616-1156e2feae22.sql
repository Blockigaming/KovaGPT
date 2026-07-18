
-- Add pinned_at to projects for pin ordering
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS projects_pinned_at_idx ON public.projects (pinned_at DESC NULLS LAST);

-- Server-side helper to check whether a user has plus/pro (live) subscription
CREATE OR REPLACE FUNCTION public.user_plan_tier(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text := 'free';
  r record;
BEGIN
  FOR r IN
    SELECT price_id, status, current_period_end
    FROM public.subscriptions
    WHERE user_id = _user_id
    ORDER BY created_at DESC
    LIMIT 5
  LOOP
    IF (r.status IN ('active','trialing','past_due')
        AND (r.current_period_end IS NULL OR r.current_period_end > now()))
       OR (r.status = 'canceled' AND r.current_period_end > now()) THEN
      IF lower(coalesce(r.price_id,'')) LIKE '%pro%' THEN
        RETURN 'pro';
      ELSIF lower(coalesce(r.price_id,'')) LIKE '%plus%' THEN
        t := 'plus';
      END IF;
    END IF;
  END LOOP;
  RETURN t;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_plan_tier(uuid) TO authenticated, service_role;
