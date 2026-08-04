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
  pricingVersion: {
    id: "price-v1",
    status: "approved",
    marginFloor: 0.5,
    effectiveAt: "2026-01-01",
    expiresAt: "2027-01-01",
  },
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

test("promotion budgets must be finite and funded before crossing the floor", () => {
  assert.throws(
    () =>
      quoteRequest({
        ...base,
        promotion: { discount: 0.1, administratorAuthorized: true, budgetId: "launch" },
      }),
    /promotion_below_margin_floor/,
  );
  assert.throws(
    () =>
      quoteRequest({
        ...base,
        promotion: {
          discount: 0.1,
          administratorAuthorized: true,
          budgetId: "launch",
          availableBudget: Number.POSITIVE_INFINITY,
        },
      }),
    /promotion_below_margin_floor/,
  );
});

test("configured pricing-version margin floors are enforced", () => {
  const quote = quoteRequest({
    ...base,
    riskBufferPercentage: 0,
    pricingVersion: { ...base.pricingVersion, marginFloor: 0.75 },
  });
  assert.equal(quote.marginFloor, 0.75);
  assert.ok(quote.projectedGrossMarginPercentage >= 0.75);
});

test("pricing versions outside their effective window fail closed", () => {
  assert.throws(
    () =>
      quoteRequest({
        ...base,
        pricingVersion: { ...base.pricingVersion, effectiveAt: "2026-09-01" },
      }),
    /pricing_version_not_effective/,
  );
  assert.throws(
    () =>
      quoteRequest({
        ...base,
        pricingVersion: { ...base.pricingVersion, expiresAt: "2026-08-01" },
      }),
    /pricing_version_expired/,
  );
});

test("negative or non-finite allowances fail closed", () => {
  assert.throws(
    () => quoteRequest({ ...base, allowances: { ...base.allowances, fixed: { compute: -1 } } }),
    /invalid_fixed_allowance:compute/,
  );
  assert.throws(
    () =>
      quoteRequest({
        ...base,
        allowances: { ...base.allowances, percentages: { fraud: Number.NaN } },
      }),
    /invalid_percentage_allowance:fraud/,
  );
});

test("emergency controls match every supported request scope", () => {
  for (const [scopeType, scopeId] of [
    ["global", "global"],
    ["provider", "provider-a"],
    ["model", "model-a"],
    ["capability", "responses"],
    ["plan", "pro"],
    ["organization", "org-1"],
    ["project", "proj-1"],
    ["key", "key-1"],
  ]) {
    assert.throws(
      () =>
        quoteRequest({
          ...base,
          usage: {
            ...base.usage,
            planId: "pro",
            organizationId: "org-1",
            projectId: "proj-1",
            apiKeyId: "key-1",
          },
          emergencyControls: [{ id: `${scopeType}-block`, active: true, scopeType, scopeId }],
        }),
      /paid_capability_disabled/,
    );
  }
});

test("reconciliation rejects missing or non-finite actual upstream costs", () => {
  const quote = quoteRequest(base);
  assert.throws(
    () => reconcileCharge({ quote }),
    (error) =>
      error instanceof PricingUnavailableError && error.code === "actual_upstream_cost_invalid",
  );
  assert.throws(
    () => reconcileCharge({ quote, actualUpstreamCost: Number.NaN }),
    (error) =>
      error instanceof PricingUnavailableError && error.code === "actual_upstream_cost_invalid",
  );
});
