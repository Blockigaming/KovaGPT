import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const WORK_RUNTIME_MIGRATION =
  "supabase/migrations/20261030163511_kova_work_runtime_forward.sql";
export const WORK_RUNTIME_TABLES = Object.freeze([
  "work_sync_counters",
  "work_saved_records",
  "work_recent_items",
  "work_sync_mutations",
  "work_execution_runs",
  "work_execution_events",
  "work_execution_receipts",
  "work_execution_outputs",
  "work_accounting_settlements",
  "work_browser_sessions",
]);
export const WORK_RUNTIME_FUNCTIONS = Object.freeze([
  "kova_private.guard_work_browser_takeover",
  "kova_private.lock_work_browser_run",
  "public.admit_work_browser_owner",
  "public.assert_work_execution_lease",
  "public.authorize_work_browser",
  "public.commit_work_execution",
  "public.delete_work_saved_record",
  "public.enforce_work_saved_payload_capacity",
  "public.enforce_work_sync_receipt_capacity",
  "public.finish_work_browser_owner",
  "public.get_work_sync_changes",
  "public.mutate_work_recent_item",
  "public.next_work_execution_dispatch",
  "public.next_work_sync_version",
  "public.publish_work_execution_output",
  "public.publish_work_project_file",
  "public.purge_work_sync_receipts",
  "public.settle_work_accounting",
  "public.upsert_work_saved_record",
  "public.validate_work_session",
  "public.work_sync_payload_depth_allowed",
  "public.work_sync_request_fingerprint",
]);
const baselineQuery = String.raw`select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'primary_key',(select jsonb_agg(a.attname order by x.ord) from pg_constraint ct cross join lateral unnest(ct.conkey) with ordinality x(attnum,ord) join pg_attribute a on a.attrelid=c.oid and a.attnum=x.attnum where ct.conrelid=c.oid and ct.contype='p'),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) z)) order by c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname=any(array['account_audit_entries','account_deletion_fences','agent_jobs','ai_usage_events','app_notifications','notification_preferences','project_files','project_members','projects','user_library_items','user_preferences'])),'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) z)) order by n.nspname,p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='kova_private' and p.proname='auth_user_exists') or(n.nspname='public' and p.proname='set_project_file_upload_state')))`;
const snapshotQuery = String.raw`select jsonb_build_object('tables',(
 select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(ad.adbin,ad.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) z),'comment',obj_description(c.oid,'pg_class'),
 'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'type',x.contype,'validated',x.convalidated,'definition',pg_get_constraintdef(x.oid,true)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
 'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by ic.relname) from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid=c.oid),
 'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'permissive',p.polpermissive,'command',p.polcmd,'roles',(select jsonb_agg(case when z=0 then 'PUBLIC' else pg_get_userbyid(z) end order by case when z=0 then 'PUBLIC' else pg_get_userbyid(z) end) from unnest(p.polroles) z),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname=any(array['work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions'])),
 'functions',(
 select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) z)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any(array['kova_private.guard_work_browser_takeover','kova_private.lock_work_browser_run','public.admit_work_browser_owner','public.assert_work_execution_lease','public.authorize_work_browser','public.commit_work_execution','public.delete_work_saved_record','public.enforce_work_saved_payload_capacity','public.enforce_work_sync_receipt_capacity','public.finish_work_browser_owner','public.get_work_sync_changes','public.mutate_work_recent_item','public.next_work_execution_dispatch','public.next_work_sync_version','public.publish_work_execution_output','public.publish_work_project_file','public.purge_work_sync_receipts','public.settle_work_accounting','public.upsert_work_saved_record','public.validate_work_session','public.work_sync_payload_depth_allowed','public.work_sync_request_fingerprint'])))`;
const baselineExpected = {
  tables: [
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "account_audit_entries",
      owner: "postgres",
      columns: [
        {
          name: "id",
          type: "uuid",
          default: "gen_random_uuid()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "user_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "event_type",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "safe_description",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "actor_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "target_id",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "result",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "metadata",
          type: "jsonb",
          default: "'{}'::jsonb",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["id"],
    },
    {
      acl: [
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "account_deletion_fences",
      owner: "postgres",
      columns: [
        {
          name: "user_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "requested_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "updated_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["user_id"],
    },
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "agent_jobs",
      owner: "postgres",
      columns: [
        {
          name: "id",
          type: "uuid",
          default: "gen_random_uuid()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "owner_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "project_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        { name: "kind", type: "text", default: null, identity: "", not_null: true, generated: "" },
        {
          name: "status",
          type: "text",
          default: "'queued'::text",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "input",
          type: "jsonb",
          default: "'{}'::jsonb",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "result",
          type: "jsonb",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "error",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "priority",
          type: "integer",
          default: "0",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "attempts",
          type: "integer",
          default: "0",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "max_attempts",
          type: "integer",
          default: "3",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "worker_id",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "lease_expires_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "available_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "started_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "completed_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "updated_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["id"],
    },
    {
      acl: [
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "ai_usage_events",
      owner: "postgres",
      columns: [
        {
          name: "id",
          type: "uuid",
          default: "gen_random_uuid()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "request_id",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "idempotency_key",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "user_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "guest_ip_hash",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "conversation_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "kova_mode",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "plan_tier",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "premium",
          type: "boolean",
          default: "false",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "provider",
          type: "text",
          default: "'openai'::text",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "provider_model",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "estimated_input_tokens",
          type: "bigint",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "reserved_tokens",
          type: "bigint",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "input_tokens",
          type: "bigint",
          default: "0",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "cached_input_tokens",
          type: "bigint",
          default: "0",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "output_tokens",
          type: "bigint",
          default: "0",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "reasoning_tokens",
          type: "bigint",
          default: "0",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "actual_billable_tokens",
          type: "bigint",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "tool_usage",
          type: "jsonb",
          default: "'{}'::jsonb",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "estimated_cost_usd",
          type: "numeric(14,8)",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "actual_cost_usd",
          type: "numeric(14,8)",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "context_trimmed",
          type: "boolean",
          default: "false",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "status",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "latency_ms",
          type: "integer",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "error_classification",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "lease_expires_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "started_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "completed_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
      ],
      primary_key: ["id"],
    },
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "app_notifications",
      owner: "postgres",
      columns: [
        {
          name: "id",
          type: "uuid",
          default: "gen_random_uuid()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "owner_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        { name: "type", type: "text", default: null, identity: "", not_null: true, generated: "" },
        { name: "title", type: "text", default: null, identity: "", not_null: true, generated: "" },
        {
          name: "safe_preview",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "action_url",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "source_entity",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "delivery_state",
          type: "text",
          default: "'delivered'::text",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "read_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "expires_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["id"],
    },
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "notification_preferences",
      owner: "postgres",
      columns: [
        {
          name: "user_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "in_app_enabled",
          type: "boolean",
          default: "true",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "account_email_enabled",
          type: "boolean",
          default: "true",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "verified_email",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "categories",
          type: "jsonb",
          default:
            '\'{"tasks": true, "billing": true, "projects": true, "security": true, "connectors": true}\'::jsonb',
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "time_zone",
          type: "text",
          default: "'UTC'::text",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "updated_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["user_id"],
    },
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "project_files",
      owner: "postgres",
      columns: [
        {
          name: "id",
          type: "uuid",
          default: "gen_random_uuid()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "project_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        { name: "name", type: "text", default: null, identity: "", not_null: true, generated: "" },
        {
          name: "storage_path",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "mime_type",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "size_bytes",
          type: "bigint",
          default: "0",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "kind",
          type: "text",
          default: "'file'::text",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "uploaded_by",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "status",
          type: "text",
          default: "'ready'::text",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "account_cleanup_user_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "content_sha256",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "idempotency_key",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "storage_owner_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "storage_charged",
          type: "boolean",
          default: "false",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "upload_quota_acquired",
          type: "boolean",
          default: "false",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "upload_attempt_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "upload_lease_until",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "delete_attempt_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "delete_lease_until",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "updated_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["id"],
    },
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "project_members",
      owner: "postgres",
      columns: [
        {
          name: "project_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "user_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "role",
          type: "project_role",
          default: "'editor'::project_role",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["project_id", "user_id"],
    },
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "projects",
      owner: "postgres",
      columns: [
        {
          name: "id",
          type: "uuid",
          default: "gen_random_uuid()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "owner_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        { name: "name", type: "text", default: null, identity: "", not_null: true, generated: "" },
        {
          name: "description",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "system_prompt",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "color",
          type: "text",
          default: "'blue'::text",
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "updated_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "archived_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "pinned_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "deletion_requested_at",
          type: "timestamp with time zone",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
      ],
      primary_key: ["id"],
    },
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "user_library_items",
      owner: "postgres",
      columns: [
        {
          name: "id",
          type: "uuid",
          default: "gen_random_uuid()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "user_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        { name: "title", type: "text", default: null, identity: "", not_null: true, generated: "" },
        {
          name: "item_type",
          type: "text",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "source",
          type: "text",
          default: "'manual'::text",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "content_text",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "file_url",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "file_name",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "file_type",
          type: "text",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "file_size",
          type: "bigint",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "metadata",
          type: "jsonb",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "created_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "updated_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "folder_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: false,
          generated: "",
        },
        {
          name: "content_generation",
          type: "uuid",
          default: "gen_random_uuid()",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "content_revision",
          type: "bigint",
          default: "1",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["id"],
    },
    {
      acl: [
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "anon", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "authenticated", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "UPDATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "DELETE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "INSERT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "MAINTAIN" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "REFERENCES" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "SELECT" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRIGGER" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "TRUNCATE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "UPDATE" },
      ],
      rls: true,
      name: "user_preferences",
      owner: "postgres",
      columns: [
        {
          name: "user_id",
          type: "uuid",
          default: null,
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "settings",
          type: "jsonb",
          default: "'{}'::jsonb",
          identity: "",
          not_null: true,
          generated: "",
        },
        {
          name: "updated_at",
          type: "timestamp with time zone",
          default: "now()",
          identity: "",
          not_null: true,
          generated: "",
        },
      ],
      primary_key: ["user_id"],
    },
  ],
  functions: [
    {
      acl: [
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "EXECUTE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "EXECUTE" },
      ],
      name: "auth_user_exists",
      owner: "postgres",
      schema: "kova_private",
      definition:
        "CREATE OR REPLACE FUNCTION kova_private.auth_user_exists(p_user_id uuid)\n RETURNS boolean\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n  return exists(select 1 from auth.users where id = p_user_id and deleted_at is null);\nend;\n$function$\n",
    },
    {
      acl: [
        { grantee: "postgres", grantor: "postgres", grantable: false, privilege: "EXECUTE" },
        { grantee: "service_role", grantor: "postgres", grantable: false, privilege: "EXECUTE" },
      ],
      name: "set_project_file_upload_state",
      owner: "postgres",
      schema: "public",
      definition:
        "CREATE OR REPLACE FUNCTION public.set_project_file_upload_state(p_file_id uuid, p_attempt_id uuid, p_status text)\n RETURNS boolean\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nDECLARE\n  target_project_id uuid;\n  changed boolean;\n  target public.project_files;\nBEGIN\n  IF p_file_id IS NULL\n    OR p_attempt_id IS NULL\n    OR p_status IS NULL\n    OR p_status NOT IN ('pending', 'ready', 'upload_failed', 'cleanup_failed')\n  THEN\n    RAISE EXCEPTION\n      USING ERRCODE = '22023', MESSAGE = 'invalid_project_file_upload_state';\n  END IF;\n\n  target_project_id := public.lock_project_for_file_operation(p_file_id);\n  IF target_project_id IS NULL THEN\n    RETURN false;\n  END IF;\n\n  IF p_status = 'ready' THEN\n    SELECT * INTO target FROM public.project_files WHERE id=p_file_id\n      AND project_id=target_project_id AND upload_attempt_id=p_attempt_id\n      AND status='pending' AND upload_lease_until > now() FOR UPDATE;\n    IF NOT FOUND OR NOT public.settle_account_storage_artifact(p_attempt_id,target.storage_owner_id,target.uploaded_by,'project-files',target.storage_path) THEN\n      RETURN false;\n    END IF;\n  END IF;\n\n  UPDATE public.project_files\n  SET status = p_status,\n      upload_lease_until = CASE\n        WHEN p_status = 'pending' THEN now() + interval '2 minutes'\n        ELSE NULL\n      END,\n      updated_at = now()\n  WHERE id = p_file_id\n    AND project_id = target_project_id\n    AND upload_attempt_id = p_attempt_id\n  RETURNING true INTO changed;\n\n  RETURN coalesce(changed, false);\nEND\n$function$\n",
    },
  ],
};
const guardDefinitionSha256 = "ff89d138f79046dce793f1870b72f402dc405f9bb706ef2e733937cfb3ad0471";
const zeroColumnAclQuery =
  "select not exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['account_audit_entries','agent_jobs','account_deletion_fences','app_notifications','notification_preferences','user_library_items','user_preferences','ai_usage_events','project_files','projects','project_members','work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions']) and a.attnum>0 and not a.attisdropped and coalesce(cardinality(a.attacl),0)>0) as valid";
// This exact canonical-only profile never relaxes installation or unused rollback.
export const WORK_RUNTIME_CANONICAL_COLUMN_ACL_CHECK =
  "select not exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['account_audit_entries','agent_jobs','account_deletion_fences','app_notifications','notification_preferences','user_library_items','user_preferences','ai_usage_events','project_files','projects','project_members','work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions']) and a.attnum>0 and not a.attisdropped and coalesce(cardinality(a.attacl),0)>0) or (to_regclass('public.work_execution_runs') is not null and not has_table_privilege('authenticated','public.user_library_items','UPDATE') and (select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'grantor',pg_get_userbyid(z.grantor),'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,'privilege',z.privilege_type,'grantable',z.is_grantable) order by c.relname,a.attname,pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(a.attacl) z where n.nspname='public' and c.relname=any(array['account_audit_entries','agent_jobs','account_deletion_fences','app_notifications','notification_preferences','user_library_items','user_preferences','ai_usage_events','project_files','projects','project_members','work_sync_counters','work_saved_records','work_recent_items','work_sync_mutations','work_execution_runs','work_execution_events','work_execution_receipts','work_execution_outputs','work_accounting_settlements','work_browser_sessions']) and a.attnum>0 and not a.attisdropped)='[{\"table\":\"user_library_items\",\"column\":\"folder_id\",\"owner\":\"postgres\",\"rls\":true,\"force_rls\":false,\"grantor\":\"postgres\",\"grantee\":\"authenticated\",\"privilege\":\"UPDATE\",\"grantable\":false},{\"table\":\"user_library_items\",\"column\":\"title\",\"owner\":\"postgres\",\"rls\":true,\"force_rls\":false,\"grantor\":\"postgres\",\"grantee\":\"authenticated\",\"privilege\":\"UPDATE\",\"grantable\":false},{\"table\":\"user_library_items\",\"column\":\"updated_at\",\"owner\":\"postgres\",\"rls\":true,\"force_rls\":false,\"grantor\":\"postgres\",\"grantee\":\"authenticated\",\"privilege\":\"UPDATE\",\"grantable\":false}]'::jsonb) as valid";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
// PostgreSQL18 also records named NOT NULL constraints in pg_constraint.
// Keep every raw catalog field and pin a separate exact profile per server major.
const installedCatalogProfiles = Object.freeze({
  17: Object.freeze({
    canonicalSha256: "e63ebbe33c281357c41b3e908c8ae2c388e46d1ff3363fdf3252c68c33c45ccb",
    postgresJsonbSha256: "0efdd7c4d84c6d192ce24d834d9c94394157230569b5fab7d2453c6ed7edd467",
  }),
  18: Object.freeze({
    canonicalSha256: "049cd0a5f7ec0e037a539384fc3486dc475472a50b7c50fd46650bbe872c2e25",
    postgresJsonbSha256: "a285dea06e01c3e587a1693a39858aef6d2fbcd9ff10c4f0a7da3e78746ea66b",
  }),
});
const serverMajorQuery = "select current_setting('server_version_num')::integer / 10000 as major";
const catalogProfile = (major) =>
  Number.isInteger(major) && Object.hasOwn(installedCatalogProfiles, major)
    ? installedCatalogProfiles[major]
    : null;
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
const exactObjects = (snapshot) => {
  if (
    snapshot?.tables?.length !== WORK_RUNTIME_TABLES.length ||
    snapshot?.functions?.length !== WORK_RUNTIME_FUNCTIONS.length
  )
    return false;
  if (
    new Set(snapshot.tables.map((t) => t.name)).size !== WORK_RUNTIME_TABLES.length ||
    new Set(snapshot.functions.map((f) => f.schema + "." + f.name)).size !==
      WORK_RUNTIME_FUNCTIONS.length
  )
    return false;
  return (
    snapshot.tables.every(
      (t) => WORK_RUNTIME_TABLES.includes(t.name) && t.comment === "kova-work-runtime-forward-v1",
    ) && snapshot.functions.every((f) => WORK_RUNTIME_FUNCTIONS.includes(f.schema + "." + f.name))
  );
};
const roleQuery =
  "select current_user='postgres' and exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls and not rolsuper) and exists(select 1 from pg_roles where rolname='authenticated' and not rolbypassrls and not rolsuper) and exists(select 1 from pg_roles where rolname='anon' and not rolbypassrls and not rolsuper) as valid";

const literal = (value) => "'" + value.replaceAll("'", "''") + "'";

/** Read-only exact inspected baseline. Also embedded before installation writes. */
export async function workRuntimePreflight() {
  const source = await readFile(WORK_RUNTIME_MIGRATION, "utf8");
  return source.split("-- WORK_PREFLIGHT_BEGIN\n")[1].split("\n-- WORK_PREFLIGHT_END")[0];
}

export async function workRuntimeInstallationSnapshot(query) {
  return (await query(snapshotQuery + " as value")).rows[0].value;
}

/** Qualified local/production-unused metadata; never proof of whole Auth recovery. */
export async function captureUnusedWorkRuntimeQualification(query) {
  const source = await readFile(WORK_RUNTIME_MIGRATION, "utf8");
  const serverMajor = (await query(serverMajorQuery)).rows[0].major;
  const profile = catalogProfile(serverMajor);
  if (!profile) throw Error("work_forward_server_version_unsupported");
  if (!(await query(roleQuery)).rows[0].valid) throw Error("work_forward_role_drift");
  if (!(await query(zeroColumnAclQuery)).rows[0].valid)
    throw Error("work_forward_column_acl_drift");
  const baseline = (await query(baselineQuery + " as value")).rows[0].value;
  if (JSON.stringify(baseline) !== JSON.stringify(baselineExpected)) {
    // JSON object key order may vary across adapters; PostgreSQL jsonb compares it.
    const same = (await query("select $1::jsonb=$2::jsonb as same", [baseline, baselineExpected]))
      .rows[0].same;
    if (!same) throw Error("work_forward_baseline_drift");
  }
  const guard = (
    await query(
      "select encode(sha256(convert_to(pg_get_functiondef('kova_auth_guard.session_is_active()'::regprocedure),'UTF8')),'hex') as value",
    )
  ).rows[0].value;
  if (guard !== guardDefinitionSha256) throw Error("work_forward_session_guard_drift");
  const snapshot = (await query(snapshotQuery + " as value")).rows[0].value;
  if (!exactObjects(snapshot)) throw Error("work_forward_incomplete_installation");
  if (sha256(canonical(snapshot)) !== profile.canonicalSha256)
    throw Error("work_forward_installation_drift");
  for (const name of WORK_RUNTIME_TABLES) {
    if ((await query(`select exists(select 1 from public.${name}) as used`)).rows[0].used)
      throw Error("work_forward_used_schema_keep_on_rollback");
  }
  return {
    schemaVersion: 2,
    operation: "unused-work-runtime-uninstall",
    serverMajor,
    migrationSha256: sha256(source),
    baseline,
    snapshot,
    snapshotSha256: sha256(JSON.stringify(snapshot)),
    guardDefinitionSha256,
  };
}

/** No CASCADE: unknown dependants and any used state prevent uninstall. */
export async function unusedWorkRuntimeRollback(qualification) {
  const source = await readFile(WORK_RUNTIME_MIGRATION, "utf8");
  const profile = catalogProfile(qualification?.serverMajor);
  if (
    !profile ||
    qualification?.schemaVersion !== 2 ||
    qualification?.operation !== "unused-work-runtime-uninstall" ||
    qualification.migrationSha256 !== sha256(source) ||
    qualification.guardDefinitionSha256 !== guardDefinitionSha256 ||
    qualification.snapshotSha256 !== sha256(JSON.stringify(qualification.snapshot)) ||
    !exactObjects(qualification.snapshot) ||
    sha256(canonical(qualification.snapshot)) !== profile.canonicalSha256 ||
    canonical(qualification.baseline) !== canonical(baselineExpected)
  )
    throw Error("work_forward_invalid_qualification");
  const sql = [
    "begin; set local lock_timeout='5s'; set local statement_timeout='60s';",
    "select pg_advisory_xact_lock(hashtextextended('kova-work-runtime-forward-v1',0));",
    "lock table " +
      WORK_RUNTIME_TABLES.map((n) => "public." + n).join(",") +
      " in access exclusive mode;",
    "lock table public.account_audit_entries,public.account_deletion_fences,public.agent_jobs,public.ai_usage_events,public.app_notifications,public.notification_preferences,public.project_files,public.project_members,public.projects,public.user_library_items,public.user_preferences in access share mode;",
  ];
  sql.push(
    "do $work_unused_guard$ begin if current_setting('server_version_num')::integer / 10000<>" +
      qualification.serverMajor +
      " then raise exception 'work_forward_server_version_mismatch'; end if; if not (" +
      zeroColumnAclQuery.replace(/ as valid$/, "") +
      ") then raise exception 'work_forward_column_acl_drift'; end if; if not (" +
      roleQuery.replace(/ as valid$/, "") +
      ") then raise exception 'work_forward_role_drift'; end if; if encode(sha256(convert_to((" +
      snapshotQuery +
      ")::text,'UTF8')),'hex')<>'" +
      profile.postgresJsonbSha256 +
      "' then raise exception 'work_forward_installation_drift'; end if; if (" +
      baselineQuery +
      ") is distinct from " +
      literal(JSON.stringify(qualification.baseline)) +
      "::jsonb then raise exception 'work_forward_baseline_drift'; end if; if (" +
      snapshotQuery +
      ") is distinct from " +
      literal(JSON.stringify(qualification.snapshot)) +
      "::jsonb then raise exception 'work_forward_installation_drift'; end if; if encode(sha256(convert_to(pg_get_functiondef('kova_auth_guard.session_is_active()'::regprocedure),'UTF8')),'hex')<>" +
      literal(guardDefinitionSha256) +
      " then raise exception 'work_forward_session_guard_drift'; end if; end $work_unused_guard$;",
  );
  for (const name of WORK_RUNTIME_TABLES)
    sql.push(
      `do $work_unused$ begin if exists(select 1 from public.${name}) then raise exception 'work_forward_used_schema_keep_on_rollback'; end if; end $work_unused$;`,
    );
  sql.push(
    "drop trigger guard_work_browser_takeover on public.work_execution_runs;",
    "drop trigger enforce_work_saved_payload_capacity on public.work_saved_records;",
    "drop trigger enforce_work_sync_receipt_capacity on public.work_sync_mutations;",
  );
  const drops = qualification.snapshot.functions.map((f) => {
    const name = f.schema + "." + f.name;
    if (!WORK_RUNTIME_FUNCTIONS.includes(name)) throw Error("work_forward_invalid_qualification");
    const args = f.definition.match(/FUNCTION [^\n]+\(([^\n]*)\)\n/);
    if (!args) throw Error("work_forward_invalid_qualification");
    // Signature is provided by pg_get_function_identity_arguments below, not by
    // caller text: only known built-in argument names/types from actual snapshot.
    const signature = f.signature;
    if (signature.split("(")[0].replace(/^(?:public|kova_private)\./, "") !== f.name)
      throw Error("work_forward_invalid_qualification");
    if (
      !/^(?:public\.|kova_private\.)?[a-z_]+\((?:uuid|jsonb|text|bigint|integer|numeric|boolean|timestamp with time zone)(?:,(?:uuid|jsonb|text|bigint|integer|numeric|boolean|timestamp with time zone))*\)$/.test(
        signature,
      ) &&
      !/^(?:public\.|kova_private\.)?[a-z_]+\(\)$/.test(signature)
    )
      throw Error("work_forward_invalid_qualification");
    return (
      "drop function " + f.schema + "." + signature.replace(/^(?:public|kova_private)\./, "") + ";"
    );
  });
  // Check constraints reference the depth helper; remove the empty tables before
  // dropping pure helpers. Other functions are PL/pgSQL and have no body deps.
  const pure = new Set([
    "public.work_sync_request_fingerprint",
    "public.work_sync_payload_depth_allowed",
  ]);
  qualification.snapshot.functions.forEach((f, i) => {
    if (!pure.has(f.schema + "." + f.name)) sql.push(drops[i]);
  });
  sql.push(
    "drop table public.work_browser_sessions,public.work_accounting_settlements,public.work_execution_outputs,public.work_execution_receipts,public.work_execution_events,public.work_execution_runs;",
    "drop table public.work_sync_mutations,public.work_recent_items,public.work_saved_records,public.work_sync_counters;",
  );
  qualification.snapshot.functions.forEach((f, i) => {
    if (pure.has(f.schema + "." + f.name)) sql.push(drops[i]);
  });
  sql.push("commit;");
  return sql.join("\n");
}
