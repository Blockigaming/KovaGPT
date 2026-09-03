-- Durable, owner-scoped Library folders and atomic bulk organization.
-- Folder mutations are server-only RPCs so clients cannot bypass cycle,
-- ownership, depth, exact-set, or audit guarantees.

create table public.library_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid,
  name text not null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_folders_id_user_unique unique (id, user_id),
  constraint library_folders_parent_owner_fk
    foreign key (parent_id, user_id)
    references public.library_folders(id, user_id)
    on delete cascade,
  constraint library_folders_not_self check (parent_id is null or parent_id <> id),
  constraint library_folders_name_valid check (
    name = btrim(name)
    and char_length(name) between 1 and 120
    and name not in ('.', '..')
    and name !~ '[[:cntrl:]]'
    and position('/' in name) = 0
    and position(chr(92) in name) = 0
  )
);

create unique index library_folders_unique_root_name
  on public.library_folders (user_id, lower(name))
  where parent_id is null;
create unique index library_folders_unique_child_name
  on public.library_folders (user_id, parent_id, lower(name))
  where parent_id is not null;
create index library_folders_tree_order
  on public.library_folders (user_id, parent_id, position, lower(name), id);

-- This internal row serializes all folder-tree and bulk-move mutations for one
-- account. It prevents two concurrent, individually valid moves from creating
-- a cycle or racing a folder deletion.
create table public.library_folder_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  touched_at timestamptz not null default now()
);

alter table public.library_folders enable row level security;
alter table public.library_folder_locks enable row level security;

revoke all on public.library_folders from public, anon, authenticated;
revoke all on public.library_folder_locks from public, anon, authenticated;
grant select on public.library_folders to authenticated;
grant all on public.library_folders to service_role;
grant all on public.library_folder_locks to service_role;
grant insert on public.account_audit_entries to service_role;

create policy "library folders owner read"
  on public.library_folders
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

alter table public.user_library_items
  add column folder_id uuid references public.library_folders(id) on delete set null;

create index user_library_items_folder_order
  on public.user_library_items (user_id, folder_id, created_at desc, id);

create schema if not exists kova_private;
revoke all on schema kova_private from public, anon;
grant usage on schema kova_private to authenticated, service_role;

create function kova_private.lock_library_tree(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'user_id_required';
  end if;

  insert into public.library_folder_locks (user_id, touched_at)
  values (p_user_id, pg_catalog.now())
  on conflict (user_id) do update set touched_at = excluded.touched_at;

  perform 1
    from public.library_folder_locks
   where user_id = p_user_id
   for update;
end;
$$;

create function kova_private.guard_library_folder_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle boolean := false;
  v_ancestor_depth integer := 0;
  v_subtree_height integer := 1;
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception using errcode = '23514', message = 'folder_owner_immutable';
  end if;

  if new.parent_id is null then
    v_ancestor_depth := 0;
  else
    if new.parent_id = new.id then
      raise exception using errcode = '23514', message = 'folder_cycle';
    end if;

    if not exists (
      select 1 from public.library_folders parent
       where parent.id = new.parent_id and parent.user_id = new.user_id
    ) then
      raise exception using errcode = '23514', message = 'folder_parent_not_owned';
    end if;

    with recursive ancestors as (
      select folder.id, folder.parent_id, 1 as depth
        from public.library_folders folder
       where folder.id = new.parent_id and folder.user_id = new.user_id
      union all
      select folder.id, folder.parent_id, ancestors.depth + 1
        from public.library_folders folder
        join ancestors on folder.id = ancestors.parent_id
       where folder.user_id = new.user_id and ancestors.depth < 13
    )
    select coalesce(pg_catalog.bool_or(id = new.id), false), coalesce(pg_catalog.max(depth), 0)
      into v_cycle, v_ancestor_depth
      from ancestors;

    if v_cycle then
      raise exception using errcode = '23514', message = 'folder_cycle';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    with recursive descendants as (
      select folder.id, 1 as depth
        from public.library_folders folder
       where folder.id = new.id and folder.user_id = new.user_id
      union all
      select child.id, descendants.depth + 1
        from public.library_folders child
        join descendants on child.parent_id = descendants.id
       where child.user_id = new.user_id and descendants.depth < 13
    )
    select coalesce(pg_catalog.max(depth), 1)
      into v_subtree_height
      from descendants;
  end if;

  if v_ancestor_depth + v_subtree_height > 12 then
    raise exception using errcode = '23514', message = 'folder_depth_exceeded';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create function kova_private.guard_library_item_folder()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.folder_id is not null and not exists (
    select 1
      from public.library_folders folder
     where folder.id = new.folder_id and folder.user_id = new.user_id
  ) then
    raise exception using errcode = '23514', message = 'library_folder_not_owned';
  end if;
  return new;
end;
$$;

revoke all on function kova_private.lock_library_tree(uuid) from public, anon, authenticated;
revoke all on function kova_private.guard_library_folder_parent() from public, anon, authenticated;
revoke all on function kova_private.guard_library_item_folder() from public, anon, authenticated;
grant execute on function kova_private.lock_library_tree(uuid) to service_role;
grant execute on function kova_private.guard_library_folder_parent() to service_role;
grant execute on function kova_private.guard_library_item_folder() to authenticated, service_role;

create trigger library_folder_parent_guard
before insert or update of user_id, parent_id, name, position
on public.library_folders
for each row execute function kova_private.guard_library_folder_parent();

create trigger library_item_folder_guard
before insert or update of user_id, folder_id
on public.user_library_items
for each row execute function kova_private.guard_library_item_folder();

create function public.create_library_folder(
  p_user_id uuid,
  p_name text,
  p_parent_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_folder public.library_folders%rowtype;
begin
  perform kova_private.lock_library_tree(p_user_id);

  if (select count(*) from public.library_folders where user_id = p_user_id) >= 200 then
    raise exception using errcode = '23514', message = 'folder_limit_reached';
  end if;

  insert into public.library_folders (user_id, parent_id, name)
  values (p_user_id, p_parent_id, p_name)
  returning * into v_folder;

  insert into public.account_audit_entries (
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'library_folder_created', 'Library folder created', p_user_id,
    v_folder.id::text, 'success',
    pg_catalog.jsonb_build_object('folder_id', v_folder.id, 'parent_id', v_folder.parent_id)
  );

  return pg_catalog.jsonb_build_object(
    'id', v_folder.id,
    'parentId', v_folder.parent_id,
    'name', v_folder.name,
    'position', v_folder.position,
    'createdAt', v_folder.created_at,
    'updatedAt', v_folder.updated_at
  );
end;
$$;

create function public.update_library_folder(
  p_user_id uuid,
  p_folder_id uuid,
  p_name text,
  p_parent_id uuid,
  p_parent_supplied boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.library_folders%rowtype;
  v_folder public.library_folders%rowtype;
begin
  perform kova_private.lock_library_tree(p_user_id);

  select * into v_existing
    from public.library_folders
   where id = p_folder_id and user_id = p_user_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'library_folder_not_found';
  end if;

  update public.library_folders
     set name = coalesce(p_name, v_existing.name),
         parent_id = case when p_parent_supplied then p_parent_id else v_existing.parent_id end
   where id = p_folder_id and user_id = p_user_id
  returning * into v_folder;

  insert into public.account_audit_entries (
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'library_folder_updated', 'Library folder updated', p_user_id,
    v_folder.id::text, 'success',
    pg_catalog.jsonb_build_object('folder_id', v_folder.id, 'parent_id', v_folder.parent_id)
  );

  return pg_catalog.jsonb_build_object(
    'id', v_folder.id,
    'parentId', v_folder.parent_id,
    'name', v_folder.name,
    'position', v_folder.position,
    'createdAt', v_folder.created_at,
    'updatedAt', v_folder.updated_at
  );
end;
$$;

create function public.delete_library_folder(p_user_id uuid, p_folder_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_folder_ids uuid[];
  v_folder_count integer;
  v_item_count integer;
begin
  perform kova_private.lock_library_tree(p_user_id);

  if not exists (
    select 1 from public.library_folders
     where id = p_folder_id and user_id = p_user_id
     for update
  ) then
    raise exception using errcode = 'P0002', message = 'library_folder_not_found';
  end if;

  with recursive descendants as (
    select folder.id
      from public.library_folders folder
     where folder.id = p_folder_id and folder.user_id = p_user_id
    union all
    select child.id
      from public.library_folders child
      join descendants on child.parent_id = descendants.id
     where child.user_id = p_user_id
  )
  select pg_catalog.array_agg(id), count(*)::integer
    into v_folder_ids, v_folder_count
    from descendants;

  select count(*)::integer into v_item_count
    from public.user_library_items
   where user_id = p_user_id and folder_id = any(v_folder_ids);

  -- Cascading removes only folder rows. The item FK uses ON DELETE SET NULL,
  -- so deleting a subtree never deletes a Library item or its stored object.
  delete from public.library_folders
   where id = p_folder_id and user_id = p_user_id;

  insert into public.account_audit_entries (
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'library_folder_deleted', 'Library folder removed; contents kept', p_user_id,
    p_folder_id::text, 'success',
    pg_catalog.jsonb_build_object(
      'folder_id', p_folder_id,
      'folders_removed', v_folder_count,
      'items_moved_to_root', v_item_count
    )
  );

  return pg_catalog.jsonb_build_object(
    'deletedFolderCount', v_folder_count,
    'movedToRootCount', v_item_count
  );
end;
$$;

create function public.bulk_move_library_items(
  p_user_id uuid,
  p_item_ids uuid[],
  p_folder_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_requested integer := pg_catalog.cardinality(p_item_ids);
  v_unique integer;
  v_owned_ids uuid[];
  v_moved integer;
begin
  if v_requested is null or v_requested < 1 or v_requested > 100 then
    raise exception using errcode = '22023', message = 'invalid_library_item_count';
  end if;

  select count(distinct value)::integer into v_unique
    from pg_catalog.unnest(p_item_ids) as item(value);
  if v_unique <> v_requested then
    raise exception using errcode = '22023', message = 'duplicate_library_item_id';
  end if;

  perform kova_private.lock_library_tree(p_user_id);

  if p_folder_id is not null and not exists (
    select 1 from public.library_folders
     where id = p_folder_id and user_id = p_user_id
     for share
  ) then
    raise exception using errcode = 'P0002', message = 'library_folder_not_found';
  end if;

  select pg_catalog.array_agg(owned.id) into v_owned_ids
    from (
      select item.id
        from public.user_library_items item
       where item.user_id = p_user_id and item.id = any(p_item_ids)
       order by item.id
       for update
    ) owned;

  if coalesce(pg_catalog.cardinality(v_owned_ids), 0) <> v_requested then
    raise exception using errcode = 'P0002', message = 'library_item_not_found';
  end if;

  update public.user_library_items
     set folder_id = p_folder_id,
         updated_at = pg_catalog.now()
   where user_id = p_user_id and id = any(p_item_ids);
  get diagnostics v_moved = row_count;

  insert into public.account_audit_entries (
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'library_items_bulk_moved', 'Library items moved', p_user_id,
    p_folder_id::text, 'success',
    pg_catalog.jsonb_build_object('folder_id', p_folder_id, 'item_count', v_moved)
  );

  return pg_catalog.jsonb_build_object('movedCount', v_moved, 'folderId', p_folder_id);
end;
$$;

revoke all on function public.create_library_folder(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.update_library_folder(uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.delete_library_folder(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.bulk_move_library_items(uuid, uuid[], uuid)
  from public, anon, authenticated;

grant execute on function public.create_library_folder(uuid, text, uuid) to service_role;
grant execute on function public.update_library_folder(uuid, uuid, text, uuid, boolean)
  to service_role;
grant execute on function public.delete_library_folder(uuid, uuid) to service_role;
grant execute on function public.bulk_move_library_items(uuid, uuid[], uuid) to service_role;
