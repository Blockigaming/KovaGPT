begin;
-- Keep the existing export budget and per-account link quota. Apply the size
-- budget to all active shares together instead of truncating individual chats.
alter table public.chat_public_shares
  drop constraint chat_public_shares_snapshot_check,
  add constraint chat_public_shares_snapshot_check check (jsonb_typeof(snapshot) = 'object');

create or replace function kova_private.guard_public_chat_share()
returns trigger language plpgsql security definer set search_path='' as $$
declare used_bytes bigint; link_count integer; total_bytes bigint;
begin
 if tg_op='UPDATE' then
  if (new.id,new.owner_id,new.token_hash,new.title,new.snapshot,new.created_at,new.expires_at)
    is distinct from (old.id,old.owner_id,old.token_hash,old.title,old.snapshot,old.created_at,old.expires_at) then
   raise exception 'public_share_snapshot_immutable';
  end if;
  return new;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,20260903204500));
 if not kova_private.auth_user_exists(new.owner_id) or exists(select 1 from public.account_deletion_fences where user_id=new.owner_id) then
  raise exception 'public_share_account_unavailable';
 end if;
 delete from public.chat_public_shares where owner_id=new.owner_id and (revoked_at is not null or expires_at<=now());
 select count(*),coalesce(sum(octet_length(to_jsonb(s)::text)),0) into link_count,used_bytes
 from public.chat_public_shares s where owner_id=new.owner_id;
 if link_count>=20 or used_bytes+octet_length(to_jsonb(new)::text)>52428800 then
  raise exception 'public_share_limit';
 end if;
 if to_regprocedure('kova_private.account_export_direct_row_bytes(uuid,bigint)') is not null then
  execute 'select kova_private.account_export_direct_row_bytes($1,52428800)' into total_bytes using new.owner_id;
  if total_bytes+octet_length(to_jsonb(new)::text)+512>52428800 then raise exception 'public_share_limit'; end if;
 end if;
 return new;
end;
$$;
commit;
