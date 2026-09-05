-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

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
;
