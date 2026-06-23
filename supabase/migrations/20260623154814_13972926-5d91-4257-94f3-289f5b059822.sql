
CREATE OR REPLACE FUNCTION public.try_increment_daily_usage(
  _user_id uuid,
  _kind text,
  _increment int,
  _limit int
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today date := (now() AT TIME ZONE 'utc')::date;
  latest record;
  cur_val int;
  window_ms bigint := 24 * 60 * 60 * 1000;
BEGIN
  IF _kind NOT IN ('images', 'chats', 'uploads') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;
  IF _increment < 1 THEN
    RAISE EXCEPTION 'increment must be positive';
  END IF;

  -- Lock the most recent row for this user (if any) to serialize concurrent calls.
  SELECT * INTO latest
  FROM public.daily_usage
  WHERE user_id = _user_id
  ORDER BY updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR (EXTRACT(EPOCH FROM (now() - latest.updated_at)) * 1000) >= window_ms THEN
    -- Window expired or no row: start a fresh window for today.
    IF _increment > _limit THEN
      RETURN false;
    END IF;
    INSERT INTO public.daily_usage (user_id, usage_date, images, chats, uploads, updated_at)
    VALUES (
      _user_id, today,
      CASE WHEN _kind = 'images' THEN _increment ELSE 0 END,
      CASE WHEN _kind = 'chats' THEN _increment ELSE 0 END,
      CASE WHEN _kind = 'uploads' THEN _increment ELSE 0 END,
      now()
    )
    ON CONFLICT (user_id, usage_date) DO UPDATE SET
      images = CASE WHEN _kind = 'images' THEN _increment ELSE public.daily_usage.images END,
      chats = CASE WHEN _kind = 'chats' THEN _increment ELSE public.daily_usage.chats END,
      uploads = CASE WHEN _kind = 'uploads' THEN _increment ELSE public.daily_usage.uploads END,
      updated_at = now();
    RETURN true;
  END IF;

  cur_val := CASE _kind
    WHEN 'images' THEN latest.images
    WHEN 'chats' THEN latest.chats
    WHEN 'uploads' THEN latest.uploads
  END;

  IF COALESCE(cur_val, 0) + _increment > _limit THEN
    RETURN false;
  END IF;

  UPDATE public.daily_usage
  SET
    images = CASE WHEN _kind = 'images' THEN images + _increment ELSE images END,
    chats = CASE WHEN _kind = 'chats' THEN chats + _increment ELSE chats END,
    uploads = CASE WHEN _kind = 'uploads' THEN uploads + _increment ELSE uploads END,
    updated_at = now()
  WHERE user_id = latest.user_id AND usage_date = latest.usage_date;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.try_increment_daily_usage(uuid, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_increment_daily_usage(uuid, text, int, int) TO service_role;

-- Ensure the upsert ON CONFLICT target exists.
CREATE UNIQUE INDEX IF NOT EXISTS daily_usage_user_date_uidx
  ON public.daily_usage (user_id, usage_date);
