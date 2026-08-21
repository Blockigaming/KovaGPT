import assert from "node:assert/strict";
import test from "node:test";

import { validateAuthMigrationEvidence } from "../../scripts/release/auth-migration-preflight.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const ready = {
  schemaVersion: 1,
  sourceUsers: 1,
  sourceIdentities: 1,
  destinationUsersBefore: 0,
  destinationIdentitiesBefore: 0,
  expectedUserUuids: [userId],
  orphanIdentities: 0,
  duplicateProviderSubjects: 0,
  tlsAuthorized: true,
  destinationMatchesExpected: false,
  exactlyOnceApproved: true,
  backupReference: "rehearsal-backup-1",
  rollbackPlan: "Keep source auth authoritative until destination verification passes.",
};

test("auth migration preflight permits only an empty, backed-up, explicitly approved destination", () => {
  assert.deepEqual(validateAuthMigrationEvidence(ready), {
    decision: "READY_FOR_REHEARSAL_OR_APPROVED_RUN",
    databaseState: "0|0",
    sourceUsers: 1,
    sourceIdentities: 1,
  });
  assert.throws(
    () => validateAuthMigrationEvidence({ ...ready, destinationUsersBefore: 1 }),
    /destination_not_empty_or_complete/u,
  );
  assert.throws(
    () => validateAuthMigrationEvidence({ ...ready, exactlyOnceApproved: false }),
    /exactly_once_not_approved/u,
  );
  assert.throws(
    () => validateAuthMigrationEvidence({ ...ready, tlsAuthorized: false }),
    /tls_not_authorized/u,
  );
});

test("completed destination evidence returns an explicit do-not-rerun decision", () => {
  assert.deepEqual(
    validateAuthMigrationEvidence({
      ...ready,
      destinationUsersBefore: 1,
      destinationIdentitiesBefore: 1,
      destinationMatchesExpected: true,
      exactlyOnceApproved: false,
    }),
    {
      decision: "DO_NOT_RERUN",
      databaseState: "1|1",
      sourceUsers: 1,
      sourceIdentities: 1,
    },
  );
});
