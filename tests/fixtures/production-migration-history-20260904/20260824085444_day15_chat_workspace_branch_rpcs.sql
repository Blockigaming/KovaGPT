-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

alter table public.chat_branches add column if not exists conversation_id text;
alter table public.chat_branches add column if not exists branch_from_message_index integer;
alter table public.chat_branches add column if not exists message_ids text[] not null default '{}'::text[];

update public.chat_branches
set conversation_id = chat_id
where conversation_id is null;

alter table public.chat_branches alter column conversation_id set not null;

create unique index if not exists chat_branches_owner_root_conversation_uidx
  on public.chat_branches (owner_id, chat_id, conversation_id);

create index if not exists chat_branches_parent_branch_idx
  on public.chat_branches (parent_branch_id)
  where parent_branch_id is not null;

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_branches'::regclass
      and conname = 'chat_branches_conversation_id_length'
  ) then
    alter table public.chat_branches
      add constraint chat_branches_conversation_id_length
      check (char_length(conversation_id) between 1 and 256);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_branches'::regclass
      and conname = 'chat_branches_message_index_nonnegative'
  ) then
    alter table public.chat_branches
      add constraint chat_branches_message_index_nonnegative
      check (branch_from_message_index is null or branch_from_message_index between 0 and 100000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_branches'::regclass
      and conname = 'chat_branches_message_ids_bound'
  ) then
    alter table public.chat_branches
      add constraint chat_branches_message_ids_bound
      check (cardinality(message_ids) <= 512);
  end if;
end
$migration$;

create or replace function public.kova_record_message_version(
  p_chat_id text,
  p_message_id text,
  p_source text,
  p_content text,
  p_branch_id uuid default null,
  p_instruction text default null,
  p_original_content text default null,
  p_accepted boolean default true,
  p_selection_start integer default null,
  p_selection_end integer default null,
  p_max_versions integer default 50
)
returns public.chat_message_versions
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_owner uuid := auth.uid();
  v_next integer;
  v_limit integer := greatest(1, least(coalesce(p_max_versions, 50), 100));
  v_selection_bound integer;
  v_row public.chat_message_versions%rowtype;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_chat_id is null or char_length(btrim(p_chat_id)) not between 1 and 256 then
    raise exception 'invalid_chat_id' using errcode = '22023';
  end if;
  if p_message_id is null or char_length(btrim(p_message_id)) not between 1 and 256 then
    raise exception 'invalid_message_id' using errcode = '22023';
  end if;
  if p_source not in ('original', 'inline_edit', 'retry', 'branch_edit') then
    raise exception 'invalid_version_source' using errcode = '22023';
  end if;
  if p_content is null or char_length(p_content) < 1 or char_length(p_content) > 131072 then
    raise exception 'invalid_version_content' using errcode = '22023';
  end if;
  if p_instruction is not null and char_length(p_instruction) > 4000 then
    raise exception 'instruction_too_long' using errcode = '22023';
  end if;
  if p_original_content is not null and char_length(p_original_content) > 131072 then
    raise exception 'original_content_too_long' using errcode = '22023';
  end if;
  if (p_selection_start is null) <> (p_selection_end is null) then
    raise exception 'invalid_selection_range' using errcode = '22023';
  end if;
  if p_selection_start is not null then
    v_selection_bound := char_length(coalesce(p_original_content, p_content));
    if p_selection_start < 0 or p_selection_end < p_selection_start or p_selection_end > v_selection_bound then
      raise exception 'invalid_selection_range' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_owner::text || ':' || btrim(p_chat_id) || ':' || btrim(p_message_id), 0)
  );

  if p_branch_id is not null and not exists (
    select 1
    from public.chat_branches b
    where b.id = p_branch_id
      and b.owner_id = v_owner
      and b.chat_id = btrim(p_chat_id)
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  select coalesce(max(v.version), 0) + 1
    into v_next
  from public.chat_message_versions v
  where v.owner_id = v_owner
    and v.chat_id = btrim(p_chat_id)
    and v.message_id = btrim(p_message_id);

  if coalesce(p_accepted, true) then
    update public.chat_message_versions
       set accepted = false
     where owner_id = v_owner
       and chat_id = btrim(p_chat_id)
       and message_id = btrim(p_message_id)
       and accepted;
  end if;

  insert into public.chat_message_versions (
    owner_id, chat_id, message_id, branch_id, version, source,
    instruction, content, original_content, accepted,
    selection_start, selection_end
  ) values (
    v_owner, btrim(p_chat_id), btrim(p_message_id), p_branch_id, v_next, p_source,
    nullif(btrim(coalesce(p_instruction, '')), ''), p_content, p_original_content,
    coalesce(p_accepted, true), p_selection_start, p_selection_end
  )
  returning * into v_row;

  with ranked as (
    select id,
           row_number() over (order by accepted desc, version desc, created_at desc, id desc) as rn
    from public.chat_message_versions
    where owner_id = v_owner
      and chat_id = btrim(p_chat_id)
      and message_id = btrim(p_message_id)
  )
  delete from public.chat_message_versions v
  using ranked r
  where v.id = r.id
    and r.rn > v_limit;

  return v_row;
end
$function$;

create or replace function public.kova_accept_message_version(p_version_id uuid)
returns public.chat_message_versions
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_owner uuid := auth.uid();
  v_target public.chat_message_versions%rowtype;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_target
  from public.chat_message_versions
  where id = p_version_id and owner_id = v_owner;

  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_owner::text || ':' || v_target.chat_id || ':' || v_target.message_id, 0)
  );

  select * into v_target
  from public.chat_message_versions
  where id = p_version_id and owner_id = v_owner
  for update;

  if not found then
    raise exception 'version_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.chat_message_versions
  where owner_id = v_owner
    and chat_id = v_target.chat_id
    and message_id = v_target.message_id
  order by version
  for update;

  update public.chat_message_versions
     set accepted = (id = p_version_id)
   where owner_id = v_owner
     and chat_id = v_target.chat_id
     and message_id = v_target.message_id;

  select * into v_target
  from public.chat_message_versions
  where id = p_version_id and owner_id = v_owner;

  return v_target;
end
$function$;

create or replace function public.kova_create_chat_branch(
  p_chat_id text,
  p_conversation_id text,
  p_parent_branch_id uuid default null,
  p_branch_from_parent_message_id text default null,
  p_branch_from_message_id text default null,
  p_branch_from_message_index integer default null,
  p_message_ids text[] default '{}'::text[],
  p_label text default null,
  p_activate boolean default true,
  p_max_branches integer default 40
)
returns public.chat_branches
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_owner uuid := auth.uid();
  v_limit integer := greatest(1, least(coalesce(p_max_branches, 40), 100));
  v_message_ids text[] := coalesce(p_message_ids, '{}'::text[]);
  v_count integer;
  v_row public.chat_branches%rowtype;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_chat_id is null or char_length(btrim(p_chat_id)) not between 1 and 256 then
    raise exception 'invalid_chat_id' using errcode = '22023';
  end if;
  if p_conversation_id is null or char_length(btrim(p_conversation_id)) not between 1 and 256 then
    raise exception 'invalid_conversation_id' using errcode = '22023';
  end if;
  if p_label is not null and char_length(p_label) > 120 then
    raise exception 'branch_label_too_long' using errcode = '22023';
  end if;
  if p_branch_from_message_index is not null and p_branch_from_message_index not between 0 and 100000 then
    raise exception 'invalid_branch_message_index' using errcode = '22023';
  end if;
  if p_branch_from_message_id is not null and char_length(p_branch_from_message_id) not between 1 and 256 then
    raise exception 'invalid_branch_message_id' using errcode = '22023';
  end if;
  if p_branch_from_parent_message_id is not null and char_length(p_branch_from_parent_message_id) not between 1 and 256 then
    raise exception 'invalid_parent_message_id' using errcode = '22023';
  end if;
  if cardinality(v_message_ids) > 512 or exists (
    select 1 from unnest(v_message_ids) as value
    where value is null or char_length(btrim(value)) not between 1 and 256
  ) then
    raise exception 'invalid_branch_message_ids' using errcode = '22023';
  end if;
  if cardinality(v_message_ids) <> (
    select count(distinct value)::integer from unnest(v_message_ids) as value
  ) then
    raise exception 'duplicate_branch_message_ids' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_owner::text || ':' || btrim(p_chat_id), 0)
  );

  if p_parent_branch_id is not null and not exists (
    select 1 from public.chat_branches b
    where b.id = p_parent_branch_id
      and b.owner_id = v_owner
      and b.chat_id = btrim(p_chat_id)
  ) then
    raise exception 'parent_branch_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.chat_branches b
    where b.owner_id = v_owner
      and b.chat_id = btrim(p_chat_id)
      and b.conversation_id = btrim(p_conversation_id)
  ) then
    raise exception 'branch_conversation_exists' using errcode = '23505';
  end if;

  select count(*) into v_count
  from public.chat_branches b
  where b.owner_id = v_owner and b.chat_id = btrim(p_chat_id);

  if v_count >= v_limit then
    raise exception 'branch_limit_reached' using errcode = '54000';
  end if;

  if coalesce(p_activate, true) then
    update public.chat_branches
       set active = false, updated_at = now()
     where owner_id = v_owner and chat_id = btrim(p_chat_id) and active;
  end if;

  insert into public.chat_branches (
    owner_id, chat_id, conversation_id, parent_branch_id,
    branch_from_parent_message_id, branch_from_message_id,
    branch_from_message_index, message_ids, label, active
  ) values (
    v_owner, btrim(p_chat_id), btrim(p_conversation_id), p_parent_branch_id,
    p_branch_from_parent_message_id, p_branch_from_message_id,
    p_branch_from_message_index, v_message_ids,
    nullif(btrim(coalesce(p_label, '')), ''), coalesce(p_activate, true)
  )
  returning * into v_row;

  return v_row;
end
$function$;

create or replace function public.kova_activate_chat_branch(
  p_chat_id text,
  p_branch_id uuid
)
returns public.chat_branches
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_owner uuid := auth.uid();
  v_target public.chat_branches%rowtype;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_chat_id is null or char_length(btrim(p_chat_id)) not between 1 and 256 then
    raise exception 'invalid_chat_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_owner::text || ':' || btrim(p_chat_id), 0)
  );

  select * into v_target
  from public.chat_branches
  where id = p_branch_id
    and owner_id = v_owner
    and chat_id = btrim(p_chat_id)
  for update;

  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  update public.chat_branches
     set active = (id = p_branch_id), updated_at = now()
   where owner_id = v_owner and chat_id = btrim(p_chat_id);

  select * into v_target
  from public.chat_branches
  where id = p_branch_id and owner_id = v_owner;

  return v_target;
end
$function$;

create or replace function public.kova_update_chat_branch_messages(
  p_branch_id uuid,
  p_message_ids text[],
  p_label text default null
)
returns public.chat_branches
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_owner uuid := auth.uid();
  v_message_ids text[] := coalesce(p_message_ids, '{}'::text[]);
  v_row public.chat_branches%rowtype;
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_label is not null and char_length(p_label) > 120 then
    raise exception 'branch_label_too_long' using errcode = '22023';
  end if;
  if cardinality(v_message_ids) > 512 or exists (
    select 1 from unnest(v_message_ids) as value
    where value is null or char_length(btrim(value)) not between 1 and 256
  ) then
    raise exception 'invalid_branch_message_ids' using errcode = '22023';
  end if;
  if cardinality(v_message_ids) <> (
    select count(distinct value)::integer from unnest(v_message_ids) as value
  ) then
    raise exception 'duplicate_branch_message_ids' using errcode = '22023';
  end if;

  update public.chat_branches
     set message_ids = v_message_ids,
         label = case when p_label is null then label else nullif(btrim(p_label), '') end,
         updated_at = now()
   where id = p_branch_id and owner_id = v_owner
   returning * into v_row;

  if not found then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  return v_row;
end
$function$;

revoke all on function public.kova_record_message_version(text,text,text,text,uuid,text,text,boolean,integer,integer,integer) from public, anon;
revoke all on function public.kova_accept_message_version(uuid) from public, anon;
revoke all on function public.kova_create_chat_branch(text,text,uuid,text,text,integer,text[],text,boolean,integer) from public, anon;
revoke all on function public.kova_activate_chat_branch(text,uuid) from public, anon;
revoke all on function public.kova_update_chat_branch_messages(uuid,text[],text) from public, anon;

grant execute on function public.kova_record_message_version(text,text,text,text,uuid,text,text,boolean,integer,integer,integer) to authenticated, service_role;
grant execute on function public.kova_accept_message_version(uuid) to authenticated, service_role;
grant execute on function public.kova_create_chat_branch(text,text,uuid,text,text,integer,text[],text,boolean,integer) to authenticated, service_role;
grant execute on function public.kova_activate_chat_branch(text,uuid) to authenticated, service_role;
grant execute on function public.kova_update_chat_branch_messages(uuid,text[],text) to authenticated, service_role;
;
