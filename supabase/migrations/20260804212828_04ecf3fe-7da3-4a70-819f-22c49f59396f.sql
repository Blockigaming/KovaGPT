CREATE OR REPLACE FUNCTION public.family_owner_of(_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT g.owner_id INTO v_owner
  FROM public.family_members m
  JOIN public.family_groups g ON g.id = m.group_id
  WHERE m.user_id = _user_id
  LIMIT 1;
  RETURN v_owner;
END;
$function$;

CREATE OR REPLACE FUNCTION public.user_plan_tier(_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t text := 'free';
  r record;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.family_owner_of(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_plan_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_owner_of(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_plan_tier(uuid) TO authenticated, service_role;