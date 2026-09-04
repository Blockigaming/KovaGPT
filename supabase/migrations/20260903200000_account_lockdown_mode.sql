-- Account-scoped Lockdown Mode. The setting is stored inside the existing
-- user_preferences JSON document so it composes with current preferences,
-- while a narrow RPC updates only this security-sensitive key atomically.
create or replace function public.set_lockdown_mode(p_enabled boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings jsonb;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_enabled is null then
    raise exception 'invalid_lockdown_mode';
  end if;

  insert into public.user_preferences (user_id, settings, updated_at)
  values (
    v_user_id,
    jsonb_build_object('lockdown_mode', p_enabled),
    now()
  )
  on conflict (user_id) do update
    set settings = jsonb_set(
          case
            when jsonb_typeof(public.user_preferences.settings) = 'object'
              then public.user_preferences.settings
            else '{}'::jsonb
          end,
          '{lockdown_mode}',
          to_jsonb(p_enabled),
          true
        ),
        updated_at = now()
  returning settings into v_settings;

  return jsonb_build_object(
    'enabled', v_settings -> 'lockdown_mode',
    'updated_at', now()
  );
end;
$$;

revoke all on function public.set_lockdown_mode(boolean) from public, anon;
grant execute on function public.set_lockdown_mode(boolean) to authenticated;
grant execute on function public.set_lockdown_mode(boolean) to service_role;
grant select, insert, update on table public.user_preferences to authenticated;

create or replace function kova_private.audit_lockdown_mode_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old boolean := false;
  v_new boolean := false;
begin
  if jsonb_typeof(new.settings -> 'lockdown_mode') = 'boolean' then
    v_new := (new.settings ->> 'lockdown_mode')::boolean;
  end if;
  if tg_op = 'UPDATE' and jsonb_typeof(old.settings -> 'lockdown_mode') = 'boolean' then
    v_old := (old.settings ->> 'lockdown_mode')::boolean;
  end if;
  if v_old is distinct from v_new then
    insert into public.account_audit_entries (
      user_id,
      event_type,
      safe_description,
      actor_id,
      result,
      metadata
    ) values (
      new.user_id,
      'lockdown_mode_changed',
      case when v_new then 'Lockdown Mode enabled' else 'Lockdown Mode disabled' end,
      new.user_id,
      'success',
      jsonb_build_object('enabled', v_new)
    );
  end if;
  return new;
end;
$$;

revoke all on function kova_private.audit_lockdown_mode_change() from public, anon, authenticated;
grant execute on function kova_private.audit_lockdown_mode_change() to service_role;

drop trigger if exists audit_user_lockdown_mode_change on public.user_preferences;
create trigger audit_user_lockdown_mode_change
after insert or update of settings on public.user_preferences
for each row execute function kova_private.audit_lockdown_mode_change();
