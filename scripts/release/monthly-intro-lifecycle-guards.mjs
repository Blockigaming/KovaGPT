import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const MONTHLY_LIFECYCLE_MIGRATION =
  "supabase/migrations/20261030141704_kova_monthly_intro_lifecycle_forward.sql";
const sourceUrl = new URL(`../../${MONTHLY_LIFECYCLE_MIGRATION}`, import.meta.url);
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const HEX = /^[a-f0-9]{64}$/u;
const PREFIX = "kova-monthly-intro-v1;unused-uninstall-baseline-sha256=";
const tables = [
  "kova_policy_accounts",
  "kova_policy_customer_bindings",
  "kova_policy_checkout_claims",
  "kova_policy_intro_redemptions",
  "kova_policy_event_receipts",
  "kova_policy_subscription_state",
];
const literal = (text) => `'${text.replaceAll("'", "''")}'`;

async function source() {
  const sql = await readFile(sourceUrl, "utf8");
  const start = sql.indexOf("-- MONTHLY_BASELINE_CATALOG_BEGIN");
  const end = sql.indexOf("-- MONTHLY_BASELINE_CATALOG_END");
  if (start < 0 || end <= start) throw new Error("monthly_lifecycle_catalog_source_missing");
  const view = sql.slice(start, end).trim();
  const select = view.slice(view.indexOf("select jsonb_build_object(")).replace(/;\s*$/u, "");
  const functions = [
    ...sql.matchAll(
      /create function ([a-z_]+\.[a-z_]+)\(([^\n]*)\)\s*\nreturns ([\s\S]*?) as \$\$([\s\S]*?)\$\$;/gu,
    ),
  ].map((match) => {
    const signature = `${match[1]}(${match[2]
      .split(",")
      .filter(Boolean)
      .map((arg) =>
        arg
          .trim()
          .replace(/^[a-z_]+\s+/u, "")
          .replace(/\s+default\s+.*$/u, ""),
      )
      .join(",")})`;
    return {
      signature,
      bodyHash: sha256(match[4]),
      securityDefiner: /security definer/u.test(match[3]),
    };
  });
  if (functions.length !== 23 || new Set(functions.map((f) => f.signature)).size !== 23)
    throw new Error("monthly_lifecycle_routine_source_incomplete");
  return { sql, hash: sha256(sql), select, view, functions, preflight: sql.slice(0, start) };
}

/** Read-only: rejects the same baseline drift as installation and emits a checksum. */
export async function monthlyLifecyclePreflight() {
  const s = await source();
  return {
    sourceSha256: s.hash,
    sql:
      `${s.preflight.replace(/\bbegin;/u, "begin read only;")}\n` +
      `select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') as baseline_sha256 ` +
      `from (${s.select}) baseline;\nrollback;\n`,
  };
}

// Catalog values contain no customer rows or credentials. Type names and
// definitions, rather than relation/function OIDs, make a qualified record
// portable between matching PostgreSQL 17/18 catalogs for review.
const objectCatalog = `select jsonb_build_object(
  'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),
    'rls',c.relrowsecurity,'forcedRls',c.relforcerowsecurity,'acl',c.relacl::text,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid),
      'validated',x.convalidated) order by x.conname),'[]'::jsonb) from pg_constraint x where x.conrelid=c.oid),
    'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text),'[]'::jsonb)
      from pg_index i where i.indrelid=c.oid),
    'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'using',pg_get_expr(p.polqual,p.polrelid),
      'check',pg_get_expr(p.polwithcheck,p.polrelid),'roles',p.polroles::text,'command',p.polcmd,'permissive',p.polpermissive) order by p.polname),'[]'::jsonb)
      from pg_policy p where p.polrelid=c.oid),
    'triggers',(select coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
      order by t.tgname),'[]'::jsonb) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname in (${tables.map(literal).join(",")})),
  'functions',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,
    'arguments',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),
    'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by n.nspname,p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
      (n.nspname='public' and (p.proname like 'kova_policy_%' or p.proname='kova_monthly_subscription_summary'))
      or (n.nspname='kova_private' and p.proname like 'kova_policy_%')),
  'authTrigger',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled))
    from pg_trigger t where t.tgrelid='auth.users'::regclass and t.tgname='kova_policy_guard_auth_deletion')
) as snapshot`;

/** Qualify only the exact source-backed unused installation. Never persists raw rows. */
export async function captureMonthlyLifecycleQualification(query) {
  if (typeof query !== "function")
    throw new TypeError("A local database query adapter is required");
  const s = await source();
  const run = async (sql, params = []) => (await query(sql, params)).rows;
  for (const f of s.functions) {
    const rows = await run(
      `select encode(sha256(convert_to(prosrc,'UTF8')),'hex') as body_hash,
      prosecdef,proconfig,pg_get_userbyid(proowner) as owner_name,
      has_function_privilege('anon',oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',oid,'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role',oid,'EXECUTE') as service_execute
      from pg_proc where oid=to_regprocedure($1)`,
      [f.signature],
    );
    const row = rows[0];
    if (
      rows.length !== 1 ||
      row.body_hash !== f.bodyHash ||
      row.prosecdef !== f.securityDefiner ||
      row.owner_name !== "postgres" ||
      row.anon_execute ||
      row.authenticated_execute ||
      !row.service_execute ||
      row.proconfig?.length !== 1 ||
      row.proconfig[0].replaceAll('"', "").replaceAll("\\", "") !== "search_path="
    )
      throw new Error("monthly_lifecycle_routine_qualification_failed");
  }
  for (const table of tables) {
    const rows = await run(`select exists(select 1 from public.${table}) as used`);
    if (rows[0]?.used !== false) throw new Error("monthly_lifecycle_installation_used");
  }
  const comment = (
    await run(`select obj_description('public.kova_policy_accounts'::regclass,'pg_class') as value`)
  )[0]?.value;
  if (
    typeof comment !== "string" ||
    !comment.startsWith(PREFIX) ||
    !HEX.test(comment.slice(PREFIX.length))
  )
    throw new Error("monthly_lifecycle_baseline_receipt_missing");
  const baselineHash = (
    await run(
      `select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') as value from (${s.select}) q`,
    )
  )[0]?.value;
  if (comment !== PREFIX + baselineHash)
    throw new Error("monthly_lifecycle_baseline_catalog_changed");
  const catalogHash = (
    await run(
      `select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') as value from (${objectCatalog}) q`,
    )
  )[0]?.value;
  if (!HEX.test(catalogHash ?? "")) throw new Error("monthly_lifecycle_catalog_missing");
  return Object.freeze({
    protocol: "kova-monthly-intro-unused-installation.v1",
    sourceSha256: s.hash,
    baselineSha256: baselineHash,
    catalogSha256: catalogHash,
    used: false,
  });
}

/**
 * Removes an unused installation only. Once any durable identity/effect exists,
 * keep the schema and disable/roll back the application. This cannot restore
 * customer data, reverse a Stripe operation, or qualify whole-Auth recovery.
 */
export async function unusedMonthlyLifecycleRollback(qualification) {
  const s = await source();
  if (
    qualification?.protocol !== "kova-monthly-intro-unused-installation.v1" ||
    qualification.sourceSha256 !== s.hash ||
    qualification.used !== false ||
    !HEX.test(qualification.baselineSha256 ?? "") ||
    !HEX.test(qualification.catalogSha256 ?? "")
  )
    throw new Error("monthly_lifecycle_rollback_qualification_invalid");
  const precheck = `do $$
declare actual text; used boolean;
begin
  if obj_description('public.kova_policy_accounts'::regclass,'pg_class') is distinct from
    ${literal(PREFIX + qualification.baselineSha256)} then raise exception 'monthly_lifecycle_baseline_receipt_changed'; end if;
  select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') into actual from (${s.select}) q;
  if actual<>${literal(qualification.baselineSha256)} then raise exception 'monthly_lifecycle_existing_catalog_changed'; end if;
  select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') into actual from (${objectCatalog}) q;
  if actual<>${literal(qualification.catalogSha256)} then raise exception 'monthly_lifecycle_object_catalog_changed'; end if;
  ${tables.map((table) => `if exists(select 1 from public.${table}) then raise exception 'monthly_lifecycle_installation_used'; end if;`).join("\n  ")}
end;
$$;`;
  const drops = [
    "drop trigger kova_policy_guard_auth_deletion on auth.users restrict;",
    ...s.functions
      .filter((f) => f.signature.startsWith("public."))
      .map((f) => `drop function ${f.signature} restrict;`),
    ...s.functions
      .filter((f) => f.signature.startsWith("kova_private."))
      .reverse()
      .map((f) => `drop function ${f.signature} restrict;`),
    ...[...tables].reverse().map((table) => `drop table public.${table} restrict;`),
  ];
  return (
    `begin;\nlock table auth.users in share row exclusive mode;\n` +
    `lock table ${tables.map((t) => `public.${t}`).join(",")} in access exclusive mode;\n` +
    `${precheck}\n${drops.join("\n")}\n` +
    `do $$ declare actual text; begin
      select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') into actual from (${s.select}) q;
      if actual<>${literal(qualification.baselineSha256)} then raise exception 'monthly_lifecycle_rollback_catalog_changed'; end if;
    end; $$;\ncommit;\n`
  );
}
