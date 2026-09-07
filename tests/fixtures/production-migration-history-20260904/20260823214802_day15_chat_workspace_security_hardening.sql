-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

-- Day 15 production hardening for durable chat editing, branches, rules, and pinned files.
-- This migration is idempotent and non-destructive.

-- Bound additional user-controlled fields and require coherent pinned-file metadata.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_branches'::regclass
      and conname = 'chat_branches_parent_message_id_len'
  ) then
    alter table public.chat_branches
      add constraint chat_branches_parent_message_id_len
      check (
        branch_from_parent_message_id is null
        or char_length(branch_from_parent_message_id) <= 256
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_message_versions'::regclass
      and conname = 'chat_message_versions_content_len'
  ) then
    alter table public.chat_message_versions
      add constraint chat_message_versions_content_len
      check (char_length(content) <= 131072);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_message_versions'::regclass
      and conname = 'chat_message_versions_original_content_len'
  ) then
    alter table public.chat_message_versions
      add constraint chat_message_versions_original_content_len
      check (
        original_content is null
        or char_length(original_content) <= 131072
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_pinned_files'::regclass
      and conname = 'chat_pinned_files_source_project_coherence'
  ) then
    alter table public.chat_pinned_files
      add constraint chat_pinned_files_source_project_coherence
      check (
        (source_type = 'library' and project_id is null)
        or
        (source_type = 'project_file' and project_id is not null)
      );
  end if;
end
$$;

-- Cover foreign keys used during branch navigation and pinned-file cleanup.
create index if not exists chat_branches_parent_branch_idx
  on public.chat_branches(parent_branch_id)
  where parent_branch_id is not null;

create index if not exists chat_message_versions_branch_idx
  on public.chat_message_versions(branch_id)
  where branch_id is not null;

create index if not exists chat_pinned_files_project_idx
  on public.chat_pinned_files(project_id)
  where project_id is not null;

-- Reject cross-chat parents, self-parenting, and ancestry cycles.
create or replace function public.validate_chat_branch_lineage()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.parent_branch_id is null then
    return new;
  end if;

  if new.parent_branch_id = new.id then
    raise exception 'invalid_parent_branch';
  end if;

  if not exists (
    select 1
    from public.chat_branches parent
    where parent.id = new.parent_branch_id
      and parent.owner_id = new.owner_id
      and parent.chat_id = new.chat_id
  ) then
    raise exception 'invalid_parent_branch';
  end if;

  if tg_op = 'UPDATE' and exists (
    with recursive descendants(id) as (
      select child.id
      from public.chat_branches child
      where child.parent_branch_id = new.id
        and child.owner_id = new.owner_id
        and child.chat_id = new.chat_id
      union
      select child.id
      from public.chat_branches child
      join descendants d on child.parent_branch_id = d.id
      where child.owner_id = new.owner_id
        and child.chat_id = new.chat_id
    )
    select 1
    from descendants
    where id = new.parent_branch_id
  ) then
    raise exception 'branch_cycle_rejected';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_chat_branch_lineage() from public, anon, authenticated;
grant execute on function public.validate_chat_branch_lineage() to service_role;

-- Keep updated_at trustworthy for all mutable Day 15 records.
drop trigger if exists chat_branches_touch_updated_at on public.chat_branches;
create trigger chat_branches_touch_updated_at
before update on public.chat_branches
for each row execute function public.touch_updated_at();

drop trigger if exists chat_custom_rules_touch_updated_at on public.chat_custom_rules;
create trigger chat_custom_rules_touch_updated_at
before update on public.chat_custom_rules
for each row execute function public.touch_updated_at();

drop trigger if exists chat_pinned_files_touch_updated_at on public.chat_pinned_files;
create trigger chat_pinned_files_touch_updated_at
before update on public.chat_pinned_files
for each row execute function public.touch_updated_at();

alter function public.touch_updated_at() set search_path = public, pg_temp;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.touch_updated_at() to service_role;

-- Replace owner policies with init-plan-safe auth checks.
drop policy if exists chat_branches_owner_select on public.chat_branches;
drop policy if exists chat_branches_owner_insert on public.chat_branches;
drop policy if exists chat_branches_owner_update on public.chat_branches;
drop policy if exists chat_branches_owner_delete on public.chat_branches;
create policy chat_branches_owner_select on public.chat_branches
  for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy chat_branches_owner_insert on public.chat_branches
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy chat_branches_owner_update on public.chat_branches
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy chat_branches_owner_delete on public.chat_branches
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists chat_custom_rules_owner_select on public.chat_custom_rules;
drop policy if exists chat_custom_rules_owner_insert on public.chat_custom_rules;
drop policy if exists chat_custom_rules_owner_update on public.chat_custom_rules;
drop policy if exists chat_custom_rules_owner_delete on public.chat_custom_rules;
create policy chat_custom_rules_owner_select on public.chat_custom_rules
  for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy chat_custom_rules_owner_insert on public.chat_custom_rules
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy chat_custom_rules_owner_update on public.chat_custom_rules
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy chat_custom_rules_owner_delete on public.chat_custom_rules
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists chat_message_versions_owner_select on public.chat_message_versions;
drop policy if exists chat_message_versions_owner_insert on public.chat_message_versions;
drop policy if exists chat_message_versions_owner_update on public.chat_message_versions;
drop policy if exists chat_message_versions_owner_delete on public.chat_message_versions;
create policy chat_message_versions_owner_select on public.chat_message_versions
  for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy chat_message_versions_owner_insert on public.chat_message_versions
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy chat_message_versions_owner_update on public.chat_message_versions
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy chat_message_versions_owner_delete on public.chat_message_versions
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists chat_pinned_files_owner_select on public.chat_pinned_files;
drop policy if exists chat_pinned_files_owner_insert on public.chat_pinned_files;
drop policy if exists chat_pinned_files_owner_update on public.chat_pinned_files;
drop policy if exists chat_pinned_files_owner_delete on public.chat_pinned_files;
create policy chat_pinned_files_owner_select on public.chat_pinned_files
  for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy chat_pinned_files_owner_insert on public.chat_pinned_files
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (
      (
        source_type = 'library'
        and project_id is null
        and exists (
          select 1
          from public.user_library_items item
          where item.id = chat_pinned_files.source_id
            and item.user_id = (select auth.uid())
        )
      )
      or
      (
        source_type = 'project_file'
        and project_id is not null
        and exists (
          select 1
          from public.project_files file
          join public.projects project on project.id = file.project_id
          left join public.project_members member
            on member.project_id = project.id
           and member.user_id = (select auth.uid())
          where file.id = chat_pinned_files.source_id
            and file.project_id = chat_pinned_files.project_id
            and (
              project.owner_id = (select auth.uid())
              or member.user_id = (select auth.uid())
            )
        )
      )
    )
  );
create policy chat_pinned_files_owner_update on public.chat_pinned_files
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and (
      (
        source_type = 'library'
        and project_id is null
        and exists (
          select 1
          from public.user_library_items item
          where item.id = chat_pinned_files.source_id
            and item.user_id = (select auth.uid())
        )
      )
      or
      (
        source_type = 'project_file'
        and project_id is not null
        and exists (
          select 1
          from public.project_files file
          join public.projects project on project.id = file.project_id
          left join public.project_members member
            on member.project_id = project.id
           and member.user_id = (select auth.uid())
          where file.id = chat_pinned_files.source_id
            and file.project_id = chat_pinned_files.project_id
            and (
              project.owner_id = (select auth.uid())
              or member.user_id = (select auth.uid())
            )
        )
      )
    )
  );
create policy chat_pinned_files_owner_delete on public.chat_pinned_files
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- RLS is not a TRUNCATE boundary. Grant only the intended user-facing DML.
revoke all on table public.chat_branches from public, anon, authenticated;
revoke all on table public.chat_custom_rules from public, anon, authenticated;
revoke all on table public.chat_message_versions from public, anon, authenticated;
revoke all on table public.chat_pinned_files from public, anon, authenticated;

grant select, insert, update, delete on table public.chat_branches to authenticated;
grant select, insert, update, delete on table public.chat_custom_rules to authenticated;
grant select, insert, update, delete on table public.chat_message_versions to authenticated;
grant select, insert, update, delete on table public.chat_pinned_files to authenticated;

grant all privileges on table public.chat_branches to service_role;
grant all privileges on table public.chat_custom_rules to service_role;
grant all privileges on table public.chat_message_versions to service_role;
grant all privileges on table public.chat_pinned_files to service_role;

-- Remove public execution from privileged or trigger-only functions.
revoke all on function public.disconnect_github_account(uuid, boolean) from public, anon;
grant execute on function public.disconnect_github_account(uuid, boolean) to authenticated, service_role;

revoke all on function public.promote_agent_deliverable(uuid, text, uuid, text, text, boolean) from public, anon;
grant execute on function public.promote_agent_deliverable(uuid, text, uuid, text, text, boolean) to authenticated, service_role;

revoke all on function public.validate_agent_dependency_edge() from public, anon, authenticated;
grant execute on function public.validate_agent_dependency_edge() to service_role;

alter function public.set_deep_research_updated_at() set search_path = public, pg_temp;
revoke all on function public.set_deep_research_updated_at() from public, anon, authenticated;
grant execute on function public.set_deep_research_updated_at() to service_role;

alter function public.prevent_financial_entry_mutation() set search_path = public, pg_temp;
revoke all on function public.prevent_financial_entry_mutation() from public, anon, authenticated;
grant execute on function public.prevent_financial_entry_mutation() to service_role;
;
