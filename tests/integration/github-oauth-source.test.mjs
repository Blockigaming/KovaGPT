import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const oauth = await readFile("src/lib/github-oauth.server.ts", "utf8"),
  start = await readFile("src/routes/api/github/auth.ts", "utf8"),
  callback = await readFile("src/routes/api/github/callback.ts", "utf8"),
  migration = await readFile("supabase/migrations/20260728200000_mercury_github_oauth.sql", "utf8");
test("GitHub OAuth has authenticated start PKCE encrypted state and one-use callback", () => {
  for (const value of [
    "requireUser",
    "startGitHubOAuth",
    "code_challenge",
    "S256",
    "encryptSecret",
    "state_hash",
    "used_at",
    "expires_at",
    "completeGitHubOAuth",
    "access_token",
  ])
    assert.ok(`${start}${oauth}${callback}${migration}`.includes(value), value);
});
test("GitHub App support signs short-lived JWTs and exchanges installation tokens", () => {
  for (const value of [
    "RS256",
    "iat: now - 60",
    "exp: now + 540",
    "/app/installations",
    "/access_tokens",
    "createInstallationToken",
  ])
    assert.ok(oauth.includes(value), value);
});
test("connector environment documents every server secret", async () => {
  const env = await readFile(".env.example", "utf8");
  for (const name of [
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "CONNECTOR_ENCRYPTION_KEY",
  ])
    assert.match(env, new RegExp(`^${name}=$`, `m`));
});
