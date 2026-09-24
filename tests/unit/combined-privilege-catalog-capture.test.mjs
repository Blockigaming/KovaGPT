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
      "../../docs/release-reconciliation/evidence/privilege-single-checkpoint-live-capture-v2-20260924.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const legacy = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/release-reconciliation/evidence/privilege-single-checkpoint-live-capture-20260924.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("reviewed collector inputs reconstruct the operator-asserted single-checkpoint SQL", () => {
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
    "644423256ff10f926e508cd16fbf4efcc456b666afdf8488a57ee4a68a9440b8",
  );
  assert.equal((combined.match(/BEGIN TRANSACTION/gu) ?? []).length, 1);
  assert.equal((combined.match(/COMMIT;/gu) ?? []).length, 1);
  assert.match(combined, /transaction_isolation/iu);
  assert.match(combined, /schema_migrations/iu);
  assert.match(combined, /public_policy_aggregate/iu);
  assert.match(combined, /aggregate_counts/iu);
  assert.match(combined, /to_jsonb\(statements\)::text/iu);
  assert.equal(capture.operatorAssertedQuerySha256, collectorSha256(combined));
  assert.equal(
    capture.collectorGeneratorSha256,
    collectorSha256(
      readFileSync(
        new URL("../../scripts/release/combined-privilege-catalog-capture.mjs", import.meta.url),
      ),
    ),
  );
  assert.equal(capture.liveQueryIdentityVerified, false);
  assert.equal(capture.liveProjectIdentityVerified, false);
  assert.equal(capture.privilegeCollectorSha256, collectorSha256(privilege));
  assert.equal(capture.helperCollectorSha256, collectorSha256(helpers));
  assert.equal(capture.evidence.isolation, "repeatable read");
  assert.equal(capture.evidence.readOnly, "on");
  assert.equal(capture.evidence.ledger.migration_count, 98);
  assert.equal(capture.evidence.ledger.rows.length, 98);
  assert.deepEqual(
    capture.evidence.ledger.rows.map(({ version, statementCount, capturedStatementsSha256 }) => ({
      version,
      statementCount,
      capturedStatementsSha256,
    })),
    legacy.evidence.ledger.rows,
  );
  assert.ok(
    capture.evidence.ledger.rows.every((row) => /^[a-f0-9]{64}$/u.test(row.statementsJsonSha256)),
  );
  assert.equal(capture.evidence.ledger.statement_count, 1043);
  assert.equal(capture.evidence.privilege.observedMigrationCount, 98);
  assert.equal(capture.evidence.helpers.migration_count, 98);
  assert.equal(capture.evidence.helpers.captured_at, capture.evidence.capturedAt);
  assert.equal(capture.evidence.privilege.serverTableRestrictiveDenyMissing, 16);
  assert.equal(capture.evidence.privilege.triggerCandidateSearchPathMismatch, 7);
  assert.equal(capture.proofV2Accepted, false);
});

test("the canonical statement-array representation distinguishes LF-boundary collisions", () => {
  const left = ["a\nb", "c"];
  const right = ["a", "b\nc"];
  assert.equal(left.join("\n"), right.join("\n"));
  assert.notEqual(JSON.stringify(left), JSON.stringify(right));
  const combined = buildCombinedPrivilegeCatalogCapture(privilege, helpers);
  assert.match(combined, /'statementsJsonSha256'/u);
  assert.match(combined, /coalesce\(to_jsonb\(statements\)::text,'null'\)/u);
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
