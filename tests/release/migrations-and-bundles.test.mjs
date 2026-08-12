import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("release manifest is ordered, unique, and content-addressed", async () => {
  const m = JSON.parse(await readFile(new URL("../../release-migrations.json", import.meta.url)));
  assert.ok(m.count > 50);
  assert.equal(new Set(m.migrations.map((x) => x.timestamp)).size, m.count);
  assert.deepEqual(
    m.migrations.map((x) => x.filename),
    [...m.migrations.map((x) => x.filename)].sort(),
  );
  assert.ok(m.migrations.every((x) => /^[a-f0-9]{64}$/.test(x.sha256)));
});
test("security hardening migration protects legacy definers and webhook claims", async () => {
  const s = await readFile(
    new URL(
      "../../supabase/migrations/20260803110000_release_security_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(s, /set search_path = public, pg_temp/);
  assert.match(s, /revoke all.*anon, authenticated/i);
});

test("bundle budget selects the actual main entry and enforces compressed size", async () => {
  const source = await readFile(
    new URL("../../scripts/release/bundle-budget.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /file\.startsWith\("index-"\)/);
  assert.match(source, /sort\(\(a, b\) => b\.raw - a\.raw\)\[0\]/);
  assert.match(source, /gzipBudget/);
  assert.doesNotMatch(source, /raw > 350000/);
});
