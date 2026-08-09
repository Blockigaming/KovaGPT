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

test("unknown errors remain generic and known rehearsal errors remain allowlisted", async () => {
  const route = await readFile("src/routes/api/internal/auth-migration/rehearsal.ts", "utf8");

  assert.match(route, /error instanceof RehearsalError/);
  assert.match(route, /known \? error\.code : "rehearsal_failed"/);
  assert.match(route, /known \? error\.status : 500/);
  assert.doesNotMatch(route, /Response\.json\([^)]*error\s*[,}]/s);
});
