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

test("voice remains deferred and no voice feature surfaces are reintroduced", () => {
  const matrix = read("docs/kova-final-completion-matrix.md");
  const settings = read("src/components/SettingsDialog.tsx");
  const chat = read("src/routes/index.tsx");
  const pricing = read("src/routes/pricing.tsx");
  assert.match(matrix, /Voice: DEFERRED BY PRODUCT DECISION/);
  assert.doesNotMatch(settings, /autoSpeak|voiceRate|voiceName|Read aloud|Dictation|Microphone/i);
  assert.doesNotMatch(chat, /label: "Voice"|Mic\b|microphone|dictation/i);
  assert.doesNotMatch(pricing, /voice generations|voice, and advanced/i);
});
