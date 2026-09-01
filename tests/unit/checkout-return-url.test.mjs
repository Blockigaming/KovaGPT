import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKOUT_RETURN_URL,
  parseAllowedCheckoutReturnUrl,
} from "../../src/lib/checkout-return-url.mjs";

test("accepts only the fixed Kova Checkout return URL", () => {
  assert.equal(
    CHECKOUT_RETURN_URL,
    "https://kovagpt.com/checkout/return?session_id={CHECKOUT_SESSION_ID}",
  );
  assert.equal(parseAllowedCheckoutReturnUrl(CHECKOUT_RETURN_URL), CHECKOUT_RETURN_URL);
});

test("rejects browser-selected Checkout return URLs", () => {
  const rejected = [
    null,
    undefined,
    "",
    "http://kovagpt.com/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    "https://evil.example/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    "https://kovagpt.com.evil.example/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    "https://user@kovagpt.com/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    "https://kovagpt.com:444/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    "https://kovagpt.com/other?session_id={CHECKOUT_SESSION_ID}",
    "https://kovagpt.com/checkout/return?session_id=attacker-selected",
  ];

  for (const value of rejected) {
    assert.throws(() => parseAllowedCheckoutReturnUrl(value), {
      name: "TypeError",
      message: "Invalid checkout return URL",
    });
  }
});
