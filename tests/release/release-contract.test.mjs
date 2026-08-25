import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("final CI contains exact-SHA production release gates and immutable actions", async () => {
  const ci = await readFile(
    new URL("../../.github/workflows/final-release-ci.yml", import.meta.url),
    "utf8",
  );

  const required = [
    "npm run format:check",
    "npm run lint",
    "npm run typecheck",
    "npm run test:unit",
    "npm run test:api",
    "npm run test:integration",
    "npm run test:a11y",
    "npm run test:visual",
    "npm run release:day16:source",
    "npm run release:db:isolated",
    "npm run build",
    "node scripts/release/artifact-secret-scan.mjs",
    "npm run release:production:verify",
    "npm run test:e2e:release:signed-out",
    "npm run test:e2e:release:signed-in",
  ];

  for (const value of required) {
    assert.ok(ci.includes(value), `final release workflow is missing: ${value}`);
  }

  assert.ok(ci.includes("workflow_dispatch:"));
  assert.ok(ci.includes("release_sha:"));
  assert.ok(ci.includes("Exact 40-character production release SHA"));

  assert.ok(
    ci.includes("ref: ${{ inputs.release_sha }}"),
    "final CI must check out the exact requested release SHA",
  );

  assert.ok(
    ci.includes('test "$(git rev-parse HEAD)" = "$KOVA_EXPECTED_RELEASE_SHA"'),
    "final CI must prove the exact checkout SHA",
  );

  assert.ok(
    ci.includes("npx playwright install --with-deps chromium firefox webkit"),
    "final CI must install Chromium, Firefox, and WebKit",
  );

  assert.ok(
    ci.includes("KOVA_RELEASE_AUTH_STATE_B64"),
    "final CI must consume protected signed-in browser state",
  );

  assert.ok(
    ci.includes("git diff --exit-code"),
    "final CI must prove the working tree remains clean",
  );

  assert.ok(
    ci.includes("git diff --cached --exit-code"),
    "final CI must prove the index remains clean",
  );

  assert.ok(ci.includes("Upload non-secret evidence"), "final CI must upload release evidence");

  assert.ok(
    ci.includes("path: artifacts/release/"),
    "release evidence must use the approved artifact path",
  );

  assert.doesNotMatch(
    ci,
    /uses:\s+[^\n]+@v\d/u,
    "GitHub actions must remain pinned by immutable SHA",
  );

  assert.doesNotMatch(
    ci,
    /wrangler\s+deploy|docker\s+push|az\s+containerapp\s+(?:create|update)/iu,
    "final verification CI must not deploy or mutate production",
  );
});

test("smoke defaults to dry-run and never performs paid actions", async () => {
  const smoke = await readFile(new URL("../../scripts/release/smoke.mjs", import.meta.url), "utf8");

  assert.match(smoke, /SAFE DRY RUN/u);
  assert.match(smoke, /KOVA_STAGING_SMOKE\s*===\s*["']1["']/u);

  assert.doesNotMatch(smoke, /\/api\/(?:checkout|chat|agents\/runs|scheduled-tasks)/iu);
});
