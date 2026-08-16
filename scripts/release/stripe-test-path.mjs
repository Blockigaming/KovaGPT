import { readFileSync } from "node:fs";

export function normalizeStripeEnvironmentValue(value) {
  return value === "sandbox" || value === "live" ? value : null;
}

export function verifyStripeTestPath({ webhookSource, stripeSource, planSource }) {
  const failures = [];
  if (!/normalizeStripeEnvironment/u.test(webhookSource)) failures.push("webhook environment parser missing");
  if (!/value === "sandbox" \|\| value === "live"/u.test(webhookSource)) failures.push("sandbox/live allowlist missing");
  if (!/processed_stripe_events/u.test(webhookSource) || !/23505/u.test(webhookSource)) failures.push("webhook idempotency missing");
  if (!/PAYMENTS_SANDBOX_WEBHOOK_SECRET/u.test(stripeSource)) failures.push("sandbox webhook secret missing");
  if (!/PAYMENTS_LIVE_WEBHOOK_SECRET/u.test(stripeSource)) failures.push("live webhook secret missing");
  if (!/timingSafeEqual/u.test(stripeSource)) failures.push("constant-time signature verification missing");
  if (!/plus_monthly/u.test(planSource) || !/pro_monthly/u.test(planSource)) failures.push("lookup-key plans missing");
  if (/unit_amount|1400|1600|8900/u.test(planSource)) failures.push("source hard-codes Stripe price amounts");
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = verifyStripeTestPath({
    webhookSource: readFileSync("src/routes/api/public/payments/webhook.ts", "utf8"),
    stripeSource: readFileSync("src/lib/stripe.server.ts", "utf8"),
    planSource: readFileSync("src/lib/billing-plans.ts", "utf8"),
  });
  if (failures.length) {
    console.error(`Stripe test-path contract failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("STRIPE_TEST_PATH_CONTRACT=PASS sandbox=true live=true realChargesRequired=false");
}
