-- Record every external upload before I/O. Retired attempts are repeatedly
-- swept because an aborted Storage request can still commit after deletion.
-- No Auth FK: removing an account must not remove its cleanup obligations.
create table public.account_storage_artifacts (
  generation uuid primary key,
  owner_id uuid not null,
  requester_id uuid not null,
  bucket text not null check (bucket in ('library-images', 'project-files')),
  storage_path text not null,
  state text not null default 'pending' check (state in ('pending', 'published', 'retired')),
  lease_expires_at timestamptz not null default now() + interval '3 minutes',
  created_at timestamptz not null default now(),
  next_cleanup_at timestamptz not null default now(),
  last_cleanup_at timestamptz,
  cleanup_attempts bigint not null default 0,
  unique(bucket, storage_path),
  check (length(storage_path) between 38 and 512
    and storage_path ~ '^[A-Za-z0-9_./-]+$'
    and storage_path !~ '(^|/)(\.|\.\.|)(/|$)'
    and position(generation::text in storage_path) > 0)
);
alter table public.account_storage_artifacts enable row level security;
revoke all on public.account_storage_artifacts from public, anon, authenticated;
grant all on public.account_storage_artifacts to service_role;
create index account_storage_artifacts_pending_idx on public.account_storage_artifacts(lease_expires_at) where state = 'pending';
create index account_storage_artifacts_cleanup_idx on public.account_storage_artifacts(next_cleanup_at, generation) where state = 'retired';
create index account_storage_artifacts_owner_idx on public.account_storage_artifacts(owner_id);
create index account_storage_artifacts_requester_idx on public.account_storage_artifacts(requester_id);

create function public.reserve_account_storage_artifact(
  p_generation uuid, p_owner_id uuid, p_requester_id uuid, p_bucket text, p_storage_path text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_user uuid;
begin
  if p_generation is null or p_owner_id is null or p_requester_id is null
    or p_bucket is null or p_bucket not in ('library-images','project-files')
    or p_storage_path is null or position(p_generation::text in p_storage_path) = 0
    or (p_bucket = 'library-images' and (
      p_owner_id <> p_requester_id or p_storage_path !~ ('^' || p_owner_id::text || '/' || p_generation::text || '\.(png|jpg|jpeg|webp|gif)$')
    )) then raise exception 'invalid_storage_artifact'; end if;
  -- Match the account deletion fence and use the same order for two principals.
  for v_user in select distinct x from unnest(array[p_owner_id,p_requester_id]) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended(v_user::text, 20260903204500));
    if not kova_private.auth_user_exists(v_user)
      or exists (select 1 from public.account_deletion_fences where user_id = v_user)
    then return false; end if;
  end loop;
  insert into public.account_storage_artifacts(generation,owner_id,requester_id,bucket,storage_path)
  values(p_generation,p_owner_id,p_requester_id,p_bucket,p_storage_path)
  on conflict(generation) do nothing;
  return exists (select 1 from public.account_storage_artifacts where generation = p_generation
    and owner_id = p_owner_id and requester_id = p_requester_id and bucket = p_bucket
    and storage_path = p_storage_path and state = 'pending' and lease_expires_at > now());
end;
$$;

create function public.settle_account_storage_artifact(p_generation uuid, p_owner_id uuid, p_requester_id uuid, p_bucket text, p_storage_path text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_artifact public.account_storage_artifacts; v_user uuid;
begin
  select * into v_artifact from public.account_storage_artifacts where generation = p_generation
    and owner_id = p_owner_id and requester_id = p_requester_id and bucket = p_bucket and storage_path = p_storage_path;
  if not found then return false; end if;
  for v_user in select distinct x from unnest(array[v_artifact.owner_id,v_artifact.requester_id]) x order by x loop
    perform pg_advisory_xact_lock(hashtextextended(v_user::text, 20260903204500));
    if not kova_private.auth_user_exists(v_user)
      or exists(select 1 from public.account_deletion_fences where user_id = v_user)
    then return false; end if;
  end loop;
  select * into v_artifact from public.account_storage_artifacts where generation = p_generation
    and owner_id = p_owner_id and requester_id = p_requester_id and bucket = p_bucket and storage_path = p_storage_path for update;
  if not found then return false; end if;
  if v_artifact.state = 'published' then return true; end if;
  if v_artifact.state <> 'pending' or v_artifact.lease_expires_at <= now() then return false; end if;
  update public.account_storage_artifacts set state = 'published' where generation = p_generation;
  return true;
end;
$$;

create function public.retire_account_storage_artifact(p_generation uuid, p_owner_id uuid, p_requester_id uuid, p_bucket text, p_storage_path text)
returns void language sql security invoker set search_path = '' as $$
  update public.account_storage_artifacts set state = 'retired', next_cleanup_at = now()
  where generation = p_generation and state = 'pending'
    and owner_id = p_owner_id and requester_id = p_requester_id and bucket = p_bucket and storage_path = p_storage_path;
$$;

create function public.prepare_account_storage_artifact_deletion(p_user_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 20260903204500));
  if not exists(select 1 from public.account_deletion_fences where user_id = p_user_id)
  then raise exception 'account_deletion_fence_required'; end if;
  with expired as (
    select generation from public.account_storage_artifacts
    where (owner_id = p_user_id or requester_id = p_user_id)
      and state = 'pending' and lease_expires_at <= now()
    order by lease_expires_at, generation for update skip locked limit 25
  ) update public.account_storage_artifacts a set state = 'retired', next_cleanup_at = now()
    from expired where a.generation = expired.generation;
  return not exists(select 1 from public.account_storage_artifacts
    where (owner_id = p_user_id or requester_id = p_user_id) and
      (state = 'pending' or (state = 'retired' and last_cleanup_at is null)));
end;
$$;

create function public.claim_account_storage_artifact_cleanup(p_user_id uuid default null, p_limit integer default 25)
returns setof public.account_storage_artifacts language plpgsql security invoker set search_path = '' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_cleanup_limit'; end if;
  -- Bounded recovery of crashed producers, independently of account deletion.
  with expired as (
    select generation from public.account_storage_artifacts
    where state = 'pending' and lease_expires_at <= now()
      and (p_user_id is null or owner_id = p_user_id or requester_id = p_user_id)
    order by lease_expires_at, generation for update skip locked limit p_limit
  ) update public.account_storage_artifacts a set state = 'retired', next_cleanup_at = now()
    from expired where a.generation = expired.generation;
  return query with candidates as (
    select a.generation from public.account_storage_artifacts a
    where a.state = 'retired' and (p_user_id is null or a.owner_id = p_user_id or a.requester_id = p_user_id)
      and (a.next_cleanup_at <= now() or (p_user_id is not null and a.last_cleanup_at is null))
    order by a.next_cleanup_at,a.generation for update skip locked limit p_limit
  ) update public.account_storage_artifacts a
    set next_cleanup_at = now() + interval '5 minutes', cleanup_attempts = cleanup_attempts + 1
    from candidates c where a.generation = c.generation returning a.*;
end;
$$;

create function public.record_account_storage_artifact_cleanup(p_generation uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_artifact public.account_storage_artifacts;
begin
  update public.account_storage_artifacts set last_cleanup_at = now()
    where generation = p_generation and state = 'retired' returning * into v_artifact;
  if not found then return false; end if;
  if v_artifact.bucket = 'library-images' then
    delete from public.user_library_items where user_id = v_artifact.owner_id
      and file_url = v_artifact.storage_path and item_type = 'image'
      and metadata->>'storage_generation' = v_artifact.generation::text;
  end if;
  return true;
end;
$$;

-- Library metadata producers share the deletion lock; this covers ordinary
-- saves as well as image publication and prevents later metadata resurrection.
create function kova_private.fence_library_item_account_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 20260903204500));
  if exists(select 1 from public.account_deletion_fences where user_id = new.user_id)
  then raise exception 'account_deletion_in_progress'; end if;
  return new;
end;
$$;
create trigger fence_library_item_account_deletion before insert or update on public.user_library_items
for each row execute function kova_private.fence_library_item_account_deletion();

revoke all on function public.reserve_account_storage_artifact(uuid,uuid,uuid,text,text),
  public.settle_account_storage_artifact(uuid,uuid,uuid,text,text), public.retire_account_storage_artifact(uuid,uuid,uuid,text,text),
  public.prepare_account_storage_artifact_deletion(uuid), public.claim_account_storage_artifact_cleanup(uuid,integer),
  public.record_account_storage_artifact_cleanup(uuid), kova_private.fence_library_item_account_deletion()
  from public, anon, authenticated;
grant execute on function public.reserve_account_storage_artifact(uuid,uuid,uuid,text,text),
  public.settle_account_storage_artifact(uuid,uuid,uuid,text,text), public.retire_account_storage_artifact(uuid,uuid,uuid,text,text),
  public.prepare_account_storage_artifact_deletion(uuid), public.claim_account_storage_artifact_cleanup(uuid,integer),
  public.record_account_storage_artifact_cleanup(uuid) to service_role;
