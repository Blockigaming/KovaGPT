import { readFileSync } from "node:fs";
import { parseCheckoutRequest } from "../../src/lib/checkout-request.mjs";

const STRIPE_API_VERSION_PATTERN = /apiVersion:\s*"2026-08-26\.dahlia"/u;
const EXPECTED_INTEGRATION_IDENTIFIER = "kovagpt_checkout_wshrfyef";
const INTEGRATION_IDENTIFIER_PATTERN = /^kovagpt_checkout_[a-z]{8}$/u;
const CHECKOUT_VALIDATOR_PATTERN =
  /\.validator\(\(data: unknown\) => \{\s*const parsed = parseCheckoutRequest\(data\);\s*if \(!resolveBillingPlan\(parsed\.priceId\)\) throw new Error\("Invalid priceId"\);\s*return parsed;\s*\}\)/u;

export function normalizeStripeEnvironmentValue(value) {
  return value === "sandbox" || value === "live" ? value : null;
}

export function verifyCheckoutRequestBoundary() {
  const failures = [];
  try {
    const hostileUrl = "https://evil.example/checkout/return";
    const parsed = parseCheckoutRequest({
      priceId: "plus_monthly",
      quantity: 1,
      environment: "sandbox",
      returnUrl: hostileUrl,
      redirect_url: hostileUrl,
      return_url: hostileUrl,
    });
    const keys = Object.keys(parsed).sort();
    if (
      parsed.priceId !== "plus_monthly" ||
      parsed.quantity !== 1 ||
      keys.length !== 2 ||
      keys[0] !== "priceId" ||
      keys[1] !== "quantity"
    ) {
      failures.push("Checkout request allowlist leaked browser fields");
    }
    if (!Object.isFrozen(parsed)) failures.push("Checkout request is not frozen");
    try {
      parsed.return_url = hostileUrl;
    } catch {
      // Expected for a frozen object in an ES module.
    }
    if ("returnUrl" in parsed || "redirect_url" in parsed || "return_url" in parsed) {
      failures.push("Checkout request accepted a browser redirect field");
    }
  } catch {
    failures.push("Checkout request boundary could not be verified");
  }
  return failures;
}

export function verifyStripeTestPath({
  webhookSource,
  reliabilitySource,
  stripeSource,
  planSource,
  checkoutSource,
}) {
  const failures = [];
  if (!/normalizeStripeEnvironment/u.test(webhookSource))
    failures.push("webhook environment parser missing");
  if (!/value === "sandbox" \|\| value === "live"/u.test(webhookSource))
    failures.push("sandbox/live allowlist missing");
  if (
    !/processed_stripe_events/u.test(reliabilitySource) ||
    !/rpc\("complete_stripe_event"/u.test(reliabilitySource)
  )
    failures.push("atomic webhook completion missing");
  if (/currentSubscriptionTimestamp|subscription_event_order_lookup/u.test(reliabilitySource))
    failures.push("webhook retains a read-then-write ordering check");
  if (!/retrieveSubscription/u.test(reliabilitySource))
    failures.push("authoritative subscription retrieval missing");
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
  if (!/livePriceId/u.test(planSource) || !/price_1UAzhH/u.test(planSource))
    failures.push("authoritative live Price ids missing");
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
  if (!/return_url:\s*CHECKOUT_RETURN_URL/u.test(checkoutSource))
    failures.push("fixed Checkout return URL missing");
  if (/\breturnUrl\b|data\.returnUrl/u.test(checkoutSource))
    failures.push("Checkout return URL remains browser-selectable");
  if (!CHECKOUT_VALIDATOR_PATTERN.test(checkoutSource))
    failures.push("sanitized Checkout validator missing");
  if (!/resolveStripeCustomerId/u.test(checkoutSource))
    failures.push("durable Stripe customer mapping missing");
  if (/customers\.(?:list|search|update)/u.test(checkoutSource))
    failures.push("email or metadata customer reassignment remains reachable");

  failures.push(...verifyCheckoutRequestBoundary());
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = verifyStripeTestPath({
    webhookSource: readFileSync("src/routes/api/public/payments/webhook.ts", "utf8"),
    reliabilitySource: readFileSync("src/lib/webhook-reliability.mjs", "utf8"),
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
