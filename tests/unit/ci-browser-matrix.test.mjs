import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("each browser group runs on a fresh runner without reducing coverage", () => {
  assert.match(workflow, /browser:\n    name: Browser \(\$\{\{ matrix\.id \}\}\)/);
  assert.match(workflow, /needs: verify/);
  assert.match(workflow, /fail-fast: false/);

  const groups = [
    ["phone-320x700", "phone-375x812", "phone-390x844", "phone-412x915", "phone-430x932"],
    ["tablet-768x1024", "phone-landscape-844x390", "tablet-1024x768"],
    ["desktop-1280x800"],
    ["desktop-1440x900"],
    ["desktop-1728x1117"],
  ];
  for (const projects of groups) {
    for (const project of projects) {
      assert.equal(
        workflow.match(new RegExp(`--project=${project}`, "g"))?.length,
        1,
        `${project} must appear exactly once`,
      );
    }
  }

  assert.match(workflow, /npm run test:e2e -- \$\{\{ matrix\.projects \}\}/);
  assert.match(workflow, /name: playwright-artifacts-\$\{\{ matrix\.id \}\}/);
});

test("third-party CI actions are pinned to immutable revisions", () => {
  for (const line of workflow.split("\n").filter((line) => line.includes("uses: actions/"))) {
    assert.match(line, /actions\/[a-z-]+@[a-f0-9]{40}(?:\s+# v\d+)?$/);
  }
});
