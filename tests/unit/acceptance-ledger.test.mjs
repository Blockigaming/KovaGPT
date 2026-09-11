import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcceptanceLedger,
  serializeAcceptanceLedger,
} from "../../scripts/release/acceptance-ledger.mjs";

test("granular acceptance ledger covers every area and evidence stage", () => {
  const ledger = buildAcceptanceLedger();

  assert.equal(ledger.auditedMainCommit, "b046727e3336b0f8df48a8097ad131e94cbf4ffe");
  assert.equal(ledger.provisionalOverallProgress, 76.5);
  assert.equal(ledger.progressRecalculated, false);
  assert.equal(ledger.verification.masterAreas, 27);
  assert.equal(ledger.verification.stagesPerArea, 5);
  assert.equal(ledger.verification.acceptanceRows, 135);
  assert.equal(ledger.verification.uniqueAcceptanceRows, 135);
  assert.equal(ledger.verification.missingEvidencePaths, 0);
  assert.equal(ledger.verification.missingRetainedLegacyTests, 0);
  assert.ok(ledger.verification.currentTestFiles >= ledger.verification.retainedLegacyTests);
});

test("merged Work specialist behavior is accepted without claiming deployment proof", () => {
  const ledger = buildAcceptanceLedger();
  const workSource = ledger.rows.find((row) => row.id === "07.source");
  const workProduction = ledger.rows.find((row) => row.id === "07.production");
  const skillsSource = ledger.rows.find((row) => row.id === "14.source");

  assert.equal(workSource?.status, "accepted");
  assert.match(workSource?.requirement ?? "", /specialist runs/i);
  assert.equal(workProduction?.status, "not_verified");
  assert.equal(skillsSource?.status, "partial");
  assert.match(skillsSource?.boundary ?? "", /skill\/workflow packages remain missing/i);
});

test("acceptance ledger serialization is deterministic", async () => {
  assert.equal(await serializeAcceptanceLedger(), await serializeAcceptanceLedger());
});
