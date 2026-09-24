import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCombinedPrivilegeCatalogCapture,
  collectorSha256,
} from "../../scripts/release/combined-privilege-catalog-capture.mjs";

const privilege = readFileSync(
  new URL("../../scripts/release/privilege-live-violation-counts.sql", import.meta.url),
  "utf8",
);
const helpers = readFileSync(
  new URL("../../scripts/release/rls-helper-live-aggregate.sql", import.meta.url),
  "utf8",
);
const capture = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/release-reconciliation/evidence/privilege-single-checkpoint-live-capture-20260924.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("reviewed collector inputs recreate the exact single-checkpoint live query", () => {
  assert.equal(
    collectorSha256(privilege),
    "aa4471fa29191ea6f6a43536f2888529ae9927a04af276928ab942a3a2f965a8",
  );
  assert.equal(
    collectorSha256(helpers),
    "8ed14a40925b85e24ef52a524da42e48237f2bb06084c677d00125bcdec1a16c",
  );
  const combined = buildCombinedPrivilegeCatalogCapture(privilege, helpers);
  assert.equal(
    collectorSha256(combined),
    "800ef2c8b1552c4872a17bff246c6dfa5d9be22b7c41d02ee27c8a874fd7b472",
  );
  assert.equal((combined.match(/BEGIN TRANSACTION/gu) ?? []).length, 1);
  assert.equal((combined.match(/COMMIT;/gu) ?? []).length, 1);
  assert.match(combined, /transaction_isolation/iu);
  assert.match(combined, /schema_migrations/iu);
  assert.match(combined, /public_policy_aggregate/iu);
  assert.match(combined, /aggregate_counts/iu);
  assert.equal(capture.querySha256, collectorSha256(combined));
  assert.equal(capture.privilegeCollectorSha256, collectorSha256(privilege));
  assert.equal(capture.helperCollectorSha256, collectorSha256(helpers));
  assert.equal(capture.evidence.isolation, "repeatable read");
  assert.equal(capture.evidence.readOnly, "on");
  assert.equal(capture.evidence.ledger.migration_count, 98);
  assert.equal(capture.evidence.ledger.rows.length, 98);
  assert.equal(capture.evidence.ledger.statement_count, 1043);
  assert.equal(capture.evidence.privilege.observedMigrationCount, 98);
  assert.equal(capture.evidence.helpers.migration_count, 98);
  assert.equal(capture.evidence.helpers.captured_at, capture.evidence.capturedAt);
  assert.equal(capture.evidence.privilege.serverTableRestrictiveDenyMissing, 16);
  assert.equal(capture.evidence.privilege.triggerCandidateSearchPathMismatch, 7);
  assert.equal(capture.proofV2Accepted, false);
});

test("collector input must be a single read-only SELECT transaction", () => {
  const safe =
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; WITH c AS (SELECT 1) SELECT 1; COMMIT;";
  assert.match(buildCombinedPrivilegeCatalogCapture(safe, safe), /SELECT 1/iu);
  for (const unsafe of [
    safe.replace("READ ONLY", "READ WRITE"),
    safe.replace("SELECT 1; COMMIT", "SELECT 1; DELETE FROM x; COMMIT"),
    safe.replace("COMMIT;", "ROLLBACK;"),
    `DROP TABLE x; ${safe}`,
  ]) {
    assert.throws(() => buildCombinedPrivilegeCatalogCapture(unsafe, safe));
  }
});
