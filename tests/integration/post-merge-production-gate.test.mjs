import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("final main combines Azure runtime, Cloudflare edge, exact-SHA CI, and security boundaries", () => {
  const workflow = read(".github/workflows/final-release-ci.yml");
  const vite = read("vite.config.ts");
  const production = read("infra/azure/production/main.bicep");
  const boundedJson = read("src/lib/bounded-json.server.mjs");
  const confirmation = read("src/routes/api/chat/confirm.ts");
  const tokenBoundary = read(
    "supabase/migrations/20260802003000_google_oauth_tokens_server_only.sql",
  );

  assert.match(workflow, /^on:\n  workflow_dispatch:/mu);
  assert.match(workflow, /release_sha must be an exact lowercase 40-character commit SHA/u);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$KOVA_EXPECTED_RELEASE_SHA"/u);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/mu);
  assert.doesNotMatch(
    workflow,
    /(?:az\s+(?:containerapp|deployment)\b|wrangler\s+deploy\b|docker\s+push\b)/iu,
  );

  assert.match(vite, /preset:\s*"node-server"/u);
  assert.doesNotMatch(vite, /cloudflare-module|wrangler/u);
  assert.match(production, /ipSecurityRestrictions/u);
  assert.match(production, /Microsoft\.App\/jobs@2025-01-01/u);
  assert.match(production, /gpt-5\.6-sol/u);

  assert.match(boundedJson, /new TextDecoder\("utf-8", \{ fatal: true \}\)/u);
  assert.match(confirmation, /readBoundedJsonObject\(request, 8 \* 1024\)/u);
  assert.match(tokenBoundary, /REVOKE ALL PRIVILEGES ON TABLE public\.google_oauth_tokens/u);
});
