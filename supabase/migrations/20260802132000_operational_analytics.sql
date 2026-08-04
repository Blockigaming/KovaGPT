create table if not exists public.operational_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check(char_length(event_name) between 1 and 80),
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  check(jsonb_typeof(metadata) = 'object'),
  check(octet_length(metadata::text) <= 2048)
);
alter table public.operational_events enable row level security;
drop policy if exists "Owners insert operational events" on public.operational_events;
create policy "Owners read operational events" on public.operational_events for select to authenticated using(auth.uid()=owner_id);
create policy "Owners delete operational events" on public.operational_events for delete to authenticated using(auth.uid()=owner_id);
revoke all on public.operational_events from anon;
grant select,delete on public.operational_events to authenticated;

drop function if exists public.submit_operational_events(jsonb);
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
create index if not exists operational_events_owner_time_idx on public.operational_events(owner_id,created_at desc);
create index if not exists operational_events_expiry_idx on public.operational_events(expires_at);
