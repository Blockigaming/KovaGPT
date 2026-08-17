import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Stripe database identity includes environment", async () => {
  const sql = await read(
    "supabase/migrations/20260817195500_stripe_environment_identity_hardening.sql",
  );
  assert.match(sql, /unique \(stripe_subscription_id, environment\)/u);
  assert.match(sql, /primary key \(event_id, environment\)/u);
  assert.match(sql, /subscriptions_environment_check/u);
  assert.match(sql, /processed_stripe_events_environment_check/u);
});

test("Stripe webhook processing is environment-isolated and ordered", async () => {
  const route = await read("src/routes/api/public/payments/webhook.ts");
  assert.match(route, /onConflict: "stripe_subscription_id,environment"/u);
  assert.match(route, /\.delete\(\)[\s\S]*\.eq\("event_id", eventId\)[\s\S]*\.eq\("environment", env\)/u);
  assert.match(route, /case "invoice\.paid"[\s\S]*last_stripe_event_created_at/u);
  assert.match(route, /currentEventFilter\(eventCreated\)/u);
});

test("Stripe webhook verification rejects malformed signed event envelopes", async () => {
  const source = await read("src/lib/stripe.server.ts");
  assert.match(source, /Buffer\.byteLength\(body, "utf8"\)/u);
  assert.match(source, /Number\.isSafeInteger\(timestampSeconds\)/u);
  assert.match(source, /Invalid webhook event id/u);
  assert.match(source, /Invalid webhook event timestamp/u);
  assert.match(source, /Invalid webhook event data/u);
});
