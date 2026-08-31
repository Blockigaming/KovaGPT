-- Scheduled Execution v2 wall-clock and missed-run semantics.
--
-- This remains a source-only, forward migration. It does not enable the
-- scheduled-task product, deploy a worker, or apply itself to any database.

alter table public.scheduled_task_occurrences
  add column if not exists schedule_rule_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists missed_count integer not null default 0
    check (missed_count between 0 and 100000),
  add column if not exists missed_policy text
    check (missed_policy is null or missed_policy in ('coalesce_latest', 'skip')),
  add column if not exists schedule_resolution text;

create or replace function public.scheduled_time_zone_is_valid_v2(p_time_zone text)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from pg_catalog.pg_timezone_names zone
    where zone.name = p_time_zone
  );
$$;

create or replace function public.normalize_scheduled_task_rule_v2(
  p_run_at timestamptz,
  p_repeat text,
  p_time_zone text,
  p_schedule_rule jsonb default null
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_input jsonb := coalesce(p_schedule_rule, '{}'::jsonb);
  v_anchor timestamp without time zone;
  v_local_time time without time zone;
  v_iso_weekday integer;
  v_day_of_month integer;
  v_month_day_policy text;
  v_ambiguous_policy text;
  v_nonexistent_policy text;
  v_missed_policy text;
  v_lateness_grace_seconds integer;
begin
  if p_run_at is null then
    raise exception 'scheduled_task_run_at_required' using errcode = '22023';
  end if;
  if p_repeat not in ('none', 'daily', 'weekly', 'monthly') then
    raise exception 'scheduled_task_repeat_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_time_zone), '') is null
    or not public.scheduled_time_zone_is_valid_v2(p_time_zone) then
    raise exception 'scheduled_task_time_zone_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(v_input) <> 'object' then
    raise exception 'scheduled_task_rule_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_input) item(key)
    where item.key not in (
      'version',
      'local_time',
      'iso_weekday',
      'day_of_month',
      'month_day_policy',
      'ambiguous_time_policy',
      'nonexistent_time_policy',
      'missed_run_policy',
      'lateness_grace_seconds'
    )
  ) then
    raise exception 'scheduled_task_rule_unknown_field' using errcode = '22023';
  end if;

  v_anchor := p_run_at at time zone p_time_zone;

  begin
    v_local_time := coalesce(
      nullif(v_input ->> 'local_time', '')::time,
      v_anchor::time
    );
  exception
    when invalid_datetime_format then
      raise exception 'scheduled_task_local_time_invalid' using errcode = '22007';
  end;

  begin
    v_iso_weekday := coalesce(
      nullif(v_input ->> 'iso_weekday', '')::integer,
      extract(isodow from v_anchor)::integer
    );
    v_day_of_month := coalesce(
      nullif(v_input ->> 'day_of_month', '')::integer,
      extract(day from v_anchor)::integer
    );
    v_lateness_grace_seconds := coalesce(
      nullif(v_input ->> 'lateness_grace_seconds', '')::integer,
      300
    );
  exception
    when invalid_text_representation then
      raise exception 'scheduled_task_rule_number_invalid' using errcode = '22023';
  end;

  if v_iso_weekday not between 1 and 7 then
    raise exception 'scheduled_task_iso_weekday_invalid' using errcode = '22023';
  end if;
  if v_day_of_month not between 1 and 31 then
    raise exception 'scheduled_task_day_of_month_invalid' using errcode = '22023';
  end if;
  if v_lateness_grace_seconds not between 0 and 3600 then
    raise exception 'scheduled_task_lateness_grace_invalid' using errcode = '22023';
  end if;

  v_month_day_policy := coalesce(v_input ->> 'month_day_policy', 'last_day');
  v_ambiguous_policy := coalesce(v_input ->> 'ambiguous_time_policy', 'later');
  v_nonexistent_policy := coalesce(v_input ->> 'nonexistent_time_policy', 'shift_forward');
  v_missed_policy := coalesce(v_input ->> 'missed_run_policy', 'coalesce_latest');

  if v_month_day_policy not in ('last_day', 'skip') then
    raise exception 'scheduled_task_month_day_policy_invalid' using errcode = '22023';
  end if;
  if v_ambiguous_policy not in ('earlier', 'later') then
    raise exception 'scheduled_task_ambiguous_time_policy_invalid' using errcode = '22023';
  end if;
  if v_nonexistent_policy not in ('shift_forward', 'skip') then
    raise exception 'scheduled_task_nonexistent_time_policy_invalid' using errcode = '22023';
  end if;
  if v_missed_policy not in ('coalesce_latest', 'skip') then
    raise exception 'scheduled_task_missed_run_policy_invalid' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'version', 2,
    'local_time', to_char(v_local_time, 'HH24:MI:SS'),
    'iso_weekday', v_iso_weekday,
    'day_of_month', v_day_of_month,
    'month_day_policy', v_month_day_policy,
    'ambiguous_time_policy', v_ambiguous_policy,
    'nonexistent_time_policy', v_nonexistent_policy,
    'missed_run_policy', v_missed_policy,
    'lateness_grace_seconds', v_lateness_grace_seconds
  );
end;
$$;

create or replace function public.scheduled_resolve_local_v2(
  p_local timestamp without time zone,
  p_time_zone text,
  p_ambiguous_policy text default 'later',
  p_nonexistent_policy text default 'shift_forward'
)
returns table (
  resolved_at timestamptz,
  resolved_local text,
  utc_offset_minutes integer,
  resolution text
)
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_primary timestamptz;
  v_candidate timestamptz;
  v_chosen timestamptz;
  v_earlier timestamptz;
  v_later timestamptz;
  v_effective_local timestamp without time zone := p_local;
  v_delta integer;
begin
  if p_local is null
    or nullif(btrim(p_time_zone), '') is null
    or not public.scheduled_time_zone_is_valid_v2(p_time_zone) then
    raise exception 'scheduled_task_local_resolution_invalid' using errcode = '22023';
  end if;
  if p_ambiguous_policy not in ('earlier', 'later') then
    raise exception 'scheduled_task_ambiguous_time_policy_invalid' using errcode = '22023';
  end if;
  if p_nonexistent_policy not in ('shift_forward', 'skip') then
    raise exception 'scheduled_task_nonexistent_time_policy_invalid' using errcode = '22023';
  end if;

  v_primary := p_local at time zone p_time_zone;

  if (v_primary at time zone p_time_zone) <> p_local then
    if p_nonexistent_policy = 'skip' then
      return query select
        null::timestamptz,
        to_char(p_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
        null::integer,
        'skipped_nonexistent'::text;
      return;
    end if;

    v_chosen := null;
    for v_delta in 1..180 loop
      v_effective_local := p_local + make_interval(mins => v_delta);
      v_candidate := v_effective_local at time zone p_time_zone;
      if (v_candidate at time zone p_time_zone) = v_effective_local then
        v_chosen := v_candidate;
        exit;
      end if;
    end loop;

    if v_chosen is null then
      raise exception 'scheduled_task_nonexistent_time_unresolved' using errcode = '22008';
    end if;

    return query select
      v_chosen,
      to_char(v_effective_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
      round(
        extract(epoch from (v_effective_local - (v_chosen at time zone 'UTC'))) / 60
      )::integer,
      'shifted_forward'::text;
    return;
  end if;

  v_earlier := v_primary;
  v_later := v_primary;
  for v_delta in 1..180 loop
    v_candidate := v_primary - make_interval(mins => v_delta);
    if (v_candidate at time zone p_time_zone) = p_local then
      v_earlier := least(v_earlier, v_candidate);
      v_later := greatest(v_later, v_candidate);
    end if;

    v_candidate := v_primary + make_interval(mins => v_delta);
    if (v_candidate at time zone p_time_zone) = p_local then
      v_earlier := least(v_earlier, v_candidate);
      v_later := greatest(v_later, v_candidate);
    end if;
  end loop;

  if v_earlier <> v_later then
    v_chosen := case when p_ambiguous_policy = 'earlier' then v_earlier else v_later end;
    resolution := case
      when p_ambiguous_policy = 'earlier' then 'ambiguous_earlier'
      else 'ambiguous_later'
    end;
  else
    v_chosen := v_primary;
    resolution := 'exact';
  end if;

  return query select
    v_chosen,
    to_char(p_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    round(
      extract(epoch from (p_local - (v_chosen at time zone 'UTC'))) / 60
    )::integer,
    resolution;
end;
$$;

create or replace function public.scheduled_next_occurrence_v2(
  p_previous timestamptz,
  p_repeat text,
  p_time_zone text,
  p_schedule_rule jsonb
)
returns table (
  next_run_at timestamptz,
  scheduled_local text,
  utc_offset_minutes integer,
  resolution text
)
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_rule jsonb;
  v_previous_local timestamp without time zone;
  v_local_time time without time zone;
  v_candidate_date date;
  v_candidate_local timestamp without time zone;
  v_month_start date;
  v_days_in_month integer;
  v_day integer;
  v_step integer;
  v_resolved record;
begin
  if p_repeat = 'none' then
    return;
  end if;

  v_rule := public.normalize_scheduled_task_rule_v2(
    p_previous,
    p_repeat,
    p_time_zone,
    p_schedule_rule
  );
  v_previous_local := p_previous at time zone p_time_zone;
  v_local_time := (v_rule ->> 'local_time')::time;

  for v_step in 1..400 loop
    if p_repeat = 'daily' then
      v_candidate_date := v_previous_local::date + v_step;
    elsif p_repeat = 'weekly' then
      v_candidate_date := v_previous_local::date + (v_step * 7);
    elsif p_repeat = 'monthly' then
      v_month_start := (
        date_trunc('month', v_previous_local)
        + make_interval(months => v_step)
      )::date;
      v_days_in_month := extract(
        day from (v_month_start + interval '1 month - 1 day')
      )::integer;
      v_day := (v_rule ->> 'day_of_month')::integer;
      if v_day > v_days_in_month then
        if v_rule ->> 'month_day_policy' = 'skip' then
          continue;
        end if;
        v_day := v_days_in_month;
      end if;
      v_candidate_date := v_month_start + (v_day - 1);
    else
      raise exception 'scheduled_task_repeat_invalid' using errcode = '22023';
    end if;

    v_candidate_local := v_candidate_date + v_local_time;
    select * into v_resolved
    from public.scheduled_resolve_local_v2(
      v_candidate_local,
      p_time_zone,
      v_rule ->> 'ambiguous_time_policy',
      v_rule ->> 'nonexistent_time_policy'
    );

    if v_resolved.resolved_at is null then
      continue;
    end if;

    return query select
      v_resolved.resolved_at,
      v_resolved.resolved_local,
      v_resolved.utc_offset_minutes,
      v_resolved.resolution;
    return;
  end loop;

  raise exception 'scheduled_task_next_occurrence_unresolved' using errcode = '22008';
end;
$$;

create or replace function public.scheduled_coalesce_due_v2(
  p_first_due timestamptz,
  p_repeat text,
  p_time_zone text,
  p_schedule_rule jsonb,
  p_now timestamptz default now()
)
returns table (
  due_for timestamptz,
  next_after timestamptz,
  skipped_count integer,
  should_execute boolean,
  scheduled_local text,
  utc_offset_minutes integer,
  resolution text
)
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v_rule jsonb;
  v_due timestamptz := p_first_due;
  v_next timestamptz;
  v_next_row record;
  v_skipped integer := 0;
  v_iterations integer := 0;
  v_local timestamp without time zone;
  v_grace integer;
  v_policy text;
begin
  if p_first_due is null or p_now is null or p_first_due > p_now then
    raise exception 'scheduled_task_due_window_invalid' using errcode = '22023';
  end if;

  v_rule := public.normalize_scheduled_task_rule_v2(
    p_first_due,
    p_repeat,
    p_time_zone,
    p_schedule_rule
  );
  v_grace := (v_rule ->> 'lateness_grace_seconds')::integer;
  v_policy := v_rule ->> 'missed_run_policy';

  loop
    v_next := null;
    select * into v_next_row
    from public.scheduled_next_occurrence_v2(
      v_due,
      p_repeat,
      p_time_zone,
      v_rule
    );
    if found then
      v_next := v_next_row.next_run_at;
    end if;

    exit when v_next is null or v_next > p_now;
    v_due := v_next;
    v_skipped := v_skipped + 1;
    v_iterations := v_iterations + 1;
    if v_iterations > 4000 then
      raise exception 'scheduled_task_missed_window_too_large' using errcode = '54000';
    end if;
  end loop;

  v_local := v_due at time zone p_time_zone;
  due_for := v_due;
  next_after := v_next;
  scheduled_local := to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS');
  utc_offset_minutes := round(
    extract(epoch from (v_local - (v_due at time zone 'UTC'))) / 60
  )::integer;

  if v_policy = 'skip'
    and p_now > p_first_due + make_interval(secs => v_grace) then
    skipped_count := v_skipped + 1;
    should_execute := false;
    resolution := 'missed_skipped';
  else
    skipped_count := v_skipped;
    should_execute := true;
    resolution := case
      when v_skipped > 0 then 'coalesced_latest'
      else 'within_grace'
    end;
  end if;

  return next;
end;
$$;

-- Replace owner RPCs so every schedule is stored with one validated canonical
-- wall-clock rule. Existing signatures remain stable for the application.
create or replace function public.owner_create_scheduled_task_v2(
  p_title text,
  p_prompt text,
  p_run_at timestamptz,
  p_repeat text,
  p_time_zone text default 'UTC',
  p_schedule_rule jsonb default null
)
returns public.scheduled_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier text;
  v_limit integer;
  v_count integer;
  v_rule jsonb;
  v_row public.scheduled_tasks%rowtype;
begin
  if v_user_id is null then
    raise exception 'scheduled_task_auth_required' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null or length(p_title) > 200 then
    raise exception 'scheduled_task_title_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_prompt), '') is null or length(p_prompt) > 4000 then
    raise exception 'scheduled_task_prompt_invalid' using errcode = '22023';
  end if;

  v_rule := public.normalize_scheduled_task_rule_v2(
    p_run_at,
    p_repeat,
    p_time_zone,
    p_schedule_rule
  );
  v_tier := public.scheduled_task_plan_tier_v2(v_user_id);
  v_limit := public.scheduled_task_max_active_v2(v_tier);
  if v_limit = 0 then
    raise exception 'scheduled_task_paid_plan_required' using errcode = '42501';
  end if;

  select count(*) into v_count
  from public.scheduled_tasks st
  where st.user_id = v_user_id
    and st.deleted_at is null
    and st.status in ('scheduled', 'running', 'paused');
  if v_count >= v_limit then
    raise exception 'scheduled_task_plan_limit_reached' using errcode = '54000';
  end if;

  insert into public.scheduled_tasks (
    user_id,
    title,
    prompt,
    run_at,
    next_run_at,
    repeat,
    status,
    time_zone,
    schedule_rule,
    state_version
  ) values (
    v_user_id,
    btrim(p_title),
    btrim(p_prompt),
    p_run_at,
    p_run_at,
    p_repeat,
    'scheduled',
    p_time_zone,
    v_rule,
    1
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.owner_update_scheduled_task_v2(
  p_task_id uuid,
  p_title text default null,
  p_prompt text default null,
  p_run_at timestamptz default null,
  p_repeat text default null,
  p_time_zone text default null,
  p_schedule_rule jsonb default null,
  p_replace_schedule_rule boolean default false
)
returns public.scheduled_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.scheduled_tasks%rowtype;
  v_run_at timestamptz;
  v_repeat text;
  v_time_zone text;
  v_rule_input jsonb;
  v_rule jsonb;
  v_schedule_changed boolean;
begin
  if v_user_id is null then
    raise exception 'scheduled_task_auth_required' using errcode = '42501';
  end if;

  select * into v_row
  from public.scheduled_tasks
  where id = p_task_id and user_id = v_user_id and deleted_at is null
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;
  if p_title is not null and (nullif(btrim(p_title), '') is null or length(p_title) > 200) then
    raise exception 'scheduled_task_title_invalid' using errcode = '22023';
  end if;
  if p_prompt is not null and (nullif(btrim(p_prompt), '') is null or length(p_prompt) > 4000) then
    raise exception 'scheduled_task_prompt_invalid' using errcode = '22023';
  end if;

  v_run_at := coalesce(p_run_at, v_row.run_at);
  v_repeat := coalesce(p_repeat, v_row.repeat);
  v_time_zone := coalesce(p_time_zone, v_row.time_zone);
  v_rule_input := case
    when p_replace_schedule_rule then p_schedule_rule
    else v_row.schedule_rule
  end;
  v_rule := public.normalize_scheduled_task_rule_v2(
    v_run_at,
    v_repeat,
    v_time_zone,
    v_rule_input
  );
  v_schedule_changed := p_run_at is not null
    or p_repeat is not null
    or p_time_zone is not null
    or p_replace_schedule_rule;

  update public.scheduled_tasks
  set
    title = coalesce(btrim(p_title), title),
    prompt = coalesce(btrim(p_prompt), prompt),
    run_at = v_run_at,
    next_run_at = case when v_schedule_changed then v_run_at else next_run_at end,
    repeat = v_repeat,
    time_zone = v_time_zone,
    schedule_rule = v_rule,
    cancel_requested_at = case when status = 'running' then now() else null end,
    state_version = state_version + 1,
    updated_at = now()
  where id = p_task_id and user_id = v_user_id
  returning * into v_row;

  return v_row;
end;
$$;

-- Replace claim materialization so backlog behavior is explicit. Coalesce mode
-- executes only the latest due wall-clock occurrence; skip mode records one
-- missed summary occurrence and advances without spending a provider call.
create or replace function public.claim_due_scheduled_task_occurrence_v2(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  task_id uuid,
  user_id uuid,
  occurrence_id uuid,
  attempt_id uuid,
  attempt_number integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  task_state_version bigint,
  scheduled_for timestamptz,
  title text,
  prompt text,
  repeat text,
  time_zone text,
  schedule_rule jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_occ public.scheduled_task_occurrences%rowtype;
  v_attempt public.scheduled_task_attempts%rowtype;
  v_due record;
  v_scheduled_for timestamptz;
  v_attempt_number integer;
  v_lease_seconds integer;
  v_scan integer;
  v_claim_ready boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id_required' using errcode = '22023';
  end if;

  v_lease_seconds := greatest(30, least(coalesce(p_lease_seconds, 120), 900));

  for v_scan in 1..25 loop
    select st.* into v_task
    from public.scheduled_tasks st
    where st.status = 'scheduled'
      and st.deleted_at is null
      and st.cancel_requested_at is null
      and coalesce(st.retry_after, st.next_run_at, st.run_at) <= now()
      and public.scheduled_task_plan_tier_v2(st.user_id) in ('plus', 'pro')
      and not exists (
        select 1
        from public.scheduled_task_occurrences active_occ
        where active_occ.user_id = st.user_id
          and active_occ.status = 'running'
      )
    order by coalesce(st.retry_after, st.next_run_at, st.run_at), st.id
    for update skip locked
    limit 1;

    if not found then
      return;
    end if;

    if v_task.retry_occurrence_id is not null then
      select * into v_occ
      from public.scheduled_task_occurrences
      where id = v_task.retry_occurrence_id
        and task_id = v_task.id
        and user_id = v_task.user_id
        and status = 'retry_wait'
      for update;
      if not found then
        raise exception 'scheduled_retry_occurrence_missing' using errcode = '55000';
      end if;
      v_scheduled_for := v_occ.scheduled_for;
      v_claim_ready := true;
      exit;
    end if;

    select * into v_due
    from public.scheduled_coalesce_due_v2(
      coalesce(v_task.next_run_at, v_task.run_at),
      v_task.repeat,
      v_task.time_zone,
      v_task.schedule_rule,
      now()
    );

    if not v_due.should_execute then
      insert into public.scheduled_task_occurrences (
        task_id,
        user_id,
        scheduled_for,
        scheduled_local,
        time_zone,
        utc_offset_minutes,
        task_state_version,
        title_snapshot,
        prompt_snapshot,
        repeat_snapshot,
        schedule_rule_snapshot,
        status,
        missed_count,
        missed_policy,
        schedule_resolution,
        safe_error,
        completed_at
      ) values (
        v_task.id,
        v_task.user_id,
        v_due.due_for,
        v_due.scheduled_local,
        v_task.time_zone,
        v_due.utc_offset_minutes,
        v_task.state_version,
        v_task.title,
        v_task.prompt,
        v_task.repeat,
        v_task.schedule_rule,
        'missed',
        v_due.skipped_count,
        'skip',
        v_due.resolution,
        'The scheduled occurrence was skipped by the task missed-run policy.',
        now()
      )
      on conflict (task_id, scheduled_for) do update set
        updated_at = now()
      returning * into v_occ;

      update public.scheduled_tasks
      set
        status = case when v_due.next_after is null then 'completed' else 'scheduled' end,
        last_run_at = now(),
        next_run_at = v_due.next_after,
        worker_id = null,
        lease_expires_at = null,
        retry_after = null,
        retry_occurrence_id = null,
        execution_attempts = 0,
        execution_blocked_reason = 'missed_policy',
        updated_at = now()
      where id = v_task.id;

      insert into public.scheduled_task_delivery_outbox (
        occurrence_id,
        user_id,
        channel,
        event_type,
        safe_preview
      ) values (
        v_occ.id,
        v_task.user_id,
        'in_app',
        'missed',
        'A scheduled task occurrence was skipped because its run time was missed.'
      ) on conflict (occurrence_id, channel, event_type) do nothing;

      continue;
    end if;

    v_scheduled_for := v_due.due_for;
    insert into public.scheduled_task_occurrences (
      task_id,
      user_id,
      scheduled_for,
      scheduled_local,
      time_zone,
      utc_offset_minutes,
      task_state_version,
      title_snapshot,
      prompt_snapshot,
      repeat_snapshot,
      schedule_rule_snapshot,
      status,
      missed_count,
      missed_policy,
      schedule_resolution
    ) values (
      v_task.id,
      v_task.user_id,
      v_scheduled_for,
      v_due.scheduled_local,
      v_task.time_zone,
      v_due.utc_offset_minutes,
      v_task.state_version,
      v_task.title,
      v_task.prompt,
      v_task.repeat,
      v_task.schedule_rule,
      'pending',
      v_due.skipped_count,
      v_task.schedule_rule ->> 'missed_run_policy',
      v_due.resolution
    )
    on conflict (task_id, scheduled_for) do update set
      updated_at = now()
    returning * into v_occ;

    if v_occ.status not in ('pending', 'retry_wait') then
      raise exception 'scheduled_occurrence_not_claimable' using errcode = '55000';
    end if;
    v_claim_ready := true;
    exit;
  end loop;

  if not v_claim_ready then
    return;
  end if;

  select coalesce(max(attempt.attempt_number), 0) + 1
  into v_attempt_number
  from public.scheduled_task_attempts attempt
  where attempt.occurrence_id = v_occ.id;
  if v_attempt_number > 4 then
    raise exception 'scheduled_attempt_limit_reached' using errcode = '55000';
  end if;

  insert into public.scheduled_task_attempts (
    occurrence_id,
    task_id,
    user_id,
    attempt_number,
    worker_id,
    lease_expires_at
  ) values (
    v_occ.id,
    v_task.id,
    v_task.user_id,
    v_attempt_number,
    p_worker_id,
    now() + make_interval(secs => v_lease_seconds)
  ) returning * into v_attempt;

  update public.scheduled_task_occurrences
  set status = 'running', retry_after = null, updated_at = now()
  where id = v_occ.id;

  update public.scheduled_tasks
  set
    status = 'running',
    worker_id = p_worker_id,
    lease_expires_at = v_attempt.lease_expires_at,
    execution_attempts = v_attempt_number,
    retry_after = null,
    retry_occurrence_id = null,
    execution_blocked_reason = null,
    updated_at = now()
  where id = v_task.id;

  return query select
    v_task.id,
    v_task.user_id,
    v_occ.id,
    v_attempt.id,
    v_attempt.attempt_number,
    v_attempt.lease_token,
    v_attempt.lease_expires_at,
    v_occ.task_state_version,
    v_occ.scheduled_for,
    v_occ.title_snapshot,
    v_occ.prompt_snapshot,
    v_occ.repeat_snapshot,
    v_occ.time_zone,
    v_occ.schedule_rule_snapshot;
end;
$$;

-- Replace successful settlement so recurrence advances in the saved wall-clock
-- zone instead of adding fixed UTC intervals.
create or replace function public.settle_scheduled_task_success_v2(
  p_task_id uuid,
  p_occurrence_id uuid,
  p_attempt_id uuid,
  p_lease_token uuid,
  p_provider_request_id text,
  p_provider_receipt text,
  p_result text
)
returns table (
  next_run_at timestamptz,
  outbox_queued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.scheduled_tasks%rowtype;
  v_occ public.scheduled_task_occurrences%rowtype;
  v_attempt public.scheduled_task_attempts%rowtype;
  v_next timestamptz;
  v_preview text;
  v_notify boolean := true;
  v_outbox boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled_execution_forbidden' using errcode = '42501';
  end if;

  select * into v_attempt
  from public.scheduled_task_attempts
  where id = p_attempt_id
    and occurrence_id = p_occurrence_id
    and task_id = p_task_id
    and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;
  if v_attempt.status = 'succeeded' then
    select task.next_run_at into v_next
    from public.scheduled_tasks task
    where task.id = p_task_id;
    return query select v_next, exists (
      select 1
      from public.scheduled_task_delivery_outbox outbox
      where outbox.occurrence_id = p_occurrence_id
        and outbox.event_type = 'completed'
    );
    return;
  end if;
  if v_attempt.status <> 'running' or v_attempt.lease_expires_at <= now() then
    raise exception 'scheduled_execution_lease_not_owned' using errcode = '55000';
  end if;

  select * into v_occ
  from public.scheduled_task_occurrences
  where id = p_occurrence_id and task_id = p_task_id
  for update;
  if not found or v_occ.status <> 'running' then
    raise exception 'scheduled_occurrence_not_running' using errcode = '55000';
  end if;

  select * into v_task
  from public.scheduled_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception 'scheduled_task_not_found' using errcode = 'P0002';
  end if;
  if v_task.cancel_requested_at is not null or v_task.deleted_at is not null then
    raise exception 'scheduled_execution_cancel_requested' using errcode = '57014';
  end if;
  if v_task.state_version <> v_occ.task_state_version then
    raise exception 'scheduled_execution_state_changed' using errcode = '40001';
  end if;

  select next_occurrence.next_run_at into v_next
  from public.scheduled_next_occurrence_v2(
    v_occ.scheduled_for,
    v_occ.repeat_snapshot,
    v_occ.time_zone,
    v_occ.schedule_rule_snapshot
  ) next_occurrence;

  v_preview := left(
    regexp_replace(
      coalesce(nullif(btrim(p_result), ''), 'Scheduled task completed.'),
      E'[\\r\\n\\t]+',
      ' ',
      'g'
    ),
    220
  );

  update public.scheduled_task_attempts
  set
    status = 'succeeded',
    provider_request_id = nullif(left(coalesce(p_provider_request_id, ''), 200), ''),
    provider_receipt = nullif(left(coalesce(p_provider_receipt, ''), 500), ''),
    result_summary = left(coalesce(p_result, ''), 12000),
    completed_at = now()
  where id = p_attempt_id;

  update public.scheduled_task_occurrences
  set
    status = 'succeeded',
    result_summary = left(coalesce(p_result, ''), 12000),
    failure_type = null,
    safe_error = null,
    retry_after = null,
    completed_at = now(),
    updated_at = now()
  where id = p_occurrence_id;

  update public.scheduled_tasks
  set
    status = case when v_next is null then 'completed' else 'scheduled' end,
    last_run_at = now(),
    next_run_at = v_next,
    last_result = left(coalesce(p_result, ''), 12000),
    worker_id = null,
    lease_expires_at = null,
    retry_after = null,
    retry_occurrence_id = null,
    execution_attempts = 0,
    last_failure_type = null,
    last_error = null,
    updated_at = now()
  where id = p_task_id;

  select
    coalesce(preferences.in_app_enabled, true)
    and coalesce((preferences.categories ->> 'tasks')::boolean, true)
  into v_notify
  from public.notification_preferences preferences
  where preferences.user_id = v_task.user_id;
  if not found then
    v_notify := true;
  end if;

  if v_notify then
    insert into public.scheduled_task_delivery_outbox (
      occurrence_id,
      user_id,
      channel,
      event_type,
      safe_preview
    ) values (
      p_occurrence_id,
      v_task.user_id,
      'in_app',
      'completed',
      v_preview
    ) on conflict (occurrence_id, channel, event_type) do nothing;
    v_outbox := true;
  end if;

  return query select v_next, v_outbox;
end;
$$;

revoke all on function public.scheduled_time_zone_is_valid_v2(text)
  from public, anon, authenticated;
revoke all on function public.normalize_scheduled_task_rule_v2(timestamptz, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.scheduled_resolve_local_v2(timestamp without time zone, text, text, text)
  from public, anon, authenticated;
revoke all on function public.scheduled_next_occurrence_v2(timestamptz, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.scheduled_coalesce_due_v2(timestamptz, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

grant execute on function public.scheduled_time_zone_is_valid_v2(text)
  to service_role;
grant execute on function public.normalize_scheduled_task_rule_v2(timestamptz, text, text, jsonb)
  to service_role;
grant execute on function public.scheduled_resolve_local_v2(timestamp without time zone, text, text, text)
  to service_role;
grant execute on function public.scheduled_next_occurrence_v2(timestamptz, text, text, jsonb)
  to service_role;
grant execute on function public.scheduled_coalesce_due_v2(timestamptz, text, text, jsonb, timestamptz)
  to service_role;

-- Owner functions retain their previously granted authenticated execute rights.
-- Worker entry points and settlement stay service-role only through the v2 base
-- migration grants; this migration does not widen those privileges.
