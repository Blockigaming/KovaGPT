import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
    () =>
      validateAuthMigrationEvidence({
        ...ready,
        sourceUsers: 2,
        expectedUserUuids: [userId, userId],
      }),
    /auth_migration_expected_uuids_duplicate/u,
  );
});

test("UUID uniqueness is case insensitive", () => {
  assert.throws(
    () =>
      validateAuthMigrationEvidence({
        ...ready,
        sourceUsers: 2,
        expectedUserUuids: [secondId, secondId.toUpperCase()],
      }),
    /auth_migration_expected_uuids_duplicate/u,
  );
});

test("invalid expected UUID manifests cannot produce a completed decision", () => {
  assert.throws(
    () =>
      validateAuthMigrationEvidence({
        ...ready,
        sourceUsers: 2,
        destinationUsersBefore: 2,
        destinationIdentitiesBefore: 1,
        destinationMatchesExpected: true,
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
    () =>
      validateAuthMigrationEvidence({ ...ready, sourceIdentities: Number.MAX_SAFE_INTEGER + 1 }),
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
  for (const key of [
    "sourceUsers",
    "sourceIdentities",
    "destinationUsersBefore",
    "destinationIdentitiesBefore",
    "orphanIdentities",
    "duplicateProviderSubjects",
  ]) {
    for (const count of [-1, 0.5, NaN, Infinity, "1", true, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => validateAuthMigrationEvidence({ ...ready, [key]: count }),
        /auth_migration_invalid_/u,
      );
    }
  }
});

test("valid distinct UUIDs retain ready and no-rerun behavior without mutating evidence", () => {
  const value = {
    ...ready,
    sourceUsers: 2,
    sourceIdentities: 3,
    expectedUserUuids: [userId, secondId.toUpperCase()],
  };
  const before = structuredClone(value);
  assert.equal(
    validateAuthMigrationEvidence(value).decision,
    "READY_FOR_REHEARSAL_OR_APPROVED_RUN",
  );
  assert.deepEqual(value, before);
  assert.equal(
    validateAuthMigrationEvidence({
      ...value,
      destinationUsersBefore: 2,
      destinationIdentitiesBefore: 3,
      destinationMatchesExpected: true,
      exactlyOnceApproved: false,
    }).decision,
    "DO_NOT_RERUN",
  );
});

test("empty source evidence can still report an already matching empty destination", () => {
  assert.equal(
    validateAuthMigrationEvidence({
      ...ready,
      sourceUsers: 0,
      sourceIdentities: 0,
      expectedUserUuids: [],
      destinationMatchesExpected: true,
    }).decision,
    "DO_NOT_RERUN",
  );
});

test("backups, rollback, approval, TLS and identity integrity still fail closed", () => {
  for (const changes of [
    { backupReference: " " },
    { rollbackPlan: "" },
    { exactlyOnceApproved: "true" },
    { tlsAuthorized: "true" },
    { orphanIdentities: 1 },
    { duplicateProviderSubjects: 1 },
    { expectedUserUuids: [null] },
    { expectedUserUuids: [] },
  ]) {
    assert.throws(
      () => validateAuthMigrationEvidence({ ...ready, ...changes }),
      /auth_migration_/u,
    );
  }
});

const cli = fileURLToPath(
  new URL("../../scripts/release/auth-migration-preflight.mjs", import.meta.url),
);
const sensitiveCanary = "PRIVATE_INPUT_CANARY_MUST_NOT_LEAK";

function withCliFile(contents, action) {
  const dir = mkdtempSync(join(tmpdir(), "kova-preflight-cli-"));
  const path = join(dir, `${sensitiveCanary}.json`);
  try {
    if (contents !== undefined) writeFileSync(path, contents);
    const run = (args = [path], extraEnv = {}) => {
      const env = { ...process.env, ...extraEnv };
      delete env.KOVA_AUTH_MIGRATION_EVIDENCE_FILE;
      if (extraEnv.KOVA_AUTH_MIGRATION_EVIDENCE_FILE !== undefined) {
        env.KOVA_AUTH_MIGRATION_EVIDENCE_FILE = extraEnv.KOVA_AUTH_MIGRATION_EVIDENCE_FILE;
      }
      return spawnSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        env,
        timeout: 10_000,
      });
    };
    action({ dir, path, run });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertSafeFailure(result, code) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), `AUTH_MIGRATION_PREFLIGHT_ERROR=${code}`);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(sensitiveCanary));
}

test("CLI malformed JSON never exposes source contents or a parser stack", () => {
  withCliFile(`{"private":"${sensitiveCanary}", broken}`, ({ run }) => {
    assertSafeFailure(run(), "auth_migration_evidence_input_invalid");
  });
});

test("CLI missing and non-regular input paths fail without exposing their names", () => {
  withCliFile(undefined, ({ run, dir }) => {
    assertSafeFailure(run(), "auth_migration_evidence_input_invalid");
    assertSafeFailure(run([dir]), "auth_migration_evidence_input_invalid");
  });
});

test("CLI oversized evidence is rejected rather than parsed or printed", () => {
  withCliFile(Buffer.alloc(4 * 1024 * 1024 + 1, 32), ({ run }) => {
    assertSafeFailure(run(), "auth_migration_evidence_input_invalid");
  });
});

test("CLI malformed UTF-8 cannot silently become replacement characters", () => {
  const input = Buffer.concat([
    Buffer.from('{"schemaVersion":1,"comment":"'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]);
  withCliFile(input, ({ run }) => {
    assertSafeFailure(run(), "auth_migration_evidence_input_invalid");
  });
});

test("CLI preserves fixed validation errors without dumping invalid evidence", () => {
  withCliFile(
    JSON.stringify({ ...ready, tlsAuthorized: false, private: sensitiveCanary }),
    ({ run }) => {
      assertSafeFailure(run(), "auth_migration_tls_not_authorized");
    },
  );
});

test("CLI valid input emits only the bounded decision, not UUIDs or private fields", () => {
  withCliFile(JSON.stringify({ ...ready, private: sensitiveCanary }), ({ run }) => {
    const result = run();
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(
      result.stdout.trim(),
      `AUTH_MIGRATION_PREFLIGHT=${JSON.stringify(validateAuthMigrationEvidence(ready))}`,
    );
    assert.ok(!result.stdout.includes(userId));
    assert.ok(!result.stdout.includes(sensitiveCanary));
  });
});

test("CLI retains the environment-file input and explicit no-rerun decision", () => {
  const done = {
    ...ready,
    destinationUsersBefore: 1,
    destinationIdentitiesBefore: 1,
    destinationMatchesExpected: true,
    exactlyOnceApproved: false,
  };
  withCliFile(JSON.stringify(done), ({ run, path }) => {
    const result = run([], { KOVA_AUTH_MIGRATION_EVIDENCE_FILE: path });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /"decision":"DO_NOT_RERUN"/u);
    assert.equal(result.stderr, "");
  });
});

test("CLI absent or excess arguments are reported with fixed safe codes", () => {
  withCliFile(JSON.stringify(ready), ({ run, path }) => {
    assertSafeFailure(run([]), "auth_migration_evidence_file_required");
    assertSafeFailure(run([path, sensitiveCanary]), "auth_migration_evidence_input_invalid");
  });
});
