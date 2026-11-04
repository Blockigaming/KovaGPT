-- Retain daily_usage as the historical ledger. Keep only the current short
-- window per account, and serialize paid reservations across app replicas.
create table public.message_usage_short_window (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  regular_messages integer not null check (regular_messages >= 0),
  thinking_messages integer not null check (thinking_messages >= 0)
);
alter table public.message_usage_short_window enable row level security;
revoke all on public.message_usage_short_window from public, anon, authenticated;
grant select, insert, update on public.message_usage_short_window to service_role;

create function public.try_consume_paid_message(
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
