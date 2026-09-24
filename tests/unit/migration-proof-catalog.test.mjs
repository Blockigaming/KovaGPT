import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MIGRATION_PROOF_CATALOG_SQL,
  MIGRATION_PROOF_CATALOG_QUERY_SHA256,
  parseMigrationProofCatalog,
} from "../../scripts/release/migration-proof-catalog.mjs";

const artifact = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/release-reconciliation/evidence/migration-proof-live-object-digests-20260924.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const capture = artifact.capture;
const clone = (value) => JSON.parse(JSON.stringify(value));

test("live catalog binds 19 remote versions and rejects a substituted query or ledger", () => {
  assert.equal(artifact.acceptedProofs, 0);
  assert.equal(artifact.querySha256, MIGRATION_PROOF_CATALOG_QUERY_SHA256);
  assert.match(
    MIGRATION_PROOF_CATALOG_SQL,
    /^-- Read-only[\s\S]*BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/u,
  );
  assert.equal(
    parseMigrationProofCatalog(JSON.stringify(capture), capture.ledger.versions).ledger
      .version_count,
    98,
  );
  assert.equal(capture.remoteOnlyHistory.length, 19);
  assert.equal(capture.schemas.length, 2);
  const locallyRecorded = clone(capture);
  locallyRecorded.remoteOnlyHistory[0].statementCount = 0;
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(locallyRecorded), capture.ledger.versions),
    /checkpoint_invalid/u,
  );
  assert.equal(
    parseMigrationProofCatalog(JSON.stringify(locallyRecorded), capture.ledger.versions, {
      requireSingleStatementHistory: false,
    }).remoteOnlyHistory.length,
    19,
  );

  const missing = clone(capture);
  missing.ledger.versions = missing.ledger.versions.filter((v) => v !== "20260824085042");
  missing.ledger.version_count--;
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(missing), missing.ledger.versions),
    /checkpoint_invalid/u,
  );
  const wrongTarget = clone(capture);
  wrongTarget.databaseName = "rehearsal";
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(wrongTarget), capture.ledger.versions),
    /checkpoint_invalid/u,
  );
  const incompleteHistory = clone(capture);
  incompleteHistory.remoteOnlyHistory.pop();
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(incompleteHistory), capture.ledger.versions),
    /checkpoint_invalid/u,
  );
  const alteredBody = clone(capture);
  alteredBody.remoteOnlyHistory[0].statementsJsonSha256 = "unknown";
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(alteredBody), capture.ledger.versions),
    /checkpoint_invalid/u,
  );
});

test("object digest inventory fails closed on incomplete or duplicated security scope", () => {
  const missingTable = clone(capture);
  missingTable.relations = missingTable.relations.filter(
    (r) => r.object_id !== "public.scheduled_tasks",
  );
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(missingTable), capture.ledger.versions),
    /scheduled_scope_missing/u,
  );

  const altered = clone(capture);
  altered.relations[0].rls_sha256 = "unverified";
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(altered), capture.ledger.versions),
    /relations_invalid/u,
  );

  const duplicated = clone(capture);
  duplicated.functions.splice(1, 0, clone(duplicated.functions[0]));
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(duplicated), capture.ledger.versions),
    /functions_invalid/u,
  );
  const missingSchema = clone(capture);
  missingSchema.schemas.pop();
  assert.throws(
    () => parseMigrationProofCatalog(JSON.stringify(missingSchema), capture.ledger.versions),
    /schemas_invalid/u,
  );
});
