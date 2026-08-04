import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("operational analytics are retained briefly and owner scoped", async () => {
  const sql = await read("supabase/migrations/20260802132000_operational_analytics.sql");
  assert.match(sql, /interval '90 days'/);
  assert.match(sql, /auth\.uid\(\)=owner_id/g);
  assert.match(sql, /revoke all .* from anon/i);
  assert.match(sql, /octet_length\(metadata::text\) <= 2048/);
});

test("analytics API rejects private-content metadata and bounds batches", async () => {
  const api = await read("src/lib/operational-analytics.functions.ts");
  assert.match(
    api,
    /prompt\|message\|document\|memory\|evidence\|file\|secret\|token\|url\|content\|error/,
  );
  assert.match(api, /\.max\(20\)/);
  assert.match(api, /\.max\(120\)/);
  assert.match(api, /requireSupabaseAuth/);
});

test("analytics client batches, honors do-not-track, and never blocks actions", async () => {
  const client = await read("src/lib/operational-analytics.ts");
  assert.match(client, /navigator\.doNotTrack === "1"/);
  assert.match(client, /queue\.splice\(0, 20\)/);
  assert.match(client, /setTimeout/);
  assert.match(client, /failure-safe/);
  assert.doesNotMatch(client, /payload\.(prompt|message|content|url)/);
});
