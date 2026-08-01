import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("the additive migration permits encrypted or legacy storage without mutating token rows", () => {
  const sql = read("supabase/migrations/20260802010000_encrypt_google_oauth_tokens.sql");

  assert.match(sql, /ADD COLUMN IF NOT EXISTS token_ciphertext TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS refresh_claim_id TEXT/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS refresh_claimed_at TIMESTAMPTZ/i);
  assert.match(sql, /ALTER COLUMN access_token DROP NOT NULL/i);
  assert.match(
    sql,
    /token_ciphertext IS NOT NULL[\s\S]*access_token IS NULL[\s\S]*refresh_token IS NULL[\s\S]*OR[\s\S]*token_ciphertext IS NULL[\s\S]*access_token IS NOT NULL/i,
  );
  assert.match(sql, /NOT VALID;/i);
  assert.match(sql, /VALIDATE CONSTRAINT google_oauth_tokens_credential_storage_check/i);
  assert.match(sql, /VALIDATE CONSTRAINT google_oauth_tokens_refresh_claim_check/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.google_oauth_token_encryption_ready\(\)/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/i);
  assert.doesNotMatch(
    sql,
    /UPDATE\s+public\.google_oauth_tokens|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN/i,
  );
});

test("Google token writes are encrypted, verified, and clear both plaintext columns", () => {
  const oauth = read("src/lib/google-oauth.server.ts");
  const lifecycle = read("src/lib/google-token-bundle.mjs");
  const types = read("src/integrations/supabase/types.ts");

  assert.match(oauth, /encrypt: encryptCredential/);
  assert.match(lifecycle, /serializeGoogleTokenBundle\(\{ userId, accessToken, refreshToken \}\)/);
  assert.match(
    lifecycle,
    /token_ciphertext: requireNonEmptyString\(ciphertext\),[\s\S]{0,100}access_token: null,[\s\S]{0,100}refresh_token: null/,
  );
  assert.doesNotMatch(oauth, /access_token:\s*tokens\.access_token/);
  assert.match(lifecycle, /stored\.token_ciphertext !== ciphertext/);
  assert.match(lifecycle, /await readEncryptedRow\(stored, userId, decrypt/);
  assert.match(types, /google_oauth_tokens:[\s\S]*access_token: string \| null/);
  assert.match(types, /google_oauth_tokens:[\s\S]*token_ciphertext: string \| null/);
  assert.match(types, /google_oauth_tokens:[\s\S]*refresh_claim_id: string \| null/);
  assert.match(types, /google_oauth_token_encryption_ready: \{ Args: never; Returns: boolean \}/);
});

test("legacy conversion is owner-scoped, atomic, race-aware, and precedes provider effects", () => {
  const oauth = read("src/lib/google-oauth.server.ts");
  const lifecycle = read("src/lib/google-token-bundle.mjs");
  const callback = read("src/routes/api/google/callback.ts");

  assert.match(oauth, /\.update\(\{ \.\.\.write, updated_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(oauth, /\.eq\("user_id", userId\)[\s\S]*\.is\("token_ciphertext", null\)/);
  assert.match(oauth, /\.eq\("expires_at", row\.expires_at\)/);
  assert.match(oauth, /\.eq\("updated_at", row\.updated_at\)/);
  assert.match(lifecycle, /A concurrent request may have completed the same migration/);
  assert.match(oauth, /refresh_claim_id: claim\.id/);
  assert.match(oauth, /AbortSignal\.timeout\(30_000\)/);

  const callbackGate = callback.indexOf("runAfterGoogleTokenStorageReady(");
  const callbackExchange = callback.indexOf("exchangeCodeForTokens(");
  assert.ok(callbackGate !== -1 && callbackGate < callbackExchange);

  const disconnect = oauth.slice(
    oauth.indexOf("export async function disconnectGoogle"),
    oauth.indexOf("async function refreshAccessToken"),
  );
  assert.ok(disconnect.indexOf("readStoredGoogleTokens") < disconnect.indexOf("await fetch("));

  const refresh = oauth.slice(
    oauth.indexOf("async function refreshAccessToken"),
    oauth.indexOf("export async function getValidGoogleAccessToken"),
  );
  assert.ok(refresh.indexOf("readStoredGoogleTokens") < refresh.indexOf("await fetch("));
});

test("routes fail closed on vault or schema readiness and avoid sensitive logging", () => {
  const oauth = read("src/lib/google-oauth.server.ts");
  const auth = read("src/routes/api/google/auth.ts");
  const callback = read("src/routes/api/google/callback.ts");

  assert.match(oauth, /requireCredentialVaultConfiguration\(\)/);
  assert.match(oauth, /db\.rpc\(\s*"google_oauth_token_encryption_ready",?\s*\)/);
  const health = oauth.slice(
    oauth.indexOf("export async function getGoogleConnectionHealth"),
    oauth.indexOf("export async function disconnectGoogle"),
  );
  const healthGate = health.indexOf("await prepareGoogleTokenStorage(userId)");
  const healthRead = health.indexOf("await getGoogleConnection(userId)");
  assert.ok(healthGate !== -1 && healthGate < healthRead);
  assert.match(health, /"reauthorization_required"[\s\S]*"temporarily_unavailable"/);
  assert.match(auth, /await prepareGoogleTokenStorage\(auth\.userId\)/);
  assert.match(callback, /\(\) => prepareGoogleTokenStorage\(userId\)/);
  assert.doesNotMatch(oauth, /console\.(?:log|warn|error)\([^\n]*(?:token|response)/i);
  assert.doesNotMatch(callback, /console\.error\([^\n]*,\s*(?:e|error)\b/);
  assert.match(oauth, /new URLSearchParams\(\{ token \}\)/);
  assert.doesNotMatch(oauth, /revoke\?token=/);
});

test("rollout documentation requires secret first, migrations second, and code last", () => {
  const docs = read("docs/google-oauth-token-encryption-rollout.md");
  const secret = docs.indexOf("**Secret first.**");
  const migrations = docs.indexOf("**Migrations second.**");
  const code = docs.indexOf("**Code last.**");

  assert.ok(secret !== -1 && secret < migrations && migrations < code);
  assert.match(docs, /does \*\*not\*\*\s+apply Supabase migrations/);
  assert.match(docs, /no bulk backfill/i);
  assert.match(docs, /rolling back[\s\S]*plaintext-only application code is unsafe/i);
  assert.match(docs, /No decrypt migration, destructive rollback, or backfill\s+is included here/);
});
