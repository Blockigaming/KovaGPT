import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("dialog and full account page initiate GitHub sign-in through guarded hosted authority", async () => {
  const [dialog, page, callback] = await Promise.all([
    read("src/components/auth/AuthDialog.tsx"),
    read("src/routes/auth.tsx"),
    read("src/routes/~oauth.callback.tsx"),
  ]);
  for (const source of [dialog, page]) {
    assert.match(source, /provider: "github"/);
    assert.match(source, /resolveLegacyAuthContext\(\)/);
    assert.match(source, /context\.assertCurrent\(\)/);
    assert.match(source, /skipBrowserRedirect: true/);
    assert.match(source, /getOAuthRedirectUri\(\)/);
    assert.match(source, /validateHostedGitHubLoginRedirect/);
    assert.match(
      source,
      /validateHostedGitHubLoginRedirect\(data\.url, SUPABASE_BROWSER_CONFIG\.url\)/,
    );
    assert.match(source, /providers\.resolved && providers\.github/);
    assert.match(source, /browserKovaAuthMode\(\) !== "kova"/);
    assert.doesNotMatch(source, /scope: "repo"|repo user:email|GITHUB_OAUTH_CLIENT_SECRET/);
  }
  assert.match(page, /Continue with GitHub/);
  assert.match(callback, /completeOAuthSessionFromUrl/);
  assert.match(callback, /clearOAuthResponseFromUrl/);
});

test("GitHub login remains distinct from the repository connector and owned-auth authority", async () => {
  const [dialog, page, connector] = await Promise.all([
    read("src/components/auth/AuthDialog.tsx"),
    read("src/routes/auth.tsx"),
    read("src/routes/api/github/auth.ts"),
  ]);
  assert.match(connector, /requireUser/);
  for (const source of [dialog, page]) {
    assert.doesNotMatch(source, /\/api\/github\/auth|startGitHubOAuth/);
    assert.match(source, /rememberPostAuthRedirect\(\)/);
  }
});
