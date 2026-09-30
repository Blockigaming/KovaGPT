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
import {
  MIGRATION_ACL_DETAIL_SQL,
  MIGRATION_ACL_DETAIL_QUERY_SHA256,
  parseMigrationAclDetail,
} from "../../scripts/release/migration-acl-detail.mjs";
import { MANIFEST, planUpgrade, rehearseUpgrade } from "../../scripts/release/upgrade-database.mjs";
import { MIGRATION_PROOF_CATALOG_SQL } from "../../scripts/release/migration-proof-catalog.mjs";
import {
  CURRENT_HISTORY_SNAPSHOT,
  extendCurrentHistory,
} from "../../scripts/release/upgrade-database-current-history.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const sha = "a".repeat(64);
const roles = ["anon", "authenticated", "service_role"];
const catalog = {
  schemaVersion: 2,
  sessionReplicationRole: "origin",
  readOnly: true,
  isolation: "repeatable read",
  databaseName: "postgres",
  postgresVersionNum: 170006,
  capturedAt: "2026-09-27T00:00:00.000Z",
  remoteOnlyHistory: JSON.parse(readFileSync(join(ROOT, "release-migration-lineage.json")))
    .entries.filter((entry) => entry.status === "requires_schema_proof")
    .map((entry) => ({
      version: entry.remoteVersion,
      statementCount: 1,
      statementsJsonSha256: sha,
    })),
  relations: [
    { object_id: "public.scheduled_tasks", schema_sha256: sha, acl_sha256: sha, rls_sha256: sha },
  ],
  functions: [{ object_id: "public.test()", function_sha256: sha }],
  types: [{ object_id: "public.test_enum", type_sha256: sha }],
  schemas: [
    { object_id: "kova_private", acl_sha256: sha },
    { object_id: "public", acl_sha256: sha },
  ],
  defaultAclSha256: sha,
};
const capture = {
  transactionReadOnly: true,
  isolationLevel: "repeatable read",
  relations: [
    {
      object_id: "public.scheduled_tasks",
      kind: "r",
      owner_role: "postgres",
      raw_acl: null,
      grants: [],
      effective: roles.map((role) => ({ role, select: false })),
      column_grants: [],
    },
  ],
  defaultPrivileges: [
    {
      owner_role: "postgres",
      schema_name: "public",
      kind: "r",
      raw_acl: null,
      grants: [],
    },
  ],
};
const relationIds = catalog.relations.map((entry) => entry.object_id);

test("the isolated collector binds its exact read-only SQL and accepts the metadata shape", () => {
  assert.equal(
    MIGRATION_ACL_DETAIL_QUERY_SHA256,
    createHash("sha256").update(MIGRATION_ACL_DETAIL_SQL).digest("hex"),
  );
  assert.match(
    MIGRATION_ACL_DETAIL_SQL,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/u,
  );
  assert.equal(parseMigrationAclDetail(JSON.stringify(capture), relationIds).relations.length, 1);
  assert.equal(capture.defaultPrivileges.length, 1);
});

test("the ACL baseline fails closed on missing objects, changed roles, or non-read-only SQL", () => {
  for (const modified of [
    { ...capture, transactionReadOnly: false },
    { ...capture, relations: [] },
    {
      ...capture,
      relations: [{ ...capture.relations[0], effective: capture.relations[0].effective.slice(1) }],
    },
    {
      ...capture,
      defaultPrivileges: [...capture.defaultPrivileges, capture.defaultPrivileges[0]],
    },
  ])
    assert.throws(() => parseMigrationAclDetail(JSON.stringify(modified), relationIds));
});

test("the optional capture requires the exact 98-version proof catalog and plans no live action", () => {
  assert.throws(
    () => rehearseUpgrade({ dryRun: true, currentHistory: true, captureAclDetail: true }),
    /upgrade_acl_detail_proof_catalog_required/u,
  );
  const plan = rehearseUpgrade({
    dryRun: true,
    currentHistory: true,
    captureProofCatalog: true,
    captureAclDetail: true,
  });
  assert.equal(plan.executed, false);
  assert.equal(plan.baselineVersions, 98);
  assert.equal(plan.baselineAclDetailQuerySha256, MIGRATION_ACL_DETAIL_QUERY_SHA256);
});

test("the disposable baseline writes an ACL capture bound to its 98-version receipt", (t) => {
  const root = mkdtempSync(join(tmpdir(), "kova-acl-baseline-"));
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
  writeFileSync(join(root, "node_modules/.bin/supabase"), "mocked local executable");

  const plan = extendCurrentHistory(
    planUpgrade(root),
    readFileSync(join(root, CURRENT_HISTORY_SNAPSHOT)),
  );
  const baselineVersions = plan.baseline.map((row) => row.version);
  const finalVersions = [
    ...baselineVersions,
    ...plan.executionForward.map((row) => row.version),
  ].sort();
  const sqlOrder = [];
  let catalogs = 0;
  const result = rehearseUpgrade({
    root,
    currentHistory: true,
    captureProofCatalog: true,
    captureAclDetail: true,
    inspectSource: () => ({
      commit: "b".repeat(40),
      tree: "c".repeat(40),
      trackedFileCount: 1,
      readFile: readFileSync,
      readDirectory: readdirSync,
    }),
    execute(command, args, options) {
      if (command === "git")
        return { status: 0, stdout: args.at(-1) === "HEAD" ? "b".repeat(40) : "c".repeat(40) };
      if (command === "docker") {
        if (options.input === MIGRATION_PROOF_CATALOG_SQL) {
          sqlOrder.push("catalog");
          const versions = ++catalogs === 1 ? baselineVersions : finalVersions;
          return {
            status: 0,
            stdout: JSON.stringify({
              ...catalog,
              ledger: { versions, version_count: versions.length },
            }),
          };
        }
        if (options.input === MIGRATION_ACL_DETAIL_SQL) {
          sqlOrder.push("acl");
          return { status: 0, stdout: JSON.stringify(capture) };
        }
        if (options.input.includes("Synthetic fixtures")) sqlOrder.push("seed");
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(sqlOrder.slice(0, 3), ["catalog", "acl", "seed"]);
  const path = join(root, "artifacts/release/upgrade-baseline-acl-detail.json");
  const bytes = readFileSync(path);
  const artifact = JSON.parse(bytes);
  assert.equal(result.baselineAclDetail.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(artifact.querySha256, MIGRATION_ACL_DETAIL_QUERY_SHA256);
  assert.deepEqual(artifact.baselineLedgerVersions, baselineVersions);
  assert.equal(
    artifact.baselineLedgerVersionsSha256,
    createHash("sha256").update(baselineVersions.join("\n")).digest("hex"),
  );
  assert.equal(artifact.capture.relations.length, 1);
  assert.equal(artifact.acceptedProofs, 0);
});
