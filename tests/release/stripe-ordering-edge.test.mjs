import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
test("Stripe completion uses a DB lease sequence and keeps Event time audit-only", async () => {
  const reliability = await read("src/lib/webhook-reliability.mjs"),
    identitySql = await read(
      "supabase/migrations/20260902023000_stripe_customer_identity_and_completion.sql",
    ),
    atomicSql = await read(
      "supabase/migrations/20260902024000_billing_plan_tier_and_atomic_stripe_events.sql",
    ),
    rollout = await read("docs/release/STRIPE_BILLING_ROLLOUT.md");
  assert.match(reliability, /rpc\("begin_stripe_event"/);
  assert.match(reliability, /rpc\("complete_stripe_event"/);
  assert.doesNotMatch(
    reliability,
    /currentSubscriptionTimestamp|_event_created_at\s*[<>=]+[\s\S]{0,80}_event_id/s,
  );
  assert.doesNotMatch(
    identitySql,
    /drop constraint if exists subscriptions_stripe_subscription_id_key/,
  );
  assert.match(atomicSql, /create table if not exists public\.stripe_event_processing_claims/);
  assert.match(atomicSql, /nextval\('public\.stripe_subscription_observation_sequence'\)/);
  assert.match(atomicSql, /active_observation_sequence/);
  assert.match(atomicSql, /last_stripe_observation_sequence/);
  assert.match(atomicSql, /on conflict \(event_id\) do nothing/);
  assert.doesNotMatch(atomicSql, /event_created_at\s*[<>=]+[\s\S]{0,80}event_id/);
  assert.match(rollout, /docs\.stripe\.com\/webhooks#event-ordering/);
  assert.match(rollout, /timestamps and IDs are retained only for audit/i);
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
