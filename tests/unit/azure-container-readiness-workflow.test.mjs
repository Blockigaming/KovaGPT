import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/azure-container-ci.yml", "utf8");

test("Azure readiness uses authoritative changed-file formatting and immutable actions", () => {
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.match(
    workflow,
    /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u,
  );
  assert.match(
    workflow,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/u,
  );
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node)@v\d+/u);
  assert.match(
    workflow,
    /- name: Formatting changed files\n\s+run: npm run format:check:changed/u,
  );
  assert.match(
    workflow,
    /- name: Legacy repository formatting audit\n\s+continue-on-error: true\n\s+run: npm run format:check/u,
  );
});

test("Azure readiness preserves every source, image, startup, and health gate", () => {
  for (const step of [
    "Lint",
    "TypeScript typecheck",
    "Unit tests",
    "Azure readiness validation",
    "Production build",
    "Docker image build",
    "Container startup",
    "Health smoke test",
    "Container shutdown",
  ]) {
    assert.match(workflow, new RegExp(`- name: ${step.replaceAll(" ", "\\s")}`, "u"));
  }

  assert.match(workflow, /run: npm run azure:validate/u);
  assert.match(workflow, /run: npm run container:build/u);
  assert.match(workflow, /curl -fsS http:\/\/127\.0\.0\.1:3000\/api\/health/u);
  assert.match(workflow, /run: npm run container:smoke/u);
  assert.match(
    workflow,
    /- name: Container shutdown\n\s+if: always\(\)\n\s+run: docker rm -f kovagpt-web-ci \|\| true/u,
  );
});
