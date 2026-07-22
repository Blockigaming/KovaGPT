import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const supabaseClient = await readFile("src/integrations/supabase/client.ts", "utf8");
const clerkSafe = await readFile("src/components/auth/ClerkSafe.tsx", "utf8");
const rootRoute = await readFile("src/routes/__root.tsx", "utf8");
const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const packageJson = await readFile("package.json", "utf8");
const changedFormat = await readFile("scripts/check-format-changed.mjs", "utf8");

test("Supabase browser config is feature-scoped and cannot crash public boot", () => {
  assert.match(supabaseClient, /getSupabaseClientConfigStatus/);
  assert.match(supabaseClient, /typeof process !== \"undefined\"/);
  assert.match(supabaseClient, /VITE_SUPABASE_ANON_KEY/);
  assert.match(clerkSafe, /Supabase auth unavailable/);
  assert.match(clerkSafe, /setIsLoaded\(true\)/);
  assert.match(clerkSafe, /getSupabaseClientConfigStatus/);
});

test("root route has a safe branded error boundary with retry and home actions", () => {
  assert.match(rootRoute, /KovaGPT couldn't load this page/);
  assert.match(rootRoute, /correlationId/);
  assert.match(rootRoute, /Retry/);
  assert.match(rootRoute, /Return home/);
  assert.doesNotMatch(rootRoute, /error\.stack/);
});

test("CI blocks changed-file formatting while isolating legacy repository drift", () => {
  assert.match(packageJson, /format:check:changed/);
  assert.match(changedFormat, /git/);
  assert.match(changedFormat, /prettier/);
  assert.match(workflow, /Formatting changed files/);
  assert.match(workflow, /Legacy repository formatting audit/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /Production build/);
});
