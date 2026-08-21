import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/release/local-non-actions-gate.mjs", "utf8");

test("the consolidated local gate covers the complete source/build suite without GitHub Actions", () => {
  for (const command of [
    "format:check",
    "lint",
    "typecheck",
    "test:unit",
    "test:api",
    "test:integration",
    "test:release",
    "test:a11y",
    "test:visual",
    "release:auth-provider",
    "release:security",
    "release:ui-truthfulness",
    "release:visible-controls",
    "release:zero-lovable:strict",
    "release:migrations",
    "release:migration-preflight",
    "release:rls:two-user:dry",
    "release:stripe:contract",
    "release:ai-provider-contract",
    "azure:validate",
    "azure:staging:validate",
    "build",
  ]) {
    assert.ok(source.includes(command), `local gate must include ${command}`);
  }
  assert.doesNotMatch(source, /gh\s+workflow|workflow_dispatch|actions\/runs|repository_dispatch/u);
  assert.match(source, /LOCAL_NON_ACTIONS_GATE=FAIL/u);
  assert.match(source, /KOVA_LOCAL_NON_ACTIONS_GATE=PASS/u);
});
