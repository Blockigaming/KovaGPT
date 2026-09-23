import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCanonicalHistoryDecision } from "../../scripts/release/canonical-history-decision.mjs";

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
