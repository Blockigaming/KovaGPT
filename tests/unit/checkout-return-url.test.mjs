import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  billingReturnOriginConfigured,
  billingReturnUrls,
} from "../../src/lib/checkout-return-url.mjs";

test("server-selected canonical and direct Azure origins have exact Checkout and Portal returns", () => {
  for (const origin of [
    "https://kovagpt.com",
    "https://kovagpt-prod-web.purpleglacier-b10c3746.eastus.azurecontainerapps.io",
  ]) {
    assert.equal(billingReturnOriginConfigured(origin), true);
    assert.deepEqual(billingReturnUrls(origin), {
      checkout: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      portal: `${origin}/`,
    });
  }
});

test("missing, ambiguous, or foreign billing return origins fail closed", () => {
  for (const origin of [
    undefined,
    "",
    "https://evil.example",
    "http://kovagpt.com",
    "https://kovagpt.com.evil.example",
    "https://kovagpt.com/checkout/return",
    "https://kovagpt.com:443",
    "https://kovagpt.com?next=evil",
    "https://kovagpt-prod-web.purpleglacier-b10c3746.eastus.azurecontainerapps.io/",
  ]) {
    assert.equal(billingReturnOriginConfigured(origin), false);
    assert.throws(() => billingReturnUrls(origin), /billing_return_origin_unconfigured/);
  }
});

test("does not expose a Checkout return URL browser input", async () => {
  const serverSource = await readFile(
      new URL("../../src/utils/payments.functions.ts", import.meta.url),
      "utf8",
    ),
    componentSource = await readFile(
      new URL("../../src/components/StripeEmbeddedCheckout.tsx", import.meta.url),
      "utf8",
    ),
    hookSource = await readFile(
      new URL("../../src/hooks/useStripeCheckout.tsx", import.meta.url),
      "utf8",
    ),
    pricingSource = await readFile(
      new URL("../../src/routes/pricing.tsx", import.meta.url),
      "utf8",
    ),
    returnSource = await readFile(
      new URL("../../src/routes/checkout.return.tsx", import.meta.url),
      "utf8",
    );

  assert.match(
    serverSource,
    /returnUrl: billingReturnUrls\(process\.env\.KOVA_BILLING_RETURN_ORIGIN\)\.checkout/,
  );
  assert.match(
    serverSource,
    /return_url: billingReturnUrls\(process\.env\.KOVA_BILLING_RETURN_ORIGIN\)\.portal/,
  );
  assert.match(
    serverSource,
    /billingPortalAvailable:[\s\S]*?hasBillingAccount &&[\s\S]*?billingReturnOriginConfigured\(process\.env\.KOVA_BILLING_RETURN_ORIGIN\)/,
  );
  assert.doesNotMatch(serverSource, /data\.(?:returnUrl|return_url)/);
  const policySource = await readFile(
    new URL("../../src/lib/billing-policy.mjs", import.meta.url),
    "utf8",
  );
  assert.match(policySource, /p_return_url: returnUrl/);
  assert.match(policySource, /session\.return_url !== claim\.returnUrl/);
  assert.doesNotMatch(componentSource, /\breturnUrl\b/);
  assert.doesNotMatch(hookSource, /\breturnUrl\b/);
  assert.doesNotMatch(pricingSource, /\breturnUrl\b|window\.location\.origin/);
  assert.match(returnSource, /Checking your account|Verifying your subscription/);
  assert.doesNotMatch(returnSource, /Subscription activated|Your subscription is active/);
});
