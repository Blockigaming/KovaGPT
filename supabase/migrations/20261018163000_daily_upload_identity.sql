-- Source-only migration: same UTC-day counter, idempotent across chat and Library auto-save.
CREATE TABLE public.daily_upload_fingerprints (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 usage_date date NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(user_id,usage_date,fingerprint)
);
ALTER TABLE public.daily_upload_fingerprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_upload_fingerprints FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,DELETE ON public.daily_upload_fingerprints TO service_role;
CREATE FUNCTION public.try_reserve_daily_uploads(_user_id uuid,_fingerprints text[],_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE today date := (now() AT TIME ZONE 'utc')::date; unseen text[];
BEGIN
 IF _user_id IS NULL OR _limit IS NULL OR _limit<0 OR _fingerprints IS NULL OR cardinality(_fingerprints) NOT BETWEEN 1 AND 20
 OR EXISTS(SELECT 1 FROM unnest(_fingerprints) f WHERE f IS NULL OR f !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'upload_quota_invalid'; END IF;
 INSERT INTO public.daily_usage(user_id,usage_date,images,chats,uploads,voice,updated_at)
 VALUES(_user_id,today,0,0,0,0,now()) ON CONFLICT(user_id,usage_date) DO NOTHING;
 PERFORM 1 FROM public.daily_usage WHERE user_id=_user_id AND usage_date=today FOR UPDATE;
 SELECT array_agg(f) INTO unseen FROM (SELECT DISTINCT f FROM unnest(_fingerprints) f
 WHERE NOT EXISTS(SELECT 1 FROM public.daily_upload_fingerprints u WHERE u.user_id=_user_id AND u.usage_date=today AND u.fingerprint=f)) missing;
 IF coalesce(cardinality(unseen),0)=0 THEN RETURN true; END IF;
 IF NOT public.try_increment_daily_usage(_user_id,'uploads',cardinality(unseen),_limit) THEN RETURN false; END IF;
 INSERT INTO public.daily_upload_fingerprints(user_id,usage_date,fingerprint) SELECT _user_id,today,f FROM unnest(unseen) f;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.try_reserve_daily_uploads(uuid,text[],integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.try_reserve_daily_uploads(uuid,text[],integer) TO service_role;
