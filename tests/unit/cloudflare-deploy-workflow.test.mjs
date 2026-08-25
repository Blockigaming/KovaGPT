import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Cloudflare is verification-only and cannot deploy KovaGPT runtime", () => {
  assert.equal(existsSync(".github/workflows/deploy-cloudflare-production.yml"), false);
  assert.equal(existsSync("wrangler.jsonc"), false);
  const verifier = readFileSync("scripts/cloudflare/verify-edge-only.mjs", "utf8");
  assert.match(verifier, /proxied CNAME/u);
  assert.match(verifier, /Azure origin allowlist/u);
  assert.doesNotMatch(verifier, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/u);
});
