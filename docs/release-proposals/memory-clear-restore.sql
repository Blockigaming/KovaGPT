-- UNAPPLIED proposal. Canonical migration history and activation are owner gates.
-- The CLI cannot create a migration in this executor (read-only default home).
-- Reversible clear affects saved cross-chat memories only, never project context.
create table kova_private.memory_clear_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  state text not null check(state in ('active','restored','dismissed','expired','retired')),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  removed_count integer not null default 0, restored_count integer not null default 0,
  skipped_count integer not null default 0,
  primary key(user_id,operation_id)
);
create table kova_private.memory_clear_items (
  user_id uuid not null, operation_id uuid not null, chat_id text not null,
  snapshot jsonb not null, removed_revision uuid,
  primary key(user_id,operation_id,chat_id),
  foreign key(user_id,operation_id) references kova_private.memory_clear_operations on delete cascade
);
create table kova_private.memory_target_revisions (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null, revision uuid not null,
  primary key(user_id,chat_id)
);
alter table kova_private.memory_clear_operations enable row level security;
alter table kova_private.memory_clear_items enable row level security;
alter table kova_private.memory_target_revisions enable row level security;
revoke all on kova_private.memory_clear_operations,kova_private.memory_clear_items,kova_private.memory_target_revisions from public,anon,authenticated;
grant all on kova_private.memory_clear_operations,kova_private.memory_clear_items,kova_private.memory_target_revisions to service_role;

-- Runs on all write paths, including manual edits and merge/delete. Revisions
-- survive removal while an inverse exists, so delete/recreate/delete is not ABA.
create function kova_private.track_memory_inverse_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner uuid; target text;
begin
  owner:=case when TG_OP='DELETE' then old.user_id else new.user_id end;
  target:=case when TG_OP='DELETE' then old.chat_id else new.chat_id end;
  if auth.uid() is not null and auth.uid()<>owner then raise exception 'memory_owner_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner::text,20260903204500));
  if exists(select 1 from kova_private.memory_clear_items where user_id=owner and chat_id=target) then
    insert into kova_private.memory_target_revisions values(owner,target,gen_random_uuid())
      on conflict(user_id,chat_id) do update set revision=excluded.revision;
  end if;
  if TG_OP='UPDATE' and (old.user_id,old.chat_id) is distinct from (new.user_id,new.chat_id) then
    if exists(select 1 from kova_private.memory_clear_items where user_id=old.user_id and chat_id=old.chat_id) then
      insert into kova_private.memory_target_revisions values(old.user_id,old.chat_id,gen_random_uuid())
        on conflict(user_id,chat_id) do update set revision=excluded.revision;
    end if;
  end if;
  return null;
end $$;
revoke all on function kova_private.track_memory_inverse_revision() from public,anon,authenticated;
create trigger track_memory_inverse_revision after insert or update or delete on public.chat_memories
  for each row execute function kova_private.track_memory_inverse_revision();

create function public.memory_clear_capability() returns integer language sql security invoker
set search_path='' as $$ select 1 $$;
revoke all on function public.memory_clear_capability() from public,anon,authenticated;
grant execute on function public.memory_clear_capability() to service_role;

create function public.memory_clear_operation(
 p_user_id uuid,p_operation_id uuid,p_action text,p_ttl_seconds integer default null,
 p_keep_newer boolean default false,p_expected_conflicts text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare op kova_private.memory_clear_operations%rowtype; row public.chat_memories%rowtype;
 item kova_private.memory_clear_items%rowtype; conflicts jsonb; conflict_token text;
 current_revision uuid; conflict_count integer; restored integer:=0; skipped integer:=0; count_rows integer; payload_bytes bigint;
begin
 if p_user_id is null or p_operation_id is null or p_action not in ('clear','restore','dismiss') or p_action is null or p_keep_newer is null then raise exception 'invalid_memory_operation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,20260903204500));
 if exists(select 1 from public.account_deletion_fences where user_id=p_user_id) then raise exception 'account_deletion_pending'; end if;
 -- Expiry retires payloads, retaining content-free idempotency receipts.
 update kova_private.memory_clear_operations set state='expired' where user_id=p_user_id and state='active' and expires_at<=now();
 delete from kova_private.memory_clear_items i using kova_private.memory_clear_operations o
   where i.user_id=o.user_id and i.operation_id=o.operation_id and o.user_id=p_user_id and o.state<>'active';
 select * into op from kova_private.memory_clear_operations where user_id=p_user_id and operation_id=p_operation_id for update;
 if p_action='clear' and not found then
   if p_ttl_seconds is null or p_ttl_seconds not between 60 and 86400 then raise exception 'memory_undo_window_unconfigured'; end if;
   if (select count(*) from kova_private.memory_clear_operations where user_id=p_user_id and state='active')>=20 then raise exception 'memory_undo_history_full'; end if;
   if (select count(*) from kova_private.memory_clear_operations where user_id=p_user_id)>=10000 then raise exception 'memory_receipt_capacity_reached'; end if;
   -- Bounded operation; overflow aborts before any removal. Lock captured rows.
   perform 1 from public.chat_memories where user_id=p_user_id order by id for update;
   select count(*),coalesce(sum(octet_length(to_jsonb(m)::text)),0) into count_rows,payload_bytes from public.chat_memories m where user_id=p_user_id;
   if count_rows>1000 or payload_bytes>4194304 then raise exception 'memory_clear_scope_too_large'; end if;
   insert into kova_private.memory_clear_operations(user_id,operation_id,state,expires_at,removed_count)
     values(p_user_id,p_operation_id,'active',now()+make_interval(secs=>p_ttl_seconds),count_rows);
   insert into kova_private.memory_clear_items(user_id,operation_id,chat_id,snapshot)
     select p_user_id,p_operation_id,m.chat_id,to_jsonb(m) from public.chat_memories m where user_id=p_user_id;
   -- Fence an older admitted model write. Existing permanent deletion remains
   -- separate and additionally removes same-chat summaries and recovery payloads.
   insert into public.chat_memory_write_epochs(user_id,epoch) values(p_user_id,2)
     on conflict(user_id) do update set epoch=public.chat_memory_write_epochs.epoch+1;
   delete from public.chat_memories where user_id=p_user_id;
   update kova_private.memory_clear_items i set removed_revision=v.revision from kova_private.memory_target_revisions v
     where i.user_id=p_user_id and i.operation_id=p_operation_id and v.user_id=i.user_id and v.chat_id=i.chat_id;
   select * into op from kova_private.memory_clear_operations where user_id=p_user_id and operation_id=p_operation_id;
 elsif op.operation_id is null then
   raise exception 'memory_operation_unavailable';
 elsif p_action='dismiss' and op.state='active' then
   update kova_private.memory_clear_operations set state='dismissed' where user_id=p_user_id and operation_id=p_operation_id returning * into op;
   delete from kova_private.memory_clear_items where user_id=p_user_id and operation_id=p_operation_id;
 elsif p_action='restore' and op.state='active' then
   select coalesce(jsonb_agg(jsonb_build_array(i.chat_id,v.revision) order by i.chat_id),'[]'::jsonb) into conflicts
     from kova_private.memory_clear_items i left join kova_private.memory_target_revisions v on v.user_id=i.user_id and v.chat_id=i.chat_id
     where i.user_id=p_user_id and i.operation_id=p_operation_id and
       (v.revision is distinct from i.removed_revision or exists(select 1 from public.chat_memories m where m.id=(i.snapshot->>'id')::uuid or (m.user_id=p_user_id and m.chat_id=i.chat_id)));
   conflict_count:=jsonb_array_length(conflicts); conflict_token:=md5(conflicts::text);
   if (conflict_count>0 and not p_keep_newer) or (p_keep_newer and p_expected_conflicts is distinct from conflict_token) then
     return jsonb_build_object('operationId',p_operation_id,'state','conflict','removedCount',op.removed_count,'conflictCount',conflict_count,'conflictToken',conflict_token,'expiresAt',op.expires_at);
   end if;
   for item in select * from kova_private.memory_clear_items where user_id=p_user_id and operation_id=p_operation_id order by chat_id loop
     select revision into current_revision from kova_private.memory_target_revisions where user_id=p_user_id and chat_id=item.chat_id;
     if current_revision is distinct from item.removed_revision or exists(select 1 from public.chat_memories m where m.id=(item.snapshot->>'id')::uuid or (m.user_id=p_user_id and m.chat_id=item.chat_id)) then skipped:=skipped+1; continue; end if;
     row:=jsonb_populate_record(null::public.chat_memories,item.snapshot);
     insert into public.chat_memories(id,user_id,chat_id,title,summary,message_count,created_at,updated_at)
       values(row.id,p_user_id,row.chat_id,row.title,row.summary,row.message_count,row.created_at,row.updated_at);
     restored:=restored+1;
   end loop;
   update kova_private.memory_clear_operations set state='restored',restored_count=restored,skipped_count=skipped
     where user_id=p_user_id and operation_id=p_operation_id returning * into op;
   delete from kova_private.memory_clear_items where user_id=p_user_id and operation_id=p_operation_id;
 end if;
 delete from kova_private.memory_target_revisions v where v.user_id=p_user_id and not exists(select 1 from kova_private.memory_clear_items i where i.user_id=v.user_id and i.chat_id=v.chat_id);
 return jsonb_build_object('operationId',p_operation_id,'state',op.state,'removedCount',op.removed_count,'restoredCount',op.restored_count,'skippedCount',op.skipped_count,'expiresAt',op.expires_at);
end $$;
revoke all on function public.memory_clear_operation(uuid,uuid,text,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.memory_clear_operation(uuid,uuid,text,integer,boolean,text) to service_role;

-- Preserve existing privacy deletion semantics, adding retirement of inverses.
create or replace function public.delete_chat_memory(p_user_id uuid,p_chat_id text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_user_id is null or (p_chat_id is not null and (length(p_chat_id)=0 or length(p_chat_id)>100)) then raise exception 'invalid_memory_principal'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,20260903204500));
 if p_chat_id is null then
   update kova_private.memory_clear_operations set state='retired' where user_id=p_user_id and state='active';
 end if;
 delete from kova_private.memory_clear_items where user_id=p_user_id and (p_chat_id is null or chat_id=p_chat_id);
 insert into public.chat_memory_write_epochs(user_id,epoch) values(p_user_id,2)
   on conflict(user_id) do update set epoch=public.chat_memory_write_epochs.epoch+1;
 delete from public.chat_context_summaries where user_id=p_user_id and (p_chat_id is null or chat_id::text=lower(p_chat_id));
 delete from public.chat_memories where user_id=p_user_id and (p_chat_id is null or chat_id=p_chat_id);
 return true;
end $$;

-- Activation must include an authorized maintenance call to enforce expiry
-- without depending on another browser visit. This proposal does not schedule it.
create function public.purge_expired_memory_inverses() returns bigint language plpgsql security invoker set search_path='' as $$
declare removed bigint;
begin
 update kova_private.memory_clear_operations set state='expired' where state='active' and expires_at<=now();
 delete from kova_private.memory_clear_items i using kova_private.memory_clear_operations o where i.user_id=o.user_id and i.operation_id=o.operation_id and o.state<>'active';
 get diagnostics removed=ROW_COUNT;
 delete from kova_private.memory_target_revisions v where not exists(select 1 from kova_private.memory_clear_items i where i.user_id=v.user_id and i.chat_id=v.chat_id);
 return removed;
end $$;
revoke all on function public.purge_expired_memory_inverses() from public,anon,authenticated;
grant execute on function public.purge_expired_memory_inverses() to service_role;
