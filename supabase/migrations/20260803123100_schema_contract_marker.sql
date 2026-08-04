-- Backfill schema objects added to earlier migrations before marking the contract.
create or replace function public.submit_operational_events(p_events jsonb) returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'authentication_required';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 20 then
    raise exception 'invalid_operational_event_batch';
  end if;
  with parsed as (
    select * from jsonb_to_recordset(p_events) as event(event_name text, occurred_at timestamptz, metadata jsonb)
  ), validated as (
    select
      event_name,
      occurred_at,
      coalesce(metadata, '{}'::jsonb) as metadata
    from parsed
    where event_name in ('route.viewed', 'command.executed', 'agent.imported', 'agent.exported')
      and occurred_at is not null
      and jsonb_typeof(coalesce(metadata, '{}'::jsonb)) = 'object'
      and octet_length(coalesce(metadata, '{}'::jsonb)::text) <= 2048
      and not exists (
        select 1 from jsonb_object_keys(coalesce(metadata, '{}'::jsonb)) as key(name)
        where length(key.name) > 40
          or key.name ~* '(prompt|message|document|memory|evidence|file|secret|token|url|content|error)'
          or not (
            (event_name = 'route.viewed' and key.name = 'route') or
            (event_name = 'command.executed' and key.name = 'command') or
            (event_name in ('agent.imported', 'agent.exported') and key.name = 'sourceVersion')
          )
      )
      and not exists (
        select 1 from jsonb_each(coalesce(metadata, '{}'::jsonb)) as item(key, value)
        where jsonb_typeof(item.value) not in ('string', 'number', 'boolean')
          or (jsonb_typeof(item.value) = 'string' and length(item.value #>> '{}') > 120)
      )
  )
  insert into public.operational_events(owner_id, event_name, occurred_at, metadata)
  select v_user, event_name, occurred_at, metadata from validated;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_events) then
    raise exception 'invalid_operational_event_payload';
  end if;
  return v_count;
end;
$$;
revoke all on function public.submit_operational_events(jsonb) from public, anon;
grant execute on function public.submit_operational_events(jsonb) to authenticated;

create or replace function public.kovagpt_schema_health() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'version', coalesce((select version from public.kova_schema_contract where singleton), 'missing'),
    'ready',
      to_regclass('public.user_preferences') is not null and
      to_regclass('public.projects') is not null and
      to_regclass('public.project_members') is not null and
      to_regclass('public.user_library_items') is not null and
      to_regclass('public.user_storage') is not null and
      to_regclass('public.writing_documents') is not null and
      to_regclass('public.deep_research_runs') is not null and
      to_regclass('public.scheduled_tasks') is not null and
      to_regclass('public.app_notifications') is not null and
      to_regclass('public.chat_memories') is not null and
      to_regclass('public.knowledge_relationships') is not null and
      to_regclass('public.agent_definitions') is not null and
      to_regclass('public.agent_runs') is not null and
      to_regclass('public.operational_events') is not null and
      to_regprocedure('public.submit_operational_events(jsonb)') is not null and
      to_regclass('public.processed_stripe_events') is not null and
      to_regprocedure('public.consume_diagnostic_rate_limit(text,text,integer,integer)') is not null and
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='processed_stripe_events' and column_name='event_created_at') and
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='processed_stripe_events' and column_name='customer_id') and
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='processed_stripe_events' and column_name='subscription_id') and
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='processed_stripe_events' and column_name='retryable')
  );
$$;
revoke execute on function public.kovagpt_schema_health() from public,anon,authenticated;
grant execute on function public.kovagpt_schema_health() to service_role;

-- Mark the schema contract only after all objects required by kovagpt_schema_health exist.
insert into public.kova_schema_contract(singleton,version) values(true,'20260803123000-v1')
on conflict(singleton) do update set version=excluded.version,applied_at=now();
