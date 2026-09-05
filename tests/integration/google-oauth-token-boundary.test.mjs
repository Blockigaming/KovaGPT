import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("fresh databases never grant browser roles access to Google OAuth tokens", async () => {
  const migration = await readSource(
    "supabase/migrations/20260704033129_4459a668-0d41-48f1-995e-09d2377c7b01.sql",
  );
  const tokenStart = migration.indexOf("CREATE TABLE public.google_oauth_tokens");
  const tokenEnd = migration.indexOf("-- Audit log for connected-account actions", tokenStart);
  const tokenSection = migration.slice(tokenStart, tokenEnd);

  assert.ok(tokenStart >= 0 && tokenEnd > tokenStart);
  assert.match(tokenSection, /GRANT ALL ON public\.google_oauth_tokens TO service_role/u);
  assert.doesNotMatch(tokenSection, /TO authenticated/u);
  assert.doesNotMatch(tokenSection, /own tokens (?:select|delete)/u);
});

test("existing databases revoke token-table access without mutating token rows", async () => {
  const migration = await readSource(
    "supabase/migrations/20260802003000_google_oauth_tokens_server_only.sql",
  );

  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.google_oauth_tokens\s+FROM PUBLIC, anon, authenticated;/u,
  );
  assert.match(
    migration,
    /DROP POLICY IF EXISTS "own tokens select" ON public\.google_oauth_tokens;/u,
  );
  assert.match(
    migration,
    /DROP POLICY IF EXISTS "own tokens delete" ON public\.google_oauth_tokens;/u,
  );
  assert.match(
    migration,
    /GRANT ALL PRIVILEGES ON TABLE public\.google_oauth_tokens TO service_role;/u,
  );

  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/iu);
  assert.doesNotMatch(migration, /\bTRUNCATE\b/iu);
  assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/iu);
  assert.doesNotMatch(migration, /\bUPDATE\s+public\.google_oauth_tokens\b/iu);
  assert.doesNotMatch(migration, /\bDROP\s+COLUMN\b/iu);
});

test("application token access remains in the server-only OAuth module", async () => {
  const [server, browser] = await Promise.all([
    readSource("src/lib/google-oauth.server.ts"),
    readSource("src/lib/google-client.ts"),
  ]);

  assert.match(server, /\.rpc\("google_connection_rpc"/u);
  const migration = await readSource(
    "supabase/migrations/20260905005417_google_multiaccount_lifecycle.sql",
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.google_connection_rpc\(uuid,text,jsonb\) FROM PUBLIC,anon,authenticated/,
  );
  assert.doesNotMatch(browser, /google_oauth_tokens/u);
});
