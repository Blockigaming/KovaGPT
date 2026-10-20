import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildCanonicalHistoryDecision,
  validateCanonicalHistoryCapture,
  validateCheckedOutMigrationSet,
  validateEquivalentSupplement,
  validateForwardExtension,
} from "../../scripts/release/canonical-history-decision.mjs";

const path = "docs/release-reconciliation/canonical-history-actions-20260923.json";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("canonical inputs use the supplied source readers and work outside the checkout", () => {
  const files = new Set();
  const directories = new Set();
  const decision = buildCanonicalHistoryDecision({
    root: ROOT,
    readFile(filename) {
      files.add(filename);
      return readFileSync(filename);
    },
    readDirectory(directory) {
      directories.add(directory);
      return readdirSync(directory);
    },
  });
  assert.deepEqual(decision, JSON.parse(readFileSync(join(ROOT, path), "utf8")));
  for (const filename of [
    "release-migrations.json",
    "release-migration-lineage.json",
    "tests/fixtures/production-migration-history-20260904/manifest.json",
    "tests/fixtures/production-migration-history-20260904/current-supplement-20260918.json",
    "supabase/migrations/20260903145843_remediate_security_advisor_warnings.sql",
    ...decision.remoteOnly
      .filter((entry) => entry.provenance === "historical_fixture")
      .map((entry) => entry.evidencePath),
  ])
    assert.ok(files.has(join(ROOT, filename)), `source reader missed ${filename}`);
  assert.ok(directories.has(join(ROOT, "supabase/migrations")));
  for (const [script, args] of [
    ["canonical-history-decision.mjs", ["--check"]],
    ["upgrade-database.mjs", ["--canonical-history", "--dry-run"]],
  ]) {
    const run = spawnSync(process.execPath, [join(ROOT, "scripts/release", script), ...args], {
      cwd: tmpdir(),
      encoding: "utf8",
    });
    if (
      args.includes("--dry-run") &&
      JSON.parse(readFileSync(join(ROOT, "release-migrations.json"))).count > 185
    ) {
      assert.equal(run.status, 1);
      assert.match(run.stderr, /upgrade_canonical_history_pending_mismatch/u);
      continue;
    }
    assert.equal(run.status, 0, `${script}: ${run.stderr}`);
    if (args.includes("--dry-run")) {
      const result = JSON.parse(run.stdout);
      assert.equal(result.baselineVersions, 98);
      assert.equal(result.canonicalHistoryProposal.expectedFinalLedgerCount, 209);
      assert.equal(result.executed, false);
    }
  }
});

test("the decision accounts for each current source-only and remote-only version", () => {
  const decision = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(decision, buildCanonicalHistoryDecision());
  assert.deepEqual(decision.counts, {
    shared: 74,
    remoteOnly: 24,
    sourceOnly: 111,
    equivalentRemoteRows: 5,
    blockedRemoteRows: 19,
    conditionalForwardBodies: 107,
    conditionalRecordOnlyVersions: 4,
    proposedFinalLedgerCount: 209,
  });
  assert.deepEqual(
    decision.sourceOnly
      .filter(
        (item) =>
          item.proposedAction === "record_canonical_version_without_rerunning_equivalent_body",
      )
      .map((item) => item.version),
    ["20260822122000", "20260823113000", "20260903145843"],
  );
  const scheduled = decision.sourceOnly.find((item) => item.version === "20260822143000");
  assert.equal(scheduled.proposedAction, "record_scheduled_version_pending_remote_effect_review");
  assert.deepEqual(scheduled.linkedRemoteOnlyVersions, ["20260823092107", "20260823092450"]);
  assert.deepEqual(scheduled.equivalentRemoteVersions, []);
  assert.match(scheduled.reviewStatus, /^blocked_/u);
  assert.ok(
    decision.remoteOnly.every((item) => item.proposedAction === "retain_remote_history_row"),
  );
  assert.ok(decision.sourceOnly.every((item) => item.reviewStatus.startsWith("blocked_")));
  assert.ok(
    decision.remoteOnly
      .filter((item) => item.mappingStatus === "requires_schema_proof")
      .every((item) => item.reviewStatus === "blocked_requires_schema_proof"),
  );
  assert.equal(decision.status, "proposed_only_no_history_repair_or_production_action");
});

test("forward auth migrations are checked without changing the historical decision", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "release-migrations.json"), "utf8"));
  const content = Buffer.from("-- New owned-auth migration fixture.\nselect 1;\n");
  const filename = "20990101000000_kova_owned_forward_fixture.sql";
  manifest.count += 1;
  manifest.migrations.push({
    ...manifest.migrations.at(-1),
    order: manifest.count,
    timestamp: filename.slice(0, 14),
    filename,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
  const build = ({ observed = manifest, changedBytes = content, untracked = false } = {}) =>
    buildCanonicalHistoryDecision({
      root: ROOT,
      readFile(pathname) {
        if (pathname === join(ROOT, "release-migrations.json"))
          return Buffer.from(JSON.stringify(observed));
        if (pathname === join(ROOT, "supabase/migrations", filename)) return changedBytes;
        return readFileSync(pathname);
      },
      readDirectory(directory) {
        return [
          ...readdirSync(directory),
          filename,
          ...(untracked ? ["20990102000000_kova_owned_untracked_fixture.sql"] : []),
        ];
      },
    });
  const expected = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  const decision = build();
  assert.deepEqual(decision, expected);
  assert.equal(decision.sourceManifestSha256, expected.sourceManifestSha256);
  assert.equal(decision.counts.proposedFinalLedgerCount, 209);
  const changedPrefix = structuredClone(manifest);
  changedPrefix.migrations[184].destructive = !changedPrefix.migrations[184].destructive;
  assert.throws(
    () => build({ observed: changedPrefix }),
    /canonical_history_current_source_checkpoint_changed/u,
  );
  assert.throws(
    () => build({ changedBytes: Buffer.from("select 2;\n") }),
    /canonical_history_checked_out_migration_content_changed/u,
  );
  assert.throws(
    () => build({ untracked: true }),
    /canonical_history_checked_out_migration_set_changed/u,
  );
});

test("capture validation rejects historical statement drift and wrong projects", () => {
  const lineage = JSON.parse(readFileSync("release-migration-lineage.json", "utf8"));
  const baselineBytes = readFileSync(
    "tests/fixtures/production-migration-history-20260904/manifest.json",
  );
  const baseline = JSON.parse(baselineBytes);
  const supplement = JSON.parse(
    readFileSync(
      "tests/fixtures/production-migration-history-20260904/current-supplement-20260918.json",
    ),
  );
  const baselineSha = createHash("sha256").update(baselineBytes).digest("hex");
  assert.doesNotThrow(() =>
    validateCanonicalHistoryCapture(lineage, baseline, supplement, baselineSha),
  );
  assert.throws(
    () =>
      validateCanonicalHistoryCapture(
        lineage,
        baseline,
        {
          ...supplement,
          historicalLedgerSha256: "0".repeat(64),
        },
        baselineSha,
      ),
    /canonical_history_historical_ledger_drift/u,
  );
  assert.throws(
    () => validateCanonicalHistoryCapture(lineage, baseline, supplement, "0".repeat(64)),
    /canonical_history_historical_manifest_drift/u,
  );
  assert.throws(
    () =>
      validateCanonicalHistoryCapture(
        { ...lineage, targetProjectRef: "other-project" },
        baseline,
        { ...supplement, projectRef: "other-project" },
        baselineSha,
      ),
    /canonical_history_target_mismatch/u,
  );
  for (const capturedAt of [
    undefined,
    "not-a-timestamp",
    123,
    "0",
    "2026-09-18",
    "2026-09-18T16:22:53",
    "2026/09/18",
    "2026-02-30T16:22:53Z",
    "2026-09-18T24:00:00Z",
  ]) {
    assert.throws(
      () =>
        validateCanonicalHistoryCapture(
          lineage,
          baseline,
          { ...supplement, capturedAt },
          baselineSha,
        ),
      /canonical_history_capture_invalid/u,
    );
  }
});

test("checked-out migration validation rejects edited and additional SQL files", () => {
  const content = "select 1;\n";
  const filename = "20260901000000_fixture.sql";
  const migration = {
    timestamp: "20260901000000",
    filename,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
  assert.doesNotThrow(() =>
    validateCheckedOutMigrationSet([migration], [filename], () => Buffer.from(content)),
  );
  assert.throws(
    () => validateCheckedOutMigrationSet([migration], [filename], () => Buffer.from("select 2;")),
    /canonical_history_checked_out_migration_content_changed/u,
  );
  assert.throws(
    () =>
      validateCheckedOutMigrationSet([migration], [filename, "20260901000001_untracked.sql"], () =>
        Buffer.from(content),
      ),
    /canonical_history_checked_out_migration_set_changed/u,
  );
});

test("the auth extension cannot rewrite the pinned 157 migrations", () => {
  const baseline = JSON.parse(
    spawnSync("git", ["show", "5734b9e3d96224b06cdf2bc6f824078738b86ce1:release-migrations.json"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout,
  );
  const current = JSON.parse(readFileSync("release-migrations.json", "utf8"));
  const files = readdirSync("supabase/migrations");
  const readMigration = (name) => readFileSync(join(ROOT, "supabase/migrations", name));
  assert.doesNotThrow(() => validateForwardExtension(baseline, current, files, readMigration));
  assert.throws(
    () =>
      validateForwardExtension(
        baseline,
        {
          ...current,
          migrations: [
            { ...current.migrations[0], destructive: true },
            ...current.migrations.slice(1),
          ],
        },
        files,
        readMigration,
      ),
    /canonical_history_source_prefix_changed/u,
  );
  assert.throws(
    () =>
      validateForwardExtension(
        baseline,
        current,
        [...files, "20260926000000_extra.sql"],
        readMigration,
      ),
    /canonical_history_checked_out_migration_set_changed/u,
  );
});

test("the 98th captured row stays bound to the pinned security source body", () => {
  const supplement = JSON.parse(
    readFileSync(
      "tests/fixtures/production-migration-history-20260904/current-supplement-20260918.json",
    ),
  );
  const source = JSON.parse(readFileSync("release-migrations.json", "utf8")).migrations.find(
    (entry) => entry.timestamp === "20260903145843",
  );
  const bytes = readFileSync(`supabase/migrations/${source.filename}`);
  assert.doesNotThrow(() => validateEquivalentSupplement(supplement, source, bytes));
  assert.throws(
    () =>
      validateEquivalentSupplement(
        {
          ...supplement,
          supplement: [{ ...supplement.supplement[0], capturedStatementsSha256: "0".repeat(64) }],
        },
        source,
        bytes,
      ),
    /canonical_history_supplement_equivalence_changed/u,
  );
});
