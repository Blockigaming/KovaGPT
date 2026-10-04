import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reconcileChecks, TARGET } from "./s6-deployed-checks.mjs";

export function finalizeS6(baseline, run, stopped) {
  assert.equal(run.target, TARGET);
  assert.equal(run.cleanupComplete, true);
  assert.deepEqual(run.cleanupReadback, {
    credentials: 0,
    sessions: 0,
    activeAccounts: 0,
    queued: 0,
  });
  assert.equal(stopped.independentReadback.id.toLowerCase(), TARGET.toLowerCase());
  assert.equal(stopped.independentReadback.state, "Stopped");
  assert.equal(stopped.watchdog.status, "stopped");
  assert.equal(stopped.watchdog.independentlyVerified, true);
  assert.equal(stopped.watchdog.finishedBeforeDeadline, true);
  assert.ok(Date.parse(stopped.at) <= Date.parse(run.deadline));
  assert.ok(Date.parse(stopped.at) >= Math.max(...run.records.map((x) => Date.parse(x.at))));
  const result = reconcileChecks(baseline, run.records, [], true);
  return {
    ...result,
    s6: result.verified ? "VERIFIED" : "BLOCKED",
    authMigrationVerified: result.verified ? 15 : 14,
    authMigrationTotal: 20,
    target: TARGET,
    independentStoppedAt: stopped.at,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baselinePath, runPath, stoppedPath, outputPath] = process.argv.slice(2);
  const result = finalizeS6(
    JSON.parse(readFileSync(baselinePath, "utf8")),
    JSON.parse(readFileSync(runPath, "utf8")),
    JSON.parse(readFileSync(stoppedPath, "utf8")),
  );
  writeFileSync(outputPath, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({ s6: result.s6, pass: result.rows.filter((x) => x.status === "PASS").length }),
  );
  if (!result.verified) process.exitCode = 2;
}
