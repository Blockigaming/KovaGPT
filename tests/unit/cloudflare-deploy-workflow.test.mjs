import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("production Cloudflare workflow is manual and validation-only", () => {
  const workflow = read("../../.github/workflows/deploy-cloudflare-production.yml");

  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
  assert.match(workflow, /inputs\.confirmation == 'VALIDATE'/u);
  assert.match(workflow, /validate-only:/u);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /node --test tests\/unit\/cloudflare-deploy-workflow\.test\.mjs/u);
  assert.match(workflow, /Azure Container Apps remains the application origin/u);

  for (const forbidden of [
    /CLOUDFLARE_API_TOKEN/u,
    /CLOUDFLARE_ACCOUNT_ID/u,
    /KOVA_CLOUDFLARE_WORKER_NAME/u,
    /VITE_SUPABASE_/u,
    /npm run build/u,
    /production-worker-artifact/u,
    /wrangler deploy/u,
    /cloudflare\/wrangler-action@/u,
    /smoke:deployment/u,
    /id-token:\s*write/u,
  ]) {
    assert.doesNotMatch(workflow, forbidden);
  }
});

test("documentation preserves the Azure application and Cloudflare edge boundary", () => {
  const documentation = read("../../docs/cloudflare-production-deploy.md");

  assert.match(documentation, /Azure Container Apps/u);
  assert.match(documentation, /validation-only/u);
  assert.match(documentation, /does not build or deploy/u);
  assert.match(documentation, /does not create or change DNS/u);
  assert.match(documentation, /live Cloudflare zone/u);
  assert.match(documentation, /owner-required/u);
});
