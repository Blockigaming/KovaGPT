-- Versioned, safe production schema marker. No private rows or schema details are returned.
create table if not exists public.kova_schema_contract (
  singleton boolean primary key default true check (singleton),
  version text not null,
  applied_at timestamptz not null default now()
);
alter table public.kova_schema_contract enable row level security;
revoke all on public.kova_schema_contract from anon, authenticated;
grant select on public.kova_schema_contract to service_role;
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
