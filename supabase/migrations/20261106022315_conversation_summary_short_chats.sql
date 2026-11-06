-- Permit a summary after the first completed exchange; retain ownership,
-- revision, deletion fences, manual-edit protection and existing plan limits.
create or replace function public.persist_automatic_chat_memory(
  p_user_id uuid, p_epoch bigint, p_chat_id text, p_revision bigint,
  p_title text, p_summary text, p_message_count integer, p_stored_limit integer
) returns boolean language plpgsql security invoker set search_path = '' set statement_timeout = '5s' as $$
begin
  if p_user_id is null or p_epoch is null or p_chat_id is null
    or length(p_chat_id) not between 1 and 100 or p_revision is null or p_revision < 1
    or p_summary is null or length(p_summary) not between 1 and 1500
    or length(p_title) > 120 or p_message_count is null or p_message_count not between 2 and 30
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

