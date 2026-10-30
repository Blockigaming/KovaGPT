-- Add only the previously absent Work runtime contract. Keep runtime disabled.
-- This forward record does not replay or stamp any earlier migration history.
-- Existing prerequisite columns/defaults/PKs/ACLs and helper bodies are pinned;
-- installation refuses partial Work schemas and any prerequisite drift.
-- Pin complete raw catalog fingerprints separately for PostgreSQL17 and18.
-- PostgreSQL18 adds named NOT NULL constraints; no catalog fields are filtered.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtextextended('kova-work-runtime-forward-v1',0));
lock table public.account_audit_entries,public.account_deletion_fences,public.agent_jobs,public.ai_usage_events,public.app_notifications,public.notification_preferences,public.project_files,public.project_members,public.projects,public.user_library_items,public.user_preferences in access share mode;
do $work_forward_install$
begin
 if current_setting('server_version_num')::integer / 10000 not in (17,18) then raise exception 'work_forward_server_version_unsupported'; end if;
 if exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['account_audit_entries','agent_jobs','account_deletion_fences','app_notifications','notification_preferences','user_library_items','user_preferences','ai_usage_events','project_files','projects','project_members','work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions']) and a.attnum>0 and not a.attisdropped and coalesce(cardinality(a.attacl),0)>0) then raise exception 'work_forward_column_acl_drift'; end if;
 if current_user<>'postgres' then raise exception 'work_forward_operator_mismatch'; end if;
 if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper)
 or not exists(select 1 from pg_roles where rolname='authenticated' and not rolbypassrls and not rolsuper)
 or not exists(select 1 from pg_roles where rolname='anon' and not rolbypassrls and not rolsuper) then
  raise exception 'work_forward_role_drift'; end if;
 -- The canonical clean-history rehearsal has already installed these objects.
 -- Only its exact complete final catalog may take this read-only no-op path.
 -- An arbitrary pre-existing/partial Work schema must fail, never be replaced.
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions')) then
  if encode(sha256(convert_to((select jsonb_build_object('tables',(
 select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) z),'comment',obj_description(c.oid,'pg_class'),
 'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'type',x.contype,'validated',x.convalidated,'definition',pg_get_constraintdef(x.oid,true)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
 'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by ic.relname) from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid),
 'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'command',p.polcmd,'roles',(select jsonb_agg(case when z=0 then 'PUBLIC' else pg_get_userbyid(z) end order by case when z=0 then 'PUBLIC' else pg_get_userbyid(z) end) from unnest(p.polroles) z),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname=any(array['work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions'])),
 'functions',(
 select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) z)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any(array['kova_private.guard_work_browser_takeover','kova_private.lock_work_browser_run','public.admit_work_browser_owner','public.assert_work_execution_lease','public.authorize_work_browser','public.commit_work_execution','public.delete_work_saved_record','public.enforce_work_saved_payload_capacity','public.enforce_work_sync_receipt_capacity','public.finish_work_browser_owner','public.get_work_sync_changes','public.mutate_work_recent_item','public.next_work_execution_dispatch','public.next_work_sync_version','public.publish_work_execution_output','public.publish_work_project_file','public.purge_work_sync_receipts','public.settle_work_accounting','public.upsert_work_saved_record','public.validate_work_session','public.work_sync_payload_depth_allowed','public.work_sync_request_fingerprint']))))::text,'UTF8')),'hex') not in ((case current_setting('server_version_num')::integer / 10000 when 17 then '1319d725618d6445a6ff236077687b9e9a8719a75480f020df0dad51fe9e751a' when 18 then 'ee66769b3750e08ed05f1fe75488c8be3dd9e057e539c45d0d518d75e1dbd983' else '' end),(case current_setting('server_version_num')::integer / 10000 when 17 then '25069cbe2603120c5c335fbe2d3dda4e06216605eac0e4b3c48bf54f703560dc' when 18 then '87c0235fcd7faef7fa74184ba73d18557760b7effd7bd005e134291b7406d430' else '' end)) then
   raise exception 'work_forward_existing_object'; end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kova_auth_guard' and p.proname='session_is_active'
 and pg_get_function_identity_arguments(p.oid)='' and p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
 and encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ff89d138f79046dce793f1870b72f402dc405f9bb706ef2e733937cfb3ad0471'
 and has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')) then
 raise exception 'work_forward_session_guard_drift'; end if;
  return;
 end if;
 execute $work_forward_payload$
-- WORK_PREFLIGHT_BEGIN
do $work_forward_preflight$
begin
 if current_setting('server_version_num')::integer / 10000 not in (17,18) then raise exception 'work_forward_server_version_unsupported'; end if;
 if exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['account_audit_entries','agent_jobs','account_deletion_fences','app_notifications','notification_preferences','user_library_items','user_preferences','ai_usage_events','project_files','projects','project_members','work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions']) and a.attnum>0 and not a.attisdropped and coalesce(cardinality(a.attacl),0)>0) then raise exception 'work_forward_column_acl_drift'; end if;
 if current_user<>'postgres' then raise exception 'work_forward_operator_mismatch'; end if;
 if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper)
 or not exists(select 1 from pg_roles where rolname='authenticated' and not rolbypassrls and not rolsuper)
 or not exists(select 1 from pg_roles where rolname='anon' and not rolbypassrls and not rolsuper) then
  raise exception 'work_forward_role_drift'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions']))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any(array['kova_private.guard_work_browser_takeover','kova_private.lock_work_browser_run','public.admit_work_browser_owner','public.assert_work_execution_lease','public.authorize_work_browser','public.commit_work_execution','public.delete_work_saved_record','public.enforce_work_saved_payload_capacity','public.enforce_work_sync_receipt_capacity','public.finish_work_browser_owner','public.get_work_sync_changes','public.mutate_work_recent_item','public.next_work_execution_dispatch','public.next_work_sync_version','public.publish_work_execution_output','public.publish_work_project_file','public.purge_work_sync_receipts','public.settle_work_accounting','public.upsert_work_saved_record','public.validate_work_session','public.work_sync_payload_depth_allowed','public.work_sync_request_fingerprint'])) then
  raise exception 'work_forward_existing_object'; end if;
 if (select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'primary_key',(select jsonb_agg(a.attname order by x.ord) from pg_constraint ct cross join lateral unnest(ct.conkey) with ordinality x(attnum,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=x.attnum where ct.conrelid=c.oid and ct.contype='p'),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) z)) order by c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname=any(array['account_audit_entries','account_deletion_fences','agent_jobs','ai_usage_events','app_notifications','notification_preferences','project_files','project_members','projects','user_library_items','user_preferences'])),'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) z)) order by n.nspname,p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='kova_private' and p.proname='auth_user_exists') or(n.nspname='public' and p.proname='set_project_file_upload_state')))) is distinct from $work_baseline${"tables":[{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"account_audit_entries","owner":"postgres","columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","identity":"","not_null":true,"generated":""},{"name":"user_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"event_type","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"safe_description","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"actor_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"target_id","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"result","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"metadata","type":"jsonb","default":"'{}'::jsonb","identity":"","not_null":true,"generated":""},{"name":"created_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""}],"primary_key":["id"]},{"acl":[{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"account_deletion_fences","owner":"postgres","columns":[{"name":"user_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"requested_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""}],"primary_key":["user_id"]},{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"agent_jobs","owner":"postgres","columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","identity":"","not_null":true,"generated":""},{"name":"owner_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"project_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"kind","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"status","type":"text","default":"'queued'::text","identity":"","not_null":true,"generated":""},{"name":"input","type":"jsonb","default":"'{}'::jsonb","identity":"","not_null":true,"generated":""},{"name":"result","type":"jsonb","default":null,"identity":"","not_null":false,"generated":""},{"name":"error","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"priority","type":"integer","default":"0","identity":"","not_null":true,"generated":""},{"name":"attempts","type":"integer","default":"0","identity":"","not_null":true,"generated":""},{"name":"max_attempts","type":"integer","default":"3","identity":"","not_null":true,"generated":""},{"name":"worker_id","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"lease_expires_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"available_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"started_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"completed_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"created_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""}],"primary_key":["id"]},{"acl":[{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"ai_usage_events","owner":"postgres","columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","identity":"","not_null":true,"generated":""},{"name":"request_id","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"idempotency_key","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"user_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"guest_ip_hash","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"conversation_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"kova_mode","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"plan_tier","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"premium","type":"boolean","default":"false","identity":"","not_null":true,"generated":""},{"name":"provider","type":"text","default":"'openai'::text","identity":"","not_null":true,"generated":""},{"name":"provider_model","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"estimated_input_tokens","type":"bigint","default":null,"identity":"","not_null":true,"generated":""},{"name":"reserved_tokens","type":"bigint","default":null,"identity":"","not_null":true,"generated":""},{"name":"input_tokens","type":"bigint","default":"0","identity":"","not_null":true,"generated":""},{"name":"cached_input_tokens","type":"bigint","default":"0","identity":"","not_null":true,"generated":""},{"name":"output_tokens","type":"bigint","default":"0","identity":"","not_null":true,"generated":""},{"name":"reasoning_tokens","type":"bigint","default":"0","identity":"","not_null":true,"generated":""},{"name":"actual_billable_tokens","type":"bigint","default":null,"identity":"","not_null":false,"generated":""},{"name":"tool_usage","type":"jsonb","default":"'{}'::jsonb","identity":"","not_null":true,"generated":""},{"name":"estimated_cost_usd","type":"numeric(14,8)","default":null,"identity":"","not_null":true,"generated":""},{"name":"actual_cost_usd","type":"numeric(14,8)","default":null,"identity":"","not_null":false,"generated":""},{"name":"context_trimmed","type":"boolean","default":"false","identity":"","not_null":true,"generated":""},{"name":"status","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"latency_ms","type":"integer","default":null,"identity":"","not_null":false,"generated":""},{"name":"error_classification","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"lease_expires_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"created_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"started_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"completed_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""}],"primary_key":["id"]},{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"app_notifications","owner":"postgres","columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","identity":"","not_null":true,"generated":""},{"name":"owner_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"type","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"title","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"safe_preview","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"action_url","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"source_entity","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"delivery_state","type":"text","default":"'delivered'::text","identity":"","not_null":true,"generated":""},{"name":"read_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"expires_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"created_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""}],"primary_key":["id"]},{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"notification_preferences","owner":"postgres","columns":[{"name":"user_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"in_app_enabled","type":"boolean","default":"true","identity":"","not_null":true,"generated":""},{"name":"account_email_enabled","type":"boolean","default":"true","identity":"","not_null":true,"generated":""},{"name":"verified_email","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"categories","type":"jsonb","default":"'{\"tasks\": true, \"billing\": true, \"projects\": true, \"security\": true, \"connectors\": true}'::jsonb","identity":"","not_null":true,"generated":""},{"name":"time_zone","type":"text","default":"'UTC'::text","identity":"","not_null":true,"generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""}],"primary_key":["user_id"]},{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"project_files","owner":"postgres","columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","identity":"","not_null":true,"generated":""},{"name":"project_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"name","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"storage_path","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"mime_type","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"size_bytes","type":"bigint","default":"0","identity":"","not_null":true,"generated":""},{"name":"kind","type":"text","default":"'file'::text","identity":"","not_null":true,"generated":""},{"name":"uploaded_by","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"created_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"status","type":"text","default":"'ready'::text","identity":"","not_null":true,"generated":""},{"name":"account_cleanup_user_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"content_sha256","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"idempotency_key","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"storage_owner_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"storage_charged","type":"boolean","default":"false","identity":"","not_null":true,"generated":""},{"name":"upload_quota_acquired","type":"boolean","default":"false","identity":"","not_null":true,"generated":""},{"name":"upload_attempt_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"upload_lease_until","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"delete_attempt_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"delete_lease_until","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""}],"primary_key":["id"]},{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"project_members","owner":"postgres","columns":[{"name":"project_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"user_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"role","type":"project_role","default":"'editor'::project_role","identity":"","not_null":true,"generated":""},{"name":"created_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""}],"primary_key":["project_id","user_id"]},{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"projects","owner":"postgres","columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","identity":"","not_null":true,"generated":""},{"name":"owner_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"name","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"description","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"system_prompt","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"color","type":"text","default":"'blue'::text","identity":"","not_null":false,"generated":""},{"name":"created_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"archived_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"pinned_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""},{"name":"deletion_requested_at","type":"timestamp with time zone","default":null,"identity":"","not_null":false,"generated":""}],"primary_key":["id"]},{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"user_library_items","owner":"postgres","columns":[{"name":"id","type":"uuid","default":"gen_random_uuid()","identity":"","not_null":true,"generated":""},{"name":"user_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"title","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"item_type","type":"text","default":null,"identity":"","not_null":true,"generated":""},{"name":"source","type":"text","default":"'manual'::text","identity":"","not_null":true,"generated":""},{"name":"content_text","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"file_url","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"file_name","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"file_type","type":"text","default":null,"identity":"","not_null":false,"generated":""},{"name":"file_size","type":"bigint","default":null,"identity":"","not_null":false,"generated":""},{"name":"metadata","type":"jsonb","default":null,"identity":"","not_null":false,"generated":""},{"name":"created_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""},{"name":"folder_id","type":"uuid","default":null,"identity":"","not_null":false,"generated":""},{"name":"content_generation","type":"uuid","default":"gen_random_uuid()","identity":"","not_null":true,"generated":""},{"name":"content_revision","type":"bigint","default":"1","identity":"","not_null":true,"generated":""}],"primary_key":["id"]},{"acl":[{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"anon","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"authenticated","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"UPDATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"DELETE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"INSERT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"MAINTAIN"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"REFERENCES"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"SELECT"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRIGGER"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"TRUNCATE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"UPDATE"}],"rls":true,"name":"user_preferences","owner":"postgres","columns":[{"name":"user_id","type":"uuid","default":null,"identity":"","not_null":true,"generated":""},{"name":"settings","type":"jsonb","default":"'{}'::jsonb","identity":"","not_null":true,"generated":""},{"name":"updated_at","type":"timestamp with time zone","default":"now()","identity":"","not_null":true,"generated":""}],"primary_key":["user_id"]}],"functions":[{"acl":[{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"EXECUTE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"EXECUTE"}],"name":"auth_user_exists","owner":"postgres","schema":"kova_private","definition":"CREATE OR REPLACE FUNCTION kova_private.auth_user_exists(p_user_id uuid)\n RETURNS boolean\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n  return exists(select 1 from auth.users where id = p_user_id and deleted_at is null);\nend;\n$function$\n"},{"acl":[{"grantee":"postgres","grantor":"postgres","grantable":false,"privilege":"EXECUTE"},{"grantee":"service_role","grantor":"postgres","grantable":false,"privilege":"EXECUTE"}],"name":"set_project_file_upload_state","owner":"postgres","schema":"public","definition":"CREATE OR REPLACE FUNCTION public.set_project_file_upload_state(p_file_id uuid, p_attempt_id uuid, p_status text)\n RETURNS boolean\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nDECLARE\n  target_project_id uuid;\n  changed boolean;\n  target public.project_files;\nBEGIN\n  IF p_file_id IS NULL\n    OR p_attempt_id IS NULL\n    OR p_status IS NULL\n    OR p_status NOT IN ('pending', 'ready', 'upload_failed', 'cleanup_failed')\n  THEN\n    RAISE EXCEPTION\n      USING ERRCODE = '22023', MESSAGE = 'invalid_project_file_upload_state';\n  END IF;\n\n  target_project_id := public.lock_project_for_file_operation(p_file_id);\n  IF target_project_id IS NULL THEN\n    RETURN false;\n  END IF;\n\n  IF p_status = 'ready' THEN\n    SELECT * INTO target FROM public.project_files WHERE id=p_file_id\n      AND project_id=target_project_id AND upload_attempt_id=p_attempt_id\n      AND status='pending' AND upload_lease_until > now() FOR UPDATE;\n    IF NOT FOUND OR NOT public.settle_account_storage_artifact(p_attempt_id,target.storage_owner_id,target.uploaded_by,'project-files',target.storage_path) THEN\n      RETURN false;\n    END IF;\n  END IF;\n\n  UPDATE public.project_files\n  SET status = p_status,\n      upload_lease_until = CASE\n        WHEN p_status = 'pending' THEN now() + interval '2 minutes'\n        ELSE NULL\n      END,\n      updated_at = now()\n  WHERE id = p_file_id\n    AND project_id = target_project_id\n    AND upload_attempt_id = p_attempt_id\n  RETURNING true INTO changed;\n\n  RETURN coalesce(changed, false);\nEND\n$function$\n"}]}$work_baseline$::jsonb then
 raise exception 'work_forward_baseline_drift'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kova_auth_guard' and p.proname='session_is_active'
 and pg_get_function_identity_arguments(p.oid)='' and p.prosecdef and pg_get_userbyid(p.proowner)='postgres'
 and encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ff89d138f79046dce793f1870b72f402dc405f9bb706ef2e733937cfb3ad0471'
 and has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')) then
 raise exception 'work_forward_session_guard_drift'; end if;
end
$work_forward_preflight$;
-- WORK_PREFLIGHT_END

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
create or replace function public.work_sync_request_fingerprint(p_request jsonb)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_request::text, 'UTF8')),
    'hex'
  )
$$;

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
create or replace function public.work_sync_payload_depth_allowed(
  p_value jsonb,
  p_remaining integer
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  v_child jsonb;
  v_type text;
begin
  if p_remaining < 0 or p_remaining > 16 then return false; end if;
  v_type := pg_catalog.jsonb_typeof(p_value);
  if p_remaining = 0 and v_type in ('object', 'array') then return false; end if;
  if v_type = 'object' then
    for v_child in
      select entry.value
      from pg_catalog.jsonb_each(p_value) as entry(key, value)
    loop
      if p_remaining = 0
         or not public.work_sync_payload_depth_allowed(v_child, p_remaining - 1) then
        return false;
      end if;
    end loop;
  elsif v_type = 'array' then
    for v_child in
      select entry.value
      from pg_catalog.jsonb_array_elements(p_value) as entry(value)
    loop
      if p_remaining = 0
         or not public.work_sync_payload_depth_allowed(v_child, p_remaining - 1) then
        return false;
      end if;
    end loop;
  end if;
  return true;
end;
$$;

-- Final definition from 20260903213000_work_cross_device_sync.sql
create table public.work_sync_counters (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  current_version bigint not null default 0 check (current_version >= 0),
  updated_at timestamptz not null default now()
);

-- Final definition from 20260903213000_work_cross_device_sync.sql
create table public.work_saved_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  kind text not null check (kind in ('task', 'template', 'agent_draft', 'session')),
  title text not null check (
    char_length(title) between 1 and 160
    and title = btrim(title)
    and title !~ '[[:cntrl:]]'
  ),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 98304
  ),
  revision bigint not null default 1 check (revision >= 1),
  sync_version bigint not null check (sync_version >= 1),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Final definition from 20260903213000_work_cross_device_sync.sql
create index work_saved_records_owner_sync_idx
  on public.work_saved_records (owner_id, sync_version);

-- Final definition from 20260903213000_work_cross_device_sync.sql
create index work_saved_records_owner_active_idx
  on public.work_saved_records (owner_id, kind, updated_at desc)
  where deleted_at is null;

-- Final definition from 20260903213000_work_cross_device_sync.sql
create table public.work_recent_items (
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null check (resource_type in ('run', 'task', 'template', 'agent_draft', 'session')),
  resource_id uuid not null,
  pinned_at timestamptz,
  last_opened_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision >= 1),
  sync_version bigint not null check (sync_version >= 1),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, resource_type, resource_id)
);

-- Final definition from 20260903213000_work_cross_device_sync.sql
create index work_recent_items_owner_sync_idx
  on public.work_recent_items (owner_id, sync_version);

-- Final definition from 20260903213000_work_cross_device_sync.sql
create index work_recent_items_owner_active_idx
  on public.work_recent_items (owner_id, pinned_at desc nulls last, last_opened_at desc)
  where deleted_at is null;

-- Final definition from 20260903213000_work_cross_device_sync.sql
create table public.work_sync_mutations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (owner_id, mutation_id)
);

-- Final definition from 20260903213000_work_cross_device_sync.sql
create index work_sync_mutations_created_idx
  on public.work_sync_mutations (created_at);

-- Final definition from 20260903213000_work_cross_device_sync.sql
alter table public.work_sync_counters enable row level security;

-- Final definition from 20260903213000_work_cross_device_sync.sql
alter table public.work_saved_records enable row level security;

-- Final definition from 20260903213000_work_cross_device_sync.sql
alter table public.work_recent_items enable row level security;

-- Final definition from 20260903213000_work_cross_device_sync.sql
alter table public.work_sync_mutations enable row level security;

-- Final definition from 20260903213000_work_cross_device_sync.sql
create policy work_saved_records_owner_read
  on public.work_saved_records
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- Final definition from 20260903213000_work_cross_device_sync.sql
create policy work_recent_items_owner_read
  on public.work_recent_items
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
alter table public.work_sync_mutations
  add column operation text,
  add column request_fingerprint text;

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
alter table public.work_sync_mutations
  alter column operation set not null,
  alter column request_fingerprint set not null,
  add constraint work_sync_mutations_operation_check
    check (operation in ('save', 'delete', 'recent')),
  add constraint work_sync_mutations_fingerprint_check
    check (request_fingerprint ~ '^(legacy:)?[0-9a-f]{64}$'),
  add constraint work_sync_mutations_compact_result_check
    check (
      pg_catalog.octet_length(result::text) <= 2048
      and not (result ? 'title')
      and not (result ? 'payload')
    );

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
create index work_sync_mutations_owner_created_idx
  on public.work_sync_mutations (owner_id, created_at);

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create table public.work_execution_runs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  revision bigint not null check (revision > 0),
  status text not null check (status in ('queued','running','waiting_for_user','approval_required','paused','completed','failed','cancelled')),
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 262144),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  next_dispatch_at timestamptz not null default now(),
  unique (owner_id, request_id),
  unique (id, owner_id)
);

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create index work_execution_owner_updated_idx on public.work_execution_runs(owner_id, updated_at desc, id);

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create index work_execution_dispatch_idx on public.work_execution_runs(next_dispatch_at,id) where status not in ('completed','failed');

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create table public.work_execution_events (
  run_id uuid not null,
  owner_id uuid not null,
  revision bigint not null,
  kind text not null,
  detail jsonb not null,
  created_at timestamptz not null default now(),
  primary key(run_id, revision),
  foreign key(run_id, owner_id) references public.work_execution_runs(id, owner_id) on delete cascade
);

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create table public.work_execution_receipts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  mutation_hash text not null check(mutation_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid not null,
  revision bigint not null,
  primary key(owner_id, mutation_id),
  foreign key(run_id, owner_id) references public.work_execution_runs(id, owner_id) on delete cascade
);

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
alter table public.work_execution_runs enable row level security;

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
alter table public.work_execution_events enable row level security;

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
alter table public.work_execution_receipts enable row level security;

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create policy work_execution_owner_read on public.work_execution_runs for select to authenticated using(owner_id = (select auth.uid()));

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create policy work_execution_event_owner_read on public.work_execution_events for select to authenticated using(owner_id = (select auth.uid()));

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create table public.work_execution_outputs (
  id uuid primary key references public.user_library_items(id) on delete cascade,
  owner_id uuid not null,
  run_id uuid not null,
  project_file_id uuid not null references public.project_files(id) on delete cascade,
  artifact_id uuid not null,
  epoch bigint not null,
  step_id uuid not null,
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null,
  mime_type text not null,
  created_at timestamptz not null default now(),
  foreign key(run_id,owner_id) references public.work_execution_runs(id,owner_id) on delete cascade,
  unique(run_id,artifact_id)
);

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
alter table public.work_execution_outputs enable row level security;

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create policy work_output_owner_read on public.work_execution_outputs for select to authenticated using(owner_id=(select auth.uid()));

-- Final definition from 20260905005310_work_accounting_reconciliation.sql
create table public.work_accounting_settlements (
  event_id uuid primary key references public.ai_usage_events(id),
  run_id uuid not null references public.work_execution_runs(id) on delete cascade,
  owner_id uuid not null,
  step_id uuid not null,
  step_epoch bigint not null check(step_epoch>0),
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  receipt_hash text not null check(receipt_hash ~ '^[a-f0-9]{64}$'),
  totals jsonb not null check(pg_column_size(totals)<=4096),
  created_at timestamptz not null default now(),
  unique(run_id,step_epoch,step_id)
);

-- Final definition from 20260905005310_work_accounting_reconciliation.sql
alter table public.work_accounting_settlements enable row level security;

-- Final definition from 20260905034000_work_browser_takeover.sql
create table public.work_browser_sessions (
 id uuid primary key,
 owner_id uuid not null,
 run_id uuid not null,
 mode text not null check(mode in ('takeover','agent','closed')),
 sequence bigint not null default 1 check(sequence between 1 and 10000),
 operation text not null,
 last_approval_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp() + interval '5 minutes',
 foreign key(run_id,owner_id) references public.work_execution_runs(id,owner_id) on delete cascade,
 check(expires_at <= created_at + interval '5 minutes')
);

-- Final definition from 20260905034000_work_browser_takeover.sql
create unique index work_browser_one_live_run on public.work_browser_sessions(run_id) where mode <> 'closed';

-- Final definition from 20260905034000_work_browser_takeover.sql
alter table public.work_browser_sessions enable row level security;

-- Final definition from 20260905034000_work_browser_takeover.sql
create policy work_browser_owner_read on public.work_browser_sessions for select to authenticated using(owner_id=(select auth.uid()));

-- Final definition from 20260913022249_stabilize_work_browser_session_timestamps.sql
alter table public.work_browser_sessions
  alter column created_at set default statement_timestamp(),
  alter column expires_at set default (statement_timestamp() + interval '5 minutes');

-- Final definition from 20260903213000_work_cross_device_sync.sql
create or replace function public.next_work_sync_version(p_user_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version bigint;
begin
  update public.work_sync_counters
     set current_version = current_version + 1,
         updated_at = now()
   where owner_id = p_user_id
  returning current_version into v_version;
  if v_version is null then
    raise exception 'work_sync_counter_missing' using errcode = 'P0002';
  end if;
  return v_version;
end;
$$;

-- Final definition from 20260903213000_work_cross_device_sync.sql
create or replace function public.purge_work_sync_receipts(p_before timestamptz, p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_before is null or p_before > now() - interval '7 days'
     or p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'work_sync_purge_invalid' using errcode = '22023';
  end if;
  with selected as (
    select owner_id, mutation_id from public.work_sync_mutations
     where created_at < p_before
     order by created_at
     limit p_limit
     for update skip locked
  ), removed as (
    delete from public.work_sync_mutations m using selected s
     where m.owner_id = s.owner_id and m.mutation_id = s.mutation_id
    returning 1
  )
  select count(*) into v_count from removed;
  return v_count;
end;
$$;

-- Final definition from 20260903213000_work_cross_device_sync.sql
create or replace function public.get_work_sync_changes(
  p_user_id uuid,
  p_after_version bigint default 0,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_version bigint;
  v_next_version bigint;
  v_saved jsonb;
  v_recent jsonb;
  v_has_more boolean;
begin
  if p_user_id is null or p_after_version is null or p_after_version < 0
     or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'work_sync_query_invalid' using errcode = '22023';
  end if;
  insert into public.work_sync_counters(owner_id) values (p_user_id)
  on conflict (owner_id) do nothing;
  select current_version into v_current_version
    from public.work_sync_counters
   where owner_id = p_user_id
   for share;

  with changes as (
    select
      r.sync_version,
      'saved'::text as change_type,
      jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'title', r.title,
        'payload', r.payload,
        'revision', r.revision,
        'syncVersion', r.sync_version,
        'deletedAt', r.deleted_at,
        'updatedAt', r.updated_at
      ) as payload
    from public.work_saved_records r
    where r.owner_id = p_user_id and r.sync_version > p_after_version
    union all
    select
      r.sync_version,
      'recent'::text as change_type,
      jsonb_build_object(
        'resourceType', r.resource_type,
        'resourceId', r.resource_id,
        'pinnedAt', r.pinned_at,
        'lastOpenedAt', r.last_opened_at,
        'revision', r.revision,
        'syncVersion', r.sync_version,
        'deletedAt', r.deleted_at,
        'updatedAt', r.updated_at
      ) as payload
    from public.work_recent_items r
    where r.owner_id = p_user_id and r.sync_version > p_after_version
    order by sync_version
    limit p_limit
  )
  select
    coalesce(jsonb_agg(payload order by sync_version) filter (where change_type = 'saved'), '[]'),
    coalesce(jsonb_agg(payload order by sync_version) filter (where change_type = 'recent'), '[]'),
    coalesce(max(sync_version), p_after_version)
  into v_saved, v_recent, v_next_version
  from changes;

  v_has_more := v_current_version > v_next_version;
  return jsonb_build_object(
    'savedRecords', v_saved,
    'recentItems', v_recent,
    'nextCursor', v_next_version,
    'currentVersion', v_current_version,
    'hasMore', v_has_more
  );
end;
$$;

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
create or replace function public.enforce_work_sync_receipt_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.work_sync_counters(owner_id)
  values (new.owner_id)
  on conflict (owner_id) do nothing;
  perform 1
  from public.work_sync_counters
  where owner_id = new.owner_id
  for update;
  delete from public.work_sync_mutations
  where owner_id = new.owner_id
    and created_at < now() - interval '7 days';
  if (
    select pg_catalog.count(*)
    from public.work_sync_mutations
    where owner_id = new.owner_id
  ) >= 10000 then
    raise exception 'work_sync_receipt_capacity' using errcode = 'P0003';
  end if;
  return new;
end;
$$;

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
create or replace function public.enforce_work_saved_payload_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_other_bytes bigint;
begin
  if new.deleted_at is not null then return new; end if;
  insert into public.work_sync_counters(owner_id)
  values (new.owner_id)
  on conflict (owner_id) do nothing;
  perform 1
  from public.work_sync_counters
  where owner_id = new.owner_id
  for update;
  select coalesce(
    pg_catalog.sum(pg_catalog.octet_length(record.payload::text)),
    0::bigint
  )
  into v_other_bytes
  from public.work_saved_records as record
  where record.owner_id = new.owner_id
    and record.id <> new.id
    and record.deleted_at is null;
  if v_other_bytes + pg_catalog.octet_length(new.payload::text) > 8388608 then
    raise exception 'work_sync_payload_capacity' using errcode = '54000';
  end if;
  return new;
end;
$$;

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
create or replace function public.delete_work_saved_record(
  p_user_id uuid,
  p_mutation_id uuid,
  p_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.work_saved_records%rowtype;
  v_result jsonb;
  v_receipt_operation text;
  v_receipt_fingerprint text;
  v_request_fingerprint text;
  v_revision bigint;
  v_sync_version bigint;
  v_deleted_at timestamptz;
begin
  if p_user_id is null or p_mutation_id is null or p_id is null
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;
  v_request_fingerprint := public.work_sync_request_fingerprint(
    pg_catalog.jsonb_build_array('delete', p_id::text, p_expected_revision)
  );
  insert into public.work_sync_counters(owner_id) values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;
  select result, operation, request_fingerprint
  into v_result, v_receipt_operation, v_receipt_fingerprint
  from public.work_sync_mutations
  where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt_operation <> 'delete'
       or (
         v_receipt_fingerprint not like 'legacy:%'
         and v_receipt_fingerprint <> v_request_fingerprint
       )
       or (
         v_receipt_fingerprint like 'legacy:%'
         and v_result ->> 'id' is distinct from p_id::text
       ) then
      raise exception 'work_sync_mutation_reused' using errcode = '23505';
    end if;
    return v_result;
  end if;
  select * into v_existing from public.work_saved_records
  where owner_id = p_user_id and id = p_id for update;
  if not found then raise exception 'work_record_not_found' using errcode = 'P0002'; end if;
  if v_existing.revision <> p_expected_revision then
    raise exception 'work_revision_conflict' using errcode = '40001';
  end if;
  if v_existing.deleted_at is not null then
    v_result := pg_catalog.jsonb_build_object(
      'id', p_id, 'revision', v_existing.revision,
      'syncVersion', v_existing.sync_version, 'deletedAt', v_existing.deleted_at
    );
    insert into public.work_sync_mutations(
      owner_id, mutation_id, operation, request_fingerprint, result
    ) values (
      p_user_id, p_mutation_id, 'delete', v_request_fingerprint, v_result
    );
    return v_result;
  end if;
  v_revision := v_existing.revision + 1;
  v_sync_version := public.next_work_sync_version(p_user_id);
  v_deleted_at := now();
  update public.work_saved_records set
    title = 'Deleted Work item',
    payload = '{}'::jsonb,
    revision = v_revision,
    sync_version = v_sync_version,
    deleted_at = v_deleted_at,
    updated_at = v_deleted_at
  where owner_id = p_user_id and id = p_id;
  v_result := pg_catalog.jsonb_build_object(
    'id', p_id, 'revision', v_revision,
    'syncVersion', v_sync_version, 'deletedAt', v_deleted_at
  );
  insert into public.work_sync_mutations(
    owner_id, mutation_id, operation, request_fingerprint, result
  ) values (
    p_user_id, p_mutation_id, 'delete', v_request_fingerprint, v_result
  );
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'work_sync', 'Work record deleted', p_user_id, p_id::text, 'success',
    pg_catalog.jsonb_build_object('kind', v_existing.kind, 'revision', v_revision)
  );
  return v_result;
end;
$$;

-- Final definition from 20260904235937_work_session_sync.sql
create or replace function public.validate_work_session(
  p_owner uuid, p_id uuid, p_payload jsonb, p_previous jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_parent public.work_saved_records%rowtype;
  v_event jsonb;
  v_step jsonb;
  v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  v_count integer;
begin
  if p_payload->>'id' is distinct from p_id::text
    or coalesce(p_payload->>'rootId','') !~* v_uuid
    or jsonb_typeof(p_payload->'objective') is distinct from 'string'
    or char_length(btrim(p_payload->>'objective')) not between 1 and 4000
    or jsonb_typeof(p_payload->'context') is distinct from 'string'
    or char_length(p_payload->>'context') > 16000
    or coalesce(p_payload->>'status','') not in ('planning','paused','completed')
    or coalesce(p_payload->>'createdAt','') !~ '^\d{1,16}$'
    or coalesce(p_payload->>'updatedAt','') !~ '^\d{1,16}$'
    or jsonb_typeof(p_payload->'steps') is distinct from 'array'
    or jsonb_typeof(p_payload->'events') is distinct from 'array'
    or not p_payload ? 'parent' then
    raise exception 'work_session_invalid' using errcode='22023';
  end if;
  if jsonb_array_length(p_payload->'steps') > 60
    or jsonb_array_length(p_payload->'events') not between 1 and 128 then
    raise exception 'work_session_limit' using errcode='22023';
  end if;
  for v_step in select value from jsonb_array_elements(p_payload->'steps') loop
    if coalesce(v_step->>'id','') !~* v_uuid
      or jsonb_typeof(v_step->'text') is distinct from 'string'
      or char_length(btrim(v_step->>'text')) not between 1 and 2000
      or jsonb_typeof(v_step->'done') is distinct from 'boolean' then
      raise exception 'work_session_step_invalid' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'steps'))
    <> jsonb_array_length(p_payload->'steps') then
    raise exception 'work_session_step_duplicate' using errcode='22023';
  end if;
  for v_event in select value from jsonb_array_elements(p_payload->'events') loop
    if coalesce(v_event->>'id','') !~* v_uuid
      or coalesce(v_event->>'at','') !~ '^\d{1,16}$'
      or coalesce(v_event->>'kind','') not in ('created','branched','plan_updated','step_updated','status_updated','conflict_resolved')
      or jsonb_typeof(v_event->'label') is distinct from 'string'
      or char_length(btrim(v_event->>'label')) not between 1 and 500 then
      raise exception 'work_session_event_invalid' using errcode='22023';
    end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'events'))
    <> jsonb_array_length(p_payload->'events') then
    raise exception 'work_session_event_duplicate' using errcode='22023';
  end if;
  if p_previous is not null then
    if p_previous = '{}'::jsonb or p_previous->'rootId' is distinct from p_payload->'rootId'
      or p_previous->'parent' is distinct from p_payload->'parent'
      or p_previous->'createdAt' is distinct from p_payload->'createdAt' then
      raise exception 'work_session_lineage_immutable' using errcode='22023';
    end if;
    v_count := jsonb_array_length(p_previous->'events');
    if jsonb_array_length(p_payload->'events') < v_count then
      raise exception 'work_session_history_immutable' using errcode='22023';
    end if;
    if (p_previous - 'events' - 'updatedAt') is distinct from (p_payload - 'events' - 'updatedAt')
      and jsonb_array_length(p_payload->'events') <= v_count then
      raise exception 'work_session_event_required' using errcode='22023';
    end if;
    for v_index in 0..v_count-1 loop
      if (p_previous->'events')->v_index is distinct from (p_payload->'events')->v_index then
        raise exception 'work_session_history_immutable' using errcode='22023';
      end if;
    end loop;
  elsif p_payload->'parent' = 'null'::jsonb then
    if p_payload->>'rootId' <> p_id::text or p_payload->'events'->0->>'kind' <> 'created' then
      raise exception 'work_session_root_invalid' using errcode='22023';
    end if;
  else
    if coalesce(p_payload->'parent'->>'id','') !~* v_uuid
      or p_payload->'parent'->>'id' = p_id::text
      or coalesce(p_payload->'parent'->>'revision','') !~ '^[1-9]\d{0,15}$' then
      raise exception 'work_session_parent_invalid' using errcode='22023';
    end if;
    -- The caller already holds the owner's shared Work clock lock. Parent revision
    -- and branch creation therefore observe one serialized account snapshot.
    select * into v_parent from public.work_saved_records
      where owner_id=p_owner and id=(p_payload->'parent'->>'id')::uuid
        and kind='session' and deleted_at is null;
    if not found or v_parent.revision <> (p_payload->'parent'->>'revision')::bigint then
      raise exception 'work_session_parent_conflict' using errcode='40001';
    end if;
    if p_payload->'rootId' is distinct from v_parent.payload->'rootId'
      or p_payload->'events'->0->>'kind' <> 'branched' then
      raise exception 'work_session_parent_invalid' using errcode='22023';
    end if;
  end if;
end;
$$;

-- Final definition from 20260904235937_work_session_sync.sql
create or replace function public.upsert_work_saved_record(
  p_user_id uuid,
  p_mutation_id uuid,
  p_id uuid,
  p_kind text,
  p_title text,
  p_payload jsonb,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.work_saved_records%rowtype;
  v_result jsonb;
  v_receipt_operation text;
  v_receipt_fingerprint text;
  v_request_fingerprint text;
  v_revision bigint;
  v_sync_version bigint;
begin
  if p_user_id is null or p_mutation_id is null or p_id is null
     or p_kind is null or p_kind not in ('task', 'template', 'agent_draft', 'session')
     or p_expected_revision is null or p_expected_revision < 0
     or p_title is null or char_length(p_title) not between 1 and 160
     or p_title <> btrim(p_title) or p_title ~ '[[:cntrl:]]'
     or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 98304
     or not public.work_sync_payload_depth_allowed(p_payload, 16) then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;

  v_request_fingerprint := public.work_sync_request_fingerprint(
    pg_catalog.jsonb_build_array(
      'save', p_id::text, p_kind, p_title, p_payload, p_expected_revision
    )
  );
  insert into public.work_sync_counters(owner_id)
  values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;

  select result, operation, request_fingerprint
  into v_result, v_receipt_operation, v_receipt_fingerprint
  from public.work_sync_mutations
  where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt_operation <> 'save'
       or (
         v_receipt_fingerprint not like 'legacy:%'
         and v_receipt_fingerprint <> v_request_fingerprint
       )
       or (
         v_receipt_fingerprint like 'legacy:%'
         and (
           v_result ->> 'id' is distinct from p_id::text
           or v_result ->> 'kind' is distinct from p_kind
         )
       ) then
      raise exception 'work_sync_mutation_reused' using errcode = '23505';
    end if;
    return v_result;
  end if;

  select * into v_existing
  from public.work_saved_records
  where owner_id = p_user_id and id = p_id
  for update;

  if found then
    if v_existing.revision <> p_expected_revision then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if v_existing.kind <> p_kind then
      raise exception 'work_record_kind_immutable' using errcode = '22023';
    end if;
    if v_existing.deleted_at is not null and (
      select pg_catalog.count(*) from public.work_saved_records
      where owner_id = p_user_id and deleted_at is null
    ) >= 500 then
      raise exception 'work_saved_record_limit' using errcode = '22023';
    end if;
    v_revision := v_existing.revision + 1;
  else
    if p_expected_revision <> 0 then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if (select pg_catalog.count(*) from public.work_saved_records where owner_id = p_user_id) >= 2000
       or (
         select pg_catalog.count(*) from public.work_saved_records
         where owner_id = p_user_id and deleted_at is null
       ) >= 500 then
      raise exception 'work_saved_record_limit' using errcode = '22023';
    end if;
    v_revision := 1;
  end if;

  if p_kind = 'session' then
    perform public.validate_work_session(p_user_id,p_id,p_payload,v_existing.payload);
  end if;
  v_sync_version := public.next_work_sync_version(p_user_id);
  insert into public.work_saved_records(
    owner_id, id, kind, title, payload, revision, sync_version, deleted_at
  ) values (
    p_user_id, p_id, p_kind, p_title, p_payload, v_revision, v_sync_version, null
  )
  on conflict (owner_id, id) do update set
    title = excluded.title,
    payload = excluded.payload,
    revision = excluded.revision,
    sync_version = excluded.sync_version,
    deleted_at = null,
    updated_at = now();

  v_result := pg_catalog.jsonb_build_object(
    'id', p_id,
    'kind', p_kind,
    'revision', v_revision,
    'syncVersion', v_sync_version,
    'deletedAt', null,
    'updatedAt', now()
  );
  insert into public.work_sync_mutations(
    owner_id, mutation_id, operation, request_fingerprint, result
  ) values (
    p_user_id, p_mutation_id, 'save', v_request_fingerprint, v_result
  );
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'work_sync', 'Work record synchronized', p_user_id, p_id::text, 'success',
    pg_catalog.jsonb_build_object('kind', p_kind, 'revision', v_revision)
  );
  return v_result;
end;
$$;

-- Final definition from 20260904235937_work_session_sync.sql
create or replace function public.mutate_work_recent_item(
  p_user_id uuid,
  p_mutation_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_operation text,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.work_recent_items%rowtype;
  v_result jsonb;
  v_receipt_operation text;
  v_receipt_fingerprint text;
  v_request_fingerprint text;
  v_revision bigint;
  v_sync_version bigint;
  v_pinned_at timestamptz;
  v_deleted_at timestamptz;
begin
  if p_user_id is null or p_mutation_id is null or p_resource_id is null
     or p_resource_type is null
     or p_resource_type not in ('run', 'task', 'template', 'agent_draft', 'session')
     or p_operation is null or p_operation not in ('keep', 'pin', 'unpin', 'forget')
     or (p_operation <> 'keep' and (p_expected_revision is null or p_expected_revision < 0)) then
    raise exception 'work_sync_input_invalid' using errcode = '22023';
  end if;
  v_request_fingerprint := public.work_sync_request_fingerprint(
    pg_catalog.jsonb_build_array(
      'recent', p_resource_type, p_resource_id::text, p_operation, p_expected_revision
    )
  );
  insert into public.work_sync_counters(owner_id) values (p_user_id)
  on conflict (owner_id) do nothing;
  perform 1 from public.work_sync_counters where owner_id = p_user_id for update;
  select result, operation, request_fingerprint
  into v_result, v_receipt_operation, v_receipt_fingerprint
  from public.work_sync_mutations
  where owner_id = p_user_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt_operation <> 'recent'
       or (
         v_receipt_fingerprint not like 'legacy:%'
         and v_receipt_fingerprint <> v_request_fingerprint
       )
       or (
         v_receipt_fingerprint like 'legacy:%'
         and (
           v_result ->> 'resourceType' is distinct from p_resource_type
           or v_result ->> 'resourceId' is distinct from p_resource_id::text
         )
       ) then
      raise exception 'work_sync_mutation_reused' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if p_operation <> 'forget' then
    if p_resource_type = 'run' then
      if not exists (
        select 1 from public.agent_jobs
        where id = p_resource_id and owner_id = p_user_id
      ) then raise exception 'work_resource_not_found' using errcode = 'P0002'; end if;
    elsif not exists (
      select 1 from public.work_saved_records
      where owner_id = p_user_id and id = p_resource_id
        and kind = p_resource_type and deleted_at is null
    ) then raise exception 'work_resource_not_found' using errcode = 'P0002';
    end if;
  end if;

  select * into v_existing from public.work_recent_items
  where owner_id = p_user_id and resource_type = p_resource_type
    and resource_id = p_resource_id for update;

  if found then
    if p_operation <> 'keep' and v_existing.revision <> p_expected_revision then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if v_existing.deleted_at is not null and p_operation <> 'forget' and (
      select pg_catalog.count(*) from public.work_recent_items
      where owner_id = p_user_id and deleted_at is null
    ) >= 500 then
      raise exception 'work_recent_limit' using errcode = '22023';
    end if;
    v_revision := v_existing.revision + 1;
    v_pinned_at := case
      when p_operation = 'pin' then now()
      when p_operation = 'unpin' then null
      else v_existing.pinned_at
    end;
  else
    if p_operation in ('unpin', 'forget') or coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'work_revision_conflict' using errcode = '40001';
    end if;
    if (select pg_catalog.count(*) from public.work_recent_items where owner_id = p_user_id) >= 2000
       or (
         select pg_catalog.count(*) from public.work_recent_items
         where owner_id = p_user_id and deleted_at is null
       ) >= 500 then
      raise exception 'work_recent_limit' using errcode = '22023';
    end if;
    v_revision := 1;
    v_pinned_at := case when p_operation = 'pin' then now() else null end;
  end if;

  v_sync_version := public.next_work_sync_version(p_user_id);
  v_deleted_at := case when p_operation = 'forget' then now() else null end;
  insert into public.work_recent_items(
    owner_id, resource_type, resource_id, pinned_at, last_opened_at,
    revision, sync_version, deleted_at
  ) values (
    p_user_id, p_resource_type, p_resource_id, v_pinned_at, now(),
    v_revision, v_sync_version, v_deleted_at
  )
  on conflict (owner_id, resource_type, resource_id) do update set
    pinned_at = excluded.pinned_at,
    last_opened_at = excluded.last_opened_at,
    revision = excluded.revision,
    sync_version = excluded.sync_version,
    deleted_at = excluded.deleted_at,
    updated_at = now();
  v_result := pg_catalog.jsonb_build_object(
    'resourceType', p_resource_type,
    'resourceId', p_resource_id,
    'pinnedAt', v_pinned_at,
    'revision', v_revision,
    'syncVersion', v_sync_version,
    'deletedAt', v_deleted_at,
    'updatedAt', now()
  );
  insert into public.work_sync_mutations(
    owner_id, mutation_id, operation, request_fingerprint, result
  ) values (
    p_user_id, p_mutation_id, 'recent', v_request_fingerprint, v_result
  );
  insert into public.account_audit_entries(
    user_id, event_type, safe_description, actor_id, target_id, result, metadata
  ) values (
    p_user_id, 'work_sync', 'Work recent state synchronized', p_user_id,
    p_resource_id::text, 'success',
    pg_catalog.jsonb_build_object('resource_type', p_resource_type, 'operation', p_operation)
  );
  return v_result;
end;
$$;

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create function public.assert_work_execution_lease(p_owner_id uuid,p_run_id uuid,p_epoch bigint,p_runner_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_state jsonb; v_setting jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner_id) or exists(select 1 from public.account_deletion_fences where user_id=p_owner_id) then
    return false;
  end if;
  select settings into v_setting from public.user_preferences where user_id=p_owner_id;
  if v_setting is not null and (jsonb_typeof(v_setting)<>'object' or coalesce(v_setting->>'lockdown_mode','false')<>'false') then return false; end if;
  select state into v_state from public.work_execution_runs where id=p_run_id and owner_id=p_owner_id and status='running';
  return coalesce((v_state->>'epoch')::bigint=p_epoch and v_state->>'runnerId'=p_runner_id::text and
    (v_state#>>'{lease,expiresAt}')::numeric > extract(epoch from clock_timestamp())*1000 and
    ((v_state->>'deadline')::numeric > extract(epoch from clock_timestamp())*1000 or v_state->>'reconciling'='true'),false);
end $$;

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create function public.publish_work_execution_output(p_owner_id uuid,p_run_id uuid,p_epoch bigint,p_receipt_epoch bigint,p_step_id uuid,
 p_input_hash text,p_project_file_id uuid,p_artifact_id uuid,p_sha256 text,p_size_bytes bigint,p_mime_type text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_state jsonb; v_file public.project_files%rowtype; v_existing public.work_execution_outputs%rowtype; v_id uuid;
begin
  if not public.assert_work_execution_lease(p_owner_id,p_run_id,p_epoch,
    (select (state->>'runnerId')::uuid from public.work_execution_runs where id=p_run_id and owner_id=p_owner_id)) then
    raise exception 'work_output_lease_stale' using errcode='42501';
  end if;
  select state into v_state from public.work_execution_runs where id=p_run_id and owner_id=p_owner_id for update;
  if not coalesce(v_state->'stepIds' ? p_step_id::text,false) or coalesce(p_input_hash,'') !~ '^[a-f0-9]{64}$' or
    v_state#>>'{step,id}' is distinct from p_step_id::text or v_state#>>'{step,inputHash}' is distinct from p_input_hash or
    (v_state#>>'{step,epoch}')::bigint is distinct from p_receipt_epoch then
    raise exception 'work_output_provenance_invalid' using errcode='22023';
  end if;
  select * into v_file from public.project_files where id=p_project_file_id for share;
  if not found or v_file.status<>'ready' or v_file.content_sha256 is distinct from p_sha256 or
    v_file.size_bytes is distinct from p_size_bytes or v_file.mime_type is distinct from p_mime_type or
    v_file.project_id::text is distinct from v_state#>>'{request,projectId}' or
    not exists(select 1 from public.projects p join public.project_members m on m.project_id=p.id
      where p.id=v_file.project_id and p.deletion_requested_at is null and m.user_id=p_owner_id and m.role in ('owner','editor')) then
    raise exception 'work_output_project_access_required' using errcode='42501';
  end if;
  select * into v_existing from public.work_execution_outputs where run_id=p_run_id and artifact_id=p_artifact_id;
  if found then
    if v_existing.owner_id<>p_owner_id or v_existing.project_file_id<>p_project_file_id or v_existing.sha256<>p_sha256 or
      v_existing.input_hash<>p_input_hash or v_existing.epoch<>p_receipt_epoch or v_existing.step_id<>p_step_id then
      raise exception 'work_output_idempotency_conflict' using errcode='40001';
    end if;
    return jsonb_build_object('id',v_existing.id,'idempotent',true);
  end if;
  v_id:=gen_random_uuid();
  insert into public.user_library_items(id,user_id,title,item_type,source,file_name,file_type,file_size,file_url,metadata)
    values(v_id,p_owner_id,v_file.name,'document','other',v_file.name,p_mime_type,p_size_bytes,null,
      jsonb_build_object('work_output',true));
  insert into public.work_execution_outputs(id,owner_id,run_id,project_file_id,artifact_id,epoch,step_id,input_hash,sha256,size_bytes,mime_type)
    values(v_id,p_owner_id,p_run_id,p_project_file_id,p_artifact_id,p_receipt_epoch,p_step_id,p_input_hash,p_sha256,p_size_bytes,p_mime_type);
  return jsonb_build_object('id',v_id,'idempotent',false);
end $$;

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create function public.publish_work_project_file(p_owner_id uuid,p_run_id uuid,p_epoch bigint,p_receipt_epoch bigint,p_step_id uuid,
 p_input_hash text,p_project_file_id uuid,p_attempt_id uuid,p_artifact_id uuid,p_sha256 text,p_size_bytes bigint,p_mime_type text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_state jsonb; v_file public.project_files%rowtype; v_principal uuid; v_project uuid;
begin
  select * into v_file from public.project_files where id=p_project_file_id;
  if not found or v_file.uploaded_by is distinct from p_owner_id or
    v_file.upload_attempt_id is distinct from p_attempt_id then return false; end if;
  -- The generic artifact settlement uses this same sorted two-principal order.
  for v_principal in select distinct x from unnest(array[p_owner_id,v_file.storage_owner_id]) x order by x loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_principal::text,20260903204500));
  end loop;
  select state into v_state from public.work_execution_runs where id=p_run_id and owner_id=p_owner_id for update;
  if not found or not public.assert_work_execution_lease(p_owner_id,p_run_id,p_epoch,(v_state->>'runnerId')::uuid) then return false; end if;
  if v_state#>>'{step,id}' is distinct from p_step_id::text or
    (v_state#>>'{step,epoch}')::bigint is distinct from p_receipt_epoch or
    v_state#>>'{step,inputHash}' is distinct from p_input_hash or
    v_state#>>'{step,receipt,ownerId}' is distinct from p_owner_id::text or
    v_state#>>'{step,receipt,runId}' is distinct from p_run_id::text or
    v_state#>>'{step,receipt,stepId}' is distinct from p_step_id::text or
    v_state#>>'{step,receipt,inputHash}' is distinct from p_input_hash or
    (v_state#>>'{step,receipt,epoch}')::bigint is distinct from p_receipt_epoch or
    not exists(select 1 from jsonb_array_elements(v_state#>'{step,receipt,outputs}') o
      where o->>'artifactId'=p_artifact_id::text and o->>'sha256'=p_sha256 and
        (o->>'bytes')::bigint=p_size_bytes and o->>'mimeType'=p_mime_type) then
    raise exception 'work_output_provenance_invalid' using errcode='22023';
  end if;
  select p.id into v_project from public.projects p where p.id=v_file.project_id and
    p.id::text=v_state#>>'{request,projectId}' and p.deletion_requested_at is null for share;
  if not found then return false; end if;
  perform 1 from public.project_members where project_id=v_project and user_id=p_owner_id and role in ('owner','editor') for share;
  if not found then return false; end if;
  select * into v_file from public.project_files where id=p_project_file_id for update;
  if v_file.uploaded_by is distinct from p_owner_id or v_file.upload_attempt_id is distinct from p_attempt_id or
    v_file.content_sha256 is distinct from p_sha256 or v_file.size_bytes is distinct from p_size_bytes or
    v_file.mime_type is distinct from p_mime_type then return false; end if;
  if v_file.status<>'ready' and not public.set_project_file_upload_state(p_project_file_id,p_attempt_id,'ready') then return false; end if;
  perform public.publish_work_execution_output(p_owner_id,p_run_id,p_epoch,p_receipt_epoch,p_step_id,
    p_input_hash,p_project_file_id,p_artifact_id,p_sha256,p_size_bytes,p_mime_type);
  return true;
end $$;

-- Final definition from 20260905002615_unified_work_execution_protocol.sql
create function public.next_work_execution_dispatch(p_runner_id uuid,p_build text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_run public.work_execution_runs%rowtype;
begin
  select * into v_run from public.work_execution_runs where next_dispatch_at<=clock_timestamp()
    and state->>'runnerId'=p_runner_id::text and state->>'runnerBuild'=p_build
    and (status='queued' or (status='running' and (state#>>'{lease,expiresAt}')::numeric<=extract(epoch from clock_timestamp())*1000)
      or (status in ('paused','cancelled') and state->'step'<>'null'::jsonb)
      or (status='paused' and jsonb_array_length(state->'outputRefs')>0))
    order by next_dispatch_at,id for update skip locked limit 1;
  if not found then return null;end if;
  update public.work_execution_runs set next_dispatch_at=clock_timestamp()+interval '30 seconds' where id=v_run.id;
  return jsonb_build_object('owner_id',v_run.owner_id,'state',v_run.state);
end $$;

-- Final definition from 20260905005310_work_accounting_reconciliation.sql
create function public.settle_work_accounting(
  p_owner uuid,p_run uuid,p_step uuid,p_epoch bigint,p_event uuid,p_input_hash text,
  p_receipt_hash text,p_model text,p_input bigint,p_cached bigint,p_output bigint,
  p_reasoning bigint,p_actual_cost numeric,p_latency integer
) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs%rowtype; e public.ai_usage_events%rowtype;
  prior public.work_accounting_settlements%rowtype; totals jsonb; cost numeric;
begin
  if p_owner is null or p_run is null or p_step is null or p_event is null or p_epoch is null or p_epoch<1
    or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$'
    or p_model is null or length(p_model)>100
    or p_input is null or p_cached is null or p_output is null or p_reasoning is null
    or p_latency is null or p_actual_cost is null
    or p_input<0 or p_input>1000000000 or p_output<0 or p_output>1000000000
    or p_cached<0 or p_cached>p_input or p_reasoning<0 or p_reasoning>p_output
    or p_latency<0 or p_actual_cost<0 or p_actual_cost>1000000
    or p_actual_cost::text in ('NaN','Infinity','-Infinity') then
    raise exception 'work_accounting_receipt_invalid';
  end if;
  cost:=round(p_actual_cost,8);
  totals:=jsonb_build_object('model',p_model,'input',p_input,'cached',p_cached,'output',p_output,
    'reasoning',p_reasoning,'cost',cost,'latency',p_latency);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text,20260903204500));
  if not kova_private.auth_user_exists(p_owner)
    or exists(select 1 from public.account_deletion_fences where user_id=p_owner) then
    raise exception 'work_account_unavailable' using errcode='42501';
  end if;
  -- Match canonical admission's lock before locking its usage row. Settlement
  -- remains available during Lockdown, disabled generation, and owner cancellation.
  perform pg_advisory_xact_lock(hashtextextended('kova-ai-global',0));
  select * into r from public.work_execution_runs where id=p_run and owner_id=p_owner for update;
  if not found or r.state->>'model' is distinct from p_model then
    raise exception 'work_accounting_binding_invalid';
  end if;
  select * into e from public.ai_usage_events where id=p_event for update;
  if not found or e.user_id is distinct from p_owner or e.provider_model is distinct from p_model
    or e.idempotency_key is distinct from 'work:'||p_run::text||':'||p_epoch::text||':'||p_step::text then
    raise exception 'work_accounting_binding_invalid';
  end if;
  select * into prior from public.work_accounting_settlements where event_id=p_event;
  if found then
    if prior.run_id is distinct from p_run or prior.owner_id is distinct from p_owner
      or prior.step_id is distinct from p_step or prior.step_epoch is distinct from p_epoch
      or prior.input_hash is distinct from p_input_hash or prior.receipt_hash is distinct from p_receipt_hash
      or prior.totals is distinct from totals then raise exception 'work_accounting_receipt_conflict'; end if;
    return true;
  end if;
  -- A cancelled/recovered run can have a newer epoch; only the persisted step's
  -- original epoch/input/reservation authorize its late authoritative receipt.
  if r.state#>>'{step,id}' is distinct from p_step::text
    or r.state#>>'{step,reservationId}' is distinct from p_event::text
    or r.state#>>'{step,inputHash}' is distinct from p_input_hash
    or (r.state#>>'{step,epoch}')::bigint is distinct from p_epoch then
    raise exception 'work_accounting_binding_invalid';
  end if;
  if e.status='completed' then
    -- Handles an old writer or a lost response after its successful finalization.
    if e.input_tokens is distinct from p_input or e.cached_input_tokens is distinct from p_cached
      or e.output_tokens is distinct from p_output or e.reasoning_tokens is distinct from p_reasoning
      or e.actual_billable_tokens is distinct from p_input+p_output
      or e.actual_cost_usd is distinct from cost or e.latency_ms is distinct from p_latency then
      raise exception 'work_accounting_receipt_conflict';
    end if;
  elsif e.status in ('reserved','started','streaming','stale') then
    if (e.actual_billable_tokens is not null and e.actual_billable_tokens>p_input+p_output)
      or (e.actual_cost_usd is not null and e.actual_cost_usd>cost)
      or e.input_tokens>p_input or e.output_tokens>p_output then
      raise exception 'work_accounting_receipt_conflict';
    end if;
    update public.ai_usage_events set status='completed',input_tokens=p_input,cached_input_tokens=p_cached,
      output_tokens=p_output,reasoning_tokens=p_reasoning,actual_billable_tokens=p_input+p_output,
      actual_cost_usd=cost,latency_ms=p_latency,tool_usage=jsonb_build_object('calls',0),
      error_classification=null,completed_at=now(),lease_expires_at=null where id=p_event;
  else raise exception 'work_accounting_terminal_conflict';
  end if;
  insert into public.work_accounting_settlements(event_id,run_id,owner_id,step_id,step_epoch,input_hash,receipt_hash,totals)
    values(p_event,p_run,p_owner,p_step,p_epoch,p_input_hash,p_receipt_hash,totals);
  return true;
end $$;

-- Final definition from 20260905034000_work_browser_takeover.sql
create function kova_private.lock_work_browser_run(p_owner uuid,p_run uuid,p_revoking boolean default false)
returns public.work_execution_runs language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs; prefs jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,20260903204500));
 if not kova_private.auth_user_exists(p_owner) or (not p_revoking and exists(select 1 from public.account_deletion_fences where user_id=p_owner)) then
   raise exception 'work_browser_owner_unavailable' using errcode='42501'; end if;
 select settings into prefs from public.user_preferences where user_id=p_owner;
 if not p_revoking and prefs is not null and (jsonb_typeof(prefs)<>'object' or coalesce(prefs->>'lockdown_mode','false')<>'false') then
   raise exception 'work_browser_lockdown_active' using errcode='42501'; end if;
 select * into r from public.work_execution_runs where id=p_run and owner_id=p_owner for update;
 if not found then raise exception 'work_browser_not_found' using errcode='42501'; end if;
 return r;
end $$;

-- Final definition from 20260905034000_work_browser_takeover.sql
create function public.admit_work_browser_owner(p_owner uuid,p_run uuid,p_session uuid,p_run_revision bigint,p_sequence bigint,p_operation text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs; s public.work_browser_sessions;
begin
 r:=kova_private.lock_work_browser_run(p_owner,p_run,p_operation='close');
 if r.revision is distinct from p_run_revision then raise exception 'work_browser_revision_conflict' using errcode='40001'; end if;
 if p_session is null or p_operation is null or p_operation not in ('open','navigate','snapshot','click','fill','press','scroll','takeover','release','close') then
   raise exception 'work_browser_operation_invalid' using errcode='22023'; end if;
 if p_operation<>'close' and (r.status<>'paused' or r.state->'step' is distinct from 'null'::jsonb or r.state#>>'{effect,status}'='started') then
   raise exception 'work_browser_pause_required' using errcode='42501'; end if;
 if p_operation='open' then
   if p_sequence is distinct from 0 then raise exception 'work_browser_sequence_conflict' using errcode='40001'; end if;
   update public.work_browser_sessions set mode='closed' where run_id=p_run and expires_at<=clock_timestamp();
   if (select count(*) from public.work_browser_sessions where owner_id=p_owner)>=10000 then
     raise exception 'work_browser_limit' using errcode='54000'; end if;
   insert into public.work_browser_sessions(id,owner_id,run_id,mode,operation) values(p_session,p_owner,p_run,'takeover',p_operation) returning * into s;
 else
   select * into s from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run for update;
   if not found or s.sequence is distinct from p_sequence or s.mode='closed' or (p_operation<>'close' and s.expires_at<=clock_timestamp()) then
     raise exception 'work_browser_sequence_conflict' using errcode='40001'; end if;
   if p_operation not in ('close','takeover') and s.mode<>'takeover' then
     raise exception 'work_browser_takeover_required' using errcode='42501'; end if;
   update public.work_browser_sessions set sequence=sequence+1,operation=p_operation,
     mode=case when p_operation='takeover' then 'takeover' else mode end
     where id=p_session returning * into s;
 end if;
 return jsonb_build_object('sessionId',s.id,'runId',s.run_id,'sequence',s.sequence,'mode',s.mode,
   'expiresAt',floor(extract(epoch from s.expires_at)*1000));
end $$;

-- Final definition from 20260905034000_work_browser_takeover.sql
create function public.finish_work_browser_owner(p_owner uuid,p_run uuid,p_session uuid,p_sequence bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs; s public.work_browser_sessions;
begin
 r:=kova_private.lock_work_browser_run(p_owner,p_run,exists(select 1 from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run and operation='close' and sequence=p_sequence));
 select * into s from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run for update;
 if not found or s.sequence<>p_sequence then return false; end if;
 if s.operation='release' then
   if r.status<>'paused' or r.state->'step' is distinct from 'null'::jsonb or r.state#>>'{effect,status}'='started' then return false; end if;
   update public.work_browser_sessions set mode='agent' where id=p_session;
 elsif s.operation='close' then update public.work_browser_sessions set mode='closed' where id=p_session;
 end if;
 return true;
end $$;

-- Final definition from 20260905034000_work_browser_takeover.sql
create function public.authorize_work_browser(p_owner uuid,p_run uuid,p_session uuid,p_runner uuid,p_build text,p_actor text,p_phase text,p_sequence bigint default null,p_epoch bigint default null,p_step uuid default null,p_hash text default null,p_approval uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.work_execution_runs; s public.work_browser_sessions; t numeric:=extract(epoch from clock_timestamp())*1000;
begin
 r:=kova_private.lock_work_browser_run(p_owner,p_run,p_actor='owner' and p_phase='check' and exists(select 1 from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run and operation='close' and sequence=p_sequence));
 if r.state->>'runnerId' is distinct from p_runner::text or r.state->>'runnerBuild' is distinct from p_build then
   raise exception 'work_browser_runner_denied' using errcode='42501'; end if;
 select * into s from public.work_browser_sessions where id=p_session and owner_id=p_owner and run_id=p_run for update;
 if not found or s.mode='closed' or s.expires_at<=clock_timestamp() then raise exception 'work_browser_session_stale' using errcode='42501'; end if;
 if p_actor='owner' then
   if p_phase<>'check' or s.sequence is distinct from p_sequence or
     (s.operation<>'close' and (r.status<>'paused' or r.state->'step' is distinct from 'null'::jsonb or r.state#>>'{effect,status}'='started')) or
     (s.operation<>'close' and s.mode<>'takeover') then raise exception 'work_browser_owner_denied' using errcode='42501'; end if;
 elsif p_actor='agent' then
   if s.mode<>'agent' or r.status<>'running' or (r.state->>'epoch')::bigint is distinct from p_epoch or
     r.state#>>'{step,id}' is distinct from p_step::text or r.state#>>'{step,inputHash}' is distinct from p_hash or
     coalesce((r.state#>>'{lease,expiresAt}')::numeric,0)<=t or coalesce((r.state->>'deadline')::numeric,0)<=t then
       raise exception 'work_browser_agent_denied' using errcode='42501'; end if;
   if p_phase<>'catalog' then
     if r.state#>>'{approval,id}' is distinct from p_approval::text or r.state#>>'{approval,status}' is distinct from 'consumed' or
       r.state#>>'{approval,action}' is distinct from 'browser_interact' or
       r.state#>>'{effect,id}' is distinct from p_approval::text or r.state#>>'{effect,status}' is distinct from 'started' or
       coalesce((r.state#>>'{approval,expiresAt}')::numeric,0)<=t or
       (r.state#>>'{approval,canonicalInput}')::jsonb->>'sessionId' is distinct from p_session::text then
       raise exception 'work_browser_approval_required' using errcode='42501'; end if;
   end if;
   if p_phase='admit_agent' then
     if s.last_approval_id is distinct from p_approval then
       update public.work_browser_sessions set sequence=sequence+1,last_approval_id=p_approval,operation='agent' where id=p_session returning * into s;
     end if;
   elsif p_phase='check' then
     if s.last_approval_id is distinct from p_approval or s.sequence is distinct from p_sequence then
       raise exception 'work_browser_sequence_conflict' using errcode='40001'; end if;
   elsif p_phase<>'catalog' then raise exception 'work_browser_phase_invalid' using errcode='22023'; end if;
 else raise exception 'work_browser_actor_invalid' using errcode='22023'; end if;
 return jsonb_build_object('allowed',true,'sequence',s.sequence,'expiresAt',floor(extract(epoch from s.expires_at)*1000));
end $$;

-- Final definition from 20260905034000_work_browser_takeover.sql
create function kova_private.guard_work_browser_takeover() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_id::text,20260903204500));
 if new.status in ('queued','running') and exists(select 1 from public.work_browser_sessions
   where run_id=new.id and mode='takeover' and expires_at>clock_timestamp()) then
   raise exception 'work_browser_takeover_active' using errcode='42501'; end if;
 return new;
end $$;

-- Final definition from 20260910143000_work_specialist_state_transitions.sql
create or replace function public.commit_work_execution(
  p_owner_id uuid, p_run_id uuid, p_mutation_id uuid, p_mutation_hash text,
  p_expected_revision bigint, p_state jsonb, p_runner_ready_until timestamptz default null,
  p_concurrency integer default 1
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run public.work_execution_runs%rowtype;
  v_receipt public.work_execution_receipts%rowtype;
  v_revision bigint;
  v_status text;
  v_setting jsonb;
  v_session public.work_saved_records%rowtype;
  v_output jsonb;
  v_notification boolean;
begin
  if p_owner_id is null or p_run_id is null or p_mutation_id is null or
     p_mutation_hash is null or p_mutation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'work_input_invalid' using errcode = '22023';
  end if;
  -- Same account-deletion lock as admission into other owned storage lifecycles.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text, 20260903204500));
  if not kova_private.auth_user_exists(p_owner_id) or
    exists(select 1 from public.account_deletion_fences where user_id = p_owner_id) then
    raise exception 'work_account_unavailable' using errcode = '42501';
  end if;
  select * into v_receipt from public.work_execution_receipts where owner_id = p_owner_id and mutation_id = p_mutation_id;
  if found then
    if v_receipt.mutation_hash <> p_mutation_hash or v_receipt.run_id <> p_run_id then
      raise exception 'work_idempotency_conflict' using errcode = '40001';
    end if;
    select state into p_state from public.work_execution_runs where id = p_run_id and owner_id = p_owner_id;
    return jsonb_build_object('state', p_state, 'idempotent', true, 'appliedRevision', v_receipt.revision);
  end if;
  if jsonb_typeof(p_state) is distinct from 'object' or octet_length(p_state::text) > 262144 or
    p_state->>'protocol' is distinct from 'kova-work-v1' or p_state->>'id' is distinct from p_run_id::text or
    p_state->>'ownerId' is distinct from p_owner_id::text or
    coalesce(p_state->>'requestHash','') !~ '^[0-9a-f]{64}$' then
    raise exception 'work_state_invalid' using errcode = '22023';
  end if;
  v_revision := (p_state->>'revision')::bigint;
  v_status := p_state->>'status';
  if v_revision is distinct from p_expected_revision + 1 or v_revision > 100000 then
    raise exception 'work_revision_invalid' using errcode = '40001';
  end if;
  select * into v_run from public.work_execution_runs where id = p_run_id for update;
  if found then
    if v_run.owner_id <> p_owner_id then raise exception 'work_owner_required' using errcode = '42501'; end if;
    if v_run.revision <> p_expected_revision then raise exception 'work_revision_conflict' using errcode = '40001'; end if;
    if (v_run.state - array['status','revision','epoch','updatedAt','lease','usage','directions','question','approval','effect','step','reconciling','reservationIds','stepIds','outputRefs','evidence','event','specialists'])
       is distinct from (p_state - array['status','revision','epoch','updatedAt','lease','usage','directions','question','approval','effect','step','reconciling','reservationIds','stepIds','outputRefs','evidence','event','specialists']) then
      raise exception 'work_immutable_input_changed' using errcode = '22023';
    end if;
    if v_run.status in ('completed','failed','cancelled') and v_status <> v_run.status then
      raise exception 'work_terminal_immutable' using errcode = '22023';
    end if;
  else
    if p_expected_revision <> 0 or v_status <> 'queued' or p_runner_ready_until is null or
      p_runner_ready_until <= clock_timestamp() or p_runner_ready_until > clock_timestamp() + interval '60 seconds' or
      p_concurrency not between 1 and 3 or coalesce(p_state->>'plan','') not in ('plus','pro') then
      raise exception 'work_admission_unavailable' using errcode = '55000';
    end if;
    select settings into v_setting from public.user_preferences where user_id = p_owner_id;
    if v_setting is not null and (jsonb_typeof(v_setting) <> 'object' or coalesce(v_setting->>'lockdown_mode','false') <> 'false') then
      raise exception 'work_lockdown_active' using errcode = '42501';
    end if;
    if (select count(*) from public.work_execution_runs where owner_id=p_owner_id and status not in ('completed','failed','cancelled')) >= p_concurrency or
       (select count(*) from public.work_execution_runs where owner_id=p_owner_id) >= 1000 then
      raise exception 'work_capacity_exceeded' using errcode = '54000';
    end if;
    if p_state#>>'{request,sessionId}' is not null then
      select * into v_session from public.work_saved_records where owner_id=p_owner_id and id=(p_state#>>'{request,sessionId}')::uuid for share;
      if not found or v_session.kind <> 'session' or v_session.deleted_at is not null or
        v_session.revision is distinct from (p_state#>>'{request,sessionRevision}')::bigint or
        p_state->'sessionContext' is distinct from jsonb_build_object('objective',v_session.payload->'objective','context',v_session.payload->'context','steps',v_session.payload->'steps') then
        raise exception 'work_session_conflict' using errcode = '40001';
      end if;
    elsif p_state#>>'{request,sessionRevision}' is not null or p_state->'sessionContext' is distinct from 'null'::jsonb then
      raise exception 'work_session_invalid' using errcode = '22023';
    end if;
    if p_state#>>'{request,projectId}' is not null and not exists(select 1 from public.projects p join public.project_members m on m.project_id=p.id
      where p.id=(p_state#>>'{request,projectId}')::uuid and p.deletion_requested_at is null and m.user_id=p_owner_id and m.role in ('owner','editor')) then
      raise exception 'work_output_project_access_required' using errcode='42501';
    end if;
  end if;
  if v_status = 'completed' then
    if jsonb_typeof(p_state->'outputRefs') is distinct from 'array' or jsonb_array_length(p_state->'outputRefs') not between 1 and 20 then
      raise exception 'work_outputs_required' using errcode='22023';
    end if;
    for v_output in select value from jsonb_array_elements(p_state->'outputRefs') loop
      if v_output->>'kind' is distinct from 'library' or not exists(select 1 from public.user_library_items where id=(v_output->>'id')::uuid and user_id=p_owner_id) then
        raise exception 'work_output_not_owned' using errcode='42501';
      end if;
      if not exists(select 1 from public.work_execution_outputs o join public.project_files f on f.id=o.project_file_id
        join public.projects p on p.id=f.project_id join public.project_members m on m.project_id=p.id and m.user_id=p_owner_id
        where o.id=(v_output->>'id')::uuid and o.run_id=p_run_id and o.owner_id=p_owner_id and f.status='ready'
          and f.content_sha256=o.sha256 and p.deletion_requested_at is null) then
        raise exception 'work_output_provenance_unavailable' using errcode='42501';
      end if;
    end loop;
  end if;
  if coalesce(p_state#>>'{event,kind}','') !~ '^[a-z_]{3,40}$' or octet_length((p_state->'event')::text)>16384 then
    raise exception 'work_event_invalid' using errcode='22023';
  end if;
  insert into public.work_execution_runs(id,owner_id,request_id,request_hash,revision,status,state)
    values(p_run_id,p_owner_id,(p_state#>>'{request,mutationId}')::uuid,p_state->>'requestHash',v_revision,v_status,p_state)
    on conflict(id) do update set revision=excluded.revision,status=excluded.status,state=excluded.state,updated_at=now();
  insert into public.work_execution_events(run_id,owner_id,revision,kind,detail)
    values(p_run_id,p_owner_id,v_revision,p_state#>>'{event,kind}',coalesce(p_state#>'{event,detail}','{}'::jsonb));
  insert into public.work_execution_receipts(owner_id,mutation_id,mutation_hash,run_id,revision)
    values(p_owner_id,p_mutation_id,p_mutation_hash,p_run_id,v_revision);
  v_notification := v_status in ('waiting_for_user','approval_required','completed','failed') and
    v_run.status is distinct from v_status and not exists(select 1 from public.notification_preferences
      where user_id=p_owner_id and (not in_app_enabled or categories->>'tasks'='false'));
  if v_notification then
    insert into public.app_notifications(owner_id,type,title,safe_preview,action_url,source_entity,delivery_state)
    values(p_owner_id,case when v_status='failed' then 'task_failure' else 'task_result' end,
      case when v_status='completed' then 'Work completed' when v_status='failed' then 'Work needs attention' else 'Work is waiting for you' end,
      'Open Work to review the current result or requested action.', '/work',
      'work-execution:'||p_run_id::text||':'||v_revision::text,'delivered');
  end if;
  return jsonb_build_object('state',p_state,'idempotent',false,'appliedRevision',v_revision);
end $$;

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
alter table public.work_saved_records
  add constraint work_saved_records_payload_depth_check
    check (public.work_sync_payload_depth_allowed(payload, 16)) not valid,
  add constraint work_saved_records_deleted_body_check
    check (
      deleted_at is null
      or (title = 'Deleted Work item' and payload = '{}'::jsonb)
    );

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
create trigger enforce_work_sync_receipt_capacity
before insert on public.work_sync_mutations
for each row execute function public.enforce_work_sync_receipt_capacity();

-- Final definition from 20260903214500_work_sync_protection_hardening.sql
create trigger enforce_work_saved_payload_capacity
before insert or update of owner_id, id, payload, deleted_at
on public.work_saved_records
for each row execute function public.enforce_work_saved_payload_capacity();

-- Final definition from 20260905034000_work_browser_takeover.sql
create trigger guard_work_browser_takeover before update on public.work_execution_runs for each row execute function kova_private.guard_work_browser_takeover();

do $work_forward_security$
declare t text; f record;
begin
 foreach t in array array['work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions'] loop
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  if t='work_accounting_settlements' then
   execute format('grant select,insert on table public.%I to service_role',t);
  elsif t='work_execution_outputs' then
   execute format('grant select,insert,delete on table public.%I to service_role',t);
  else
   execute format('grant select,insert,update,delete on table public.%I to service_role',t);
  end if;
  execute format('create policy kova_owned_session_guard on public.%I as restrictive for all to anon,authenticated using ((select kova_auth_guard.session_is_active())) with check ((select kova_auth_guard.session_is_active()))',t);
  execute format('comment on table public.%I is %L',t,'kova-work-runtime-forward-v1');
 end loop;
 foreach t in array array['work_saved_records','work_recent_items','work_execution_runs','work_execution_events','work_execution_outputs','work_browser_sessions'] loop
  execute format('grant select on table public.%I to authenticated',t);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any(array['kova_private.guard_work_browser_takeover','kova_private.lock_work_browser_run','public.admit_work_browser_owner','public.assert_work_execution_lease','public.authorize_work_browser','public.commit_work_execution','public.delete_work_saved_record','public.enforce_work_saved_payload_capacity','public.enforce_work_sync_receipt_capacity','public.finish_work_browser_owner','public.get_work_sync_changes','public.mutate_work_recent_item','public.next_work_execution_dispatch','public.next_work_sync_version','public.publish_work_execution_output','public.publish_work_project_file','public.purge_work_sync_receipts','public.settle_work_accounting','public.upsert_work_saved_record','public.validate_work_session','public.work_sync_payload_depth_allowed','public.work_sync_request_fingerprint']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end
$work_forward_security$;
do $work_forward_postcheck$ begin
 if exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['account_audit_entries','agent_jobs','account_deletion_fences','app_notifications','notification_preferences','user_library_items','user_preferences','ai_usage_events','project_files','projects','project_members','work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions']) and a.attnum>0 and not a.attisdropped and coalesce(cardinality(a.attacl),0)>0) then raise exception 'work_forward_column_acl_drift'; end if;
if encode(sha256(convert_to((select jsonb_build_object('tables',(
 select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) z),'comment',obj_description(c.oid,'pg_class'),
 'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'type',x.contype,'validated',x.convalidated,'definition',pg_get_constraintdef(x.oid,true)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
 'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by ic.relname) from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid),
 'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'command',p.polcmd,'roles',(select jsonb_agg(case when z=0 then 'PUBLIC' else pg_get_userbyid(z) end order by case when z=0 then 'PUBLIC' else pg_get_userbyid(z) end) from unnest(p.polroles) z),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname=any(array['work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions'])),
 'functions',(
 select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) z)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any(array['kova_private.guard_work_browser_takeover','kova_private.lock_work_browser_run','public.admit_work_browser_owner','public.assert_work_execution_lease','public.authorize_work_browser','public.commit_work_execution','public.delete_work_saved_record','public.enforce_work_saved_payload_capacity','public.enforce_work_sync_receipt_capacity','public.finish_work_browser_owner','public.get_work_sync_changes','public.mutate_work_recent_item','public.next_work_execution_dispatch','public.next_work_sync_version','public.publish_work_execution_output','public.publish_work_project_file','public.purge_work_sync_receipts','public.settle_work_accounting','public.upsert_work_saved_record','public.validate_work_session','public.work_sync_payload_depth_allowed','public.work_sync_request_fingerprint']))))::text,'UTF8')),'hex') is distinct from (case current_setting('server_version_num')::integer / 10000 when 17 then '0efdd7c4d84c6d192ce24d834d9c94394157230569b5fab7d2453c6ed7edd467' when 18 then 'a285dea06e01c3e587a1693a39858aef6d2fbcd9ff10c4f0a7da3e78746ea66b' else '' end) then raise exception 'work_forward_installation_drift'; end if;
end $work_forward_postcheck$;

$work_forward_payload$;
end
$work_forward_install$;
commit;
