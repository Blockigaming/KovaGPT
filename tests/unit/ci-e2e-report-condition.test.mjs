import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const reportJob = workflow.match(/\n  e2e-report:\n([\s\S]*?)\n  isolated-database:/u)?.[1] ?? "";
const releaseJob = workflow.match(/\n  release-e2e:\n([\s\S]*?)\n  e2e-report:/u)?.[1] ?? "";

function shouldAggregate(result) {
  return result === "success" || result === "failure";
}

test("Playwright report aggregation runs only when release shards actually ran", () => {
  assert.ok(reportJob, "e2e-report job must exist");
  assert.match(
    reportJob,
    /if: \$\{\{ always\(\) && \(needs\.release-e2e\.result == 'success' \|\| needs\.release-e2e\.result == 'failure'\) \}\}/u,
  );
  assert.equal(shouldAggregate("success"), true);
  assert.equal(shouldAggregate("failure"), true);
  assert.equal(shouldAggregate("skipped"), false);
  assert.equal(shouldAggregate("cancelled"), false);
});

test("real release failures still upload shards and merge available reports", () => {
  assert.match(releaseJob, /if: always\(\)[\s\S]*name: e2e-blob-\$\{\{ matrix\.shard \}\}/u);
  assert.match(releaseJob, /if-no-files-found: error/u);
  assert.match(reportJob, /needs: release-e2e/u);
  assert.match(reportJob, /pattern: e2e-blob-\*/u);
  assert.match(reportJob, /playwright merge-reports --reporter=html \.\/blob-reports/u);
  assert.match(reportJob, /name: merged-playwright-report/u);
});

test("CI actions remain pinned to immutable revisions", () => {
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+(?:\.\d+){0,2}\b/u);
  for (const reference of workflow.matchAll(/uses:\s+[^\s]+@([^\s#]+)/gu)) {
    assert.match(reference[1], /^[0-9a-f]{40}$/u);
  }
});
