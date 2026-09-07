import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

async function readOptional(path, context) {
  try {
    return await read(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      context.skip(`sparse local audit checkout does not contain ${path}`);
      return null;
    }
    throw error;
  }
}

test("both server auth boundaries revalidate the user and enforce MFA before privileged access", async () => {
  const [apiAuth, middleware] = await Promise.all([
    read("src/lib/api-auth.server.ts"),
    read("src/integrations/supabase/auth-middleware.ts"),
  ]);
  for (const source of [apiAuth, middleware]) {
    assert.match(source, /auth\.getUser\(token\)/);
    assert.match(source, /auth\.getClaims\(token\)/);
    assert.match(source, /evaluateAuthenticatedUser/);
    assert.match(source, /mfa_required/);
  }
  const authoritativeUserCheck = apiAuth.indexOf("verifier.auth.getUser(token)");
  const privilegedClient = apiAuth.indexOf("const supabaseAdmin = createClient<Database>");
  assert.ok(authoritativeUserCheck >= 0);
  assert.ok(privilegedClient > authoritativeUserCheck);
  assert.doesNotMatch(middleware, /Missing Supabase environment variable\(s\).*throw new Error/s);
  assert.ok(
    middleware.indexOf("parseBearerToken(authHeader)") <
      middleware.indexOf("process.env.SUPABASE_URL"),
  );
});

test("browser auth gates aal1 sessions and keeps normal sign-out device-local", async () => {
  const [provider, challenge, panel] = await Promise.all([
    read("src/components/auth/ClerkSafe.tsx"),
    read("src/components/auth/MfaChallengeDialog.tsx"),
    read("src/components/MfaPanel.tsx"),
  ]);
  assert.match(provider, /getAuthenticatorAssuranceLevel\(\s*candidate\.access_token/);
  assert.match(provider, /nextLevel === "aal2"/);
  assert.match(provider, /setPendingMfaSession\(candidate\)/);
  assert.match(provider, /signOut\(\{ scope: "local" \}\)/);
  assert.match(challenge, /challengeAndVerify/);
  assert.match(challenge, /\^\\d\{6\}\$/);
  assert.match(challenge, /expires_at: Math\.round\(Date\.now\(\) \/ 1000\) \+ data\.expires_in/);
  assert.doesNotMatch(challenge, /data\.session/);
  assert.match(panel, /signOut\(\{ scope: "others" \}\)/);
});

test("passkey sign-in and credential management stay deployment-gated and WebAuthn-backed", async () => {
  const [client, providers, support, dialog, panel] = await Promise.all([
    read("src/integrations/supabase/client.ts"),
    read("src/lib/auth-providers.ts"),
    read("src/lib/passkey-support.ts"),
    read("src/components/auth/AuthDialog.tsx"),
    read("src/components/PasskeyPanel.tsx"),
  ]);
  assert.match(client, /experimental: \{ passkey: true \}/);
  assert.match(providers, /passkeys_enabled/);
  assert.match(providers, /passkeys: bool\(data\.passkeys_enabled\)/);
  assert.match(providers, /bool\(data\.passkey_enabled\)/);
  assert.match(support, /typeof navigator\.credentials\?\.create === "function"/);
  assert.match(support, /typeof navigator\.credentials\?\.get === "function"/);
  assert.match(dialog, /providers\.resolved[\s\S]*providers\.passkeys/);
  assert.match(dialog, /auth\.signInWithPasskey\(\)/);
  assert.match(dialog, /browserSupportsPasskeys\(\)/);
  assert.match(panel, /auth\.registerPasskey\(\)/);
  assert.match(panel, /auth\.passkey\.list\(\)/);
  assert.match(panel, /auth\.passkey\.update\(/);
  assert.match(panel, /auth\.passkey\.delete\(/);
  assert.match(panel, /providers\.resolved && providers\.passkeys/);
  assert.match(panel, /const canLoad = enabled;/);
  assert.doesNotMatch(panel, /const canLoad = enabled && supported/);
  assert.match(panel, /you can still review, rename, or remove registered/);
  assert.match(panel, /disabled=\{Boolean\(busy\) \|\| !supported\}/);
  assert.match(panel, /const mutationInFlight = useRef\(false\)/);
  assert.match(panel, /if \(mutationInFlight\.current\) return false/);
  assert.match(panel, /if \(!beginMutation\(editing\.id\)\) return/);
  assert.match(panel, /if \(!beginMutation\(id\)\) return/);
  assert.doesNotMatch(panel, /disabled=\{itemBusy \|\| !editing\.name\.trim\(\)\}/);
  assert.doesNotMatch(panel, /toast\.error\([^\n]*error\.message/);
});

test("recovery and OAuth flows avoid open redirects, query-token consumption, and ordinary-session password changes", async () => {
  const [oauth, reset, callback] = await Promise.all([
    read("src/lib/oauth-session.ts"),
    read("src/routes/reset-password.tsx"),
    read("src/routes/~oauth.callback.tsx"),
  ]);
  assert.match(oauth, /safeRelativeRedirect/);
  assert.match(oauth, /const accessToken = hash\.get\("access_token"\)/);
  assert.doesNotMatch(oauth, /const accessToken = getOAuthParam/);
  assert.match(reset, /event === "PASSWORD_RECOVERY" && session/);
  assert.match(reset, /hasRecentPasswordRecoveryFlow\(data\.session\.user\.id\)/);
  assert.doesNotMatch(reset, /recoveryExpected\s*=\s*hasOAuthResponseInUrl/);
  assert.match(reset, /signOut\(\{\s*scope: "others"/);
  assert.doesNotMatch(callback, /setError\(message\)/);
});

test("account and memory mutations are bounded, no-store, and cross-site guarded", async () => {
  const [account, memory] = await Promise.all([
    read("src/routes/api/account.ts"),
    read("src/routes/api/memory.ts"),
  ]);
  assert.match(account, /readUtf8BodyBounded\(request, MAX_DELETE_BODY_BYTES\)/);
  assert.match(account, /mediaType !== "application\/json"/);
  assert.match(account, /isCrossSiteMutation\(request\)/);
  assert.match(
    account,
    /prepareStripeAccountDeletion\(\{\s*supabase: auth\.supabaseAdmin,\s*userId: auth\.userId,/,
  );
  assert.match(account, /auth\.admin\.deleteUser\(\s*auth\.userId/u);
  assert.match(account, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(account, /error instanceof Error \? error\.message/);
  assert.equal(memory.match(/isCrossSiteMutation\(request\)/g)?.length, 2);
  assert.match(
    memory,
    /deleteChatMemory\(caller\.auth\.supabaseAdmin, caller\.auth\.userId, chatId\)/,
  );
});

test("auth UI does not enumerate duplicate signups or expose raw provider errors", async () => {
  const [dialog, forgot, mfa, settings] = await Promise.all([
    read("src/components/auth/AuthDialog.tsx"),
    read("src/components/auth/ForgotPasswordDialog.tsx"),
    read("src/components/MfaPanel.tsx"),
    read("src/components/SettingsDialog.tsx"),
  ]);
  assert.doesNotMatch(dialog, /Already registered/);
  assert.doesNotMatch(dialog, /error\.message/);
  assert.doesNotMatch(dialog, /auth\.resend/);
  assert.doesNotMatch(dialog, /toast\.error\([^\n]*\.message/);
  assert.doesNotMatch(forgot, /toast\.error\(msg\)/);
  assert.doesNotMatch(mfa, /toast\.error\(\(e as Error\)\.message/);
  assert.doesNotMatch(settings, /onClick=\{\(\) => clerk\?\.openUserProfile\(\)\}/);
  assert.match(settings, /Email-address\s+changes are not\s+currently available in the app/);
  assert.match(
    settings,
    /Legally required billing, security,\s+and backup records may be retained/,
  );
});

test("RLS-facing library and project functions retain explicit ownership boundaries", async (context) => {
  const paths = [
    "src/lib/library.functions.ts",
    "src/lib/projects.functions.ts",
    "src/lib/project-workspace.functions.ts",
    "supabase/migrations/20260713010018_ae3321a8-3e87-46f9-9e37-867848dd48b6.sql",
  ];
  const sources = await Promise.all(paths.map((path) => readOptional(path, context)));
  if (sources.some((source) => source === null)) return;
  const [library, projects, workspace, migration] = sources;

  assert.match(library, /\.eq\("user_id", context\.userId\)/);
  assert.match(library, /const values = \{\s*user_id: context\.userId/s);
  assert.match(library, /\.insert\(\{\s*\.\.\.values,/s);
  assert.match(projects, /owner_id: context\.userId/);
  assert.match(projects, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(workspace, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(
    migration,
    /notes_select_members[\s\S]*is_project_member\(project_id, auth\.uid\(\)\)/,
  );
  assert.match(
    migration,
    /tasks_write_editors[\s\S]*can_edit_project\(project_id, auth\.uid\(\)\)/,
  );
  assert.match(
    migration,
    /project_id uuid NOT NULL REFERENCES public\.projects\(id\) ON DELETE CASCADE/,
  );
  assert.match(migration, /project_files_delete[\s\S]*can_edit_project/);
});
