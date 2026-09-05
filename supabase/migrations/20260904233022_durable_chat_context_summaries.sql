-- Same-chat context summaries are admitted only by the consent-checked server.
-- Queue activation and an authenticated scheduler remain deployment-owner gates.
-- A privacy epoch fences POSTs already admitted on another device when DELETE
-- succeeds. New requests retain the existing browser-local consent contract.
create table public.chat_memory_write_epochs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  epoch bigint not null default 1 check (epoch > 0)
);
alter table public.chat_memory_write_epochs enable row level security;
revoke all on public.chat_memory_write_epochs from public,anon,authenticated;
grant all on public.chat_memory_write_epochs to service_role;

create or replace function public.begin_chat_memory_write(p_user_id uuid)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare current_epoch bigint;
begin
  if p_user_id is null then raise exception 'invalid_memory_principal'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  if exists(select 1 from public.account_deletion_fences where user_id=p_user_id) then raise exception 'account_deletion_pending'; end if;
  insert into public.chat_memory_write_epochs(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select epoch into current_epoch from public.chat_memory_write_epochs where user_id=p_user_id;
  return current_epoch;
end $$;
revoke all on function public.begin_chat_memory_write(uuid) from public,anon,authenticated;
grant execute on function public.begin_chat_memory_write(uuid) to service_role;

create table public.chat_context_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null,
  requested_revision bigint not null default 1 check (requested_revision > 0),
  requested_digest text not null check (requested_digest ~ '^[a-f0-9]{64}$'),
  requested_start integer not null check (requested_start between 0 and 1000000),
  requested_count integer not null check (requested_count between 4 and 1000000),
  input_messages jsonb not null default '[]'::jsonb check (jsonb_typeof(input_messages) = 'array' and octet_length(input_messages::text) <= 524288),
  input_previous_summary text check (char_length(input_previous_summary) <= 3000),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  input_expires_at timestamptz not null default now() + interval '24 hours',
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_summary text check (char_length(completed_summary) <= 3000),
  completed_digest text,
  completed_start integer,
  completed_count integer,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(user_id, chat_id)
);
create index chat_context_summary_due_idx on public.chat_context_summaries(next_attempt_at) where status in ('pending','processing');
alter table public.chat_context_summaries enable row level security;
revoke all on public.chat_context_summaries from public, anon, authenticated;
grant select on public.chat_context_summaries to authenticated;
grant all on public.chat_context_summaries to service_role;
create policy chat_context_summary_owner_read on public.chat_context_summaries for select to authenticated using (user_id = auth.uid());

create or replace function public.delete_chat_memory(p_user_id uuid,p_chat_id text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_user_id is null or (p_chat_id is not null and (length(p_chat_id)=0 or length(p_chat_id)>100)) then raise exception 'invalid_memory_principal'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  insert into public.chat_memory_write_epochs(user_id,epoch) values(p_user_id,2)
    on conflict(user_id) do update set epoch=public.chat_memory_write_epochs.epoch+1;
  delete from public.chat_context_summaries where user_id=p_user_id and (p_chat_id is null or chat_id::text=lower(p_chat_id));
  delete from public.chat_memories where user_id=p_user_id and (p_chat_id is null or chat_id=p_chat_id);
  return true;
end $$;
revoke all on function public.delete_chat_memory(uuid,text) from public,anon,authenticated;
grant execute on function public.delete_chat_memory(uuid,text) to service_role;

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
  insert into public.chat_memories(user_id,chat_id,title,summary,message_count,updated_at)
    values(p_user_id,p_chat_id,p_title,p_summary,p_message_count,now())
    on conflict(user_id,chat_id) do update set title=excluded.title,summary=excluded.summary,message_count=excluded.message_count,updated_at=excluded.updated_at;
  return true;
end $$;
revoke all on function public.persist_chat_memory(uuid,bigint,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.persist_chat_memory(uuid,bigint,text,text,text,integer) to service_role;

-- Beginning account deletion permanently retires current summary leases even
-- if the outer deletion later fails and releases its account fence.
create or replace function kova_private.clear_chat_memory_on_account_deletion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.delete_chat_memory(new.user_id,null);
  return new;
end $$;
revoke all on function kova_private.clear_chat_memory_on_account_deletion() from public,anon,authenticated;
grant execute on function kova_private.clear_chat_memory_on_account_deletion() to service_role;
create trigger clear_chat_memory_on_account_deletion after insert or update on public.account_deletion_fences
  for each row execute function kova_private.clear_chat_memory_on_account_deletion();

create or replace function public.queue_chat_context_summary(
  p_user_id uuid, p_epoch bigint, p_chat_id uuid, p_start integer, p_count integer, p_digest text, p_messages jsonb,
  p_base_count integer default 0,p_base_digest text default null,p_base_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.chat_context_summaries%rowtype;
  row_count integer; pending_count integer;
begin
  if p_user_id is null or p_chat_id is null or p_start is null or p_count is null or p_start < 0 or p_start + p_count > 1000000
    or p_count not between 4 and 1000000 or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    or p_messages is null or jsonb_typeof(p_messages) <> 'array' then raise exception 'invalid_chat_summary_input'; end if;
  if p_base_count is null or p_base_count < 0 or p_count-p_base_count not between 1 and 88
    or jsonb_array_length(p_messages) <> p_count-p_base_count or octet_length(p_messages::text) > 524288 then raise exception 'invalid_chat_summary_input'; end if;
  if exists(select 1 from jsonb_array_elements(p_messages) item where jsonb_typeof(item) <> 'object'
    or item->>'role' not in ('user','assistant') or item->>'role' is null
    or jsonb_typeof(item->'content') is distinct from 'string' or char_length(item->>'content') > 256) then raise exception 'invalid_chat_summary_input'; end if;
  -- Serialize admission, privacy deletion, and the account-deletion fence.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  if exists(select 1 from public.account_deletion_fences where user_id=p_user_id)
    or not exists(select 1 from public.chat_memory_write_epochs where user_id=p_user_id and epoch=p_epoch) then return null; end if;
  select * into current_row from public.chat_context_summaries where user_id = p_user_id and chat_id = p_chat_id for update;
  if p_base_count > 0 and (current_row.id is distinct from p_base_id or current_row.completed_count is distinct from p_base_count
    or current_row.completed_digest is distinct from p_base_digest or current_row.completed_start is distinct from p_start
    or current_row.completed_summary is null) then return null; end if;
  if current_row.id is null or current_row.requested_digest is distinct from p_digest or current_row.requested_start is distinct from p_start then
    select count(*), count(*) filter(where status in ('pending','processing')) into row_count,pending_count from public.chat_context_summaries where user_id = p_user_id;
    if (current_row.id is null and row_count >= 250) or (coalesce(current_row.status, '') not in ('pending','processing') and pending_count >= 8) then
      -- Foreground chat remains usable with whatever verified summary already exists.
      null;
    elsif current_row.id is null then
      insert into public.chat_context_summaries(user_id,chat_id,requested_digest,requested_start,requested_count,input_messages)
      values(p_user_id,p_chat_id,p_digest,p_start,p_count,p_messages) returning * into current_row;
    else
      update public.chat_context_summaries set requested_revision=requested_revision+1,requested_digest=p_digest,
        requested_start=p_start,requested_count=p_count,input_messages=p_messages,
        input_previous_summary=case when p_base_count > 0 then current_row.completed_summary else null end,status='pending',attempts=0,
        lease_token=null,lease_expires_at=null,next_attempt_at=now(),input_expires_at=now()+interval '24 hours',updated_at=now()
      where id=current_row.id returning * into current_row;
    end if;
  end if;
  if current_row.id is null then return null; end if;
  return jsonb_build_object('id',current_row.id,'completed_summary',current_row.completed_summary,
    'completed_digest',current_row.completed_digest,'completed_start',current_row.completed_start,
    'completed_count',current_row.completed_count,'completed_at',current_row.completed_at);
end $$;

create or replace function public.purge_expired_chat_context_inputs()
returns integer language plpgsql security invoker set search_path = '' as $$
declare purged integer;
begin
  -- Clear expired raw input, including leases abandoned on the final attempt.
  with candidates as (
    select id from public.chat_context_summaries where status in ('pending','processing')
      and (input_expires_at <= now() or (attempts >= 3 and (lease_expires_at is null or lease_expires_at <= now())))
    order by input_expires_at,id for update skip locked limit 500
  ) update public.chat_context_summaries s set status='failed',input_messages='[]'::jsonb,input_previous_summary=null,lease_token=null,lease_expires_at=null,updated_at=now()
    from candidates c where s.id=c.id;
  get diagnostics purged=row_count;
  return purged;
end $$;
revoke all on function public.purge_expired_chat_context_inputs() from public,anon,authenticated;
grant execute on function public.purge_expired_chat_context_inputs() to service_role;

create or replace function public.claim_chat_context_summaries(p_limit integer default 2)
returns setof public.chat_context_summaries language plpgsql security invoker set search_path = '' as $$
begin
  return query
    with candidates as (
      select id from public.chat_context_summaries
      where attempts < 3 and input_expires_at > now() and next_attempt_at <= now()
        and (status='pending' or (status='processing' and lease_expires_at <= now()))
        and not exists(select 1 from public.account_deletion_fences fence where fence.user_id=chat_context_summaries.user_id)
      order by next_attempt_at,id for update skip locked limit greatest(0,least(coalesce(p_limit,2),2))
    )
    update public.chat_context_summaries s set status='processing',attempts=s.attempts+1,
      lease_token=gen_random_uuid(),lease_expires_at=now()+interval '180 seconds',updated_at=now()
    from candidates c where s.id=c.id returning s.*;
end $$;

create or replace function public.settle_chat_context_summary(p_id uuid,p_revision bigint,p_lease uuid,p_summary text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_row public.chat_context_summaries%rowtype;
begin
  select * into current_row from public.chat_context_summaries where id=p_id for update;
  if current_row.id is null or current_row.requested_revision is distinct from p_revision or current_row.lease_token is distinct from p_lease
    or current_row.status <> 'processing' or current_row.lease_expires_at <= now() or current_row.input_expires_at <= now() then return false; end if;
  if p_summary is not null and (char_length(btrim(p_summary)) = 0 or char_length(p_summary) > 3000) then raise exception 'invalid_chat_summary_output'; end if;
  if p_summary is not null then
    update public.chat_context_summaries set status='completed',completed_summary=p_summary,
      completed_digest=requested_digest,completed_start=requested_start,completed_count=requested_count,completed_at=now(),
      input_messages='[]'::jsonb,input_previous_summary=null,lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id;
  else
    update public.chat_context_summaries set status=case when attempts >= 3 then 'failed' else 'pending' end,
      input_messages=case when attempts >= 3 then '[]'::jsonb else input_messages end,
      input_previous_summary=case when attempts >= 3 then null else input_previous_summary end,
      next_attempt_at=now()+make_interval(secs => (30*power(2,attempts-1))::integer),
      lease_token=null,lease_expires_at=null,updated_at=now() where id=p_id;
  end if;
  return true;
end $$;

revoke all on function public.queue_chat_context_summary(uuid,bigint,uuid,integer,integer,text,jsonb,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.claim_chat_context_summaries(integer) from public,anon,authenticated;
revoke all on function public.settle_chat_context_summary(uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.queue_chat_context_summary(uuid,bigint,uuid,integer,integer,text,jsonb,integer,text,uuid) to service_role;
grant execute on function public.claim_chat_context_summaries(integer) to service_role;
grant execute on function public.settle_chat_context_summary(uuid,bigint,uuid,text) to service_role;
