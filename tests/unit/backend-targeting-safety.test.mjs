import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const migrationWrapper = readFileSync("scripts/release/supabase-db-push.mjs", "utf8");
const stagingWorkflow = readFileSync(".github/workflows/staging-rehearsal.yml", "utf8");
const releaseRunbook = readFileSync("docs/RELEASE_RUNBOOK.md", "utf8");
const oauthDiscoveryRoute = readFileSync(
  "src/routes/[.well-known]/oauth-protected-resource.ts",
  "utf8",
);
const oauthConsent = readFileSync("src/routes/oauth.consent.tsx", "utf8");

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
  assert.match(migrationWrapper, /argument\.startsWith\("--local="\)/);
  assert.match(migrationWrapper, /argument === "--include-seed"/);
  assert.match(migrationWrapper, /argument\.startsWith\("--include-seed="\)/);
  assert.match(migrationWrapper, /argument\.startsWith\("--db-url="\)/);
  assert.match(migrationWrapper, /argument === "--workdir"/);
  assert.match(migrationWrapper, /argument\.startsWith\("--workdir="\)/);
});

test("remote migrations use the package-local Supabase CLI entrypoint", () => {
  assert.match(migrationWrapper, /node_modules", "supabase", "dist", "supabase\.js"/);
  assert.match(migrationWrapper, /spawnSync\(process\.execPath, \[entrypoint, \.\.\.args\]/);
  assert.doesNotMatch(migrationWrapper, /supabase\.cmd/);
  assert.doesNotMatch(migrationWrapper, /npx/);
});

test("the release runbook documents every guarded remote migration input", () => {
  assert.match(releaseRunbook, /SUPABASE_PROJECT_REF/);
  assert.match(releaseRunbook, /SUPABASE_ACCESS_TOKEN/);
  assert.match(releaseRunbook, /SUPABASE_DB_PASSWORD/);
  assert.match(releaseRunbook, /SUPABASE_PROJECT_REF=<exact-project-ref> npm run db:migrate/);
});

test("staging builds receive and validate staging browser credentials before Vite runs", () => {
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
  const validation = buildStep.indexOf("node scripts/validate-public-build-env.mjs");
  const build = buildStep.indexOf("npm run build");
  assert.ok(validation >= 0 && build > validation);
});

test("OAuth discovery uses the configured issuer and stays unavailable until explicitly enabled", () => {
  assert.match(oauthDiscoveryRoute, /mcpOAuthMetadata\(true\)/);
  const runtime = readFileSync("src/lib/pricing/mcp-oauth.server.ts", "utf8");
  assert.match(runtime, /KOVA_MCP_ISSUER/);
  assert.match(runtime, /KOVA_MCP_OAUTH_ENABLED/);
  assert.match(runtime, /external_connection_unavailable/);
  assert.match(runtime, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(oauthDiscoveryRoute, /resolveBackendUrl/);
});

test("OAuth consent is Kova-owned and no checked-in Lovable MCP manifest is required", () => {
  assert.match(oauthConsent, /createFileRoute\("\/oauth\/consent"\)/);
  assert.match(oauthConsent, /getAuthorizationDetails/);
  assert.match(oauthConsent, /approveAuthorization/);
  assert.match(oauthConsent, /denyAuthorization/);
  assert.doesNotMatch(oauthConsent, /lovable\.dev|lovable\.app|LOVABLE_API_KEY/iu);
});
