import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCanonicalHistoryDecision,
  validateCanonicalHistoryCapture,
  validateCheckedOutMigrationSet,
  validateEquivalentSupplement,
} from "../../scripts/release/canonical-history-decision.mjs";

const path = "docs/release-reconciliation/canonical-history-actions-20260923.json";

test("the decision accounts for each source-only and remote-only version at the pinned checkpoint", () => {
  const decision = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(decision, buildCanonicalHistoryDecision());
  assert.deepEqual(decision.counts, {
    shared: 74,
    remoteOnly: 24,
    sourceOnly: 83,
    equivalentRemoteRows: 5,
    blockedRemoteRows: 19,
    conditionalForwardBodies: 80,
    conditionalRecordOnlyVersions: 3,
    proposedFinalLedgerCount: 181,
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
  for (const capturedAt of [undefined, "not-a-timestamp", 123]) {
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
