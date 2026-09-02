import assert from "node:assert/strict";
import test from "node:test";

import { stripeErrorDiagnostic } from "../../src/lib/stripe-error-diagnostics.mjs";

test("retains only allowlisted Stripe operational fields", () => {
  const result = stripeErrorDiagnostic(
    {
      type: "StripeInvalidRequestError",
      code: "parameter_unknown",
      requestId: "req_123",
      message: "contains customer@example.com and sk_live_secret",
      stack: "secret stack",
      raw: { message: "raw secret", param: "customer", doc_url: "https://example.test" },
    },
    "checkout_session_create",
  );

  assert.deepEqual(result, {
    stage: "checkout_session_create",
    errorType: "StripeInvalidRequestError",
    errorCode: "parameter_unknown",
    requestId: "req_123",
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /customer@example|sk_live|secret/i);
  assert.doesNotMatch(serialized, /"(?:message|stack|param|raw)"/i);
});

test("reads SDK raw fields and bounds output", () => {
  const result = stripeErrorDiagnostic(
    {
      raw: {
        type: "card_error",
        code: "x".repeat(200),
        headers: { "request-id": "req_raw" },
      },
    },
    "price_lookup",
  );
  assert.equal(result.errorType, "card_error");
  assert.equal(result.errorCode.length, 96);
  assert.equal(result.requestId, "req_raw");
});

test("normalizes unknown failures", () => {
  assert.deepEqual(stripeErrorDiagnostic("failure", "configuration"), {
    stage: "configuration",
    errorType: "unknown_error",
  });
});

test("does not execute or leak hostile getters", () => {
  const hostile = {};
  Object.defineProperties(hostile, {
    type: { get() { throw new Error("do not leak"); } },
    code: { get() { throw new Error("do not leak"); } },
    requestId: { get() { throw new Error("do not leak"); } },
    message: { get() { throw new Error("do not leak"); } },
  });
  assert.deepEqual(stripeErrorDiagnostic(hostile, "customer_resolution"), {
    stage: "customer_resolution",
    errorType: "unknown_error",
  });
});
