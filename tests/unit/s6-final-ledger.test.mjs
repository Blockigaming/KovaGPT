import assert from "node:assert/strict";
import test from "node:test";
import { requiredDeployedChecks } from "../../scripts/release/kova-auth-cutover-gate.mjs";
import { finalizeS6 } from "../../scripts/release/finalize-s6-ledger.mjs";
import { TARGET } from "../../scripts/release/s6-deployed-checks.mjs";

const baseline = requiredDeployedChecks.map((check) => ({
  check,
  status: "PASS",
  kind: "REUSED_DEPLOYED",
}));
const run = {
  target: TARGET,
  cleanupComplete: true,
  cleanupReadback: { sessions: 0, activeAccounts: 0, queued: 0 },
  deadline: "2026-09-30T22:20:00Z",
  records: [
    {
      check: requiredDeployedChecks[0],
      status: "PASS",
      kind: "DEPLOYED",
      at: "2026-09-30T22:10:00Z",
    },
  ],
};
const stopped = {
  at: "2026-09-30T22:19:00Z",
  independentReadback: { id: TARGET, state: "Stopped" },
  watchdog: { status: "stopped", independentlyVerified: true, finishedBeforeDeadline: true },
};
test("migration increments only with all 22 deployed passes, cleanup and timely independent stop", () => {
  assert.equal(finalizeS6(baseline, run, stopped).authMigrationVerified, 15);
  const failed = baseline.map((x, i) => (i === 17 ? { ...x, status: "BLOCKED" } : x));
  assert.equal(finalizeS6(failed, run, stopped).authMigrationVerified, 14);
  assert.throws(() => finalizeS6(baseline, { ...run, cleanupComplete: false }, stopped));
  assert.throws(() => finalizeS6(baseline, run, { ...stopped, at: "2026-09-30T22:21:00Z" }));
  assert.throws(() =>
    finalizeS6(baseline, run, {
      ...stopped,
      independentReadback: { id: TARGET, state: "Running" },
    }),
  );
});
