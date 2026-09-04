import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const supabaseClient = await readFile("src/integrations/supabase/client.ts", "utf8");
const supabaseBrowserConfig = await readFile("src/integrations/supabase/config.ts", "utf8");
const supabaseAdminClient = await readFile("src/integrations/supabase/client.server.ts", "utf8");
const clerkSafe = await readFile("src/components/auth/ClerkSafe.tsx", "utf8");
const authMiddleware = await readFile("src/integrations/supabase/auth-middleware.ts", "utf8");
const rootRoute = await readFile("src/routes/__root.tsx", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = await readFile("package.json", "utf8");
const changedFormat = await readFile("scripts/check-format-changed.mjs", "utf8");

test("Supabase browser config is feature-scoped and cannot crash public boot", () => {
  assert.match(supabaseClient, /getSupabaseClientConfigStatus/);
  assert.match(supabaseClient, /SUPABASE_BROWSER_CONFIG/);
  assert.doesNotMatch(supabaseClient, /process\.env/);
  assert.match(supabaseBrowserConfig, /Object\.freeze/);
  assert.match(supabaseBrowserConfig, /VITE_SUPABASE_URL/);
  assert.match(supabaseBrowserConfig, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(supabaseBrowserConfig, /VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(supabaseBrowserConfig, /process\.env/);
  assert.match(supabaseAdminClient, /process\.env\.SUPABASE_URL/);
  assert.match(supabaseAdminClient, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(clerkSafe, /Supabase auth unavailable/);
  assert.match(clerkSafe, /setIsLoaded\(true\)/);
  assert.match(clerkSafe, /getSupabaseClientConfigStatus/);
});

test("anonymous server functions fail closed before reading Supabase configuration", () => {
  const credentialCheck = authMiddleware.indexOf('request.headers.get("authorization")');
  const configurationRead = authMiddleware.indexOf("process.env.SUPABASE_URL");
  assert.ok(credentialCheck >= 0);
  assert.ok(configurationRead > credentialCheck);
  assert.match(authMiddleware, /failAuthentication\(401, "Unauthorized"\)/);
  assert.match(authMiddleware, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(authMiddleware, /Missing Supabase environment variable\(s\)/);
});

test("root route has a safe branded error boundary with retry and home actions", () => {
  assert.match(rootRoute, /KovaGPT couldn't load this page/);
  assert.match(rootRoute, /Retry/);
  assert.match(rootRoute, /Return home/);
  assert.match(rootRoute, /contact support and describe what you were doing/);
  assert.doesNotMatch(rootRoute, /correlationId|randomUUID|error\.stack/);
  assert.doesNotMatch(rootRoute, /console\.error/);
  assert.doesNotMatch(rootRoute, /diagnostic details server-side|while we log/i);
});

test("CI blocks changed-file and repository-wide formatting", () => {
  assert.match(packageJson, /format:check:changed/);
  assert.match(changedFormat, /git/);
  assert.match(changedFormat, /prettier/);
  assert.match(workflow, /Formatting changed files/);
  assert.match(workflow, /Repository formatting audit/);
  assert.doesNotMatch(
    workflow,
    /name: Repository formatting audit[\s\S]{0,120}continue-on-error:\s*true/,
  );
  assert.match(workflow, /Production build/);
});
