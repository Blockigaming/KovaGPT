import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/azure-container-ci.yml", "utf8");

test("Azure readiness blocks new formatting drift but only audits legacy debt", () => {
  const changedGate = workflow.indexOf("name: Formatting changed files");
  const legacyAudit = workflow.indexOf("name: Legacy repository formatting audit");
  const lint = workflow.indexOf("name: Lint");

  assert.ok(changedGate >= 0 && legacyAudit > changedGate && lint > legacyAudit);
  assert.match(workflow, /name: Formatting changed files\s+run: npm run format:check:changed/su);
  assert.match(
    workflow,
    /name: Legacy repository formatting audit\s+continue-on-error: true\s+run: npm run format:check/su,
  );
});

test("Azure readiness keeps every functional validation stage", () => {
  for (const required of [
    "npm run lint",
    "npm run typecheck",
    "npm run test:unit",
    "npm run azure:validate",
    "KOVA_BROWSER_PREVIEW=node npm run build",
    "npm run container:build",
    "docker run -d --name kovagpt-web-ci",
    "npm run container:smoke",
  ]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(
    workflow,
    /name: Container shutdown\s+if: always\(\)\s+run: docker rm -f kovagpt-web-ci \|\| true/su,
  );
  assert.match(workflow, /AI_GENERATION_ENABLED: "false"/u);
  assert.match(workflow, /-e AI_GENERATION_ENABLED=false/u);
});

test("Azure readiness actions are immutable and permissions are read-only", () => {
  assert.match(workflow, /permissions:\s+contents: read/su);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+(?:\.\d+){0,2}\b/u);
  for (const reference of workflow.matchAll(/uses:\s+[^\s]+@([^\s#]+)/gu)) {
    assert.match(reference[1], /^[0-9a-f]{40}$/u);
  }
});
