import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL(
    "../../.github/workflows/deploy-cloudflare-production.yml",
    import.meta.url,
  ),
  "utf8",
);

test("production build validates browser-safe Supabase values without exposing secrets", () => {
  const buildStart = workflow.indexOf(
    "- name: Build the Nitro Cloudflare module",
  );
  const validationStart = workflow.indexOf(
    "- name: Validate the generated Worker artifact",
    buildStart,
  );
  assert.ok(buildStart >= 0 && validationStart > buildStart);

  const buildBlock = workflow.slice(buildStart, validationStart);
  assert.match(
    buildBlock,
    /VITE_SUPABASE_URL: \$\{\{ vars\.VITE_SUPABASE_URL \}\}/,
  );
  assert.match(
    buildBlock,
    /VITE_SUPABASE_PUBLISHABLE_KEY: \$\{\{ vars\.VITE_SUPABASE_PUBLISHABLE_KEY \}\}/,
  );
  assert.doesNotMatch(buildBlock, /secrets\.VITE_SUPABASE/);

  const validator = buildBlock.indexOf(
    "node scripts/validate-public-build-env.mjs",
  );
  const build = buildBlock.indexOf("npm run build");
  assert.ok(
    validator >= 0 && build > validator,
    "public configuration must be validated first",
  );
});

test("public build values cannot leak into job or deploy scope", () => {
  const jobScope = workflow.slice(
    workflow.indexOf("jobs:"),
    workflow.indexOf("steps:"),
  );
  const deployBlock = workflow.slice(
    workflow.indexOf("- name: Deploy the generated Worker with Wrangler"),
  );
  assert.doesNotMatch(jobScope, /VITE_SUPABASE/);
  assert.doesNotMatch(deployBlock, /VITE_SUPABASE/);
  assert.doesNotMatch(workflow, /set -x/);
});

test("manual protected deployment gates and generated artifact remain unchanged", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(
    workflow,
    /if: inputs\.confirmation == 'DEPLOY' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(workflow, /environment:\n      name: production/);
  assert.match(workflow, /--config dist\/server\/wrangler\.json/);
  assert.match(workflow, /--keep-vars/);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
});
