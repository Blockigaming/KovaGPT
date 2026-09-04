import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CHECKOUT_RETURN_URL } from "../../src/lib/checkout-return-url.mjs";

test("uses the fixed Kova Checkout return URL", () => {
  assert.equal(
    CHECKOUT_RETURN_URL,
    "https://kovagpt.com/checkout/return?session_id={CHECKOUT_SESSION_ID}",
  );
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

  assert.match(serverSource, /return_url: CHECKOUT_RETURN_URL/);
  assert.doesNotMatch(serverSource, /\breturnUrl\b|data\.returnUrl/);
  assert.doesNotMatch(componentSource, /\breturnUrl\b/);
  assert.doesNotMatch(hookSource, /\breturnUrl\b/);
  assert.doesNotMatch(pricingSource, /\breturnUrl\b|window\.location\.origin/);
  assert.match(returnSource, /verifying the subscription server-side/);
  assert.doesNotMatch(returnSource, /Subscription activated|Your subscription is active/);
});
