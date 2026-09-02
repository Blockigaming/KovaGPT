import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const browserJob = workflow.slice(
  workflow.indexOf("\n  browser:"),
  workflow.indexOf("\n  release-e2e:"),
);
const releaseJob = workflow.slice(
  workflow.indexOf("\n  release-e2e:"),
  workflow.indexOf("\n  e2e-report:"),
);

test("each browser group runs on a fresh runner without reducing coverage", () => {
  assert.match(
    workflow,
    /browser:\n(?:    if: [^\n]+\n)?    name: Browser \(\$\{\{ matrix\.id \}\}\)/,
  );
  assert.match(workflow, /needs: verify/);
  assert.match(workflow, /fail-fast: false/);

  const singleRunProjects = [
    "phone-320x700",
    "phone-375x812",
    "phone-390x844",
    "phone-412x915",
    "phone-430x932",
    "tablet-768x1024",
    "phone-landscape-844x390",
    "tablet-1024x768",
    "desktop-1280x800",
    "desktop-1728x1117",
  ];
  for (const project of singleRunProjects) {
    assert.equal(
      browserJob.match(new RegExp(`--project=${project}`, "g"))?.length,
      1,
      `${project} must appear exactly once`,
    );
  }

  assert.equal(
    browserJob.match(/--project=desktop-1440x900/g)?.length,
    2,
    "desktop-1440x900 must be split across two fresh runners",
  );
  assert.match(workflow, /id: desktop-1440-a[\s\S]*?shard: 1\/2/);
  assert.match(workflow, /id: desktop-1440-b[\s\S]*?shard: 2\/2/);
  assert.match(
    workflow,
    /npm run test:e2e -- \$\{\{ matrix\.projects \}\} --shard=\$\{\{ matrix\.shard \}\}/,
  );
  assert.match(workflow, /name: playwright-artifacts-\$\{\{ matrix\.id \}\}/);
  assert.match(releaseJob, /KOVA_BROWSER_PREVIEW: "node"/);
  assert.match(
    releaseJob,
    /--project=desktop-1440x900 --shard=\$\{\{ matrix\.shard \}\}\/3 --reporter=blob/,
  );
});

test("full browser gates stay opt-in for pull requests", () => {
  assert.match(
    workflow,
    /types: \[opened, reopened, synchronize, ready_for_review, labeled\]/,
  );

  for (const job of [browserJob, releaseJob]) {
    assert.match(job, /github\.event_name == 'push'/);
    assert.match(job, /github\.event_name == 'workflow_dispatch'/);
    assert.match(
      job,
      /contains\(github\.event\.pull_request\.labels\.\*\.name, 'run-full-e2e'\)/,
    );
  }
});

test("third-party CI actions are pinned to immutable revisions", () => {
  for (const line of workflow.split("\n").filter((line) => line.includes("uses: actions/"))) {
    assert.match(line, /actions\/[a-z-]+@[a-f0-9]{40}(?:\s+# v\d+)?$/);
  }
});
