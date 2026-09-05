-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Day 15: persist the character range used for selected-text edits.
alter table public.chat_message_versions
  add column if not exists selection_start integer,
  add column if not exists selection_end integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.chat_message_versions'::regclass
      and conname = 'chat_message_versions_selection_range'
  ) then
    alter table public.chat_message_versions
      add constraint chat_message_versions_selection_range
      check (
        (selection_start is null and selection_end is null)
        or (
          selection_start >= 0
          and selection_end > selection_start
          and selection_end <= char_length(coalesce(original_content, content))
        )
      );
  end if;
end
$$;

-- The RPC is not yet used by the deployed application, so replace the initial
-- 8-argument contract with the complete selected-range contract.
drop function if exists public.create_chat_message_version(
  text, text, text, text, text, text, uuid, boolean
);

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
  v_original_length integer := char_length(coalesce(p_original_content, p_content));
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

revoke all on function public.create_chat_message_version(
  text, text, text, text, text, text, uuid, integer, integer, boolean
) from public, anon;
grant execute on function public.create_chat_message_version(
  text, text, text, text, text, text, uuid, integer, integer, boolean
) to authenticated, service_role;

comment on function public.create_chat_message_version(
  text, text, text, text, text, text, uuid, integer, integer, boolean
) is 'Creates an atomically numbered chat message version with optional selected-text range metadata.';
;
