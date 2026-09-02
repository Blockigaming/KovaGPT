import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
test("Stripe ordering metadata prevents stale entitlement updates", async () => {
  const reliability = await read("src/lib/webhook-reliability.mjs"),
    orderingSql = await read("supabase/migrations/20260803121000_stripe_event_ordering.sql"),
    identitySql = await read(
      "supabase/migrations/20260901234000_stripe_customer_identity_and_completion.sql",
    );
  assert.match(reliability, /currentSubscriptionTimestamp/);
  assert.match(reliability, /last_stripe_event_created_at/);
  assert.match(reliability, /POSTGRES_UNIQUE_VIOLATION/);
  assert.match(reliability, /stripe_subscription_id,environment/);
  assert.match(orderingSql, /processed_stripe_events_order_idx/);
  assert.match(identitySql, /primary key \(event_id, environment\)/);
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
