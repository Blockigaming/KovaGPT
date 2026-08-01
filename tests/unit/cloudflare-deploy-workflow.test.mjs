import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("production deployment is manual, protected, and uses the generated Nitro artifact", () => {
  const workflow = read("../../.github/workflows/deploy-cloudflare-production.yml");

  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
  assert.match(workflow, /if: inputs\.confirmation == 'DEPLOY'/);
  assert.match(workflow, /environment:\n      name: production/);
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /vars\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /vars\.KOVA_CLOUDFLARE_WORKER_NAME/);
  assert.doesNotMatch(workflow, /set -x/);
  assert.doesNotMatch(workflow, /^    env:\n      CLOUDFLARE_API_TOKEN:/m);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);

  assert.match(workflow, /npm run build/);
  assert.match(workflow, /tests\/integration\/production-worker-artifact\.test\.mjs/);
  assert.match(workflow, /npx --no-install wrangler deploy/);
  assert.match(workflow, /--config dist\/server\/wrangler\.json/);
  assert.match(workflow, /--keep-vars/);
  assert.doesNotMatch(workflow, /wrangler deploy[^\n]*wrangler\.jsonc/);
});

test("deployment documentation keeps Worker deployment separate from DNS cutover", () => {
  const documentation = read("../../docs/cloudflare-production-deploy.md");

  assert.match(documentation, /zero-Lovable-credit deployment path/);
  assert.match(documentation, /does not create or change DNS records/);
  assert.match(documentation, /KOVA_CLOUDFLARE_WORKER_NAME/);
  assert.match(documentation, /Deployment alone cannot bind `kovagpt\.com`/);
  assert.match(documentation, /workers\.dev/);
  assert.match(documentation, /GET \/api\/health/);
  assert.match(documentation, /There is no automatic deployment/);
});
