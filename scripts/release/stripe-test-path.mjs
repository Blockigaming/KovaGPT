import { readFileSync } from "node:fs";

const STRIPE_API_VERSION_PATTERN = /apiVersion:\s*"2026-07-29\.dahlia"/u;
const EXPECTED_INTEGRATION_IDENTIFIER = "kovagpt_checkout_wshrfyef";
const INTEGRATION_IDENTIFIER_PATTERN = /^kovagpt_checkout_[a-z]{8}$/u;

export function normalizeStripeEnvironmentValue(value) {
  return value === "sandbox" || value === "live" ? value : null;
}

export function verifyStripeTestPath({ webhookSource, stripeSource, planSource, checkoutSource }) {
  const failures = [];
  if (!/normalizeStripeEnvironment/u.test(webhookSource))
    failures.push("webhook environment parser missing");
  if (!/value === "sandbox" \|\| value === "live"/u.test(webhookSource))
    failures.push("sandbox/live allowlist missing");
  if (!/processed_stripe_events/u.test(webhookSource) || !/23505/u.test(webhookSource))
    failures.push("webhook idempotency missing");
  if (!/PAYMENTS_SANDBOX_WEBHOOK_SECRET/u.test(stripeSource))
    failures.push("sandbox webhook secret missing");
  if (!/PAYMENTS_LIVE_WEBHOOK_SECRET/u.test(stripeSource))
    failures.push("live webhook secret missing");
  if (!/timingSafeEqual/u.test(stripeSource))
    failures.push("constant-time signature verification missing");
  if (!STRIPE_API_VERSION_PATTERN.test(stripeSource))
    failures.push("current Stripe API version missing");
  if (!/plus_monthly/u.test(planSource) || !/pro_monthly/u.test(planSource))
    failures.push("lookup-key plans missing");
  if (/unit_amount|1400|1600|8900/u.test(planSource))
    failures.push("source hard-codes Stripe price amounts");

  const integrationIdentifier = checkoutSource.match(/integration_identifier:\s*"([^"]+)"/u)?.[1];
  if (!integrationIdentifier) {
    failures.push("embedded Checkout integration identifier missing");
  } else if (!INTEGRATION_IDENTIFIER_PATTERN.test(integrationIdentifier)) {
    failures.push("embedded Checkout integration identifier malformed");
  } else if (integrationIdentifier !== EXPECTED_INTEGRATION_IDENTIFIER) {
    failures.push("embedded Checkout integration identifier changed");
  }
  if (/payment_method_types\s*:/u.test(checkoutSource))
    failures.push("Checkout payment methods must remain dynamic");
  if (/automatic_tax\s*:/u.test(checkoutSource))
    failures.push("automatic tax requires approved registrations");
  if (
    !/const sessionParams:\s*Parameters<typeof stripe\.checkout\.sessions\.create>\[0\]/u.test(
      checkoutSource,
    )
  ) {
    failures.push("Checkout parameters are not SDK-typed");
  }
  if (/sessionParams\s+as\s+Parameters</u.test(checkoutSource))
    failures.push("Checkout parameters use an unsafe type assertion");

  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = verifyStripeTestPath({
    webhookSource: readFileSync("src/routes/api/public/payments/webhook.ts", "utf8"),
    stripeSource: readFileSync("src/lib/stripe.server.ts", "utf8"),
    planSource: readFileSync("src/lib/billing-plans.ts", "utf8"),
    checkoutSource: readFileSync("src/utils/payments.functions.ts", "utf8"),
  });
  if (failures.length) {
    console.error(`Stripe test-path contract failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("STRIPE_TEST_PATH_CONTRACT=PASS sandbox=true live=true realChargesRequired=false");
}
