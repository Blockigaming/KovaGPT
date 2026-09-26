import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const MIGRATION_PROOF_CATALOG_SQL = readFileSync(
  new URL("./migration-proof-catalog.sql", import.meta.url),
  "utf8",
);
export const MIGRATION_PROOF_CATALOG_QUERY_SHA256 = createHash("sha256")
  .update(MIGRATION_PROOF_CATALOG_SQL)
  .digest("hex");

const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^\d{14}$/u;
const REMOTE_ONLY = [
  "20260823092107",
  "20260823092450",
  "20260823151901",
  "20260823151927",
  "20260823214802",
  "20260823215044",
  "20260823215132",
  "20260823215222",
  "20260823215259",
  "20260823215454",
  "20260823215619",
  "20260823215848",
  "20260824081357",
  "20260824081812",
  "20260824081926",
  "20260824082127",
  "20260824084005",
  "20260824085042",
  "20260824085444",
];

export function parseMigrationProofCatalog(
  stdout,
  expectedVersions,
  { requireSingleStatementHistory = true, allowHistoricalCapture = false } = {},
) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > 2 * 1024 * 1024)
    throw new Error("migration_proof_catalog_output_invalid");
  let capture;
  try {
    capture = JSON.parse(stdout);
  } catch {
    throw new Error("migration_proof_catalog_output_invalid");
  }
  const versions = capture?.ledger?.versions;
  const remoteOnlyHistory = capture?.remoteOnlyHistory;
  const sorted = [...(expectedVersions ?? [])].sort();
  if (
    (allowHistoricalCapture
      ? capture?.schemaVersion !== 1 || capture?.sessionReplicationRole !== undefined
      : capture?.schemaVersion !== 2 || capture?.sessionReplicationRole !== "origin") ||
    capture?.readOnly !== true ||
    capture?.isolation !== "repeatable read" ||
    capture?.databaseName !== "postgres" ||
    !Number.isInteger(capture?.postgresVersionNum) ||
    Math.floor(capture.postgresVersionNum / 10000) !== 17 ||
    !Number.isFinite(Date.parse(capture?.capturedAt)) ||
    !Array.isArray(versions) ||
    !versions.every((version) => typeof version === "string" && VERSION.test(version)) ||
    capture.ledger.version_count !== versions.length ||
    JSON.stringify(versions) !== JSON.stringify(sorted) ||
    !REMOTE_ONLY.every((version) => versions.includes(version)) ||
    !Array.isArray(remoteOnlyHistory) ||
    remoteOnlyHistory.length !== REMOTE_ONLY.length ||
    JSON.stringify(remoteOnlyHistory.map((entry) => entry?.version)) !==
      JSON.stringify(REMOTE_ONLY) ||
    remoteOnlyHistory.some(
      (entry) =>
        !Number.isInteger(entry.statementCount) ||
        entry.statementCount < 0 ||
        (requireSingleStatementHistory && entry.statementCount !== 1) ||
        !SHA256.test(entry.statementsJsonSha256 ?? ""),
    ) ||
    !SHA256.test(capture?.defaultAclSha256 ?? "")
  )
    throw new Error("migration_proof_catalog_checkpoint_invalid");

  for (const [key, fields] of [
    ["relations", ["schema_sha256", "acl_sha256", "rls_sha256"]],
    ["functions", ["function_sha256"]],
    ["types", ["type_sha256"]],
  ]) {
    const entries = capture[key];
    if (
      !Array.isArray(entries) ||
      !entries.length ||
      entries.some(
        (entry) =>
          typeof entry.object_id !== "string" ||
          (!entry.object_id.startsWith("public.") &&
            !entry.object_id.startsWith("kova_private.")) ||
          fields.some((field) => !SHA256.test(entry[field] ?? "")),
      ) ||
      JSON.stringify(entries.map((entry) => entry.object_id)) !==
        JSON.stringify([...new Set(entries.map((entry) => entry.object_id))].sort())
    )
      throw new Error(`migration_proof_catalog_${key}_invalid`);
  }
  if (
    !Array.isArray(capture.schemas) ||
    JSON.stringify(capture.schemas.map((entry) => entry.object_id)) !==
      JSON.stringify(["kova_private", "public"]) ||
    capture.schemas.some((entry) => !SHA256.test(entry.acl_sha256 ?? ""))
  )
    throw new Error("migration_proof_catalog_schemas_invalid");
  if (!capture.relations.some((entry) => entry.object_id === "public.scheduled_tasks"))
    throw new Error("migration_proof_catalog_scheduled_scope_missing");
  return capture;
}
