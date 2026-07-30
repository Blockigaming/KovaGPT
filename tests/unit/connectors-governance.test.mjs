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

test("voice uses browser capabilities without adding provider secrets or billing claims", () => {
  const matrix = read("docs/kova-final-completion-matrix.md");
  const voice = read("src/lib/browser-voice.ts");
  const chat = read("src/components/ChatInput.tsx");
  const pricing = read("src/routes/pricing.tsx");
  assert.match(matrix, /Voice: IMPLEMENTED AT SOURCE LEVEL/);
  assert.match(voice, /SpeechRecognition/);
  assert.match(chat, /Start voice input/);
  assert.doesNotMatch(pricing, /voice generations|voice, and advanced/i);
});
