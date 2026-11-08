-- Premium is five times Standard for metered AI usage. Keep model tiers,
-- storage, concurrency, billing and the included Pro Argon Lite path unchanged.
create or replace function public.effective_user_usage_multiplier(_user_id uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
 select case when public.effective_user_plan_tier(_user_id) = 'pro' and exists (
   select 1 from public.team_members m join public.team_workspaces t on t.id=m.team_id
   where m.user_id=_user_id and m.state='active' and m.seat='premium'
     and t.premium_seats>0 and not t.billing_hold and t.status in ('active','trialing') and t.paid_until>now()
     and not exists(select 1 from public.account_deletion_fences f where f.user_id in (_user_id,t.owner_id))
 ) then 5 else 1 end
$$;
revoke all on function public.effective_user_usage_multiplier(uuid) from public,anon,authenticated;
grant execute on function public.effective_user_usage_multiplier(uuid) to service_role;

-- Pro basic chat is included, while advanced usage remains capped.
-- Preserve service-role-only access, idempotency, leases, accounting and locks.
create or replace function public.acquire_ai_generation(
  p_request_id text,p_idempotency_key text,p_user_id uuid,p_guest_ip_hash text,p_conversation_id uuid,p_mode text,p_plan text,p_premium boolean,
  p_model text,p_estimated_input bigint,p_reserved_tokens bigint,p_estimated_cost numeric,p_context_trimmed boolean,
  p_daily_limit bigint,p_monthly_limit bigint,p_premium_limit integer,p_guest_limit integer,p_global_concurrency integer,p_principal_concurrency integer,p_lease_seconds integer,
  p_period_start timestamptz,p_period_end timestamptz)
returns table(event_id uuid,decision text) language plpgsql security definer set search_path=public,pg_temp as $$
declare active_global integer; active_principal integer; used_day bigint; used_month bigint; used_premium integer; used_guest integer; new_id uuid;
begin
  if p_user_id is not null and public.effective_user_usage_multiplier(p_user_id)=5 then
    p_daily_limit := case when p_daily_limit is null then null else least(p_daily_limit::numeric*5,9223372036854775807)::bigint end;
    p_monthly_limit := case when p_monthly_limit is null then null else least(p_monthly_limit::numeric*5,9223372036854775807)::bigint end;
    p_premium_limit := case when p_premium_limit is null then null else least(p_premium_limit::bigint*5,2147483647)::integer end;
  end if;
  if (p_user_id is null)=(p_guest_ip_hash is null) then return query select null::uuid,'invalid_principal'; return; end if;
  perform pg_advisory_xact_lock(hashtextextended('kova-ai-global',0));
  if exists(select 1 from ai_usage_events where idempotency_key=p_idempotency_key and ((p_user_id is not null and user_id=p_user_id) or (p_guest_ip_hash is not null and guest_ip_hash=p_guest_ip_hash))) then
    return query select null::uuid,'duplicate'; return;
  end if;
  update ai_usage_events set status='stale',completed_at=now(),error_classification='lease_expired' where status in ('reserved','started','streaming') and lease_expires_at<now();
  select count(*) into active_global from ai_usage_events where status in ('reserved','started','streaming') and lease_expires_at>=now();
  if active_global>=p_global_concurrency then return query select null::uuid,'global_concurrency'; return; end if;
  select count(*) into active_principal from ai_usage_events where status in ('reserved','started','streaming') and lease_expires_at>=now() and ((p_user_id is not null and user_id=p_user_id) or (p_guest_ip_hash is not null and guest_ip_hash=p_guest_ip_hash));
  if active_principal>=p_principal_concurrency then return query select null::uuid,'principal_concurrency'; return; end if;
  if p_user_id is not null then
    -- Included Pro Argon Lite chat has no daily/monthly token allowance.
    if not coalesce(p_plan='pro' and p_model='kova-argon-4.6' and p_mode='instant' and p_premium=false,false) then
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_day from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed') and not (plan_tier='pro' and provider_model='kova-argon-4.6' and kova_mode='instant' and premium=false);
    select coalesce(sum(coalesce(actual_billable_tokens,reserved_tokens)),0) into used_month from ai_usage_events where user_id=p_user_id and created_at>=date_trunc('month',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed') and not (plan_tier='pro' and provider_model='kova-argon-4.6' and kova_mode='instant' and premium=false);
    if used_day+p_reserved_tokens>p_daily_limit then return query select null::uuid,'daily_tokens'; return; end if;
    if used_month+p_reserved_tokens>p_monthly_limit then return query select null::uuid,'monthly_tokens'; return; end if;
    end if;
    if p_premium then
      select count(*) into used_premium from ai_usage_events where user_id=p_user_id and premium and created_at>=p_period_start and created_at<p_period_end and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed');
      if used_premium>=p_premium_limit then return query select null::uuid,'premium_period'; return; end if;
    end if;
  else
    select count(*) into used_guest from ai_usage_events where guest_ip_hash=p_guest_ip_hash and created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc' and status not in ('quota_rejected','provider_rejected','provider_failed','accounting_failed');
    if used_guest>=p_guest_limit then return query select null::uuid,'guest_daily'; return; end if;
  end if;
  begin
    insert into ai_usage_events(request_id,idempotency_key,user_id,guest_ip_hash,conversation_id,kova_mode,plan_tier,premium,provider_model,estimated_input_tokens,reserved_tokens,estimated_cost_usd,context_trimmed,status,lease_expires_at)
    values(p_request_id,p_idempotency_key,p_user_id,p_guest_ip_hash,p_conversation_id,p_mode,p_plan,p_premium,p_model,p_estimated_input,p_reserved_tokens,p_estimated_cost,p_context_trimmed,'reserved',now()+make_interval(secs=>p_lease_seconds)) returning id into new_id;
  exception when unique_violation then return query select null::uuid,'duplicate'; return; end;
  return query select new_id,'acquired';
end $$;

revoke all on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.acquire_ai_generation(text,text,uuid,text,uuid,text,text,boolean,text,bigint,bigint,numeric,boolean,bigint,bigint,integer,integer,integer,integer,integer,timestamptz,timestamptz) to service_role;

create or replace function public.try_consume_paid_message(
  _user_id uuid, _thinking boolean, _weekly_limit integer, _short_limit integer
) returns text
language plpgsql security invoker set search_path = '' set statement_timeout = '5s' as $$
declare
  now_utc timestamp := statement_timestamp() at time zone 'UTC';
  week_start date := date_trunc('week', now_utc)::date;
  short_start timestamptz := date_bin(
    interval '5 hours', statement_timestamp(), timestamptz '1970-01-01 00:00:00+00'
  );
  weekly_count bigint;
  short_count integer;
begin
  if _user_id is null or _thinking is null
    or _weekly_limit is null or _weekly_limit not between 1 and 100000
    or (_short_limit is not null and _short_limit not between 1 and _weekly_limit) then
    raise exception 'invalid_message_allowance';
  end if;

  if public.effective_user_usage_multiplier(_user_id)=5 then
    _weekly_limit := _weekly_limit*5;
    if _short_limit is not null then _short_limit := _short_limit*5; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_user_id::text, 20261104223000));

  select coalesce(sum(case when _thinking then thinking_chats else chats - thinking_chats end), 0)
    into weekly_count
    from public.daily_usage
    where user_id = _user_id and usage_date between week_start and now_utc::date;
  if weekly_count >= _weekly_limit then
    return 'weekly';
  end if;

  if _short_limit is not null then
    select case when _thinking then thinking_messages else regular_messages end
      into short_count
      from public.message_usage_short_window
      where user_id = _user_id and window_start = short_start;
    if coalesce(short_count, 0) >= _short_limit then
      return 'five_hour';
    end if;
  end if;

  if not public.try_consume_daily_message(_user_id, _thinking, 100000, 100000) then
    raise exception 'message_reservation_unavailable';
  end if;

  insert into public.message_usage_short_window(
    user_id, window_start, regular_messages, thinking_messages
  ) values (
    _user_id, short_start, case when _thinking then 0 else 1 end, case when _thinking then 1 else 0 end
  )
  on conflict (user_id) do update set
    window_start = excluded.window_start,
    regular_messages = excluded.regular_messages + case
      when message_usage_short_window.window_start = excluded.window_start
      then message_usage_short_window.regular_messages else 0 end,
    thinking_messages = excluded.thinking_messages + case
      when message_usage_short_window.window_start = excluded.window_start
      then message_usage_short_window.thinking_messages else 0 end
  where message_usage_short_window.window_start <= excluded.window_start;

  return 'allowed';
end
$$;
revoke all on function public.try_consume_paid_message(uuid, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.try_consume_paid_message(uuid, boolean, integer, integer)
  to service_role;

create or replace function public.try_consume_daily_message(
  _user_id uuid, _thinking boolean, _regular_limit integer, _thinking_limit integer
) returns boolean
language plpgsql security invoker set search_path = '' set statement_timeout = '5s' as $$
begin
  if _user_id is null or _thinking is null
    or _regular_limit is null or _regular_limit not between 1 and 100000
    or _thinking_limit is null or _thinking_limit not between 1 and 100000 then
    raise exception 'invalid_message_allowance';
  end if;
  if public.effective_user_usage_multiplier(_user_id)=5 then
    _regular_limit := _regular_limit*5;
    _thinking_limit := _thinking_limit*5;
  end if;
  insert into public.daily_usage(user_id, usage_date, chats, thinking_chats)
    values (_user_id, (statement_timestamp() at time zone 'UTC')::date, 1, case when _thinking then 1 else 0 end)
  on conflict (user_id, usage_date) do update set
    chats = public.daily_usage.chats + 1,
    thinking_chats = public.daily_usage.thinking_chats + case when _thinking then 1 else 0 end,
    updated_at = statement_timestamp()
  where case when _thinking
    then public.daily_usage.thinking_chats < _thinking_limit
    else public.daily_usage.chats - public.daily_usage.thinking_chats < _regular_limit
  end;
  return found;
end
$$;
revoke all on function public.try_consume_daily_message(uuid,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.try_consume_daily_message(uuid,boolean,integer,integer) to service_role;


CREATE OR REPLACE FUNCTION public.try_increment_daily_usage(_user_id uuid, _kind text, _increment integer, _limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  today date := (now() AT TIME ZONE 'utc')::date;
  today_row record;
  cur_val int;
BEGIN
  IF _kind NOT IN ('images', 'chats', 'uploads', 'voice') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;
  IF _increment < 1 THEN
    RAISE EXCEPTION 'increment must be positive';
  END IF;

  IF _kind IN ('images','chats','uploads') AND _limit IS NOT NULL THEN
    _limit := least(_limit::bigint*public.effective_user_usage_multiplier(_user_id),2147483647)::integer;
  END IF;

  -- Ensure today's row exists (idempotent) then lock it.
  INSERT INTO public.daily_usage (user_id, usage_date, images, chats, uploads, voice, updated_at)
  VALUES (_user_id, today, 0, 0, 0, 0, now())
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT * INTO today_row
  FROM public.daily_usage
  WHERE user_id = _user_id AND usage_date = today
  FOR UPDATE;

  cur_val := CASE _kind
    WHEN 'images' THEN today_row.images
    WHEN 'chats' THEN today_row.chats
    WHEN 'uploads' THEN today_row.uploads
    WHEN 'voice' THEN today_row.voice
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
  WHERE user_id = _user_id AND usage_date = today;

  RETURN true;
END;
$function$;


