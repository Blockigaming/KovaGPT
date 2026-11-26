import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDeveloperUsage } from "../../src/lib/pricing/developer-usage-summary.mjs";

const row = {
  public_model: "kova-argon-4.6",
  capability: "chat",
  settlement_state: "settled",
  created_at: "2026-11-01T00:00:00.000Z",
  currency: "USD",
};

test("usage aggregation preserves decimal charges and separates currencies and missing meters", () => {
  const summary = summarizeDeveloperUsage([
    {
      ...row,
      final_customer_charge: "0.1",
      authoritative_usage: { input_tokens: 4, cached_input_tokens: 2, output_tokens: 1 },
    },
    { ...row, final_customer_charge: "0.2" },
    { ...row, final_customer_charge: 1e-8 },
    { ...row, currency: "EUR", final_customer_charge: "2.00000000" },
    {
      ...row,
      settlement_state: "reserved",
      final_customer_charge: null,
      maximum_reserved_charge: 99,
    },
  ]);
  assert.equal(summary.requests, 5);
  assert.equal(summary.measuredRequests, 1);
  assert.deepEqual(summary.charges, [
    { currency: "EUR", amount: "2.00000000" },
    { currency: "USD", amount: "0.30000001" },
  ]);
  assert.deepEqual(summary.tokens, {
    input_tokens: 4,
    cached_input_tokens: 2,
    image_input_tokens: 0,
    output_tokens: 1,
  });
  assert.equal(summary.models[0].requests, 5);
  assert.equal(summary.days[0].label, "2026-11-01");
  assert.equal(summary.statuses.find((item) => item.label === "reserved").charges.length, 0);
});
test("empty summaries never imply metered usage or a charge", () => {
  const summary = summarizeDeveloperUsage([]);
  assert.equal(summary.requests, 0);
  assert.equal(summary.measuredRequests, 0);
  assert.deepEqual(summary.charges, []);
  assert.deepEqual(summary.models, []);
});
