import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("saved agents are owner scoped, bounded, versioned, and anonymous-safe", async () => {
  const sql = await read("supabase/migrations/20260802120000_agent_definitions.sql");
  assert.match(sql, /references auth\.users\(id\) on delete cascade/);
  assert.match(sql, /char_length\(instructions\) between 1 and 12000/);
  assert.match(sql, /cardinality\(allowed_tools\) <= 20/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /auth\.uid\(\) = owner_id/g);
  assert.match(sql, /revoke all .* from anon/is);
  assert.match(sql, /unique\(definition_id, version\)/);
});

test("agent server functions validate ownership and roll back partial creation", async () => {
  const source = await read("src/lib/agent-definitions.functions.ts");
  assert.match(source, /requireSupabaseAuth/);
  assert.match(source, /max\(12_000\)/);
  assert.match(source, /\.eq\("owner_id", context\.userId\)/g);
  assert.match(source, /\.limit\(100\)/);
  assert.match(source, /agent_definition_versions/);
  assert.match(source, /Agent could not be saved/);
  assert.match(source, /new Set\(data\.allowedTools\)/);
});

test("Agent Studio persists real definitions without implying execution", async () => {
  const source = await read("src/routes/omega.tsx");
  assert.match(source, /listSavedAgents/);
  assert.match(source, /createSavedAgent/);
  assert.match(source, /duplicateSavedAgent/);
  assert.match(source, /archiveSavedAgent/);
  assert.match(source, /Execution remains separate/);
  assert.match(source, /authenticated runner and plan entitlement/);
  assert.match(source, /\/api\/agents\/runs/);
  assert.match(source, /Agent execution analytics/);
  assert.match(source, /Average completed runtime/);
  assert.match(source, /Sign in to Omega/);
  assert.doesNotMatch(source, /saveOmega\(scope, "agents"/);
});
