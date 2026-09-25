import assert from "node:assert/strict";
import test from "node:test";

import {
  MIGRATION_PROOF_CATALOG_SQL,
  MIGRATION_PROOF_CATALOG_QUERY_SHA256,
  parseMigrationProofCatalog,
} from "../../scripts/release/migration-proof-catalog.mjs";

const versions = [
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
const sha = "a".repeat(64);
const capture = () => ({
  schemaVersion: 2,
  sessionReplicationRole: "origin",
  readOnly: true,
  isolation: "repeatable read",
  databaseName: "postgres",
  postgresVersionNum: 170006,
  capturedAt: "2026-09-25T00:00:00.000Z",
  ledger: { versions, version_count: versions.length },
  remoteOnlyHistory: versions.map((version) => ({
    version,
    statementCount: 1,
    statementsJsonSha256: sha,
  })),
  defaultAclSha256: sha,
  relations: [
    {
      object_id: "public.scheduled_tasks",
      schema_sha256: sha,
      acl_sha256: sha,
      rls_sha256: sha,
    },
  ],
  functions: [{ object_id: "public.test()", function_sha256: sha }],
  types: [{ object_id: "public.test_enum", type_sha256: sha }],
  schemas: [
    { object_id: "kova_private", acl_sha256: sha },
    { object_id: "public", acl_sha256: sha },
  ],
});

test("same-query inventory is read-only and binds all nineteen histories", () => {
  assert.match(MIGRATION_PROOF_CATALOG_QUERY_SHA256, /^[a-f0-9]{64}$/u);
  assert.match(
    MIGRATION_PROOF_CATALOG_SQL,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/u,
  );
  assert.match(MIGRATION_PROOF_CATALOG_SQL, /session_replication_role/u);
  assert.equal(
    parseMigrationProofCatalog(JSON.stringify(capture()), versions).remoteOnlyHistory.length,
    19,
  );
});

test("inventory rejects incomplete history, unsafe replication role and missing security scope", () => {
  const wrongRole = capture();
  wrongRole.sessionReplicationRole = "replica";
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(wrongRole), versions),
    /checkpoint_invalid/u,
  );

  const missingVersion = capture();
  missingVersion.remoteOnlyHistory.pop();
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(missingVersion), versions),
    /checkpoint_invalid/u,
  );

  const missingTable = capture();
  missingTable.relations[0].object_id = "public.other";
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(missingTable), versions),
    /scheduled_scope_missing/u,
  );

  const badDigest = capture();
  badDigest.relations[0].rls_sha256 = "unverified";
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(badDigest), versions),
    /relations_invalid/u,
  );
});
