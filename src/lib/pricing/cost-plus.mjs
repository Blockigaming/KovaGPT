/** Internal paid-API price controls. Money is expressed in minor currency units. */
export const MARGIN_FLOOR = 0.5;

export class PricingUnavailableError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "PricingUnavailableError";
    this.code = code;
    this.details = details;
  }
}

const roundUp = (value, increment) =>
  Number((Math.ceil((value - Number.EPSILON) / increment) * increment).toFixed(8));

export function selectActivePrices(records, { provider, model, at = new Date(), currency }) {
  const instant = new Date(at).getTime();
  const matches = records.filter(
    (record) =>
      record.provider === provider &&
      record.upstreamModel === model &&
      record.currency === currency &&
      record.active === true &&
      record.verificationStatus === "approved" &&
      new Date(record.effectiveAt).getTime() <= instant &&
      (!record.expiresAt || new Date(record.expiresAt).getTime() > instant),
  );
  const byDimension = new Map();
  for (const record of matches.sort((a, b) => new Date(a.effectiveAt) - new Date(b.effectiveAt))) {
    byDimension.set(record.billingDimension, record);
  }
  return byDimension;
}

/**
 * Quote a bounded request. `usage` values are maximums before dispatch and authoritative
 * usage at settlement. Every used dimension must have an approved, effective registry row.
 */
export function quoteRequest({
  registry,
  provider,
  upstreamModel,
  currency = "USD",
  usage,
  allowances = {},
  pricingVersion,
  publicPrice = {},
  riskBufferPercentage = 0.15,
  minimumRequestCharge = 1,
  roundingIncrement = 1,
  absorbedTaxPercentage = 0,
  planAdjustmentPercentage = 0,
  reservePercentage = 0,
  promotion,
  emergencyControls = [],
  at = new Date(),
}) {
  if (!pricingVersion?.id || pricingVersion.status !== "approved") {
    throw new PricingUnavailableError("pricing_version_unapproved");
  }
  const marginFloor = pricingVersion.marginFloor ?? MARGIN_FLOOR;
  if (!Number.isFinite(marginFloor) || marginFloor < MARGIN_FLOOR || marginFloor >= 1)
    throw new PricingUnavailableError("margin_floor_invalid");
  if (riskBufferPercentage < 0 || riskBufferPercentage > 1)
    throw new RangeError("risk_buffer_invalid");
  const blocked = emergencyControls.find(
    (control) =>
      control.active &&
      ["global", provider, upstreamModel, usage.capability].includes(control.scopeKey),
  );
  if (blocked)
    throw new PricingUnavailableError("paid_capability_disabled", { controlId: blocked.id });

  const active = selectActivePrices(registry, { provider, model: upstreamModel, currency, at });
  const upstreamBreakdown = {};
  for (const [dimension, quantity] of Object.entries(usage.dimensions ?? {})) {
    if (!Number.isFinite(quantity) || quantity < 0)
      throw new RangeError(`invalid_usage:${dimension}`);
    if (quantity === 0) continue;
    const price = active.get(dimension);
    if (!price) throw new PricingUnavailableError("upstream_price_missing", { dimension });
    upstreamBreakdown[dimension] = (quantity / price.unitQuantity) * price.unitPrice;
  }
  const upstreamCost = Object.values(upstreamBreakdown).reduce((sum, value) => sum + value, 0);
  const fixedCosts = Object.entries(allowances.fixed ?? {}).reduce(
    (sum, [, value]) => sum + value,
    0,
  );
  const percentageCosts = Object.entries(allowances.percentages ?? {}).reduce(
    (sum, [, percentage]) => sum + upstreamCost * percentage,
    0,
  );
  const collectionRate = allowances.collectionPercentage ?? 0;
  const collectionFixed = allowances.collectionFixed ?? 0;
  const preCollectionCost = upstreamCost + fixedCosts + percentageCosts;
  // Solve the approved margin floor including collection costs on the charge.
  const denominator = 1 - marginFloor - collectionRate;
  if (denominator <= 0) throw new PricingUnavailableError("collection_cost_exceeds_margin_budget");
  const baseMinimumPrice = (preCollectionCost + collectionFixed) / denominator;
  const riskBufferAmount = baseMinimumPrice * riskBufferPercentage;
  const adjusted =
    (baseMinimumPrice + riskBufferAmount) *
    (1 + absorbedTaxPercentage + planAdjustmentPercentage + reservePercentage);
  const normalCharge = roundUp(Math.max(minimumRequestCharge, adjusted), roundingIncrement);
  const requestedDiscount = promotion?.discount ?? 0;
  let customerCharge = roundUp(Math.max(0, normalCharge - requestedDiscount), roundingIncrement);
  const projectedCollectionCost = collectionFixed + customerCharge * collectionRate;
  const totalVariableCost = preCollectionCost + projectedCollectionCost;
  const marginMinimum = totalVariableCost / (1 - marginFloor);
  let promotionalSubsidy = 0;
  if (customerCharge + Number.EPSILON < marginMinimum) {
    if (
      !promotion?.administratorAuthorized ||
      !promotion.budgetId ||
      promotion.availableBudget < marginMinimum - customerCharge
    ) {
      throw new PricingUnavailableError("promotion_below_margin_floor");
    }
    promotionalSubsidy = marginMinimum - customerCharge;
  }
  const effectiveRevenue = customerCharge + promotionalSubsidy;
  const grossMarginPercentage = (effectiveRevenue - totalVariableCost) / effectiveRevenue;
  if (grossMarginPercentage + Number.EPSILON < marginFloor) {
    throw new PricingUnavailableError("margin_floor_not_met");
  }
  return Object.freeze({
    pricingVersionId: pricingVersion.id,
    marginFloor,
    publicPrice,
    currency,
    upstreamBreakdown,
    estimatedUpstreamCost: upstreamCost,
    estimatedTotalVariableCost: totalVariableCost,
    baseMinimumPrice,
    riskBufferAmount,
    normalCharge,
    customerCharge,
    maximumReservedCharge: customerCharge,
    promotionalSubsidy,
    roundingDifference: customerCharge - Math.max(0, normalCharge - requestedDiscount),
    projectedGrossProfit: effectiveRevenue - totalVariableCost,
    projectedGrossMarginPercentage: grossMarginPercentage,
  });
}

export function reconcileCharge({
  quote,
  actualUpstreamCost,
  actualAllowances = {},
  cause = "usage_variance",
}) {
  const other = Object.values(actualAllowances).reduce((sum, value) => sum + value, 0);
  const actualTotalVariableCost = actualUpstreamCost + other;
  const revenue = quote.customerCharge + quote.promotionalSubsidy;
  const grossProfit = revenue - actualTotalVariableCost;
  const grossMarginPercentage = revenue > 0 ? grossProfit / revenue : Number.NEGATIVE_INFINITY;
  const belowFloor = grossMarginPercentage < (quote.marginFloor ?? MARGIN_FLOOR);
  return {
    finalCustomerCharge: quote.customerCharge,
    finalUpstreamCost: actualUpstreamCost,
    actualTotalVariableCost,
    grossProfit,
    grossMarginPercentage,
    belowFloor,
    cause: belowFloor ? cause : null,
    requiredActions: belowFloor
      ? [
          "flag_request",
          "flag_model",
          "notify_administrators",
          "reconcile_pricing",
          "block_or_reprice_new_usage",
        ]
      : [],
  };
}
