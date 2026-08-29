import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

test("final CI covers exact source, deployed production, full browsers, security, and fresh database once", () => {
  const workflowFiles = readdirSync(".github/workflows").filter((name) => {
    if (!/\.ya?ml$/u.test(name)) return false;
    const source = readFileSync(`.github/workflows/${name}`, "utf8");
    return /(?:^|\n)\s+workflow_dispatch\s*:/u.test(source);
  });
  assert.deepEqual(
    workflowFiles,
    ["final-release-ci.yml"],
    "only one manual exact-SHA workflow may remain",
  );
  const workflow = readFileSync(".github/workflows/final-release-ci.yml", "utf8");
  for (const proof of [
    "format:check",
    "typecheck",
    "test:unit",
    "test:api",
    "test:integration",
    "test:a11y",
    "test:visual",
    "release:db:isolated",
    "release:day16:source",
    "release:production:verify",
    "test:e2e:release:signed-out",
    "test:e2e:release:signed-in",
    "artifact-secret-scan",
    "KOVA_RELEASE_AUTH_STATE_B64",
    "KOVA_RUN_TOOL_SMOKE",
    "KOVA_READINESS_TOKEN",
    "KOVA_RUN_IMAGE_SMOKE",
    "KOVA_RUN_RESEARCH_SMOKE",
    "KOVA_RUN_GENERATION_SMOKE",
  ])
    assert.match(workflow, new RegExp(escapeRegExp(proof), "u"), proof);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/mu);
  assert.doesNotMatch(workflow, /az containerapp|wrangler deploy|git push/iu);
});
