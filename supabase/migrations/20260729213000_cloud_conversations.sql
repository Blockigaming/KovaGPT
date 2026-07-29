-- Owner-scoped cloud history with timestamp conflict resolution and tombstones.
create table public.user_conversations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null check (char_length(conversation_id) between 1 and 200),
  payload jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  deleted boolean not null default false,
  client_updated_at bigint not null check (client_updated_at >= 0),
  server_updated_at timestamptz not null default now(),
  primary key (owner_id, conversation_id),
  check (pg_column_size(payload) <= 1572864)
);

create index user_conversations_recent_idx
  on public.user_conversations(owner_id, client_updated_at desc);

alter table public.user_conversations enable row level security;

create policy "owners read cloud conversations"
  on public.user_conversations for select to authenticated
  using (owner_id = auth.uid());
create policy "owners insert cloud conversations"
  on public.user_conversations for insert to authenticated
  with check (owner_id = auth.uid());
create policy "owners update cloud conversations"
  on public.user_conversations for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete cloud conversations"
  on public.user_conversations for delete to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on public.user_conversations to authenticated;
grant all on public.user_conversations to service_role;

create or replace function public.sync_my_conversations(p_rows jsonb)
returns table(conversation_id text, client_updated_at bigint)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50 then
    raise exception 'Invalid conversation sync batch';
  end if;

  return query
  insert into public.user_conversations as existing (
    owner_id, conversation_id, payload, archived, deleted, client_updated_at, server_updated_at
  )
  select
    auth.uid(),
    item->>'conversation_id',
    coalesce(item->'payload', '{}'::jsonb),
    coalesce((item->>'archived')::boolean, false),
    coalesce((item->>'deleted')::boolean, false),
    (item->>'client_updated_at')::bigint,
    now()
  from jsonb_array_elements(p_rows) item
  where char_length(item->>'conversation_id') between 1 and 200
    and (item->>'client_updated_at')::bigint >= 0
    and pg_column_size(coalesce(item->'payload', '{}'::jsonb)) <= 1572864
  on conflict (owner_id, conversation_id) do update set
    payload = excluded.payload,
    archived = excluded.archived,
    deleted = excluded.deleted,
    client_updated_at = excluded.client_updated_at,
    server_updated_at = now()
  where excluded.client_updated_at >= existing.client_updated_at
  returning existing.conversation_id, existing.client_updated_at;
end;
$$;

grant execute on function public.sync_my_conversations(jsonb) to authenticated;

-- Cross-device duplicate protection for saved chat outputs.
alter table public.user_library_items
  add column if not exists dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 200);
create unique index if not exists user_library_items_owner_dedupe_idx
  on public.user_library_items(user_id, dedupe_key) where dedupe_key is not null;
