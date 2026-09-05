-- Run only inside the disposable local upgrade project, after pending source
-- migrations. Assertions are transactional; the privilege probe is rolled back.
begin;

do $assertions$
declare
  table_name text;
  routine_name text;
  routine record;
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'upgrade_requires_postgres_17';
  end if;

  foreach table_name in array array[
    'chat_branches','chat_message_versions','chat_custom_rules','chat_pinned_files',
    'work_saved_records','work_recent_items','work_sync_mutations','project_templates',
    'project_template_versions','project_template_grants','project_template_mutations',
    'account_export_jobs','account_export_artifacts','account_storage_artifacts',
    'account_deletion_fences','stripe_customer_mappings','stripe_customer_creation_requests'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=table_name and c.relrowsecurity
    ) then
      raise exception 'upgrade_required_table_rls_missing:%',table_name;
    end if;
  end loop;

  foreach table_name in array array[
    'agent_workers','api_emergency_controls','api_pricing_versions','credit_purchases',
    'developer_api_requests','developer_credit_accounts','developer_credit_ledger',
    'diagnostic_rate_limits','github_oauth_states','github_webhook_deliveries',
    'integration_oauth_states','integration_providers','integration_webhook_subscriptions',
    'integration_workspace_policies','kova_schema_contract','upstream_price_registry',
    'work_sync_mutations','account_export_artifacts','account_storage_artifacts',
    'account_deletion_fences','stripe_customer_mappings','stripe_customer_creation_requests'
  ] loop
    if has_table_privilege('anon',format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_table_privilege('authenticated',format('public.%I',table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'upgrade_server_table_client_grant:%',table_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and (has_table_privilege('anon',c.oid,'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        or has_table_privilege('authenticated',c.oid,'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))
  ) then
    raise exception 'upgrade_client_ddl_grant';
  end if;

  -- Every overload matters: checking only a name can miss an older privileged
  -- overload that remains callable through PostgREST.
  foreach routine_name in array array[
    'create_chat_message_version','accept_chat_message_version','create_chat_branch',
    'activate_chat_branch','save_chat_custom_rules','delete_chat_custom_rules',
    'pin_chat_source','unpin_chat_source','get_chat_context_bundle','get_chat_workspace_state',
    'kova_record_message_version','kova_accept_message_version','kova_create_chat_branch',
    'kova_activate_chat_branch','kova_update_chat_branch_messages','family_owner_of'
  ] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=routine_name) then
      raise exception 'upgrade_canonical_rpc_missing:%',routine_name;
    end if;
    for routine in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=routine_name loop
      if routine.prosecdef or routine.proconfig is null
         or has_function_privilege('anon',routine.oid,'EXECUTE')
         or not has_function_privilege('authenticated',routine.oid,'EXECUTE')
         or not has_function_privilege('service_role',routine.oid,'EXECUTE') then
        raise exception 'upgrade_canonical_rpc_privileges:%',routine.oid::regprocedure;
      end if;
    end loop;
  end loop;

  foreach routine_name in array array[
    'list_account_project_storage_objects','claim_account_export_artifact_cleanup',
    'register_account_export_artifact','claim_account_storage_artifact_cleanup',
    'purge_work_sync_receipts','purge_project_template_mutation_receipts',
    'claim_stripe_customer_creation','prepare_stripe_account_deletion'
  ] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=routine_name) then
      raise exception 'upgrade_service_rpc_missing:%',routine_name;
    end if;
    for routine in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=routine_name loop
      if has_function_privilege('anon',routine.oid,'EXECUTE')
         or has_function_privilege('authenticated',routine.oid,'EXECUTE')
         or not has_function_privilege('service_role',routine.oid,'EXECUTE') then
        raise exception 'upgrade_service_rpc_privileges:%',routine.oid::regprocedure;
      end if;
    end loop;
  end loop;

  if public.utf16_code_unit_length('A😀B') <> 4 then
    raise exception 'upgrade_utf16_guard_missing';
  end if;
  if not exists (select 1 from public.chat_message_versions
    where id='44444444-4444-4444-8444-444444444444'
      and source='retry' and instruction='Keep this instruction'
      and content='Replacement' and original_content='😀'
      and selection_start=0 and selection_end=2 and accepted)
    or not exists (select 1 from public.chat_branches
      where id='33333333-3333-4333-8333-333333333333'
        and char_length(chat_id)=200 and conversation_id='synthetic-conversation'
        and message_ids=array['synthetic-message']::text[] and active)
    or not exists (select 1 from public.chat_pinned_files
      where id='66666666-6666-4666-8666-666666666666' and status='active') then
    raise exception 'upgrade_synthetic_history_changed';
  end if;
  if not exists (select 1 from pg_constraint
    where conrelid='public.chat_branches'::regclass
      and conname='kova_branch_message_ids_lineage_check'
      and pg_get_constraintdef(oid) like '%cardinality(message_ids) <= 512%') then
    raise exception 'upgrade_branch_bound_missing';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid='public.chat_message_versions'::regclass
      and tgname='trg_validate_chat_message_version_branch' and tgenabled='O') then
    raise exception 'upgrade_version_branch_integrity_missing';
  end if;

  -- Outbox cleanup must still discover bytes after Auth has been deleted.
  if exists (select 1 from pg_constraint where contype='f'
      and conrelid in ('public.account_export_artifacts'::regclass,'public.account_storage_artifacts'::regclass)
      and confrelid='auth.users'::regclass) then
    raise exception 'upgrade_artifact_outbox_auth_dependency';
  end if;
end
$assertions$;

create function public.kova_upgrade_default_execute_probe()
returns boolean language sql as $$select true$$;
do $$begin
  if has_function_privilege('anon','public.kova_upgrade_default_execute_probe()','EXECUTE')
     or has_function_privilege('authenticated','public.kova_upgrade_default_execute_probe()','EXECUTE') then
    raise exception 'upgrade_default_public_execute_returned';
  end if;
end$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$begin
  if (select count(*) from public.chat_message_versions) <> 1 then
    raise exception 'upgrade_owner_history_unreadable';
  end if;
  begin
    perform public.family_owner_of('22222222-2222-4222-8222-222222222222');
    raise exception 'upgrade_family_owner_scope_not_enforced';
  exception when insufficient_privilege then
    if sqlerrm <> 'forbidden_user_scope' then raise; end if;
  end;
end$$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$begin
  if exists (select 1 from public.chat_message_versions)
    or exists (select 1 from public.chat_branches)
    or exists (select 1 from public.chat_pinned_files) then
    raise exception 'upgrade_other_user_history_visible';
  end if;
end$$;
rollback;
