-- Restore the complete canonical workspace API on fresh and upgraded databases.
-- Reconciles the reviewed production-only Day 15 functions without replaying
-- historical migrations or replacing data. Every callable API remains invoker
-- only, with owner/member RLS plus explicit ownership validation.
--
-- Both spellings share advisory-lock namespaces and acquire advisory locks
-- before row locks. Browser selection offsets remain UTF-16 code units.

create or replace function public.utf16_code_unit_length(p_text text)
returns integer
language sql
immutable
strict
parallel safe
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    sum(case when ascii(character) > 65535 then 2 else 1 end),
    0
  )::integer
  from regexp_split_to_table(p_text, '') as characters(character);
$$;

create or replace function public.create_chat_message_version(
  p_chat_id text,
  p_message_id text,
  p_content text,
  p_original_content text default null,
  p_instruction text default null,
  p_source text default 'inline_edit',
  p_branch_id uuid default null,
  p_selection_start integer default null,
  p_selection_end integer default null,
  p_accept boolean default false
)
returns public.chat_message_versions
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_next integer;
  v_row public.chat_message_versions%rowtype;
  v_retry boolean := false;
  v_original_length integer := public.utf16_code_unit_length(coalesce(p_original_content, p_content));
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null
     or nullif(btrim(p_message_id), '') is null
     or nullif(btrim(p_content), '') is null then
    raise exception 'chat_message_version_input_required' using errcode = '22023';
  end if;

  if p_source not in ('original', 'inline_edit', 'retry', 'branch_edit') then
    raise exception 'invalid_chat_message_version_source' using errcode = '22023';
  end if;

  if (p_selection_start is null) <> (p_selection_end is null) then
    raise exception 'invalid_selection_range' using errcode = '22023';
  end if;

  if p_selection_start is not null and (
    p_selection_start < 0
    or p_selection_end <= p_selection_start
    or p_selection_end > v_original_length
  ) then
    raise exception 'invalid_selection_range' using errcode = '22023';
  end if;

  if p_branch_id is not null and not exists (
    select 1
    from public.chat_branches branch
    where branch.id = p_branch_id
      and branch.owner_id = v_owner
      and branch.chat_id = btrim(p_chat_id)
  ) then
    raise exception 'branch_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'kova:chat-version:' || v_owner::text || ':' || btrim(p_chat_id) || ':' || btrim(p_message_id),
      0
    )
  );

  if p_accept then
    update public.chat_message_versions
    set accepted = false
    where owner_id = v_owner
      and chat_id = btrim(p_chat_id)
      and message_id = btrim(p_message_id)
      and accepted;
  end if;

  <<insert_attempt>>
  loop
    select coalesce(max(version), 0) + 1
    into v_next
    from public.chat_message_versions
    where owner_id = v_owner
      and chat_id = btrim(p_chat_id)
      and message_id = btrim(p_message_id);

    begin
      insert into public.chat_message_versions (
        owner_id,
        chat_id,
        message_id,
        branch_id,
        version,
        source,
        instruction,
        content,
        original_content,
        selection_start,
        selection_end,
        accepted
      ) values (
        v_owner,
        btrim(p_chat_id),
        btrim(p_message_id),
        p_branch_id,
        v_next,
        p_source,
        nullif(btrim(coalesce(p_instruction, '')), ''),
        p_content,
        p_original_content,
        p_selection_start,
        p_selection_end,
        p_accept
      )
      returning * into v_row;
      exit insert_attempt;
    exception
      when unique_violation then
        if v_retry then
          raise;
        end if;
        v_retry := true;
    end;
  end loop;

  delete from public.chat_message_versions old
  where old.owner_id = v_owner
    and old.chat_id = btrim(p_chat_id)
    and old.message_id = btrim(p_message_id)
    and not old.accepted
    and old.version <= greatest(v_row.version - 50, 0);

  return v_row;
end;
$$;

-- The source-only positional overload differs from production's accepted-first
-- signature. Named callers retain identical parameter names on the canonical
-- production signature; removing the obsolete overload avoids PostgREST
-- ambiguity. No CASCADE: an unexpected dependency must stop migration safely.
drop function if exists public.kova_record_message_version(
  text,text,text,text,uuid,text,text,integer,integer,boolean,integer
);

CREATE OR REPLACE FUNCTION public.kova_record_message_version(p_chat_id text, p_message_id text, p_source text, p_content text, p_branch_id uuid DEFAULT NULL::uuid, p_instruction text DEFAULT NULL::text, p_original_content text DEFAULT NULL::text, p_accepted boolean DEFAULT true, p_selection_start integer DEFAULT NULL::integer, p_selection_end integer DEFAULT NULL::integer, p_max_versions integer DEFAULT 50)
 RETURNS chat_message_versions
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
    v_selection_bound := public.utf16_code_unit_length(coalesce(p_original_content, p_content));
    if p_selection_start < 0 or p_selection_end <= p_selection_start or p_selection_end > v_selection_bound then
      raise exception 'invalid_selection_range' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('kova:chat-version:' || v_owner::text || ':' || btrim(p_chat_id) || ':' || btrim(p_message_id), 0)
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

CREATE OR REPLACE FUNCTION public.kova_accept_message_version(p_version_id uuid)
 RETURNS chat_message_versions
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
    hashtextextended('kova:chat-version:' || v_owner::text || ':' || v_target.chat_id || ':' || v_target.message_id, 0)
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

  -- Clear the old accepted row before setting the target to satisfy the
  -- immediate partial unique index independently of physical row order.
  update public.chat_message_versions set accepted = false
   where owner_id = v_owner and chat_id = v_target.chat_id
     and message_id = v_target.message_id and accepted;
  update public.chat_message_versions set accepted = true
   where id = p_version_id and owner_id = v_owner;

  select * into v_target
  from public.chat_message_versions
  where id = p_version_id and owner_id = v_owner;

  return v_target;
end
$function$;

CREATE OR REPLACE FUNCTION public.kova_create_chat_branch(p_chat_id text, p_conversation_id text, p_parent_branch_id uuid DEFAULT NULL::uuid, p_branch_from_parent_message_id text DEFAULT NULL::text, p_branch_from_message_id text DEFAULT NULL::text, p_branch_from_message_index integer DEFAULT NULL::integer, p_message_ids text[] DEFAULT '{}'::text[], p_label text DEFAULT NULL::text, p_activate boolean DEFAULT true, p_max_branches integer DEFAULT 40)
 RETURNS chat_branches
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
    hashtextextended('kova:chat-branches:' || v_owner::text || ':' || btrim(p_chat_id), 0)
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

CREATE OR REPLACE FUNCTION public.kova_activate_chat_branch(p_chat_id text, p_branch_id uuid)
 RETURNS chat_branches
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
    hashtextextended('kova:chat-branches:' || v_owner::text || ':' || btrim(p_chat_id), 0)
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

  update public.chat_branches set active = false, updated_at = now()
   where owner_id = v_owner and chat_id = btrim(p_chat_id) and active;
  update public.chat_branches set active = true, updated_at = now()
   where id = p_branch_id and owner_id = v_owner;

  select * into v_target
  from public.chat_branches
  where id = p_branch_id and owner_id = v_owner;

  return v_target;
end
$function$;

CREATE OR REPLACE FUNCTION public.kova_update_chat_branch_messages(p_branch_id uuid, p_message_ids text[], p_label text DEFAULT NULL::text)
 RETURNS chat_branches
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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

create or replace function public.accept_chat_message_version(p_version_id uuid)
returns public.chat_message_versions language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$ select public.kova_accept_message_version(p_version_id) $$;

create or replace function public.activate_chat_branch(p_branch_id uuid)
returns public.chat_branches language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare v_chat_id text;
begin
  select chat_id into v_chat_id from public.chat_branches
  where id=p_branch_id and owner_id=(select auth.uid());
  if v_chat_id is null then raise exception 'branch_not_found' using errcode='P0002'; end if;
  return public.kova_activate_chat_branch(v_chat_id,p_branch_id);
end;
$$;

-- Preserve the original six-argument contract for older clients. Its durable
-- conversation mapping is generated inside the same transaction.
create or replace function public.create_chat_branch(
  p_chat_id text, p_parent_branch_id uuid default null,
  p_branch_from_message_id text default null,
  p_branch_from_parent_message_id text default null,
  p_label text default null, p_activate boolean default true
)
returns public.chat_branches language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
  select public.kova_create_chat_branch(
    p_chat_id, gen_random_uuid()::text, p_parent_branch_id,
    p_branch_from_parent_message_id, p_branch_from_message_id,
    null, '{}'::text[], p_label, p_activate, 40
  )
$$;

-- The required conversation parameter distinguishes this overload even when
-- optional arguments are omitted, so PostgREST dispatch stays unambiguous.
create or replace function public.create_chat_branch(
  p_chat_id text, p_conversation_id text, p_parent_branch_id uuid default null,
  p_branch_from_parent_message_id text default null,
  p_branch_from_message_id text default null,
  p_branch_from_message_index integer default null,
  p_message_ids text[] default '{}'::text[], p_label text default null,
  p_activate boolean default true, p_max_branches integer default 40
)
returns public.chat_branches language sql security invoker
set search_path = pg_catalog, public, pg_temp
as $$
  select public.kova_create_chat_branch(
    p_chat_id,p_conversation_id,p_parent_branch_id,p_branch_from_parent_message_id,
    p_branch_from_message_id,p_branch_from_message_index,p_message_ids,p_label,
    p_activate,p_max_branches
  )
$$;

create or replace function public.save_chat_custom_rules(
  p_chat_id text,
  p_instructions text,
  p_enabled boolean default true
)
returns public.chat_custom_rules
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_row public.chat_custom_rules%rowtype;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null then
    raise exception 'chat_id_required' using errcode = '22023';
  end if;

  if char_length(coalesce(p_instructions, '')) > 8000 then
    raise exception 'chat_rules_too_long' using errcode = '22023';
  end if;

  insert into public.chat_custom_rules (
    owner_id,
    chat_id,
    instructions,
    enabled
  ) values (
    v_owner,
    btrim(p_chat_id),
    coalesce(p_instructions, ''),
    p_enabled
  )
  on conflict (owner_id, chat_id) do update
  set instructions = excluded.instructions,
      enabled = excluded.enabled,
      updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_chat_custom_rules(
  p_chat_id text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  delete from public.chat_custom_rules
  where owner_id = v_owner
    and chat_id = btrim(p_chat_id);

  return found;
end;
$$;

create or replace function public.pin_chat_source(
  p_chat_id text,
  p_source_type text,
  p_source_id uuid,
  p_project_id uuid default null
)
returns public.chat_pinned_files
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_count integer;
  v_row public.chat_pinned_files%rowtype;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null or p_source_id is null then
    raise exception 'pin_source_input_required' using errcode = '22023';
  end if;

  if p_source_type = 'library' then
    if p_project_id is not null or not exists (
      select 1
      from public.user_library_items item
      where item.id = p_source_id
        and item.user_id = v_owner
    ) then
      raise exception 'pin_source_not_authorized' using errcode = '42501';
    end if;
  elsif p_source_type = 'project_file' then
    if p_project_id is null or not exists (
      select 1
      from public.project_files file
      join public.projects project on project.id = file.project_id
      left join public.project_members member
        on member.project_id = project.id
       and member.user_id = v_owner
      where file.id = p_source_id
        and file.project_id = p_project_id
        and (project.owner_id = v_owner or member.user_id = v_owner)
    ) then
      raise exception 'pin_source_not_authorized' using errcode = '42501';
    end if;
  else
    raise exception 'invalid_pin_source_type' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('kova:chat-pins:' || v_owner::text || ':' || btrim(p_chat_id), 0)
  );

  select *
  into v_row
  from public.chat_pinned_files
  where owner_id = v_owner
    and chat_id = btrim(p_chat_id)
    and source_type = p_source_type
    and source_id = p_source_id
  for update;

  if found then
    update public.chat_pinned_files
    set project_id = p_project_id,
        status = 'active',
        updated_at = now()
    where id = v_row.id
      and owner_id = v_owner
    returning * into v_row;
    return v_row;
  end if;

  select count(*)::integer
  into v_count
  from public.chat_pinned_files
  where owner_id = v_owner
    and chat_id = btrim(p_chat_id)
    and status <> 'deleted';

  if v_count >= 25 then
    raise exception 'chat_pin_limit_reached' using errcode = '22023';
  end if;

  insert into public.chat_pinned_files (
    owner_id,
    chat_id,
    source_type,
    source_id,
    project_id,
    status
  ) values (
    v_owner,
    btrim(p_chat_id),
    p_source_type,
    p_source_id,
    p_project_id,
    'active'
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.unpin_chat_source(
  p_pin_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  delete from public.chat_pinned_files
  where id = p_pin_id
    and owner_id = v_owner;

  return found;
end;
$$;

create or replace function public.get_chat_context_bundle(
  p_chat_id text,
  p_project_id uuid default null,
  p_max_chars integer default 24000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_limit integer := greatest(1000, least(coalesce(p_max_chars, 24000), 48000));
  v_remaining integer;
  v_chat_rules text;
  v_project_instructions text;
  v_pins jsonb := '[]'::jsonb;
  v_pin record;
  v_title text;
  v_mime text;
  v_content text;
  v_piece text;
  v_take integer;
  v_status text;
  v_any_truncated boolean := false;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_chat_id), '') is null then
    raise exception 'chat_id_required' using errcode = '22023';
  end if;

  select rules.instructions
  into v_chat_rules
  from public.chat_custom_rules rules
  where rules.owner_id = v_owner
    and rules.chat_id = btrim(p_chat_id)
    and rules.enabled
  limit 1;

  if p_project_id is not null then
    select project.system_prompt
    into v_project_instructions
    from public.projects project
    where project.id = p_project_id
      and (
        project.owner_id = v_owner
        or exists (
          select 1
          from public.project_members member
          where member.project_id = project.id
            and member.user_id = v_owner
        )
      )
    limit 1;
  end if;

  v_remaining := v_limit;

  for v_pin in
    select pin.*
    from public.chat_pinned_files pin
    where pin.owner_id = v_owner
      and pin.chat_id = btrim(p_chat_id)
      and pin.status in ('active', 'indexing')
    order by pin.created_at, pin.id
    limit 25
  loop
    if v_remaining <= 0 then
      v_any_truncated := true;
      exit;
    end if;

    v_title := null;
    v_mime := null;
    v_content := null;
    v_status := v_pin.status;
    v_take := least(v_remaining, 8000);

    if v_pin.source_type = 'library' then
      select
        coalesce(item.file_name, item.title),
        item.file_type,
        left(coalesce(item.content_text, ''), v_take + 1)
      into v_title, v_mime, v_content
      from public.user_library_items item
      where item.id = v_pin.source_id
        and item.user_id = v_owner;

      if not found then
        v_status := 'permission_lost';
        v_content := '';
      end if;
    elsif v_pin.source_type = 'project_file' then
      select
        file.name,
        file.mime_type,
        left(coalesce((
          select string_agg(chunk.content, E'\n\n' order by chunk.chunk_index)
          from (
            select left(c.content, 4000) as content, c.chunk_index
            from public.project_file_chunks c
            where c.file_id = file.id
              and c.project_id = file.project_id
            order by c.chunk_index
            limit 12
          ) chunk
        ), ''), v_take + 1)
      into v_title, v_mime, v_content
      from public.project_files file
      join public.projects project on project.id = file.project_id
      left join public.project_members member
        on member.project_id = project.id
       and member.user_id = v_owner
      where file.id = v_pin.source_id
        and file.project_id = v_pin.project_id
        and (project.owner_id = v_owner or member.user_id = v_owner)
      limit 1;

      if not found then
        v_status := 'permission_lost';
        v_content := '';
      elsif coalesce(v_content, '') = '' then
        v_status := 'indexing';
      end if;
    end if;

    -- Never inject inaccessible or not-yet-indexed content into the model.
    if v_status not in ('active') then
      v_piece := '';
    else
      v_piece := left(coalesce(v_content, ''), v_take);
    end if;

    if v_status = 'active' and char_length(coalesce(v_content, '')) > v_take then
      v_any_truncated := true;
    end if;

    v_pins := v_pins || jsonb_build_array(jsonb_build_object(
      'pin_id', v_pin.id,
      'source_type', v_pin.source_type,
      'source_id', v_pin.source_id,
      'project_id', v_pin.project_id,
      'title', v_title,
      'mime_type', v_mime,
      'status', v_status,
      'content', v_piece,
      'truncated', v_status = 'active' and char_length(coalesce(v_content, '')) > v_take
    ));

    v_remaining := greatest(v_remaining - char_length(v_piece), 0);
  end loop;

  return jsonb_build_object(
    'chat_id', btrim(p_chat_id),
    'instruction_precedence', jsonb_build_array('global', 'project', 'chat'),
    'chat_rules', coalesce(v_chat_rules, ''),
    'project_instructions', coalesce(v_project_instructions, ''),
    'pinned_sources', v_pins,
    'max_chars', v_limit,
    'used_chars', v_limit - v_remaining,
    'truncated', v_any_truncated
  );
end;
$$;

create or replace function public.get_chat_workspace_state(
  p_chat_id text,
  p_message_id text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_chat text := btrim(coalesce(p_chat_id, ''));
  v_message text := nullif(btrim(coalesce(p_message_id, '')), '');
  v_branches jsonb;
  v_rules jsonb;
  v_pins jsonb;
  v_versions jsonb;
begin
  if v_owner is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if v_chat = '' then
    raise exception 'chat_id_required' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', branch.id,
    'conversation_id', branch.conversation_id,
    'message_ids', branch.message_ids,
    'branch_from_message_index', branch.branch_from_message_index,
    'parent_branch_id', branch.parent_branch_id,
    'branch_from_message_id', branch.branch_from_message_id,
    'branch_from_parent_message_id', branch.branch_from_parent_message_id,
    'label', branch.label,
    'active', branch.active,
    'created_at', branch.created_at,
    'updated_at', branch.updated_at
  ) order by branch.created_at, branch.id), '[]'::jsonb)
  into v_branches
  from (
    select *
    from public.chat_branches
    where owner_id = v_owner
      and chat_id = v_chat
    order by created_at, id
    limit 40
  ) branch;

  select coalesce((
    select jsonb_build_object(
      'instructions', rules.instructions,
      'enabled', rules.enabled,
      'updated_at', rules.updated_at
    )
    from public.chat_custom_rules rules
    where rules.owner_id = v_owner
      and rules.chat_id = v_chat
    limit 1
  ), 'null'::jsonb)
  into v_rules;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pin.id,
    'source_type', pin.source_type,
    'source_id', pin.source_id,
    'project_id', pin.project_id,
    'stored_status', pin.status,
    'display_status', pin.display_status,
    'title', pin.title,
    'mime_type', pin.mime_type,
    'created_at', pin.created_at,
    'updated_at', pin.updated_at
  ) order by pin.created_at, pin.id), '[]'::jsonb)
  into v_pins
  from (
    select
      p.*,
      case
        when p.source_type = 'library' and item.id is null then 'permission_lost'
        when p.source_type = 'project_file' and file.id is null then 'permission_lost'
        when p.source_type = 'project_file' and not exists (
          select 1 from public.project_file_chunks chunk
          where chunk.file_id = p.source_id
            and chunk.project_id = p.project_id
        ) and p.status = 'active' then 'indexing'
        else p.status
      end as display_status,
      case
        when p.source_type = 'library' then coalesce(item.file_name, item.title)
        else file.name
      end as title,
      case
        when p.source_type = 'library' then item.file_type
        else file.mime_type
      end as mime_type
    from public.chat_pinned_files p
    left join public.user_library_items item
      on p.source_type = 'library'
     and item.id = p.source_id
     and item.user_id = v_owner
    left join public.project_files file
      on p.source_type = 'project_file'
     and file.id = p.source_id
     and file.project_id = p.project_id
     and exists (
       select 1
       from public.projects project
       left join public.project_members member
         on member.project_id = project.id
        and member.user_id = v_owner
       where project.id = file.project_id
         and (project.owner_id = v_owner or member.user_id = v_owner)
     )
    where p.owner_id = v_owner
      and p.chat_id = v_chat
      and p.status <> 'deleted'
    order by p.created_at, p.id
    limit 25
  ) pin;

  if v_message is null then
    v_versions := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', version.id,
      'branch_id', version.branch_id,
      'version', version.version,
      'source', version.source,
      'instruction', version.instruction,
      'content', version.content,
      'original_content', version.original_content,
      'selection_start', version.selection_start,
      'selection_end', version.selection_end,
      'accepted', version.accepted,
      'created_at', version.created_at
    ) order by version.version), '[]'::jsonb)
    into v_versions
    from (
      select *
      from public.chat_message_versions
      where owner_id = v_owner
        and chat_id = v_chat
        and message_id = v_message
      order by version desc
      limit 50
    ) version;
  end if;

  return jsonb_build_object(
    'schema_version', 'day15-v1',
    'chat_id', v_chat,
    'active_branch_id', (
      select branch.id
      from public.chat_branches branch
      where branch.owner_id = v_owner
        and branch.chat_id = v_chat
        and branch.active
      limit 1
    ),
    'branches', v_branches,
    'custom_rules', v_rules,
    'pinned_sources', v_pins,
    'message_id', v_message,
    'message_versions', v_versions
  );
end;
$$;

-- Ensure direct client inserts/updates cannot attach a version to a branch
-- owned by a different user or belonging to another chat.
create or replace function public.validate_chat_message_version_branch()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.branch_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.chat_branches branch
    where branch.id = new.branch_id
      and branch.owner_id = new.owner_id
      and branch.chat_id = new.chat_id
  ) then
    raise exception 'invalid_chat_message_version_branch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_chat_message_version_branch() from public;
revoke all on function public.validate_chat_message_version_branch() from anon;
revoke all on function public.validate_chat_message_version_branch() from authenticated;
grant execute on function public.validate_chat_message_version_branch() to service_role;

drop trigger if exists trg_validate_chat_message_version_branch
  on public.chat_message_versions;
create trigger trg_validate_chat_message_version_branch
before insert or update of branch_id, owner_id, chat_id
on public.chat_message_versions
for each row
execute function public.validate_chat_message_version_branch();
-- Match the deployed 512-ID ceiling for direct writes as well as RPCs.
-- Historical source-only rows remain readable until populated-target validation.
alter table public.chat_branches
  drop constraint if exists kova_branch_message_ids_lineage_check;
alter table public.chat_branches
  add constraint kova_branch_message_ids_lineage_check
  check (cardinality(message_ids) <= 512) not valid;

-- Enforce paired UTF-16 offsets on new writes without rejecting an upgrade
-- solely because an older client once stored invalid historical offsets.
-- NOT VALID preserves historical rows; later full rehearsal reports whether
-- explicit validation can safely be performed on a populated target.
alter table public.chat_message_versions
  drop constraint if exists kova_message_selection_lineage_check;
alter table public.chat_message_versions
  add constraint kova_message_selection_lineage_check check (
    (selection_start is null) = (selection_end is null)
    and (selection_start is null or (
      selection_start >= 0 and selection_end > selection_start
      and selection_end <= public.utf16_code_unit_length(coalesce(original_content,content))
    ))
  ) not valid;

-- Source's earlier aliases were definers. Reassert the invoker/ACL contract for
-- every known overload, including canonical functions already in production.
do $migration$
declare routine record;
begin
  for routine in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'utf16_code_unit_length', 'create_chat_message_version',
      'accept_chat_message_version', 'create_chat_branch', 'activate_chat_branch',
      'save_chat_custom_rules','delete_chat_custom_rules','pin_chat_source',
      'unpin_chat_source','get_chat_context_bundle','get_chat_workspace_state',
      'kova_record_message_version','kova_accept_message_version',
      'kova_create_chat_branch','kova_activate_chat_branch','kova_update_chat_branch_messages'
    ])
  loop
    execute format('alter function %s security invoker',routine.signature);
    execute format('revoke all on function %s from public,anon',routine.signature);
    execute format('grant execute on function %s to authenticated,service_role',routine.signature);
  end loop;
end
$migration$;
