import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const migrationWrapper = readFileSync("scripts/release/supabase-db-push.mjs", "utf8");
const stagingWorkflow = readFileSync(".github/workflows/staging-rehearsal.yml", "utf8");
const mcpManifest = JSON.parse(readFileSync(".lovable/mcp/manifest.json", "utf8"));

test("remote migrations explicitly link the requested Supabase project before pushing", () => {
  assert.equal(packageJson.scripts["db:migrate"], "node scripts/release/supabase-db-push.mjs");
  assert.match(migrationWrapper, /SUPABASE_PROJECT_REF/);
  assert.match(migrationWrapper, /SUPABASE_ACCESS_TOKEN/);
  assert.match(migrationWrapper, /SUPABASE_DB_PASSWORD/);

  const link = migrationWrapper.indexOf('runSupabase(["link", "--project-ref", projectRef]);');
  const push = migrationWrapper.indexOf(
    'runSupabase(["db", "push", "--linked", ...forwardedArgs]);',
  );
  assert.ok(link >= 0 && push > link);
  assert.match(migrationWrapper, /argument === "--local"/);
  assert.match(migrationWrapper, /argument === "--include-seed"/);
  assert.match(migrationWrapper, /argument\.startsWith\("--db-url="\)/);
});

test("staging builds receive staging browser credentials before Vite runs", () => {
  const start = stagingWorkflow.indexOf("- name: Validate and build staging artifact");
  const end = stagingWorkflow.indexOf("- run: npm run test:unit", start);
  assert.ok(start >= 0 && end > start);
  const buildStep = stagingWorkflow.slice(start, end);

  assert.match(buildStep, /VITE_SUPABASE_URL: "\$\{\{ secrets\.STAGING_SUPABASE_URL \}\}"/);
  assert.match(
    buildStep,
    /VITE_SUPABASE_PUBLISHABLE_KEY: "\$\{\{ secrets\.STAGING_SUPABASE_PUBLISHABLE_KEY \}\}"/,
  );
  assert.match(buildStep, /export VITE_SUPABASE_PROJECT_ID="\$\{BASH_REMATCH\[1\]\}"/);
  assert.match(buildStep, /npm run build/);
});

test("the checked-in MCP OAuth issuer follows the production Supabase project", () => {
  assert.equal(mcpManifest.auth.issuer, "https://mfbycmbjygcfkrsuepxf.supabase.co/auth/v1");
  assert.doesNotMatch(JSON.stringify(mcpManifest), /zrzwkqrwurgutrmvalri/);
});
