import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("auth rehearsal maps raw pg connect failures to a safe stable status", async () => {
  const route = await readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8");

  assert.match(route, /await client\.connect\(\)/);
  assert.match(
    route,
    /catch\s*\{\s*throw new RehearsalError\("database_connect_failed", 503\);\s*\}/s,
  );
  assert.doesNotMatch(route, /error\.message|error\.detail|error\.stack|connectionString.*Response\.json/s);
});

test("database TLS stays verified and supports a server-only Supabase CA", async () => {
  const route = await readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8");

  assert.match(route, /AUTH_MIGRATION_REHEARSAL_DATABASE_CA/);
  assert.match(route, /rejectUnauthorized:\s*true/);
  assert.match(route, /databaseCa\s*\?\s*\{\s*ca:\s*databaseCa\s*\}/s);
  assert.match(route, /connectionTimeoutMillis:\s*10_000/);
  assert.doesNotMatch(route, /rejectUnauthorized:\s*false/);
  assert.doesNotMatch(route, /NODE_TLS_REJECT_UNAUTHORIZED/);
});

test("database close failures log only a fixed non-sensitive stage", async () => {
  const route = await readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8");

  assert.match(route, /stage:\s*"database_close"/);
  assert.doesNotMatch(
    route,
    /safeDatabaseCloseFailure\([^)]*(?:error|message|stack|detail|databaseUrl|databaseCa|secret)/s,
  );
});

test("authentication and payload validation still precede database construction", async () => {
  const route = await readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8");

  const auth = route.indexOf("authenticateRequest(");
  const payload = route.indexOf("validatePayload(");
  const nonce = route.indexOf("processGuard.claimNonce(");
  const client = route.indexOf("new Client(");
  assert.ok(auth >= 0 && payload > auth && nonce > payload && client > nonce);
});

test("connected pg client is wrapped by authoritative constraint adapter before import", async () => {
  const route = await readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8");

  assert.match(route, /createAuthRehearsalDatabaseAdapter/);
  const connected = route.indexOf("await client.connect()");
  const adapter = route.indexOf("createAuthRehearsalDatabaseAdapter(client)");
  const imported = route.indexOf("importRehearsal(database, validated)");
  assert.ok(connected >= 0 && adapter > connected && imported > adapter);
  assert.doesNotMatch(route, /importRehearsal\(client,\s*validated\)/);
});

test("unknown errors remain generic and known rehearsal errors remain allowlisted", async () => {
  const route = await readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8");

  assert.match(route, /error instanceof RehearsalError/);
  assert.match(route, /known \? error\.code : "rehearsal_failed"/);
  assert.match(route, /known \? error\.status : 500/);
  assert.doesNotMatch(route, /Response\.json\([^)]*error\s*[,}]/s);
});
