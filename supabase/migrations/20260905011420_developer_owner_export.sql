-- Dedicated secret-free projection for the account export worker. Never grant
-- browser roles access to the financial tables or credential digest columns.
create view public.developer_account_export_records with (security_invoker=true) as
  select o.owner_id,'account:'||a.id::text as id,'account'::text as record_type,
    jsonb_build_object('id',a.id,'name',o.name,'organization_id',a.organization_id,'currency',a.currency,
      'available_amount',a.available_amount,'reserved_amount',a.reserved_amount,'suspended_at',a.suspended_at,'created_at',o.created_at) as data
    from public.developer_account_owners o join public.developer_credit_accounts a on a.id=o.account_id
  union all select o.owner_id,'project:'||p.id::text,'project',
    jsonb_build_object('id',p.id,'account_id',p.account_id,'name',p.name,'created_at',p.created_at)
    from public.developer_account_owners o join public.developer_projects p on p.account_id=o.account_id
  union all select o.owner_id,'key:'||k.id::text,'key_metadata',
    jsonb_build_object('id',k.id,'account_id',k.account_id,'project_id',k.project_id,'name',k.name,
      'capabilities',k.capabilities,'enabled',k.enabled,'expires_at',k.expires_at,'revoked_at',k.revoked_at,'created_at',k.created_at)
    from public.developer_account_owners o join public.developer_billing_keys k on k.account_id=o.account_id
  union all select o.owner_id,'limit:'||l.account_id::text||':'||l.scope_type||':'||l.scope_id::text,'spending_limit',
    jsonb_build_object('account_id',l.account_id,'scope_type',l.scope_type,'scope_id',l.scope_id,
      'request_limit',l.request_limit,'daily_limit',l.daily_limit,'monthly_limit',l.monthly_limit,'concurrent_limit',l.concurrent_limit)
    from public.developer_account_owners o join public.developer_billing_limits l on l.account_id=o.account_id
  union all select o.owner_id,'usage:'||r.id::text,'api_usage',
    jsonb_build_object('id',r.id,'account_id',r.account_id,'project_id',r.project_id,'api_key_id',r.api_key_id,
      'public_model',r.public_model,'capability',r.capability,'pricing_version_id',r.pricing_version_id,
      'maximum_reserved_charge',r.maximum_reserved_charge,'final_customer_charge',r.final_customer_charge,
      'currency',r.currency,'authoritative_usage',r.authoritative_usage,'settlement_state',r.settlement_state,
      'created_at',r.created_at,'settled_at',r.settled_at)
    from public.developer_account_owners o join public.developer_api_requests r on r.account_id=o.account_id
  union all select o.owner_id,'ledger:'||l.id::text,'credit_ledger',
    jsonb_build_object('id',l.id,'account_id',l.account_id,'request_id',l.request_id,'entry_type',l.entry_type,
      'amount',l.amount,'balance_after',l.balance_after,'created_at',l.created_at)
    from public.developer_account_owners o join public.developer_credit_ledger l on l.account_id=o.account_id
  union all select o.owner_id,'purchase:'||p.id::text,'credit_purchase',
    jsonb_build_object('id',p.id,'account_id',p.account_id,'gross_amount',p.gross_amount,'tax',p.tax,
      'credits_granted',p.credits_granted,'processor_reference',p.processor_reference,'created_at',p.created_at)
    from public.developer_account_owners o join public.credit_purchases p on p.account_id=o.account_id;
revoke all on public.developer_account_export_records from public,anon,authenticated;
grant select on public.developer_account_export_records to service_role;
