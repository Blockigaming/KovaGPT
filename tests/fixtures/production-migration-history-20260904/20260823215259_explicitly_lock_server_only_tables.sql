-- Reviewed structural history fixture, never a live migration command.
-- Replayed only in the generated disposable local upgrade project.

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

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = table_name || '_deny_clients'
    ) then
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
        table_name || '_deny_clients',
        table_name
      );
    end if;
  end loop;
end
$$;
;
