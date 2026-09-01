import assert from "node:assert/strict";
import test from "node:test";
import { parseCheckoutRequest } from "../../src/lib/checkout-request.mjs";

test("returns a frozen allowlisted Checkout request", () => {
  const parsed = parseCheckoutRequest({
    priceId: "plus_monthly",
    quantity: 1,
    environment: "sandbox",
    returnUrl: "https://evil.example",
    redirect_url: "https://evil.example",
    return_url: "https://evil.example",
  });

  assert.deepEqual(parsed, { priceId: "plus_monthly", quantity: 1 });
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal("environment" in parsed, false);
  assert.equal("returnUrl" in parsed, false);
  assert.equal("redirect_url" in parsed, false);
  assert.equal("return_url" in parsed, false);
  assert.throws(() => {
    parsed.return_url = "https://evil.example";
  }, TypeError);
});

test("accepts omitted quantity and rejects malformed Checkout requests", () => {
  assert.deepEqual(parseCheckoutRequest({ priceId: "pro_monthly" }), {
    priceId: "pro_monthly",
  });

  for (const value of [
    null,
    undefined,
    "plus_monthly",
    {},
    { priceId: "" },
    { priceId: "plus_monthly", quantity: 0 },
    { priceId: "plus_monthly", quantity: 2 },
    { priceId: "plus_monthly", quantity: "1" },
  ]) {
    assert.throws(() => parseCheckoutRequest(value), {
      name: "TypeError",
      message: "Invalid checkout request",
    });
  }
});
