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

const secondId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("duplicate expected user UUIDs cannot satisfy the source user count", () => {
  assert.throws(
    () => validateAuthMigrationEvidence({
      ...ready, sourceUsers: 2, expectedUserUuids: [userId, userId],
    }),
    /auth_migration_expected_uuids_duplicate/u,
  );
});

test("UUID uniqueness is case insensitive", () => {
  assert.throws(
    () => validateAuthMigrationEvidence({
      ...ready, sourceUsers: 2, expectedUserUuids: [secondId, secondId.toUpperCase()],
    }),
    /auth_migration_expected_uuids_duplicate/u,
  );
});

test("invalid expected UUID manifests cannot produce a completed decision", () => {
  assert.throws(
    () => validateAuthMigrationEvidence({
      ...ready, sourceUsers: 2, destinationUsersBefore: 2,
      destinationIdentitiesBefore: 1, destinationMatchesExpected: true,
      expectedUserUuids: [userId, userId],
    }),
    /auth_migration_expected_uuids_duplicate/u,
  );
});

test("UUID entries must be strings, not values accepted through coercion", () => {
  for (const entry of [[userId], { toString: () => userId }]) {
    assert.throws(
      () => validateAuthMigrationEvidence({ ...ready, expectedUserUuids: [entry] }),
      /auth_migration_expected_uuids_invalid/u,
    );
  }
});

test("sparse UUID arrays fail closed rather than passing Array.every", () => {
  assert.throws(
    () => validateAuthMigrationEvidence({ ...ready, expectedUserUuids: Array(1) }),
    /auth_migration_expected_uuids_invalid/u,
  );
});

test("counts beyond exact integer precision are rejected", () => {
  assert.throws(
    () => validateAuthMigrationEvidence({ ...ready, sourceIdentities: Number.MAX_SAFE_INTEGER + 1 }),
    /auth_migration_invalid_source_identities/u,
  );
});

test("identities with zero source users contradict zero orphan identities", () => {
  assert.throws(
    () => validateAuthMigrationEvidence({ ...ready, sourceUsers: 0, expectedUserUuids: [] }),
    /auth_migration_source_counts_inconsistent/u,
  );
});

test("all count fields require safe nonnegative integers", () => {
  for (const key of ["sourceUsers", "sourceIdentities", "destinationUsersBefore",
    "destinationIdentitiesBefore", "orphanIdentities", "duplicateProviderSubjects"]) {
    for (const count of [-1, 0.5, NaN, Infinity, "1", true, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validateAuthMigrationEvidence({ ...ready, [key]: count }),
        /auth_migration_invalid_/u);
    }
  }
});

test("valid distinct UUIDs retain ready and no-rerun behavior without mutating evidence", () => {
  const value = { ...ready, sourceUsers: 2, sourceIdentities: 3,
    expectedUserUuids: [userId, secondId.toUpperCase()] };
  const before = structuredClone(value);
  assert.equal(validateAuthMigrationEvidence(value).decision, "READY_FOR_REHEARSAL_OR_APPROVED_RUN");
  assert.deepEqual(value, before);
  assert.equal(validateAuthMigrationEvidence({ ...value, destinationUsersBefore: 2,
    destinationIdentitiesBefore: 3, destinationMatchesExpected: true,
    exactlyOnceApproved: false }).decision, "DO_NOT_RERUN");
});

test("empty source evidence can still report an already matching empty destination", () => {
  assert.equal(validateAuthMigrationEvidence({ ...ready, sourceUsers: 0, sourceIdentities: 0,
    expectedUserUuids: [], destinationMatchesExpected: true }).decision, "DO_NOT_RERUN");
});

test("backups, rollback, approval, TLS and identity integrity still fail closed", () => {
  for (const changes of [{ backupReference: " " }, { rollbackPlan: "" },
    { exactlyOnceApproved: "true" }, { tlsAuthorized: "true" },
    { orphanIdentities: 1 }, { duplicateProviderSubjects: 1 },
    { expectedUserUuids: [null] }, { expectedUserUuids: [] }]) {
    assert.throws(() => validateAuthMigrationEvidence({ ...ready, ...changes }), /auth_migration_/u);
  }
});
