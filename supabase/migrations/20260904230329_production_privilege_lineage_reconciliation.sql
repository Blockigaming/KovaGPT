-- Forward reconciliation of the reviewed production privilege lineage.
-- No data changes. Preserve caller-scoped helpers and the explicit access matrix
-- from the August 23 production hardening on both fresh and upgraded databases.

revoke truncate, trigger, references on all tables in schema public from public, anon, authenticated;
revoke update on all sequences in schema public from public, anon, authenticated;
do $migration$
begin
  -- MAINTAIN was introduced in PostgreSQL 17; older servers have no such grant.
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on all tables in schema public from public, anon, authenticated';
  end if;
end
$migration$;

-- Schema-local defaults cannot subtract PostgreSQL's global PUBLIC EXECUTE
-- default. Remove that global default for the proven migration owner first,
-- then remove any additive public-schema grants and explicitly allow service.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

-- The private implementation must enforce caller scope itself. An invoker
-- facade alone cannot protect an unguarded SECURITY DEFINER implementation.
create or replace function kova_private.family_owner_of(_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  result_owner uuid;
begin
  if auth.role() is distinct from 'service_role'
     and ((select auth.uid()) is null or (select auth.uid()) is distinct from _user_id) then
    raise exception 'forbidden_user_scope' using errcode = '42501';
  end if;
  select g.owner_id into result_owner
  from public.family_members m
  join public.family_groups g on g.id = m.group_id
  where m.user_id = _user_id
  limit 1;
  return result_owner;
end;
$function$;
revoke all on function kova_private.family_owner_of(uuid) from public, anon;
grant execute on function kova_private.family_owner_of(uuid) to authenticated, service_role;

-- Keep the plan helper under subscription RLS and preserve production's
-- explicit rejection of attempts to inspect another caller's billing state.
create or replace function public.user_plan_tier(_user_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  tier text := 'free';
  subscription_row record;
begin
  if auth.role() is distinct from 'service_role'
     and ((select auth.uid()) is null or (select auth.uid()) is distinct from _user_id) then
    raise exception 'forbidden_user_scope' using errcode = '42501';
  end if;

  for subscription_row in
    select price_id, status, current_period_end
    from public.subscriptions
    where user_id = _user_id
    order by created_at desc
    limit 5
  loop
    if (
      subscription_row.status in ('active', 'trialing', 'past_due')
      and (
        subscription_row.current_period_end is null
        or subscription_row.current_period_end > now()
      )
    ) or (
      subscription_row.status = 'canceled'
      and subscription_row.current_period_end > now()
    ) then
      if lower(coalesce(subscription_row.price_id, '')) like '%pro%' then
        return 'pro';
      elsif lower(coalesce(subscription_row.price_id, '')) like '%plus%' then
        tier := 'plus';
      end if;
    end if;
  end loop;

  return tier;
end;
$$;

revoke all on function public.user_plan_tier(uuid) from public, anon;
grant execute on function public.user_plan_tier(uuid) to authenticated, service_role;

-- Trigger-only routines are executed by their triggers, never as browser RPCs.
do $migration$
declare
  routine text;
begin
  foreach routine in array array[
    'enforce_family_member_cap', 'enforce_supported_agent_job_kind',
    'set_feedback_submission_updated_at', 'validate_agent_dependency_edge',
    'set_deep_research_updated_at', 'prevent_financial_entry_mutation', 'touch_updated_at'
  ] loop
    execute format('alter function public.%I() set search_path = pg_catalog, public, pg_temp', routine);
    execute format('revoke all on function public.%I() from public, anon, authenticated', routine);
    execute format('grant execute on function public.%I() to service_role', routine);
  end loop;
end
$migration$;

-- Server-only tables had RLS enabled but inherited broad client grants and no explicit policy.
-- Make the denial contract explicit and remove client table privileges entirely.
do $$
declare
  table_name text;
  locked_tables text[] := array[
    'agent_workers',
    'api_emergency_controls',
    'api_pricing_versions',
    'credit_purchases',
    'developer_api_requests',
    'developer_credit_accounts',
    'developer_credit_ledger',
    'diagnostic_rate_limits',
    'github_oauth_states',
    'github_webhook_deliveries',
    'integration_oauth_states',
    'integration_providers',
    'integration_webhook_subscriptions',
    'integration_workspace_policies',
    'kova_schema_contract',
    'upstream_price_registry'
  ];
begin
  foreach table_name in array locked_tables loop
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);

    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_deny_clients', table_name);
      execute format(
        'create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        table_name || '_deny_clients',
        table_name
      );
  end loop;
end
$$;

-- Connector credentials and provider state are server-managed. Client grants must
-- match the operations actually permitted by RLS instead of inheriting full DML.
revoke all privileges on table
  public.connected_account_audit_log,
  public.connected_accounts,
  public.google_oauth_tokens,
  public.integration_linked_accounts,
  public.integration_sync_jobs,
  public.integration_consents,
  public.integration_action_approvals,
  public.integration_audit_events,
  public.integration_deletion_requests,
  public.github_accounts,
  public.github_installations,
  public.github_repositories,
  public.github_repository_branches,
  public.github_sync_records,
  public.github_tool_audit,
  public.github_webhooks,
  public.github_coding_selections
from public, anon, authenticated;

-- Authenticated users may only read their own redacted/status rows unless a
-- narrowly scoped policy intentionally permits another action.
grant select on table public.connected_account_audit_log to authenticated;
grant select, delete on table public.connected_accounts to authenticated;

grant select on table public.integration_linked_accounts to authenticated;
grant select on table public.integration_sync_jobs to authenticated;
grant select on table public.integration_consents to authenticated;
grant select, update on table public.integration_action_approvals to authenticated;
grant select on table public.integration_audit_events to authenticated;
grant select on table public.integration_deletion_requests to authenticated;

grant select on table public.github_accounts to authenticated;
grant select on table public.github_installations to authenticated;
grant select on table public.github_repositories to authenticated;
grant select on table public.github_repository_branches to authenticated;
grant select on table public.github_sync_records to authenticated;
grant select on table public.github_tool_audit to authenticated;
grant select on table public.github_webhooks to authenticated;
grant select, insert, update, delete on table public.github_coding_selections to authenticated;

-- Server operations retain full privileges.
grant all privileges on table
  public.connected_account_audit_log,
  public.connected_accounts,
  public.google_oauth_tokens,
  public.integration_linked_accounts,
  public.integration_sync_jobs,
  public.integration_consents,
  public.integration_action_approvals,
  public.integration_audit_events,
  public.integration_deletion_requests,
  public.github_accounts,
  public.github_installations,
  public.github_repositories,
  public.github_repository_branches,
  public.github_sync_records,
  public.github_tool_audit,
  public.github_webhooks,
  public.github_coding_selections
to service_role;
