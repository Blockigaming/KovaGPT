
-- 1) Extend daily_usage with a 'voice' counter and update the RPC to accept it.
ALTER TABLE public.daily_usage
  ADD COLUMN IF NOT EXISTS voice integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.try_increment_daily_usage(_user_id uuid, _kind text, _increment integer, _limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'utc')::date;
  latest record;
  cur_val int;
  window_ms bigint := 24 * 60 * 60 * 1000;
BEGIN
  IF _kind NOT IN ('images', 'chats', 'uploads', 'voice') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;
  IF _increment < 1 THEN
    RAISE EXCEPTION 'increment must be positive';
  END IF;

  SELECT * INTO latest
  FROM public.daily_usage
  WHERE user_id = _user_id
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR (EXTRACT(EPOCH FROM (now() - latest.updated_at)) * 1000) >= window_ms THEN
    IF _increment > _limit THEN
      RETURN false;
    END IF;
    INSERT INTO public.daily_usage (user_id, usage_date, images, chats, uploads, voice, updated_at)
    VALUES (
      _user_id, today,
      CASE WHEN _kind = 'images' THEN _increment ELSE 0 END,
      CASE WHEN _kind = 'chats' THEN _increment ELSE 0 END,
      CASE WHEN _kind = 'uploads' THEN _increment ELSE 0 END,
      CASE WHEN _kind = 'voice' THEN _increment ELSE 0 END,
      now()
    )
    ON CONFLICT (user_id, usage_date) DO UPDATE SET
      images = CASE WHEN _kind = 'images' THEN _increment ELSE public.daily_usage.images END,
      chats = CASE WHEN _kind = 'chats' THEN _increment ELSE public.daily_usage.chats END,
      uploads = CASE WHEN _kind = 'uploads' THEN _increment ELSE public.daily_usage.uploads END,
      voice = CASE WHEN _kind = 'voice' THEN _increment ELSE public.daily_usage.voice END,
      updated_at = now();
    RETURN true;
  END IF;

  cur_val := CASE _kind
    WHEN 'images' THEN latest.images
    WHEN 'chats' THEN latest.chats
    WHEN 'uploads' THEN latest.uploads
    WHEN 'voice' THEN latest.voice
  END;

  IF COALESCE(cur_val, 0) + _increment > _limit THEN
    RETURN false;
  END IF;

  UPDATE public.daily_usage
  SET
    images = CASE WHEN _kind = 'images' THEN images + _increment ELSE images END,
    chats = CASE WHEN _kind = 'chats' THEN chats + _increment ELSE chats END,
    uploads = CASE WHEN _kind = 'uploads' THEN uploads + _increment ELSE uploads END,
    voice = CASE WHEN _kind = 'voice' THEN voice + _increment ELSE voice END,
    updated_at = now()
  WHERE user_id = latest.user_id AND usage_date = latest.usage_date;

  RETURN true;
END;
$function$;

-- 2) user_storage table - tracks cumulative bytes uploaded.
CREATE TABLE IF NOT EXISTS public.user_storage (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  bytes_used bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_storage TO authenticated;
GRANT ALL ON public.user_storage TO service_role;

ALTER TABLE public.user_storage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own storage" ON public.user_storage;
CREATE POLICY "Users can read their own storage"
  ON public.user_storage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 3) Atomic add-bytes-with-cap helper.
CREATE OR REPLACE FUNCTION public.try_add_storage_bytes(_user_id uuid, _bytes bigint, _limit bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cur bigint;
BEGIN
  IF _bytes < 0 THEN
    RAISE EXCEPTION 'bytes must be non-negative';
  END IF;
  IF _bytes = 0 THEN
    RETURN true;
  END IF;

  INSERT INTO public.user_storage (user_id, bytes_used, updated_at)
  VALUES (_user_id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT bytes_used INTO cur FROM public.user_storage WHERE user_id = _user_id FOR UPDATE;

  IF COALESCE(cur, 0) + _bytes > _limit THEN
    RETURN false;
  END IF;

  UPDATE public.user_storage
  SET bytes_used = COALESCE(bytes_used, 0) + _bytes,
      updated_at = now()
  WHERE user_id = _user_id;

  RETURN true;
END;
$function$;
