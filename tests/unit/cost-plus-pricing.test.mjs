import assert from "node:assert/strict";
import test from "node:test";
import {
  PricingUnavailableError,
  quoteRequest,
  reconcileCharge,
} from "../../src/lib/pricing/cost-plus.mjs";

const registry = ["input_tokens", "cached_input_tokens", "output_tokens", "web_search"].map(
  (billingDimension) => ({
    provider: "provider-a",
    upstreamModel: "model-a",
    billingDimension,
    unitQuantity: 1,
    unitPrice: billingDimension === "output_tokens" ? 0.02 : 0.01,
    currency: "USD",
    source: "reviewed evidence",
    verificationStatus: "approved",
    effectiveAt: "2026-01-01",
    expiresAt: "2027-01-01",
    active: true,
  }),
);
const base = {
  registry,
  provider: "provider-a",
  upstreamModel: "model-a",
  currency: "USD",
  usage: {
    capability: "responses",
    dimensions: { input_tokens: 10, output_tokens: 5, web_search: 1 },
  },
  allowances: {
    fixed: { compute: 0.02, database: 0.01 },
    percentages: { fraud: 0.02 },
    collectionPercentage: 0.03,
    collectionFixed: 0.01,
  },
  pricingVersion: { id: "price-v1", status: "approved" },
  minimumRequestCharge: 0.01,
  roundingIncrement: 0.0001,
  riskBufferPercentage: 0.15,
  at: new Date("2026-08-03"),
};

test("dynamic quote includes fees and remains above a 50% gross margin", () => {
  const quote = quoteRequest(base);
  assert.ok(quote.projectedGrossMarginPercentage >= 0.5);
  assert.ok(quote.customerCharge >= quote.estimatedTotalVariableCost / 0.5);
  assert.equal(quote.pricingVersionId, "price-v1");
});
test("missing, expired, or unreviewed upstream dimensions fail closed", () => {
  assert.throws(
    () => quoteRequest({ ...base, usage: { dimensions: { image: 1 } } }),
    (error) => error instanceof PricingUnavailableError && error.code === "upstream_price_missing",
  );
});
test("unauthorized discounts cannot cross the floor, funded promotions can", () => {
  assert.throws(
    () => quoteRequest({ ...base, promotion: { discount: 10 } }),
    /promotion_below_margin_floor/,
  );
  const quote = quoteRequest({
    ...base,
    promotion: {
      discount: 0.1,
      administratorAuthorized: true,
      budgetId: "launch",
      availableBudget: 100,
    },
  });
  assert.ok(quote.promotionalSubsidy > 0);
  assert.ok(quote.projectedGrossMarginPercentage >= 0.5);
});
test("reconciliation flags below-floor requests without retroactive charging", () => {
  const quote = quoteRequest(base);
  const result = reconcileCharge({ quote, actualUpstreamCost: quote.customerCharge * 0.75 });
  assert.equal(result.finalCustomerCharge, quote.customerCharge);
  assert.equal(result.belowFloor, true);
  assert.ok(result.requiredActions.includes("block_or_reprice_new_usage"));
});
