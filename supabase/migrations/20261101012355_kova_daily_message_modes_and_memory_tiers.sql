-- Separate daily message modes without resetting existing account usage.
-- The existing total remains authoritative for older clients and tool requests.
alter table public.daily_usage
  add column thinking_chats integer not null default 0
  check (thinking_chats >= 0 and thinking_chats <= chats);

create function public.try_consume_daily_message(
  _user_id uuid, _thinking boolean, _regular_limit integer, _thinking_limit integer
) returns boolean
language plpgsql security invoker set search_path = '' set statement_timeout = '5s' as $$
begin
  if _user_id is null or _thinking is null
    or _regular_limit is null or _regular_limit not between 1 and 100000
    or _thinking_limit is null or _thinking_limit not between 1 and 100000 then
    raise exception 'invalid_message_allowance';
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

-- Existing reviewed notes are manual. Automatic refresh must never overwrite them.
alter table public.chat_memories
  add column automatic boolean not null default false,
  add column source_revision bigint;

-- Store no note content in this owner-scoped suppression list. Forgetting a
-- conversation note must also stop later automatic refreshes from recreating it.
create table public.chat_memory_automatic_blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null check(length(chat_id) between 1 and 100),
  primary key(user_id,chat_id)
);
alter table public.chat_memory_automatic_blocks enable row level security;
revoke all on public.chat_memory_automatic_blocks from public,anon,authenticated;
grant all on public.chat_memory_automatic_blocks to service_role;

create function public.persist_automatic_chat_memory(
  p_user_id uuid, p_epoch bigint, p_chat_id text, p_revision bigint,
  p_title text, p_summary text, p_message_count integer, p_stored_limit integer
) returns boolean language plpgsql security invoker set search_path = '' set statement_timeout = '5s' as $$
begin
  if p_user_id is null or p_epoch is null or p_chat_id is null
    or length(p_chat_id) not between 1 and 100 or p_revision is null or p_revision < 1
    or p_summary is null or length(p_summary) not between 1 and 1500
    or length(p_title) > 120 or p_message_count is null or p_message_count not between 4 and 30
    or p_stored_limit is null or p_stored_limit not between 1 and 1000 then
    raise exception 'invalid_automatic_memory';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  if exists(select 1 from public.account_deletion_fences where user_id=p_user_id)
    or not exists(select 1 from public.chat_memory_write_epochs where user_id=p_user_id and epoch=p_epoch) then return false; end if;
  if exists(select 1 from public.chat_memory_automatic_blocks where user_id=p_user_id and chat_id=p_chat_id) then return false; end if;
  perform 1 from public.chat_history_records where owner_id=p_user_id and id::text=p_chat_id
    and revision=p_revision and deleted_at is null for share;
  if not found then return false; end if;
  insert into public.chat_memories(user_id,chat_id,title,summary,message_count,automatic,source_revision,updated_at)
    values(p_user_id,p_chat_id,p_title,p_summary,p_message_count,true,p_revision,now())
    on conflict(user_id,chat_id) do update set title=excluded.title,summary=excluded.summary,
      message_count=excluded.message_count,source_revision=excluded.source_revision,updated_at=now()
    where public.chat_memories.automatic and public.chat_memories.source_revision < p_revision;
  if not found then return false; end if;
  delete from public.chat_memories where user_id=p_user_id and automatic and id in (
    select id from public.chat_memories where user_id=p_user_id and automatic
      order by updated_at desc,id desc offset p_stored_limit
  );
  return true;
end $$;
revoke all on function public.persist_automatic_chat_memory(uuid,bigint,text,bigint,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.persist_automatic_chat_memory(uuid,bigint,text,bigint,text,text,integer,integer) to service_role;

-- Reviewing a generated note makes it manual and stops automatic replacement.
create or replace function public.persist_chat_memory(
  p_user_id uuid,p_epoch bigint,p_chat_id text,p_title text,p_summary text,p_message_count integer
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_user_id is null or p_epoch is null or p_chat_id is null or length(p_chat_id) not between 1 and 100
    or length(p_title)>120 or p_summary is null or length(p_summary) not between 1 and 1500
    or p_message_count is null or p_message_count not between 4 and 30 then raise exception 'invalid_memory_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  if exists(select 1 from public.account_deletion_fences where user_id=p_user_id)
    or not exists(select 1 from public.chat_memory_write_epochs where user_id=p_user_id and epoch=p_epoch) then return false; end if;
  delete from public.chat_memory_automatic_blocks where user_id=p_user_id and chat_id=p_chat_id;
  insert into public.chat_memories(user_id,chat_id,title,summary,message_count,updated_at)
    values(p_user_id,p_chat_id,p_title,p_summary,p_message_count,now())
    on conflict(user_id,chat_id) do update set title=excluded.title,summary=excluded.summary,message_count=excluded.message_count,automatic=false,source_revision=null,updated_at=excluded.updated_at;
  return true;
end $$;
revoke all on function public.persist_chat_memory(uuid,bigint,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.persist_chat_memory(uuid,bigint,text,text,text,integer) to service_role;


create function public.forget_chat_memory_record(p_user_id uuid,p_record_id uuid)
returns boolean language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare target text;
begin
  if p_user_id is null or p_record_id is null then raise exception 'invalid_memory_principal'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  select chat_id into target from public.chat_memories where user_id=p_user_id and id=p_record_id;
  if not found then return false; end if;
  insert into public.chat_memory_automatic_blocks(user_id,chat_id) values(p_user_id,target) on conflict do nothing;
  return public.delete_chat_memory(p_user_id,target);
end $$;
revoke all on function public.forget_chat_memory_record(uuid,uuid) from public,anon,authenticated;
grant execute on function public.forget_chat_memory_record(uuid,uuid) to service_role;

-- Clearing saved memory also suppresses automatic recreation of those notes.
create or replace function public.delete_chat_memory(p_user_id uuid,p_chat_id text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_user_id is null or (p_chat_id is not null and (length(p_chat_id)=0 or length(p_chat_id)>100)) then raise exception 'invalid_memory_principal'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  insert into public.chat_memory_write_epochs(user_id,epoch) values(p_user_id,2)
    on conflict(user_id) do update set epoch=public.chat_memory_write_epochs.epoch+1;
  insert into public.chat_memory_automatic_blocks(user_id,chat_id)
    select user_id,chat_id from public.chat_memories where user_id=p_user_id and (p_chat_id is null or chat_id=p_chat_id)
    on conflict do nothing;
  delete from public.chat_context_summaries where user_id=p_user_id and (p_chat_id is null or chat_id::text=lower(p_chat_id));
  delete from public.chat_memories where user_id=p_user_id and (p_chat_id is null or chat_id=p_chat_id);
  return true;
end $$;
revoke all on function public.delete_chat_memory(uuid,text) from public,anon,authenticated;
grant execute on function public.delete_chat_memory(uuid,text) to service_role;


-- The scoped live installation can introduce summaries after the general
-- owned-session migration. Keep its owner policy behind the same session fence.
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='chat_context_summaries' and policyname='kova_owned_session_guard') then
    create policy kova_owned_session_guard on public.chat_context_summaries as restrictive for all to anon,authenticated
      using ((select kova_auth_guard.session_is_active()))
      with check ((select kova_auth_guard.session_is_active()));
  end if;
end $$;

-- Scoped Tasks foundations can likewise arrive after the global session fence.
do $$ begin
  if to_regclass('public.scheduled_task_copy_offers') is not null and not exists(select 1 from pg_policies where schemaname='public' and tablename='scheduled_task_copy_offers' and policyname='kova_owned_session_guard') then
    create policy kova_owned_session_guard on public.scheduled_task_copy_offers as restrictive for all to anon,authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()));
  end if;
  if to_regclass('public.scheduled_task_connection_grants') is not null and not exists(select 1 from pg_policies where schemaname='public' and tablename='scheduled_task_connection_grants' and policyname='kova_owned_session_guard') then
    create policy kova_owned_session_guard on public.scheduled_task_connection_grants as restrictive for all to anon,authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()));
  end if;
  if to_regclass('public.scheduled_task_events') is not null and not exists(select 1 from pg_policies where schemaname='public' and tablename='scheduled_task_events' and policyname='kova_owned_session_guard') then
    create policy kova_owned_session_guard on public.scheduled_task_events as restrictive for all to anon,authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()));
  end if;
end $$;
