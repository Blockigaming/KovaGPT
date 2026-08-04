import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("CI contains all release gates and immutable actions", async () => {
  const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  for (const gate of [
    "typecheck",
    "lint",
    "build",
    "test:unit",
    "test:integration",
    "test:api",
    "test:a11y",
    "test:visual",
    "test:browser",
    "test:e2e",
    "release:migrations",
    "release:bundle",
    "release:security",
    "npm audit",
    "git diff --check",
  ])
    assert.match(ci, new RegExp(gate.replaceAll(":", "\\:")));
  assert.doesNotMatch(ci, /uses:\s+[^\n]+@v\d/);
});
test("smoke defaults to dry-run and never performs paid actions", async () => {
  const s = await readFile(new URL("../../scripts/release/smoke.mjs", import.meta.url), "utf8");
  assert.match(s, /SAFE DRY RUN/);
  assert.match(s, /KOVA_STAGING_SMOKE\s*===\s*["']1["']/);
  assert.doesNotMatch(s, /\/api\/(?:checkout|chat|agents\/runs|scheduled-tasks)/i);
});
