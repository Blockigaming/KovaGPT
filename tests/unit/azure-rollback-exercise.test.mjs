import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateAzureRollbackExercise } from "../../scripts/release/azure-rollback-exercise.mjs";

const script = fileURLToPath(
  new URL("../../scripts/release/azure-rollback-exercise.mjs", import.meta.url),
);
function fixture() {
  const at = (seconds) => `2026-10-06T21:00:${String(seconds).padStart(2, "0")}.000Z`;
  const scope = {
    schemaVersion: 1,
    milestone: "M19",
    targetResourceId:
      "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/synthetic/providers/Microsoft.App/containerapps/synthetic",
    authorizationSha256: "d".repeat(64),
    maximumIncrementalSpendUsd: 0,
    maximumCandidateWeight: 5,
    maximumRecoveryMs: 20000,
    windowStart: at(0),
    windowEnd: at(59),
    backupReference: "synthetic-reviewed-backup",
    candidate: {
      revision: "synthetic--candidate",
      imageDigest: `sha256:${"b".repeat(64)}`,
      releaseSha: "a".repeat(40),
    },
    previous: {
      revision: "synthetic--previous",
      imageDigest: `sha256:${"c".repeat(64)}`,
      releaseSha: "e".repeat(40),
    },
  };
  const snapshot = (identity, observed, checked, candidateWeight) => ({
    revisionMode: "Multiple",
    targetResourceId: scope.targetResourceId,
    observedAt: at(observed),
    receiptSha256: "f".repeat(64),
    weights: [
      {
        revision: scope.candidate.revision,
        imageDigest: scope.candidate.imageDigest,
        weight: candidateWeight,
      },
      {
        revision: scope.previous.revision,
        imageDigest: scope.previous.imageDigest,
        weight: 100 - candidateWeight,
      },
    ],
    checks: Object.fromEntries(
      ["originLivez", "originReadyz", "originVersion", "edge", "auth", "databaseCompatibility"].map(
        (name) => [
          name,
          {
            ...scope[identity],
            observedAt: at(checked),
            receiptSha256: "f".repeat(64),
            status: "PASS",
            authenticatedOrigin: true,
          },
        ],
      ),
    ),
  });
  const evidence = {
    schemaVersion: 1,
    kind: "actual-azure-revision-rollback",
    releaseSha: scope.candidate.releaseSha,
    candidateRevision: scope.candidate.revision,
    candidateImageDigest: scope.candidate.imageDigest,
    previousRevision: scope.previous.revision,
    previousImageDigest: scope.previous.imageDigest,
    targetResourceId: scope.targetResourceId,
    authorizationSha256: scope.authorizationSha256,
    backupReference: scope.backupReference,
    databaseCompatibility: "synthetic compatible",
    authMigrationState: "not_started",
    cloudflareOriginState: "synthetic unchanged",
    restoreCommand: "synthetic rollback",
    verificationCommand: "synthetic verification",
    incrementalSpendUsd: 0,
    databaseWrites: 0,
    authMigrationPerformed: false,
    before: snapshot("candidate", 1, 2, 5),
    after: snapshot("previous", 20, 25, 0),
    rollback: {
      operation: "revision-traffic-rollback",
      startedAt: at(10),
      completedAt: at(15),
      exitCode: 0,
      receiptSha256: "f".repeat(64),
    },
    observedRecoveryMs: 15000,
  };
  return { scope, evidence };
}

test("synthetic consistent evidence passes only the source consistency check", () => {
  const { evidence, scope } = fixture();
  assert.deepEqual(validateAzureRollbackExercise(evidence, scope), []);
});

test("canonical ARM containerApps casing is accepted without relaxing exact scope binding", () => {
  const { evidence, scope } = fixture();
  const id = scope.targetResourceId.replace("containerapps", "containerApps");
  scope.targetResourceId = id;
  evidence.targetResourceId = id;
  evidence.before.targetResourceId = id;
  evidence.after.targetResourceId = id;
  assert.deepEqual(validateAzureRollbackExercise(evidence, scope), []);
  evidence.after.targetResourceId += "-other";
  assert.ok(validateAzureRollbackExercise(evidence, scope).includes("after.targetBinding"));
});

for (const [name, mutate, gate] of [
  [
    "zero-to-zero is not rollback",
    (e) => {
      e.before.weights[0].weight = 0;
      e.before.weights[1].weight = 100;
    },
    "before.measuredTransition",
  ],
  [
    "single-revision mode",
    (e) => {
      e.before.revisionMode = "Single";
    },
    "before.multipleRevisionMode",
  ],
  [
    "wrong production target",
    (e) => {
      e.targetResourceId += "-other";
    },
    "targetBinding",
  ],
  [
    "unbound approval",
    (e) => {
      e.authorizationSha256 = "0".repeat(64);
    },
    "authorizationBinding",
  ],
  [
    "unbounded canary",
    (e) => {
      e.before.weights[0].weight = 6;
      e.before.weights[1].weight = 94;
    },
    "before.measuredTransition",
  ],
  [
    "wrong prior image",
    (e) => {
      e.after.weights[1].imageDigest = e.candidateImageDigest;
    },
    "after.previous.imageBinding",
  ],
  [
    "duplicate revision",
    (e) => {
      e.after.weights[1] = { ...e.after.weights[0] };
    },
    "after.previous.uniqueRevision",
  ],
  [
    "unmeasured traffic",
    (e) => {
      e.before.weights[0].weight = "5";
    },
    "before.candidate.weight",
  ],
  [
    "missing auth proof",
    (e) => {
      delete e.after.checks.auth;
    },
    "after.auth.status",
  ],
  [
    "wrong health version",
    (e) => {
      e.after.checks.originVersion.releaseSha = e.releaseSha;
    },
    "after.originVersion.identity",
  ],
  [
    "unprotected origin",
    (e) => {
      e.after.checks.originReadyz.authenticatedOrigin = false;
    },
    "after.originReadyz.protectedOrigin",
  ],
  [
    "stale healthy result",
    (e) => {
      e.after.checks.edge.observedAt = e.before.observedAt;
    },
    "after.edge.window",
  ],
  [
    "invented recovery time",
    (e) => {
      e.observedRecoveryMs = 1;
    },
    "measuredRecoveryTime",
  ],
  [
    "failed rollback command",
    (e) => {
      e.rollback.exitCode = 1;
    },
    "rollback.success",
  ],
  [
    "production database write",
    (e) => {
      e.databaseWrites = 1;
    },
    "noUnapprovedDataMutation",
  ],
  [
    "paid execution",
    (e) => {
      e.incrementalSpendUsd = 0.01;
    },
    "zeroCostBoundary",
  ],
  [
    "unreviewed backup",
    (e) => {
      e.backupReference = "another-backup";
    },
    "backupBinding",
  ],
  [
    "outside approved time",
    (e, s) => {
      s.windowEnd = e.rollback.startedAt;
    },
    "rollback.window",
  ],
]) {
  test(`rejects ${name}`, () => {
    const { evidence, scope } = fixture();
    mutate(evidence, scope);
    assert.ok(validateAzureRollbackExercise(evidence, scope).includes(gate));
  });
}

test("missing approved scope and non-object inputs fail closed", () => {
  for (const value of [null, [], "input", 0, undefined]) {
    assert.ok(validateAzureRollbackExercise(value, fixture().scope).length);
    assert.ok(validateAzureRollbackExercise(fixture().evidence, value).length);
  }
});

test("CLI never echoes malformed private content or awards M19 acceptance", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "m19-source-contract-"));
  const evidencePath = path.join(dir, "evidence.json");
  const scopePath = path.join(dir, "scope.json");
  try {
    const { evidence, scope } = fixture();
    writeFileSync(evidencePath, JSON.stringify(evidence), { mode: 0o600 });
    writeFileSync(scopePath, JSON.stringify(scope), { mode: 0o600 });
    const run = () =>
      spawnSync(process.execPath, [script, evidencePath, scopePath], {
        encoding: "utf8",
        timeout: 5000,
      });
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(
      valid.stdout,
      /independentAcceptanceStillRequired=true authorizationNotGranted=true/u,
    );
    assert.doesNotMatch(valid.stdout, /M19.*ACCEPTED/u);
    writeFileSync(evidencePath, '{"private":"SYNTHETIC_DO_NOT_ECHO" invalid');
    const malformed = run();
    assert.equal(malformed.status, 1);
    assert.doesNotMatch(malformed.stdout + malformed.stderr, /SYNTHETIC_DO_NOT_ECHO/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
