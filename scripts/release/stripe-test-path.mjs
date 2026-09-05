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
  checkoutReconciliationSource,
}) {
  const failures = [];
  if (!/normalizeStripeEnvironment/u.test(webhookSource))
    failures.push("webhook environment parser missing");
  if (!/value === "sandbox" \|\| value === "live"/u.test(webhookSource))
    failures.push("sandbox/live allowlist missing");
  if (
    !/rpc\("begin_stripe_event"/u.test(reliabilitySource) ||
    !/rpc\("complete_stripe_event"/u.test(reliabilitySource)
  )
    failures.push("leased atomic webhook completion missing");
  if (
    /currentSubscriptionTimestamp|subscription_event_order_lookup|\.(?:order|gt|gte)\(\s*["'](?:event_created_at|event_id)/u.test(
      reliabilitySource,
    )
  )
    failures.push("webhook retains a non-causal Event ordering check");
  const beginCall = reliabilitySource.indexOf('rpc("begin_stripe_event"');
  const retrieveCall = reliabilitySource.indexOf("await retrieveSubscription(subscriptionId)");
  const completeCall = reliabilitySource.indexOf('rpc("complete_stripe_event"');
  if (!(beginCall >= 0 && retrieveCall > beginCall && completeCall > retrieveCall))
    failures.push("webhook does not claim before GET and complete after projection");
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
  if (!/claim_stripe_checkout_attempt/u.test(checkoutSource))
    failures.push("durable Checkout attempt claim missing");
  if (!/_trial_eligible:\s*requestedTrialEligibility/u.test(checkoutSource))
    failures.push("Checkout trial eligibility is not frozen in the durable attempt");
  if (!/idempotencyKey:\s*`kova-checkout-/u.test(checkoutReconciliationSource ?? ""))
    failures.push("Stripe Checkout idempotency key missing");
  if (!/resolveDurableCheckoutSession\(\{/u.test(checkoutSource))
    failures.push("durable Checkout reconciliation missing");
  if (!/subscriptions\.list\(\{\s*customer:\s*customerId,\s*status:\s*"all"/u.test(checkoutSource))
    failures.push("authoritative all-status subscription precheck missing");
  if (!/stripeSubscriptionBlocksCheckout\(subscription, nowSeconds\)/u.test(checkoutSource))
    failures.push("Checkout does not use the authoritative status projection");
  if (/client_secret\s*\?\?\s*""/u.test(checkoutSource))
    failures.push("Checkout accepts a missing client secret");
  if (!/if \(!session\.client_secret\)/u.test(checkoutSource))
    failures.push("Checkout missing-client-secret guard absent");

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
    checkoutReconciliationSource: readFileSync(
      "src/lib/stripe-checkout-reconciliation.mjs",
      "utf8",
    ),
  });
  if (failures.length) {
    console.error(`Stripe test-path contract failed:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("STRIPE_TEST_PATH_CONTRACT=PASS sandbox=true live=true realChargesRequired=false");
}
