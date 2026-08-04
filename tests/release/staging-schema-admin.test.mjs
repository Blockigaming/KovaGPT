import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
test("schema contract covers critical database security objects", async () => {
  const c = JSON.parse(await read("database-contract.json"));
  assert.ok(c.tables.length >= 100);
  assert.ok(c.policies.length >= 180);
  assert.ok(c.functions.includes("kovagpt_schema_health"));
  assert.ok(c.rlsTables.includes("kova_schema_contract"));
  assert.match(c.sha256, /^[a-f0-9]{64}$/);
});
test("runtime schema readiness uses one versioned bounded RPC and timeout cache", async () => {
  const s = await read("src/lib/readiness.server.ts");
  assert.match(s, /rpc\/kovagpt_schema_health/);
  assert.match(s, /20260803123000-v1/);
  assert.match(s, /database-timeout/);
  assert.match(s, /expires: Date\.now\(\) \+ 15_000/);
});
test("administrator authorization is server allowlisted and fail closed", async () => {
  const s = await read("src/lib/administrator.server.ts"),
    route = await read("src/routes/api/admin/diagnostics.ts");
  assert.match(s, /KOVA_ADMIN_USER_IDS/);
  assert.match(s, /requireUser\(request\)/);
  assert.match(s, /diagnostics_unavailable/);
  assert.match(s, /admins\.has\(caller\.userId\)/);
  assert.doesNotMatch(s, /email|query|searchParams/i);
  assert.match(route, /rate_limited/);
  assert.match(route, /Cache-Control.*no-store/s);
});
test("authenticated smoke refuses unapproved or non-disposable targets", async () => {
  const s = await read("scripts/release/authenticated-smoke.mjs");
  assert.match(s, /KOVA_STAGING_DISPOSABLE/);
  assert.match(s, /KOVA_STAGING_ALLOWED_HOST/);
  assert.match(s, /KOVA_ALLOW_PRODUCTION_SMOKE/);
  assert.match(s, /finally/);
  assert.match(s, /SECONDARY_TOKEN/);
  assert.doesNotMatch(s, /checkout\.sessions|generate-image/);
  assert.match(s, /scheduled_tasks/);
  assert.match(s, /status: "paused"/);
});
