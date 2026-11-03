import assert from "node:assert/strict";
import test from "node:test";
import { validateHostedGitHubLoginRedirect } from "../../src/lib/hosted-github-login-redirect.mjs";

const authUrl = "https://example.supabase.co";

test("GitHub login accepts only the configured hosted-auth authorization endpoint", () => {
  const value =
    "https://example.supabase.co/auth/v1/authorize?provider=github&redirect_to=https%3A%2F%2Fkovagpt.com%2F~oauth%2Fcallback";
  assert.equal(validateHostedGitHubLoginRedirect(value, authUrl), value);
});

test("GitHub login rejects unrelated and malicious redirects", () => {
  for (const value of [
    "https://github.com/login/oauth/authorize?client_id=fake",
    "https://evil.example/auth/v1/authorize?provider=github",
    "http://example.supabase.co/auth/v1/authorize?provider=github",
    "https://example.supabase.co/auth/v1/authorize?provider=google",
    "https://example.supabase.co/auth/v1/authorize?provider=github&provider=google",
    "https://example.supabase.co/auth/v1/authorize?provider=github#token",
    "https://example.supabase.co/auth/v1/callback?provider=github",
    "https://username@example.supabase.co/auth/v1/authorize?provider=github",
    "/auth/v1/authorize?provider=github",
  ]) {
    assert.throws(
      () => validateHostedGitHubLoginRedirect(value, authUrl),
      /github_login_redirect_invalid/,
      value,
    );
  }
  assert.throws(
    () => validateHostedGitHubLoginRedirect("https://example.supabase.co/auth/v1/authorize?provider=github", ""),
    /github_login_redirect_invalid/,
  );
});
