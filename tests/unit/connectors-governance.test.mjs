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
  const pricing = read("src/routes/pricing.tsx");
  const start = read("src/start.ts");

  assert.match(matrix, /Voice: INTENTIONALLY DISABLED/);
  assert.doesNotMatch(chat, /Start voice input|createSpeechRecognition|MicOff/);
  assert.match(start, /microphone=\(\)/);
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
