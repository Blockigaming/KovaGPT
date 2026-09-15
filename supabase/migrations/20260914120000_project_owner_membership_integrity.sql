-- Keep the canonical project owner membership immutable. This closes paths where
-- an owner could be removed from project_members or another member could be
-- labelled as an owner while projects.owner_id continued to name someone else.

create or replace function public.enforce_project_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  canonical_owner uuid;
  previous_canonical_owner uuid;
  candidate_user uuid := coalesce(new.user_id, old.user_id);
  candidate_role public.project_role := coalesce(new.role, old.role);
  candidate_project uuid := coalesce(new.project_id, old.project_id);
begin
  select p.owner_id
    into canonical_owner
  from public.projects p
  where p.id = candidate_project;

  -- A missing parent means this is the project's own cascading deletion.
  if canonical_owner is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' and old.user_id = canonical_owner then
    raise exception 'project_owner_membership_required' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    select p.owner_id
      into previous_canonical_owner
    from public.projects p
    where p.id = old.project_id;

    if old.user_id = previous_canonical_owner and (
      new.project_id is distinct from old.project_id
      or new.user_id is distinct from old.user_id
    ) then
      raise exception 'project_owner_membership_required' using errcode = '23514';
    end if;
  end if;

  if candidate_user = canonical_owner and candidate_role <> 'owner'::public.project_role then
    raise exception 'project_owner_role_required' using errcode = '23514';
  end if;

  if candidate_user <> canonical_owner and candidate_role = 'owner'::public.project_role then
    raise exception 'project_owner_role_reserved' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.enforce_project_owner_membership() from public, anon, authenticated;
grant execute on function public.enforce_project_owner_membership() to service_role;

drop trigger if exists trg_project_owner_membership_integrity on public.project_members;
create trigger trg_project_owner_membership_integrity
before insert or update or delete on public.project_members
for each row execute function public.enforce_project_owner_membership();

-- Repair historical drift before relying on the trigger for future writes.
-- The deletion fence is bypassed only inside this migration so pending owners
-- retain visibility and retry authority; the transaction restores the fence
-- before application writes can resume.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.project_members'::regclass
      and tgname = 'project_members_deletion_write_fence'
  ) then
    alter table public.project_members disable trigger project_members_deletion_write_fence;
  end if;
end;
$$;

insert into public.project_members(project_id, user_id, role)
select p.id, p.owner_id, 'owner'::public.project_role
from public.projects p
on conflict (project_id, user_id) do update set role = excluded.role;

update public.project_members pm
set role = 'editor'::public.project_role
from public.projects p
where p.id = pm.project_id
  and pm.user_id <> p.owner_id
  and pm.role = 'owner'::public.project_role;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.project_members'::regclass
      and tgname = 'project_members_deletion_write_fence'
  ) then
    alter table public.project_members enable trigger project_members_deletion_write_fence;
  end if;
end;
$$;
