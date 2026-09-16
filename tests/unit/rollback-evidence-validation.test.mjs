import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateRollbackEvidence } from "../../scripts/release/rollback-evidence.mjs";

const script = fileURLToPath(
  new URL("../../scripts/release/rollback-evidence.mjs", import.meta.url),
);
const textFields = [
  "candidateRevision",
  "previousRevision",
  "backupReference",
  "databaseCompatibility",
  "authMigrationState",
  "cloudflareOriginState",
  "restoreCommand",
  "verificationCommand",
];

function validEvidence() {
  return {
    releaseSha: "a".repeat(40),
    candidateImageDigest: `sha256:${"b".repeat(64)}`,
    previousImageDigest: `sha256:${"c".repeat(64)}`,
    candidateRevision: "candidate",
    previousRevision: "previous",
    backupReference: "backup",
    databaseCompatibility: "expand-contract compatible",
    authMigrationState: "not_started",
    cloudflareOriginState: "origin unchanged",
    restoreCommand: "az containerapp ingress traffic set ...",
    verificationCommand: "curl health and version",
  };
}

function runCli(args, env = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.KOVA_ROLLBACK_EVIDENCE_FILE;
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: 5000,
    env: { ...cleanEnv, ...env },
  });
}

test("rollback validation preserves the existing valid evidence contract", () => {
  assert.deepEqual(validateRollbackEvidence(validEvidence()), []);
  assert.deepEqual(validateRollbackEvidence({ ...validEvidence(), schemaVersion: 1 }), []);
});

for (const name of textFields) {
  test(`rollback validation rejects unresolved template text in ${name}`, () => {
    for (const marker of ["REPLACE_WITH_REVIEWED_EVIDENCE", " replace_with_actual_reference "]) {
      assert.ok(validateRollbackEvidence({ ...validEvidence(), [name]: marker }).includes(name));
    }
  });
}

for (const name of ["releaseSha", "candidateImageDigest", "previousImageDigest"]) {
  test(`rollback validation refuses coerced ${name} identifiers`, () => {
    const value = validEvidence()[name];
    for (const replacement of [[value], new String(value), { toString: () => value }]) {
      assert.ok(
        validateRollbackEvidence({ ...validEvidence(), [name]: replacement }).includes(name),
      );
    }
  });
}

test("rollback validation rejects an array pretending to be an evidence record", () => {
  assert.ok(validateRollbackEvidence(Object.assign([], validEvidence())).length > 0);
});

test("rollback validation handles null, primitive and missing inputs", () => {
  for (const value of [null, undefined, "evidence", 1, true, [], {}]) {
    assert.ok(validateRollbackEvidence(value).length > 0);
  }
});

test("rollback validation preserves required nonempty text fields", () => {
  for (const name of textFields) {
    for (const value of [undefined, null, "", " \n ", 7, ["proof"]]) {
      assert.ok(validateRollbackEvidence({ ...validEvidence(), [name]: value }).includes(name));
    }
  }
});

test("rollback validation still requires distinct immutable digests", () => {
  const value = validEvidence();
  value.previousImageDigest = value.candidateImageDigest;
  assert.ok(validateRollbackEvidence(value).includes("distinctImageDigests"));
});

test("the template cannot pass after only the SHA and digests are replaced", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kova-rollback-placeholder-"));
  try {
    const file = path.join(dir, "evidence.json");
    const generated = runCli(["--write-template", file]);
    assert.equal(generated.status, 0, generated.stderr);
    const value = JSON.parse(readFileSync(file, "utf8"));
    const valid = validEvidence();
    for (const name of ["releaseSha", "candidateImageDigest", "previousImageDigest"]) {
      value[name] = valid[name];
    }
    writeFileSync(file, JSON.stringify(value));
    const checked = runCli([file]);
    assert.equal(checked.status, 1, checked.stdout);
    assert.match(checked.stderr, /rollback_evidence_invalid:/u);
    assert.match(checked.stderr, /backupReference/u);
    assert.doesNotMatch(checked.stdout, /ROLLBACK_EVIDENCE_CONTRACT=PASS/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI accepts valid evidence without calling it a completed recovery exercise", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kova-rollback-valid-"));
  try {
    const file = path.join(dir, "evidence.json");
    writeFileSync(file, JSON.stringify(validEvidence()));
    for (const checked of [runCli([file]), runCli([], { KOVA_ROLLBACK_EVIDENCE_FILE: file })]) {
      assert.equal(checked.status, 0, checked.stderr);
      assert.match(
        checked.stdout,
        /ROLLBACK_EVIDENCE_CONTRACT=PASS productionExerciseStillRequired=true/u,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
