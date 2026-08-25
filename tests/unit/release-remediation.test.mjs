import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("deployment identity is exact, no-store, and verified by the local Azure release path", () => {
  const route = readFileSync("src/routes/api/version.ts", "utf8");
  const deploy = readFileSync("scripts/azure/deploy-production-local.sh", "utf8");
  const smoke = readFileSync("scripts/release/production-system-verifier.mjs", "utf8");
  assert.match(route, /X-Kova-Build/u);
  assert.match(route, /no-store/u);
  assert.match(deploy, /git rev-parse HEAD/u);
  assert.match(deploy, /@sha256:/u);
  assert.match(smoke, /expectedSha/u);
  assert.equal(existsSync(".github/workflows/deploy-cloudflare-production.yml"), false);
});
