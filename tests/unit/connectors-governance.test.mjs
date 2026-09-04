import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("Google connector lifecycle has PKCE, state validation, scopes, and safe errors", () => {
  const source = read("src/lib/connectors.server.ts");
  for (const token of [
    "ConnectorState",
    "connection_expired",
    "reauthorization_required",
    "permission_incomplete",
    "createOAuthState",
    "codeVerifier",
    "codeChallenge",
    "validateOAuthState",
    "GOOGLE_SCOPE_GROUPS",
    "requireGoogleCapability",
    "safeConnectorError",
  ]) {
    assert.match(source, new RegExp(token), `connectors source should include ${token}`);
  }
  assert.doesNotMatch(source, /localStorage|access_token\s*:/);
});

test("Google OAuth routes use the documented configuration, exact redirect, and one-browser PKCE state", () => {
  const oauth = read("src/lib/google-oauth.server.ts");
  const authRoute = read("src/routes/api/google/auth.ts");
  const callbackRoute = read("src/routes/api/google/callback.ts");
  const diagnostics = read("src/lib/config/diagnostics.server.ts");
  const envExample = read(".env.example");

  for (const source of [oauth, diagnostics, envExample]) {
    assert.match(source, /GOOGLE_OAUTH_CLIENT_ID/);
    assert.match(source, /GOOGLE_OAUTH_CLIENT_SECRET/);
    assert.match(source, /GOOGLE_REDIRECT_URI/);
    assert.doesNotMatch(source, /GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET/);
  }
  assert.match(oauth, /code_challenge_method: "S256"/);
  assert.match(oauth, /code_verifier: codeVerifier/);
  assert.match(authRoute, /HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
  assert.match(callbackRoute, /oauthCookie\.state !== state/);
  assert.match(callbackRoute, /age < -30_000/);
  assert.match(callbackRoute, /Max-Age=0/);
});

test("voice stays disabled without adding provider secrets or billing claims", () => {
  const matrix = read("docs/kova-final-completion-matrix.md");
  const chat = read("src/components/ChatInput.tsx");
  const message = read("src/components/ChatMessage.tsx");
  const pricing = read("src/routes/pricing.tsx");
  const start = read("src/start.ts");
  const server = read("src/server.ts");

  assert.match(matrix, /Voice: INTENTIONALLY DISABLED/);
  for (const source of [chat, message]) {
    assert.doesNotMatch(
      source,
      /SpeechRecognition|webkitSpeechRecognition|speechSynthesis|SpeechSynthesisUtterance|Start voice input|Read aloud|MicOff|Dictate|dictation/i,
    );
  }
  assert.match(start, /microphone=\(\)/g);
  assert.match(server, /microphone=\(\)/g);
  assert.doesNotMatch(pricing, /voice generations|voice, and advanced/i);
});

test("connector OAuth callbacks are browser-bound and keep returns same-origin", () => {
  const helper = read("src/lib/oauth-security.server.ts");
  const start = read("src/routes/api/integrations/oauth/start.ts");
  const callback = read("src/routes/api/integrations/oauth/callback/$provider.ts");
  const lifecycle = read("src/integrations/oauth-lifecycle.server.ts");
  const githubStart = read("src/routes/api/github/auth.ts");
  const githubCallback = read("src/routes/api/github/callback.ts");
  const githubOauth = read("src/lib/github-oauth.server.ts");

  assert.match(helper, /value\.startsWith\("\/\/"\)/);
  assert.match(helper, /value\.includes\("\\\\"\)/);
  assert.match(helper, /parsed\.origin !== SAFE_RETURN_ORIGIN/);
  assert.match(helper, /Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=/);
  assert.match(start, /browserNonce = crypto\.randomUUID\(\)/);
  assert.match(start, /Set-Cookie/);
  assert.match(lifecycle, /nonce_hash: await sha256\(input\.browserNonce\)/);
  assert.match(lifecycle, /invalid_oauth_browser_binding/);
  assert.match(lifecycle, /normalizeOAuthReturnPath\(input\.returnPath\)/);
  assert.match(callback, /readOauthCookie\(request, INTEGRATION_OAUTH_COOKIE\)/);
  assert.match(callback, /normalizeOAuthReturnPath\(result\.returnPath\)/);
  assert.match(callback, /redirectClearingOauthCookie/);
  assert.match(githubStart, /GITHUB_OAUTH_COOKIE/);
  assert.match(githubStart, /Set-Cookie/);
  assert.match(githubCallback, /browserState !== state/);
  assert.match(githubCallback, /new URL\("\/apps", url\.origin\)/);
  assert.doesNotMatch(githubCallback, /returnPath|return_path/);
  assert.match(githubOauth, /browserState !== state/);
});

test("account deletion verifies every credential store before removing auth", () => {
  const account = read("src/routes/api/account.ts");
  const google = read("src/lib/google-oauth.server.ts");
  const github = read("src/lib/github-oauth.server.ts");
  const finance = read("src/finances/plaid.server.ts");
  const lifecycle = read("src/integrations/oauth-lifecycle.server.ts");
  const authDeletion = account.indexOf("auth.admin.deleteUser(");

  for (const cleanup of [
    "disconnectAllFinance(auth)",
    "disconnectGoogle(auth.userId)",
    "disconnectAllGitHub(auth.userId)",
    "disconnectAllOAuth(auth.userId)",
  ]) {
    const cleanupIndex = account.indexOf(cleanup);
    assert.ok(cleanupIndex > -1 && cleanupIndex < authDeletion, cleanup);
  }

  assert.match(google, /\.from\("google_oauth_tokens"\)\.delete\(\)\.eq\("user_id", userId\)/);
  assert.match(google, /google_token_purge_failed/);
  assert.match(account, /Google credentials could not be removed/);

  assert.match(github, /export async function disconnectAllGitHub\(ownerId: string\)/);
  assert.match(github, /\.from\("github_accounts"\)/);
  assert.match(github, /\/applications\/\$\{encodeURIComponent\(clientId\)\}\/grant/);
  assert.match(github, /Authorization: `Basic \$\{Buffer\.from/);
  assert.match(github, /JSON\.stringify\(\{ access_token: token \}\)/);
  assert.match(github, /token_ciphertext: "deleted"/);
  assert.match(github, /purgeError \|\| !purgedAccount/);
  assert.match(github, /github_account_purge_failed/);
  assert.match(account, /GitHub credentials could not be removed/);

  assert.match(finance, /export async function disconnectAllFinance\(caller: AuthedCaller\)/);
  assert.match(finance, /\.from\("financial_connections"\)/);
  assert.match(finance, /"\/item\/remove", \{ access_token: accessToken \}/);
  assert.match(finance, /\.delete\(\)/);
  assert.match(finance, /purgeError \|\| !purgedConnection/);
  assert.match(finance, /finance_connection_purge_failed/);
  assert.match(account, /Financial connections could not be removed/);

  assert.match(lifecycle, /export async function disconnectAllOAuth\(ownerId: string\)/);
  assert.match(
    lifecycle,
    /\.from\("integration_linked_accounts"\)[\s\S]*\.eq\("owner_id", ownerId\)/,
  );
  assert.match(lifecycle, /await disconnectOAuth\(ownerId, account\.id\)/);
  assert.match(lifecycle, /let providerRevoked = false/);
  assert.doesNotMatch(lifecycle, /providerRevoked = !provider\.revocationEndpoint/);
  assert.match(lifecycle, /data: purgedAccount, error: credentialDeletionError/);
  assert.match(lifecycle, /credentialDeletionError \|\| !purgedAccount/);
  assert.match(lifecycle, /linked_account_purge_failed/);
  assert.match(
    lifecycle,
    /if \(failures\.length\) throw new Error\("linked_account_disconnect_failed"\)/,
  );
  assert.equal((lifecycle.match(/event_type: "disconnect"/g) ?? []).length, 1);
  assert.match(account, /Connected accounts could not be disconnected/);
});
