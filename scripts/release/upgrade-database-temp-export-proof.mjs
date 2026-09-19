import { createHash } from "node:crypto";
import { fingerprintMigrationSchemaSnapshot } from "./migration-schema-fingerprint.mjs";

export const TEMP_EXPORT_PROOF_ID = "proof-20260824085042";
export const TEMP_EXPORT_PROOF_FILE = "upgrade-temp-export-proof.json";
const VERSION = /^\d{14}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// A single bounded catalog/ledger read, also used for the separate read-only
// production capture. No application RPC, SQL body, secret, or user row returns.
export const TEMP_EXPORT_CATALOG_SQL = `begin transaction isolation level repeatable read read only;
set local statement_timeout = '10s';
set local lock_timeout = '1s';
set local search_path = pg_catalog;
with routine_family as (
  select p.oid, n.nspname::text as schema_name, p.proname::text as routine_name,
         pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where lower(p.proname::text) = '_kova_temp_export_day15'
), inbound_dependencies as (
  select d.classid, d.objid, d.objsubid
  from pg_depend d join routine_family f
    on d.refclassid = 'pg_proc'::regclass and d.refobjid = f.oid
), stored_references as (
  select p.oid from pg_proc p
  where strpos(lower(p.prosrc), '_kova_temp_export_day15') > 0
    and p.oid not in (select oid from routine_family)
), ledger as (
  select count(*)::integer as version_count,
    coalesce(jsonb_agg(version::text order by version::text), '[]'::jsonb) as versions
  from supabase_migrations.schema_migrations
)
select jsonb_build_object(
  'schemaVersion', 1,
  'captureKind', 'temporary-export-catalog-absence',
  'capturedAt', to_char(current_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'postgresVersionNum', current_setting('server_version_num')::integer,
  'databaseName', current_database(),
  'readOnly', current_setting('transaction_read_only') = 'on',
  'isolation', current_setting('transaction_isolation'),
  'publicSchemaPresent', to_regnamespace('public') is not null,
  'catalogSentinelPresent', to_regprocedure('pg_catalog.length(text)') is not null,
  'exactSignaturePresent', to_regprocedure('public._kova_temp_export_day15(text)') is not null,
  'routineFamilyCount', (select count(*)::integer from routine_family),
  'inboundDependencyCount', (select count(*)::integer from inbound_dependencies),
  'storedReferenceCount', (select count(*)::integer from stored_references),
  'ledgerVersionCount', ledger.version_count,
  'ledgerVersions', ledger.versions
) as capture from ledger;
commit;`;

export const TEMP_EXPORT_QUERY_SHA256 = hash(TEMP_EXPORT_CATALOG_SQL);
const FIELDS = [
  "schemaVersion",
  "captureKind",
  "capturedAt",
  "postgresVersionNum",
  "databaseName",
  "readOnly",
  "isolation",
  "publicSchemaPresent",
  "catalogSentinelPresent",
  "exactSignaturePresent",
  "routineFamilyCount",
  "inboundDependencyCount",
  "storedReferenceCount",
  "ledgerVersionCount",
  "ledgerVersions",
].sort();

function sortedVersions(versions) {
  if (
    !Array.isArray(versions) ||
    versions.length < 1 ||
    versions.length > 2000 ||
    versions.some((version) => typeof version !== "string" || !VERSION.test(version)) ||
    new Set(versions).size !== versions.length
  )
    throw new Error("upgrade_temp_export_history_invalid");
  return [...versions].sort();
}

export function validateTemporaryExportCapture(capture, expectedVersions) {
  const expected = sortedVersions(expectedVersions);
  if (
    !capture ||
    typeof capture !== "object" ||
    Array.isArray(capture) ||
    JSON.stringify(Object.keys(capture).sort()) !== JSON.stringify(FIELDS) ||
    capture.schemaVersion !== 1 ||
    capture.captureKind !== "temporary-export-catalog-absence" ||
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
    capture.catalogSentinelPresent !== true ||
    !Number.isSafeInteger(capture.ledgerVersionCount)
  )
    throw new Error("upgrade_temp_export_capture_invalid");
  const observed = sortedVersions(capture.ledgerVersions);
  if (
    capture.ledgerVersionCount !== observed.length ||
    JSON.stringify(capture.ledgerVersions) !== JSON.stringify(observed) ||
    JSON.stringify(observed) !== JSON.stringify(expected) ||
    !observed.includes("20260824085042")
  )
    throw new Error("upgrade_temp_export_history_mismatch");
  if (
    capture.exactSignaturePresent !== false ||
    capture.routineFamilyCount !== 0 ||
    capture.inboundDependencyCount !== 0 ||
    capture.storedReferenceCount !== 0
  )
    throw new Error("upgrade_temp_export_absence_not_proven");
  // Clone only the now-validated JSON shape. Metadata stays outside the scoped
  // fingerprint, so a different ledger/checkpoint cannot be silently conflated.
  return JSON.parse(JSON.stringify(capture));
}

export function parseTemporaryExportCapture(stdout, expectedVersions) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > 65536)
    throw new Error("upgrade_temp_export_output_invalid");
  let capture;
  try {
    capture = JSON.parse(stdout);
  } catch {
    throw new Error("upgrade_temp_export_output_invalid");
  }
  return validateTemporaryExportCapture(capture, expectedVersions);
}

export function temporaryExportSnapshot(capture, expectedVersions) {
  const validated = validateTemporaryExportCapture(capture, expectedVersions);
  const snapshot = {
    schemaVersion: 1,
    scope: {
      proofId: TEMP_EXPORT_PROOF_ID,
      objects: [
        "public._kova_temp_export_day15(text)",
        "pg_proc:any-schema:case-insensitive-family:_kova_temp_export_day15",
        "pg_depend:inbound-to-matching-routine-family",
        "pg_proc.prosrc:case-insensitive-literal-reference:_kova_temp_export_day15",
      ],
    },
    categories: {
      schema: [
        {
          routineFamilyCount: validated.routineFamilyCount,
          inboundDependencyCount: validated.inboundDependencyCount,
        },
      ],
      acl: [{ applicable: false, reason: "routine_family_absent" }],
      rls: [{ applicable: false, reason: "routine_family_absent" }],
      function: [
        {
          exactSignaturePresent: validated.exactSignaturePresent,
          storedReferenceCount: validated.storedReferenceCount,
        },
      ],
    },
  };
  return {
    capture: validated,
    querySha256: TEMP_EXPORT_QUERY_SHA256,
    ledgerVersionsSha256: hash(validated.ledgerVersions.join("\n")),
    snapshot,
    fingerprint: fingerprintMigrationSchemaSnapshot(snapshot),
  };
}

export function buildTemporaryExportProof({
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
    throw new Error("upgrade_temp_export_source_invalid");
  const before = temporaryExportSnapshot(baseline, baselineVersions);
  const after = temporaryExportSnapshot(upgraded, finalVersions);
  if (
    Date.parse(after.capture.capturedAt) < Date.parse(before.capture.capturedAt) ||
    JSON.stringify(before.fingerprint) !== JSON.stringify(after.fingerprint)
  )
    throw new Error("upgrade_temp_export_comparison_invalid");
  return {
    schemaVersion: 1,
    proofId: TEMP_EXPORT_PROOF_ID,
    sourceCommit,
    sourceTree,
    querySha256: TEMP_EXPORT_QUERY_SHA256,
    baseline: before,
    upgraded: after,
    isolatedFingerprintMatch: true,
    liveCatalogCompared: false,
    schemaProofPromoted: false,
    canonicalHistoryReconciled: false,
    productionReleaseReady: false,
    productionRowsRestored: false,
    limitations: [
      "Catalog absence plus a literal stored-routine-body reference scan; dynamically constructed references are not excluded.",
      "No fresh-source checkpoint, actual-backup restore, data compatibility, or other lineage scope is proven by this record.",
      "Matching live evidence, scope review, later-writer review, recovery evidence and independent approval remain separate requirements.",
    ],
  };
}
