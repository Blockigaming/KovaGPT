import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { MANIFEST, planUpgrade, rehearseUpgrade } from "../../scripts/release/upgrade-database.mjs";
import {
  CURRENT_HISTORY_SNAPSHOT,
  extendCurrentHistory,
} from "../../scripts/release/upgrade-database-current-history.mjs";
import { MIGRATION_PROOF_CATALOG_SQL } from "../../scripts/release/migration-proof-catalog.mjs";
import { SCHEDULED_TABLE_SQL } from "../../scripts/release/upgrade-database-scheduled-tables.mjs";
import { SCHEDULED_CATALOG_SQL } from "../../scripts/release/upgrade-database-scheduled-catalog.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_COMMIT = "b".repeat(40);
const SOURCE_TREE = "c".repeat(40);
const sha = "a".repeat(64);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

test("scheduled candidate is captured after two exact forward migrations and before later writers", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kova-scheduled-candidate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of [
    "supabase/migrations",
    dirname(MANIFEST),
    "scripts/release",
    "node_modules/.bin",
  ])
    mkdirSync(join(root, path), { recursive: true });
  cpSync(join(ROOT, "supabase/migrations"), join(root, "supabase/migrations"), { recursive: true });
  cpSync(join(ROOT, dirname(MANIFEST)), join(root, dirname(MANIFEST)), { recursive: true });
  for (const name of ["upgrade-database-assertions.sql", "upgrade-database-seed.sql"])
    cpSync(join(ROOT, "scripts/release", name), join(root, "scripts/release", name));
  writeFileSync(join(root, "node_modules/.bin/supabase"), "mocked pinned local executable");

  const plan = extendCurrentHistory(
    planUpgrade(root),
    readFileSync(join(root, CURRENT_HISTORY_SNAPSHOT)),
  );
  const checkpointVersions = [
    ...plan.baseline.map((row) => row.version),
    "20260822122000",
    "20260822143000",
  ].sort();
  const checkpoint = (path) => {
    const capture = readJson(path);
    capture.ledgerVersions = checkpointVersions;
    capture.ledgerVersionCount = checkpointVersions.length;
    return JSON.stringify(capture);
  };
  const tables = checkpoint(
    "docs/release-reconciliation/evidence/scheduled-tables-live-capture-20260924.json",
  );
  const routines = checkpoint(
    "docs/release-reconciliation/evidence/scheduled-routines-live-capture-20260924.json",
  );
  const remoteOnly = readJson("release-migration-lineage.json")
    .entries.filter((entry) => entry.status === "requires_schema_proof")
    .map((entry) => entry.remoteVersion);
  const catalog = JSON.stringify({
    schemaVersion: 2,
    sessionReplicationRole: "origin",
    readOnly: true,
    isolation: "repeatable read",
    databaseName: "postgres",
    postgresVersionNum: 170006,
    capturedAt: "2026-09-27T00:00:00.000Z",
    ledger: { versions: checkpointVersions, version_count: checkpointVersions.length },
    remoteOnlyHistory: remoteOnly.map((version) => ({
      version,
      statementCount: 1,
      statementsJsonSha256: sha,
    })),
    defaultAclSha256: sha,
    relations: [
      { object_id: "public.scheduled_tasks", schema_sha256: sha, acl_sha256: sha, rls_sha256: sha },
    ],
    functions: [{ object_id: "public.test()", function_sha256: sha }],
    types: [{ object_id: "public.test_enum", type_sha256: sha }],
    schemas: [
      { object_id: "kova_private", acl_sha256: sha },
      { object_id: "public", acl_sha256: sha },
    ],
  });

  const migrationInventories = [];
  const catalogCalls = [];
  const result = rehearseUpgrade({
    root,
    currentHistory: true,
    captureScheduledCandidate: true,
    inspectSource: () => ({
      commit: SOURCE_COMMIT,
      tree: SOURCE_TREE,
      trackedFileCount: 1,
      readFile: readFileSync,
      readDirectory: readdirSync,
    }),
    execute(command, args, options) {
      if (command === "git")
        return { status: 0, stdout: args.at(-1) === "HEAD" ? SOURCE_COMMIT : SOURCE_TREE };
      if (args[0] === "migration")
        migrationInventories.push(readdirSync(join(options.cwd, "supabase/migrations")));
      if (command === "docker") {
        if (options.input === MIGRATION_PROOF_CATALOG_SQL) {
          catalogCalls.push("whole");
          return { status: 0, stdout: catalog };
        }
        if (options.input === SCHEDULED_TABLE_SQL) {
          catalogCalls.push("table");
          return { status: 0, stdout: tables };
        }
        if (options.input === SCHEDULED_CATALOG_SQL) {
          catalogCalls.push("routine");
          return { status: 0, stdout: routines };
        }
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(result.passed, true);
  assert.equal(migrationInventories.length, 2);
  assert.equal(migrationInventories[0].length, 100);
  assert.equal(migrationInventories[1].length, 98 + plan.executionForward.length);
  assert.deepEqual(catalogCalls, ["whole", "table", "routine"]);
  const evidencePath = join(root, "artifacts/release/upgrade-scheduled-candidate-checkpoint.json");
  const evidence = JSON.parse(readFileSync(evidencePath));
  assert.equal(result.scheduledCandidateCheckpoint.sha256, digest(readFileSync(evidencePath)));
  assert.deepEqual(evidence.checkpointVersions, checkpointVersions);
  assert.equal(evidence.checkpointLedgerVersionsSha256, digest(checkpointVersions.join("\n")));
  assert.deepEqual(
    evidence.candidateMigrations.map((row) => row.version),
    ["20260822122000", "20260822143000"],
  );
  assert.equal(evidence.acceptedProofs, 0);
  assert.equal(evidence.productionReleaseReady, false);
});
