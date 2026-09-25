import { createHash } from "node:crypto";

export const CHAT_WORKSPACE_CATALOG_FILE = "upgrade-chat-workspace-routine-catalog.json";
export const CHAT_WORKSPACE_ROUTINE_NAMES = Object.freeze([
  "accept_chat_message_version",
  "activate_chat_branch",
  "create_chat_branch",
  "create_chat_message_version",
  "delete_chat_custom_rules",
  "get_chat_context_bundle",
  "get_chat_workspace_state",
  "kova_accept_message_version",
  "kova_activate_chat_branch",
  "kova_can_pin_source",
  "kova_chat_branch_lineage_guard",
  "kova_create_chat_branch",
  "kova_record_message_version",
  "kova_set_updated_at",
  "kova_update_chat_branch_messages",
  "pin_chat_source",
  "save_chat_custom_rules",
  "set_active_chat_branch",
  "unpin_chat_source",
  "utf16_code_unit_length",
  "validate_chat_branch_lineage",
  "validate_chat_message_version_branch",
]);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const VERSION = /^\d{14}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const ROLES = ["anon", "authenticated", "service_role"];

// Catalog reads only. Never invoke a scheduler/settlement function to inspect it.
// Case-insensitive family matching retains unexpected schemas and overloads.
export const CHAT_WORKSPACE_CATALOG_SQL = `begin transaction isolation level repeatable read read only;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
set local search_path = pg_catalog;
with selected as (
  select p.*, n.nspname::text as schema_name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where lower(p.proname::text) = any(array[${CHAT_WORKSPACE_ROUTINE_NAMES.map((name) => `'${name}'`).join(",")}])
), rows as (
  select p.schema_name, p.proname::text as routine_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    jsonb_build_object(
      'schema', p.schema_name, 'name', p.proname::text, 'kind', p.prokind::text,
      'identityArguments', pg_get_function_identity_arguments(p.oid),
      'result', pg_get_function_result(p.oid),
      'owner', pg_get_userbyid(p.proowner), 'language', l.lanname::text,
      'securityDefiner', p.prosecdef, 'strict', p.proisstrict,
      'volatility', p.provolatile::text, 'parallel', p.proparallel::text,
      'leakproof', p.proleakproof, 'returnsSet', p.proretset,
      'defaultArgumentCount', p.pronargdefaults,
      'bodyBytes', octet_length(p.prosrc),
      'bodySha256', encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex'),
      'definitionSha256', case when p.prokind <> 'a'
        then encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex') else null end,
      'searchPath', coalesce((select jsonb_agg(setting order by setting collate "C")
        from unnest(p.proconfig) as setting where split_part(setting, '=', 1) = 'search_path'), '[]'::jsonb),
      'configurationSha256', encode(sha256(convert_to(coalesce(to_jsonb(p.proconfig), '[]'::jsonb)::text, 'UTF8')), 'hex'),
      'acl', coalesce((select jsonb_agg(jsonb_build_object(
          'grantor', pg_get_userbyid(a.grantor),
          'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
          'privilege', a.privilege_type, 'grantable', a.is_grantable)
          order by (case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end) collate "C",
            pg_get_userbyid(a.grantor)::text collate "C", a.privilege_type collate "C", a.is_grantable)
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '[]'::jsonb),
      'effectivePrivileges', (select jsonb_agg(jsonb_build_object(
          'role', r.name, 'schemaUsage', has_schema_privilege(r.name, p.pronamespace, 'USAGE'),
          'execute', has_function_privilege(r.name, p.oid, 'EXECUTE')) order by r.name collate "C")
        from (values ('anon'), ('authenticated'), ('service_role')) r(name))
    ) as record
  from selected p join pg_language l on l.oid = p.prolang
), ledger as (
  select count(*)::integer as version_count,
    coalesce(jsonb_agg(version::text order by version::text collate "C"), '[]'::jsonb) as versions
  from supabase_migrations.schema_migrations
)
select jsonb_build_object(
  'schemaVersion', 1, 'captureKind', 'chat-workspace-routine-catalog',
  'capturedAt', to_char(current_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'postgresVersionNum', current_setting('server_version_num')::integer,
  'databaseName', current_database(), 'readOnly', current_setting('transaction_read_only') = 'on',
  'isolation', current_setting('transaction_isolation'),
  'publicSchemaPresent', to_regnamespace('public') is not null,
  'catalogSentinelPresent', to_regprocedure('pg_catalog.length(text)') is not null,
  'ledgerVersionCount', ledger.version_count, 'ledgerVersions', ledger.versions,
  'routineCount', (select count(*)::integer from rows),
  'routines', coalesce((select jsonb_agg(record order by schema_name collate "C",
    routine_name collate "C", identity_arguments collate "C") from rows), '[]'::jsonb)
) as capture from ledger;
commit;`;
export const CHAT_WORKSPACE_CATALOG_QUERY_SHA256 = digest(CHAT_WORKSPACE_CATALOG_SQL);

const CAPTURE_FIELDS = [
  "schemaVersion",
  "captureKind",
  "capturedAt",
  "postgresVersionNum",
  "databaseName",
  "readOnly",
  "isolation",
  "publicSchemaPresent",
  "catalogSentinelPresent",
  "ledgerVersionCount",
  "ledgerVersions",
  "routineCount",
  "routines",
];
const ROUTINE_FIELDS = [
  "schema",
  "name",
  "kind",
  "identityArguments",
  "result",
  "owner",
  "language",
  "securityDefiner",
  "strict",
  "volatility",
  "parallel",
  "leakproof",
  "returnsSet",
  "defaultArgumentCount",
  "bodyBytes",
  "bodySha256",
  "definitionSha256",
  "searchPath",
  "configurationSha256",
  "acl",
  "effectivePrivileges",
];
function fail(code) {
  throw new Error(`upgrade_chat_workspace_catalog_${code}`);
}
function record(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== fields.length ||
    fields.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
    })
  )
    fail("shape_invalid");
}
function text(value, allowEmpty = false, max = 4096) {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= max &&
    !value.includes("\0")
  );
}
function sortedVersions(values) {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > 2000 ||
    values.some((v) => typeof v !== "string" || !VERSION.test(v)) ||
    new Set(values).size !== values.length
  )
    fail("history_invalid");
  return [...values].sort();
}
function identity(row) {
  return JSON.stringify(tuple(row));
}
function tuple(row) {
  return [row.schema, row.name, row.identityArguments];
}
function ordered(a, b) {
  for (let i = 0; i < a.length; i++) {
    const comparison = Buffer.compare(Buffer.from(String(a[i])), Buffer.from(String(b[i])));
    if (comparison !== 0) return comparison;
  }
  return 0;
}
function validateRoutine(row) {
  record(row, ROUTINE_FIELDS);
  for (const key of ["schema", "name", "result", "owner", "language"])
    if (!text(row[key])) fail("routine_invalid");
  if (
    !CHAT_WORKSPACE_ROUTINE_NAMES.includes(row.name.toLowerCase()) ||
    row.kind !== "f" ||
    !text(row.identityArguments, true) ||
    !["i", "s", "v"].includes(row.volatility) ||
    !["s", "r", "u"].includes(row.parallel)
  )
    fail("routine_invalid");
  for (const key of ["securityDefiner", "strict", "leakproof", "returnsSet"])
    if (typeof row[key] !== "boolean") fail("routine_invalid");
  for (const key of ["defaultArgumentCount", "bodyBytes"])
    if (!Number.isSafeInteger(row[key]) || row[key] < 0) fail("routine_invalid");
  for (const key of ["bodySha256", "definitionSha256", "configurationSha256"])
    if (typeof row[key] !== "string" || !HASH.test(row[key])) fail("routine_invalid");
  if (
    !Array.isArray(row.searchPath) ||
    row.searchPath.length > 1 ||
    row.searchPath.some((setting) => !text(setting) || !setting.startsWith("search_path="))
  )
    fail("routine_invalid");
  if (!Array.isArray(row.acl) || row.acl.length > 128) fail("acl_invalid");
  const aclKeys = [];
  for (const acl of row.acl) {
    record(acl, ["grantor", "grantee", "privilege", "grantable"]);
    if (
      !text(acl.grantor) ||
      !text(acl.grantee) ||
      acl.privilege !== "EXECUTE" ||
      typeof acl.grantable !== "boolean"
    )
      fail("acl_invalid");
    const key = [acl.grantee, acl.grantor, acl.privilege, acl.grantable];
    if (aclKeys.length && ordered(aclKeys.at(-1), key) >= 0) fail("acl_invalid");
    aclKeys.push(key);
  }
  if (!Array.isArray(row.effectivePrivileges) || row.effectivePrivileges.length !== ROLES.length)
    fail("acl_invalid");
  row.effectivePrivileges.forEach((privilege, index) => {
    record(privilege, ["role", "schemaUsage", "execute"]);
    if (
      privilege.role !== ROLES[index] ||
      typeof privilege.schemaUsage !== "boolean" ||
      typeof privilege.execute !== "boolean"
    )
      fail("acl_invalid");
  });
  const normalized = Object.fromEntries(ROUTINE_FIELDS.map((field) => [field, row[field]]));
  normalized.acl = row.acl.map((entry) =>
    Object.fromEntries(
      ["grantor", "grantee", "privilege", "grantable"].map((key) => [key, entry[key]]),
    ),
  );
  normalized.effectivePrivileges = row.effectivePrivileges.map((entry) =>
    Object.fromEntries(["role", "schemaUsage", "execute"].map((key) => [key, entry[key]])),
  );
  return normalized;
}

export function validateChatWorkspaceCatalogCapture(capture, expectedVersions) {
  record(capture, CAPTURE_FIELDS);
  if (
    capture.schemaVersion !== 1 ||
    capture.captureKind !== "chat-workspace-routine-catalog" ||
    typeof capture.capturedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(capture.capturedAt) ||
    !Number.isFinite(Date.parse(capture.capturedAt)) ||
    new Date(capture.capturedAt).toISOString() !== capture.capturedAt ||
    !Number.isSafeInteger(capture.postgresVersionNum) ||
    Math.floor(capture.postgresVersionNum / 10000) !== 17 ||
    capture.databaseName !== "postgres" ||
    capture.readOnly !== true ||
    capture.isolation !== "repeatable read" ||
    capture.publicSchemaPresent !== true ||
    capture.catalogSentinelPresent !== true
  )
    fail("capture_invalid");
  const expected = sortedVersions(expectedVersions);
  const observed = sortedVersions(capture.ledgerVersions);
  if (
    capture.ledgerVersionCount !== observed.length ||
    JSON.stringify(observed) !== JSON.stringify(expected) ||
    JSON.stringify(observed) !== JSON.stringify(capture.ledgerVersions) ||
    !["20260823151901", "20260824085444"].every((version) => observed.includes(version))
  )
    fail("history_mismatch");
  if (
    !Array.isArray(capture.routines) ||
    capture.routines.length > 256 ||
    capture.routineCount !== capture.routines.length
  )
    fail("inventory_invalid");
  const routines = capture.routines.map(validateRoutine);
  for (let index = 1; index < routines.length; index++)
    if (ordered(tuple(routines[index - 1]), tuple(routines[index])) >= 0) fail("inventory_invalid");
  // Reorder validated keys deterministically, preserving exact strings/semantics.
  const result = Object.fromEntries(CAPTURE_FIELDS.map((key) => [key, capture[key]]));
  result.routines = routines;
  return JSON.parse(JSON.stringify(result));
}

export function parseChatWorkspaceCatalogCapture(stdout, versions) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 2 * 1024 * 1024)
    fail("output_invalid");
  let capture;
  try {
    capture = JSON.parse(stdout);
  } catch {
    fail("output_invalid");
  }
  return validateChatWorkspaceCatalogCapture(capture, versions);
}

function fingerprint(capture) {
  const acl = capture.routines.map((row) => ({
    schema: row.schema,
    name: row.name,
    identityArguments: row.identityArguments,
    owner: row.owner,
    acl: row.acl,
    effectivePrivileges: row.effectivePrivileges,
  }));
  const routines = capture.routines.map(
    ({ acl: _acl, effectivePrivileges: _privileges, ...row }) => row,
  );
  return {
    routineSha256: digest(JSON.stringify(routines)),
    aclSha256: digest(JSON.stringify(acl)),
  };
}

export function buildChatWorkspaceCatalogEvidence({
  baseline,
  upgraded,
  baselineVersions,
  finalVersions,
  sourceCommit,
  sourceTree,
}) {
  if (
    typeof sourceCommit !== "string" ||
    typeof sourceTree !== "string" ||
    !SHA.test(sourceCommit) ||
    !SHA.test(sourceTree)
  )
    fail("source_invalid");
  const before = validateChatWorkspaceCatalogCapture(baseline, baselineVersions);
  const after = validateChatWorkspaceCatalogCapture(upgraded, finalVersions);
  if (Date.parse(after.capturedAt) < Date.parse(before.capturedAt)) fail("chronology_invalid");
  const beforeMap = new Map(before.routines.map((row) => [identity(row), row]));
  const afterMap = new Map(after.routines.map((row) => [identity(row), row]));
  const changes = [];
  for (const key of [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()) {
    const oldRow = beforeMap.get(key),
      newRow = afterMap.get(key);
    if (!oldRow || !newRow) changes.push({ identity: key, kind: oldRow ? "removed" : "added" });
    else {
      const fields = ROUTINE_FIELDS.filter(
        (field) => JSON.stringify(oldRow[field]) !== JSON.stringify(newRow[field]),
      );
      if (fields.length) changes.push({ identity: key, kind: "changed", fields });
    }
  }
  return {
    schemaVersion: 1,
    captureKind: "chat-workspace-routine-checkpoints",
    sourceCommit,
    sourceTree,
    proofIds: [
      "proof-20260823151901",
      "proof-20260823151927",
      "proof-20260823214802",
      "proof-20260824081357",
      "proof-20260824081812",
      "proof-20260824081926",
      "proof-20260824082127",
      "proof-20260824084005",
      "proof-20260824085444",
    ],
    querySha256: CHAT_WORKSPACE_CATALOG_QUERY_SHA256,
    scope: {
      routineNames: [...CHAT_WORKSPACE_ROUTINE_NAMES],
      schemas: "all",
      overloads: "all",
      tableSchemaAclRlsCapturedSeparately: true,
    },
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
    routineCatalogMatch: changes.length === 0,
    schemaProofPromoted: false,
    liveCatalogCompared: false,
    canonicalHistoryReconciled: false,
    productionReleaseReady: false,
    productionRowsRestored: false,
    limitations: [
      "Routine metadata and effective privileges only; the four chat-workspace tables require their separate catalog capture and executable RLS tests.",
      "Later writers may legitimately change routines. Differences are reported, not normalized away or declared equivalent.",
      "No chat-workspace function was called; runtime behavior, cross-user isolation, concurrency and data compatibility are unproven.",
      "Original intermediate effects, fresh-source comparison, live capture binding, independent review and real-backup recovery remain separate gates.",
    ],
  };
}
