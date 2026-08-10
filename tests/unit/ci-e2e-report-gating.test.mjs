import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

function jobBlock(jobName, nextJobName) {
  const startMarker = `  ${jobName}:\n`;
  const endMarker = `  ${nextJobName}:\n`;
  const start = workflow.indexOf(startMarker);
  const end = workflow.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `${jobName} job is missing`);
  assert.notEqual(end, -1, `${nextJobName} job is missing after ${jobName}`);
  return workflow.slice(start, end);
}

test("E2E report aggregation skips only when release shards never ran", () => {
  const reportJob = jobBlock("e2e-report", "isolated-database");

  assert.match(
    reportJob,
    /if: \$\{\{ always\(\) && needs\['release-e2e'\]\.result != 'skipped' && needs\['release-e2e'\]\.result != 'cancelled' \}\}/u,
  );
  assert.match(reportJob, /needs: release-e2e/u);
  assert.match(reportJob, /playwright merge-reports --reporter=html \.\/blob-reports/u);
  assert.doesNotMatch(reportJob, /continue-on-error:\s*true/u);
});

test("release shards keep fail-closed blob uploads for real test failures", () => {
  const releaseJob = jobBlock("release-e2e", "e2e-report");

  assert.match(releaseJob, /- if: always\(\)/u);
  assert.match(releaseJob, /name: e2e-blob-\$\{\{ matrix\.shard \}\}/u);
  assert.match(releaseJob, /if-no-files-found: error/u);
  assert.match(releaseJob, /--reporter=blob/u);
});
