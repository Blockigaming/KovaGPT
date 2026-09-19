import { createHash } from "node:crypto";

export const SCHEDULED_TABLE_FILE = "upgrade-scheduled-table-catalog.json";
export const SCHEDULED_TABLE_NAMES = Object.freeze(["scheduled_task_runs", "scheduled_tasks"]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Read PostgreSQL catalogs, not task contents; no application routine is invoked.
// Unsupported replication, maintenance, role-authority and storage layouts are
// excluded here and rejected by the exact-two-table validator, never treated as
// equivalent. The supported API-role baseline is non-superuser anon/authenticated
// without BYPASSRLS, and non-superuser service_role with BYPASSRLS.
export const SCHEDULED_TABLE_SQL = `begin transaction isolation level repeatable read read only;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
set local search_path = pg_catalog;
with target as (
 select c.* from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('scheduled_task_runs','scheduled_tasks')
 and not exists (select 1 from pg_inherits h where h.inhparent=c.oid)
 and not exists (select 1 from pg_rewrite r where r.ev_class=c.oid)
 and not exists (select 1 from pg_publication_tables p where p.schemaname=n.nspname and p.tablename=c.relname)
 and c.reloptions is null
 and not exists (select 1 from pg_class toast where toast.oid=c.reltoastrelid and toast.reloptions is not null)
 and not exists (select 1 from pg_trigger internal where internal.tgisinternal
   and (internal.tgrelid=c.oid or internal.tgconstrrelid=c.oid) and internal.tgenabled<>'O')
 and not exists (select 1 from pg_roles api_role where api_role.rolname in ('anon','authenticated','service_role')
   and (api_role.rolsuper or api_role.rolbypassrls<>(api_role.rolname='service_role')))
 and c.reltablespace=0
 and (select space.spcname='pg_default' from pg_database db join pg_tablespace space on space.oid=db.dattablespace
   where db.datname=current_database())
 and not exists (select 1 from pg_roles named_role where named_role.rolname='PUBLIC')
), rows as (
 select c.relname::text as name,jsonb_build_object(
 'schema','public','name',c.relname::text,'kind',c.relkind::text,
 'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence::text,
 'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
 'replicaIdentity',c.relreplident::text,'partition',c.relispartition,
 'parentCount',(select count(*) from pg_inherits h where h.inhrelid=c.oid),
 'columns',coalesce((select jsonb_agg(jsonb_build_object(
   'ordinal',a.attnum,'name',a.attname::text,'type',format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'identity',a.attidentity::text,'generated',a.attgenerated::text,
   'aclIsNull',a.attacl is null,
   'defaultSha256',case when d.oid is not null then encode(sha256(convert_to(pg_get_expr(d.adbin,d.adrelid),'UTF8')),'hex') else null end,
   'collation',case when a.attcollation<>0 then (select format('%I.%I',n.nspname,k.collname) from pg_collation k join pg_namespace n on n.oid=k.collnamespace where k.oid=a.attcollation) else null end
 ) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
 'constraints',coalesce((select jsonb_agg(jsonb_build_object(
   'name',q.conname::text,'kind',q.contype::text,'validated',q.convalidated,
   'deferrable',q.condeferrable,'initiallyDeferred',q.condeferred,
   'definitionSha256',encode(sha256(convert_to(pg_get_constraintdef(q.oid),'UTF8')),'hex')
 ) order by q.conname::text collate "C") from pg_constraint q where q.conrelid=c.oid),'[]'::jsonb),
 'indexes',coalesce((select jsonb_agg(jsonb_build_object(
   'name',i.relname::text,'primary',x.indisprimary,'unique',x.indisunique,'valid',x.indisvalid,
   'ready',x.indisready,'replicaIdentity',x.indisreplident,'clustered',x.indisclustered,
   'nullsNotDistinct',x.indnullsnotdistinct,
   'definitionSha256',encode(sha256(convert_to(pg_get_indexdef(x.indexrelid),'UTF8')),'hex')
 ) order by i.relname::text collate "C") from pg_index x join pg_class i on i.oid=x.indexrelid where x.indrelid=c.oid),'[]'::jsonb),
 'aclIsNull',c.relacl is null,
 'acl',coalesce((select jsonb_agg(jsonb_build_object(
   'grantor',pg_get_userbyid(x.grantor),'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
   'privilege',x.privilege_type,'grantable',x.is_grantable
 ) order by (case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee)::text end) collate "C",pg_get_userbyid(x.grantor)::text collate "C",x.privilege_type collate "C",x.is_grantable)
 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x),'[]'::jsonb),
 'columnAcl',coalesce((select jsonb_agg(jsonb_build_object(
   'column',a.attname::text,'grantor',pg_get_userbyid(x.grantor),
   'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
   'privilege',x.privilege_type,'grantable',x.is_grantable
 ) order by a.attname::text collate "C",(case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee)::text end) collate "C",pg_get_userbyid(x.grantor)::text collate "C",x.privilege_type collate "C",x.is_grantable)
 from pg_attribute a cross join lateral aclexplode(a.attacl) x where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::jsonb),
 'effectivePrivileges',(select jsonb_agg(jsonb_build_object(
   'role',r.name,'schemaUsage',has_schema_privilege(r.name,c.relnamespace,'USAGE'),
   'privileges',(select coalesce(jsonb_agg(v.name order by v.name collate "C"),'[]'::jsonb)
     from (values ('DELETE'),('INSERT'),('MAINTAIN'),('REFERENCES'),('SELECT'),('TRIGGER'),('TRUNCATE'),('UPDATE')) v(name)
     where has_table_privilege(r.name,c.oid,v.name))
 ) order by r.name collate "C") from (values ('anon'),('authenticated'),('service_role')) r(name)),
 'policies',coalesce((select jsonb_agg(jsonb_build_object(
   'name',p.polname::text,'command',p.polcmd::text,'permissive',p.polpermissive,
   'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by (case when r=0 then 'PUBLIC' else pg_get_userbyid(r)::text end) collate "C") from unnest(p.polroles) r),
   'usingSha256',case when p.polqual is null then null else encode(sha256(convert_to(pg_get_expr(p.polqual,p.polrelid),'UTF8')),'hex') end,
   'checkSha256',case when p.polwithcheck is null then null else encode(sha256(convert_to(pg_get_expr(p.polwithcheck,p.polrelid),'UTF8')),'hex') end
 ) order by p.polname::text collate "C") from pg_policy p where p.polrelid=c.oid),'[]'::jsonb),
 'triggers',coalesce((select jsonb_agg(jsonb_build_object(
   'name',t.tgname::text,'enabled',t.tgenabled::text,
   'function',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
   'functionOwner',pg_get_userbyid(p.proowner),
   'definitionSha256',encode(sha256(convert_to(pg_get_triggerdef(t.oid),'UTF8')),'hex'),
   'functionDefinitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')
 ) order by t.tgname::text collate "C") from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid=c.oid and not t.tgisinternal),'[]'::jsonb)
 ) as value from target c
), ledger as (
 select count(*)::integer as count,jsonb_agg(version::text order by version::text collate "C") as versions from supabase_migrations.schema_migrations
)
select jsonb_build_object(
 'schemaVersion',1,'captureKind','scheduled-table-catalog',
 'capturedAt',to_char(current_timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'postgresVersionNum',current_setting('server_version_num')::integer,'databaseName',current_database(),
 'readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),
 'publicSchemaPresent',to_regnamespace('public') is not null,'catalogSentinelPresent',to_regprocedure('pg_catalog.length(text)') is not null,
 'ledgerVersionCount',ledger.count,'ledgerVersions',ledger.versions,
 'tableCount',(select count(*) from rows),'tables',coalesce((select jsonb_agg(value order by name collate "C") from rows),'[]'::jsonb)
) as capture from ledger;
commit;`;
export const SCHEDULED_TABLE_QUERY_SHA256 = digest(SCHEDULED_TABLE_SQL);
const fail = () => {
  throw new Error("upgrade_scheduled_tables_invalid");
};
const scalar = (test) => (value) => {
  if (!test(value)) fail();
  return value;
};
const text = scalar(
  (v) => typeof v === "string" && v.length > 0 && v.length <= 8192 && !v.includes("\0"),
);
const bool = scalar((v) => typeof v === "boolean");
const integer = scalar((v) => Number.isSafeInteger(v) && v >= 0);
const hash = scalar((v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v));
const literal = (...choices) => scalar((v) => choices.includes(v));
const nullable = (rule) => (value) => (value === null ? null : rule(value));
const tupleCompare = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    const difference =
      typeof a[i] === "number" && typeof b[i] === "number"
        ? a[i] - b[i]
        : Buffer.compare(Buffer.from(String(a[i])), Buffer.from(String(b[i])));
    if (difference) return difference;
  }
  return 0;
};
const array =
  (rule, key, min = 0, max = 2048) =>
  (value) => {
    if (
      !Array.isArray(value) ||
      value.length < min ||
      value.length > max ||
      Object.keys(value).length !== value.length
    )
      fail();
    const result = value.map(rule);
    for (let i = 1; i < result.length; i++)
      if (tupleCompare(key(result[i - 1]), key(result[i])) >= 0) fail();
    return result;
  };
const object = (shape) => (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== Object.keys(shape).length
  )
    fail();
  const result = {};
  for (const [key, rule] of Object.entries(shape)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !property.enumerable || !("value" in property)) fail();
    result[key] = rule(property.value);
  }
  return result;
};
const roleNames = ["anon", "authenticated", "service_role"];
const privilegeNames = [
  "DELETE",
  "INSERT",
  "MAINTAIN",
  "REFERENCES",
  "SELECT",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
];
const grant = {
  grantor: text,
  grantee: text,
  privilege: literal(...privilegeNames),
  grantable: bool,
};
const grantKey = (r) => [r.grantee, r.grantor, r.privilege, r.grantable];
const named = (r) => [r.name];
const column = object({
  ordinal: scalar((v) => Number.isSafeInteger(v) && v > 0 && v <= 1600),
  name: text,
  type: text,
  notNull: bool,
  identity: literal("", "a", "d"),
  generated: literal("", "s"),
  aclIsNull: bool,
  defaultSha256: nullable(hash),
  collation: nullable(text),
});
const constraint = object({
  name: text,
  kind: literal("c", "f", "p", "u", "t", "x"),
  validated: bool,
  deferrable: bool,
  initiallyDeferred: bool,
  definitionSha256: hash,
});
const index = object({
  name: text,
  primary: bool,
  unique: bool,
  valid: bool,
  ready: bool,
  replicaIdentity: bool,
  clustered: bool,
  nullsNotDistinct: bool,
  definitionSha256: hash,
});
const policy = object({
  name: text,
  command: literal("*", "r", "a", "w", "d"),
  permissive: bool,
  roles: array(text, (r) => [r], 1, 128),
  usingSha256: nullable(hash),
  checkSha256: nullable(hash),
});
const trigger = object({
  name: text,
  enabled: literal("O", "D", "R", "A"),
  function: text,
  functionOwner: text,
  definitionSha256: hash,
  functionDefinitionSha256: hash,
});
const table = object({
  schema: literal("public"),
  name: literal(...SCHEDULED_TABLE_NAMES),
  kind: literal("r"),
  owner: text,
  persistence: literal("p"),
  rowSecurity: bool,
  forceRowSecurity: bool,
  replicaIdentity: literal("d", "n", "f", "i"),
  partition: literal(false),
  parentCount: literal(0),
  columns: array(column, (r) => [r.ordinal], 1, 1600),
  constraints: array(constraint, named),
  indexes: array(index, named),
  aclIsNull: bool,
  acl: array(object(grant), grantKey),
  columnAcl: array(object({ column: text, ...grant }), (r) => [r.column, ...grantKey(r)]),
  effectivePrivileges: array(
    object({
      role: literal(...roleNames),
      schemaUsage: bool,
      privileges: array(literal(...privilegeNames), (r) => [r], 0, 8),
    }),
    (r) => [r.role],
    3,
    3,
  ),
  policies: array(policy, named),
  triggers: array(trigger, named),
});
const version = scalar((v) => typeof v === "string" && /^\d{14}$/u.test(v));
const versions = array(version, (v) => [v], 1, 2000);
const timestamp = scalar(
  (v) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString() === v,
);
const captureRule = object({
  schemaVersion: literal(1),
  captureKind: literal("scheduled-table-catalog"),
  capturedAt: timestamp,
  postgresVersionNum: scalar((v) => Number.isSafeInteger(v) && Math.floor(v / 10000) === 17),
  databaseName: literal("postgres"),
  readOnly: literal(true),
  isolation: literal("repeatable read"),
  publicSchemaPresent: literal(true),
  catalogSentinelPresent: literal(true),
  ledgerVersionCount: integer,
  ledgerVersions: versions,
  tableCount: literal(2),
  tables: array(table, named, 2, 2),
});

export function validateScheduledTableCapture(input, expectedVersions) {
  const capture = captureRule(input);
  const expected = versions(
    Array.isArray(expectedVersions) ? [...expectedVersions].sort() : expectedVersions,
  );
  if (
    capture.ledgerVersionCount !== expected.length ||
    JSON.stringify(capture.ledgerVersions) !== JSON.stringify(expected) ||
    !["20260823092107", "20260823092450"].every((v) => expected.includes(v))
  )
    fail();
  if (JSON.stringify(capture.tables.map((r) => r.name)) !== JSON.stringify(SCHEDULED_TABLE_NAMES))
    fail();
  for (const row of capture.tables) {
    const names = new Set(row.columns.map((c) => c.name));
    if (
      names.size !== row.columns.length ||
      row.columnAcl.some((g) => !names.has(g.column)) ||
      JSON.stringify(row.effectivePrivileges.map((r) => r.role)) !== JSON.stringify(roleNames)
    )
      fail();
  }
  return capture;
}
export function parseScheduledTableCapture(stdout, expectedVersions) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 1024 * 1024) fail();
  let capture;
  try {
    capture = JSON.parse(stdout);
  } catch {
    fail();
  }
  return validateScheduledTableCapture(capture, expectedVersions);
}
function fingerprint(capture) {
  const fields = {
    schema: [
      "kind",
      "owner",
      "persistence",
      "replicaIdentity",
      "partition",
      "parentCount",
      "columns",
      "constraints",
      "indexes",
    ],
    acl: ["owner", "aclIsNull", "acl", "columnAcl", "effectivePrivileges"],
    rls: ["rowSecurity", "forceRowSecurity", "policies"],
    trigger: ["triggers"],
  };
  return Object.fromEntries(
    Object.entries(fields).map(([category, keys]) => [
      category,
      digest(
        JSON.stringify(
          capture.tables.map((t) => ({
            schema: t.schema,
            name: t.name,
            ...Object.fromEntries(
              keys.map((k) => [
                k,
                category === "schema" && k === "columns"
                  ? t.columns.map(({ aclIsNull: _aclIsNull, ...column }) => column)
                  : t[k],
              ]),
            ),
            ...(category === "acl"
              ? {
                  columnAclState: t.columns.map(({ name, aclIsNull }) => ({ name, aclIsNull })),
                }
              : {}),
          })),
        ),
      ),
    ]),
  );
}
export function buildScheduledTableEvidence({
  baseline,
  upgraded,
  baselineVersions,
  finalVersions,
  sourceCommit,
  sourceTree,
}) {
  for (const v of [sourceCommit, sourceTree])
    if (typeof v !== "string" || !/^[a-f0-9]{40}$/u.test(v)) fail();
  const before = validateScheduledTableCapture(baseline, baselineVersions),
    after = validateScheduledTableCapture(upgraded, finalVersions);
  if (Date.parse(after.capturedAt) < Date.parse(before.capturedAt)) fail();
  const changes = before.tables.flatMap((row, i) => {
    const fields = Object.keys(row).filter(
      (k) => JSON.stringify(row[k]) !== JSON.stringify(after.tables[i][k]),
    );
    return fields.length ? [{ table: `public.${row.name}`, fields }] : [];
  });
  return {
    schemaVersion: 1,
    captureKind: "scheduled-table-checkpoints",
    sourceCommit,
    sourceTree,
    querySha256: SCHEDULED_TABLE_QUERY_SHA256,
    proofIds: ["proof-20260823092107", "proof-20260823092450"],
    baseline: {
      capture: before,
      ledgerVersionsSha256: digest(before.ledgerVersions.join("\n")),
      fingerprint: fingerprint(before),
    },
    upgraded: {
      capture: after,
      ledgerVersionsSha256: digest(after.ledgerVersions.join("\n")),
      fingerprint: fingerprint(after),
    },
    changes,
    tableCatalogMatch: changes.length === 0,
    schemaProofPromoted: false,
    liveCatalogCompared: false,
    canonicalHistoryReconciled: false,
    productionReleaseReady: false,
    productionRowsRestored: false,
    limitations: [
      "Only the two named ordinary public tables; inheritance, rules, effective publications, relation/TOAST options, non-origin internal constraint triggers, noncanonical API-role authority, nondefault tablespaces and a named PUBLIC role fail closed.",
      "No table rows, sequences, external foreign-key targets, dependency closure, role-membership graph or executable RLS behavior is proven.",
      "Definition hashes compare fixed-search-path PostgreSQL deparser output; equality is not independent semantic equivalence proof.",
      "Later-writer changes remain visible. Fresh-source/live comparison, original effects, recovery and independent review remain separate gates.",
    ],
  };
}
