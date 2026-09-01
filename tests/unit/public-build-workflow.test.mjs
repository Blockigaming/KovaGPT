import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-cloudflare-production.yml", import.meta.url),
  "utf8",
);

test("Cloudflare production validation cannot consume browser build values or deploy the app", () => {
  assert.match(workflow, /validate-only:/u);
  assert.match(workflow, /permissions:\n  contents: read/u);

  for (const forbidden of [
    /VITE_SUPABASE/u,
    /npm run build/u,
    /wrangler deploy/u,
    /cloudflare\/wrangler-action@/u,
    /dist\/server\/wrangler\.json/u,
    /smoke:deployment/u,
    /environment:\n\s+name: production/u,
    /id-token:\s*write/u,
  ]) {
    assert.doesNotMatch(workflow, forbidden);
  }
});

test("manual Cloudflare validation gate remains non-deploying and main-only", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(
    workflow,
    /if: inputs\.confirmation == 'VALIDATE' && github\.ref == 'refs\/heads\/main'/u,
  );
  assert.match(workflow, /node --test tests\/unit\/cloudflare-deploy-workflow\.test\.mjs/u);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
});
