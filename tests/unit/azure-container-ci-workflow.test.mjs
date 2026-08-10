import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/azure-container-ci.yml", "utf8");

test("Azure readiness blocks new formatting drift but only audits legacy debt", () => {
  const changedGate = workflow.indexOf("name: Formatting changed files");
  const legacyAudit = workflow.indexOf("name: Legacy repository formatting audit");
  const lint = workflow.indexOf("name: Lint");

  assert.ok(changedGate >= 0 && legacyAudit > changedGate && lint > legacyAudit);
  assert.match(
    workflow,
    /name: Formatting changed files\s+id: changed-format\s+continue-on-error: true\s+run: npm run format:check:changed/su,
  );
  assert.match(
    workflow,
    /name: Legacy repository formatting audit\s+continue-on-error: true\s+run: npm run format:check/su,
  );
});

test("Azure readiness executes independent checks before one final blocking verdict", () => {
  for (const [id, command] of [
    ["lint", "npm run lint"],
    ["typecheck", "npm run typecheck"],
    ["unit-tests", "npm run test:unit"],
    ["azure-validation", "npm run azure:validate"],
    ["production-build", "KOVA_BROWSER_PREVIEW=node npm run build"],
  ]) {
    assert.match(
      workflow,
      new RegExp(
        `id: ${id}\\s+continue-on-error: true\\s+run: ${command.replace(
          /[.*+?^${}()|[\]\\]/gu,
          "\\$&",
        )}`,
        "su",
      ),
    );
  }

  assert.match(
    workflow,
    /name: Docker image build\s+id: image-build\s+if: \$\{\{ always\(\) && steps\.production-build\.outcome == 'success' \}\}/su,
  );
  assert.match(
    workflow,
    /name: Container startup\s+id: container-startup\s+if: \$\{\{ always\(\) && steps\.image-build\.outcome == 'success' \}\}/su,
  );
  assert.match(
    workflow,
    /name: Health smoke test\s+id: health-smoke\s+if: \$\{\{ always\(\) && steps\.container-startup\.outcome == 'success' \}\}/su,
  );
});

test("Azure readiness preserves container validation, cleanup, and generation-off defaults", () => {
  for (const required of [
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

test("final verdict exposes every outcome and fails closed on failure or skip", () => {
  assert.match(workflow, /name: Azure readiness verdict\s+if: always\(\)/su);
  for (const outcome of [
    "CHANGED_FORMAT",
    "LINT",
    "TYPECHECK",
    "UNIT_TESTS",
    "AZURE_VALIDATION",
    "PRODUCTION_BUILD",
    "IMAGE_BUILD",
    "CONTAINER_STARTUP",
    "HEALTH_SMOKE",
  ]) {
    assert.match(workflow, new RegExp(`${outcome}: \\$\\{\\{ steps\\.`, "u"));
    assert.match(workflow, new RegExp(`\\n            ${outcome}(?: \\\\)?\\n`, "u"));
  }
  assert.match(workflow, /if \[ "\$outcome" != "success" \]; then/su);
  assert.match(workflow, /AZURE_CONTAINER_READINESS=failed/su);
  assert.match(workflow, /AZURE_CONTAINER_READINESS=passed/su);
});

test("Azure readiness actions are immutable and permissions are read-only", () => {
  assert.match(workflow, /permissions:\s+contents: read/su);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d+(?:\.\d+){0,2}\b/u);
  for (const reference of workflow.matchAll(/uses:\s+[^\s]+@([^\s#]+)/gu)) {
    assert.match(reference[1], /^[0-9a-f]{40}$/u);
  }
});
