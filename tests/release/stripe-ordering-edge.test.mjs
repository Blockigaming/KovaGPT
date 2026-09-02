import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
test("Stripe completion is atomic and ordered by timestamp plus event id", async () => {
  const reliability = await read("src/lib/webhook-reliability.mjs"),
    identitySql = await read(
      "supabase/migrations/20260902023000_stripe_customer_identity_and_completion.sql",
    ),
    atomicSql = await read(
      "supabase/migrations/20260902024000_billing_plan_tier_and_atomic_stripe_events.sql",
    );
  assert.match(reliability, /rpc\("complete_stripe_event"/);
  assert.doesNotMatch(reliability, /currentSubscriptionTimestamp/);
  assert.match(identitySql, /primary key \(event_id, environment\)/);
  assert.match(atomicSql, /on conflict \(event_id, environment\) do nothing/);
  assert.match(atomicSql, /last_stripe_event_created_at[\s\S]*last_stripe_event_id/);
  assert.match(atomicSql, /returning true into _subscription_applied/);
});
test("edge contract enforces security headers CSRF and request size", async () => {
  const edge = await read("scripts/release/edge-contract.mjs"),
    server = await read("src/server.ts");
  for (const header of [
    "Content-Security-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ])
    assert.match(server, new RegExp(header));
  assert.match(server, /rejectCrossSiteRequest/);
  assert.match(server, /16 \* 1024 \* 1024/);
  assert.match(edge, /KOVA_EDGE_ALLOWED_HOSTS/);
});
test("E2E matrix is deterministically sharded and merged", async () => {
  const ci = await read(".github/workflows/ci.yml");
  assert.match(ci, /shard: \[1, 2, 3\]/);
  assert.match(ci, /--shard=\$\{\{ matrix\.shard \}\}\/3/);
  assert.match(ci, /merge-reports/);
  assert.match(ci, /if-no-files-found: error/);
  assert.doesNotMatch(ci, /retries|--grep-invert/);
});
