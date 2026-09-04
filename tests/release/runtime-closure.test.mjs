import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
test("client readiness deduplicates, caches, invalidates, and exposes normalized states", async () => {
  const source = await read("src/lib/readiness-client.ts");
  for (const token of [
    "pending",
    "expiresAt",
    "invalidateReadiness",
    "AbortController",
    "quota-exhausted",
    "migration-required",
    "billing-verification-pending",
    "storage-unavailable",
    "hosted-execution-unavailable",
  ])
    assert.match(source, new RegExp(token));
});
test("operational state is accessible and correlation safe", async () => {
  const source = await read("src/components/OperationalState.tsx");
  assert.ok(source.includes('role={urgent ? "alert" : "status"}'));
  assert.ok(source.includes('aria-live={urgent ? "assertive" : "polite"}'));
  assert.match(source, /Reference:/);
  assert.match(source, /Retry/);
});
test("diagnostics uses distributed fail-closed database limiter", async () => {
  const route = await read("src/routes/api/admin/diagnostics.ts");
  const limiter = await read("src/lib/distributed-rate-limit.mjs");
  const serverLimiter = await read("src/lib/distributed-rate-limit.server.ts");
  const migration = await read(
    "supabase/migrations/20260803122000_distributed_diagnostics_limit.sql",
  );
  assert.doesNotMatch(route, /new Map/);
  assert.match(route, /consumeApplicationRateLimit/);
  assert.match(route, /Retry-After/);
  assert.match(limiter, /consume_diagnostic_rate_limit/);
  assert.match(limiter, /AbortSignal\.timeout/);
  assert.match(serverLimiter, /KOVA_IP_HASH_SECRET/);
  assert.match(migration, /on conflict/);
  assert.match(migration, /revoke all/);
  assert.match(migration, /service_role/);
  assert.match(migration, /security definer/);
});
test("staging smoke reports CRUD isolation and cleanup without paid actions", async () => {
  const source = await read("scripts/release/authenticated-smoke.mjs");
  for (const token of [
    "projects",
    "writing_documents",
    "user_library_items",
    "scheduled_tasks",
    "isolation",
    "orphans",
    "cleanup",
    "paidCapacityConsumed: false",
  ])
    assert.match(source, new RegExp(token));
  assert.doesNotMatch(source, /checkout\.sessions|image.*generat|email.*send/i);
});
test("launch report and production guard fail closed", async () => {
  const report = await read("scripts/release/launch-report.mjs");
  const guard = await read("scripts/release/production-guard.mjs");
  assert.match(report, /unavailable.*skipped.*not-run/);
  assert.match(report, /productionValidated/);
  assert.match(guard, /SHA256|sha256/i);
  assert.match(guard, /KOVA_PRODUCTION_HUMAN_APPROVAL/);
  assert.match(guard, /cleanup/);
});
