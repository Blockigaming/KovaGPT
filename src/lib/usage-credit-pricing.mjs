import { consumerModel } from "./consumer-model-selection.mjs";

const USAGE_CREDIT_TIERS = Object.freeze(["free", "plus", "pro"]);

export function canBuyUsageCredits(tier) {
  return USAGE_CREDIT_TIERS.includes(tier);
}

export function canUseCreditsForModel(tier, modelId) {
  return canBuyUsageCredits(tier) && Boolean(consumerModel(modelId)?.tiers.includes(tier));
}

export const DEFAULT_USAGE_CREDIT_MARGIN_BPS = 1_000;

const BPS = 10_000n;
const MICROS_PER_CENT = 10_000n;

/**
 * Quote a minimum charge for known, attributable costs. All USD amounts use
 * integer millionths of a dollar except the top-up and its fee, which use cents.
 * Allocate actual processing fees across the top-up's face value and round the
 * charge up. Balance debits funded by different top-ups must be priced using
 * the fee allocation of each funding lot or the most expensive eligible lot.
 */
export function quoteUsageCreditDebit({
  costMicros,
  topUpCents,
  paymentFeeCents,
  targetMarginBps = DEFAULT_USAGE_CREDIT_MARGIN_BPS,
}) {
  if (
    ![costMicros, topUpCents, paymentFeeCents, targetMarginBps].every(Number.isSafeInteger) ||
    costMicros <= 0 ||
    topUpCents <= 0 ||
    paymentFeeCents < 0 ||
    targetMarginBps <= 0 ||
    targetMarginBps >= Number(BPS)
  ) {
    throw new RangeError("Invalid usage credit pricing inputs");
  }

  const gross = BigInt(topUpCents);
  const fee = BigInt(paymentFeeCents);
  const margin = BigInt(targetMarginBps);
  const divisor = gross * (BPS - margin) - fee * BPS;
  if (divisor <= 0n) throw new RangeError("Top-up cannot support the target margin");

  const numerator = BigInt(costMicros) * gross * BPS;
  const charge = (numerator + divisor - 1n) / divisor;
  if (charge > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Usage charge is too large");
  return {
    debitMicros: Number(charge),
    fitsWithinFundingLotFaceValue: charge <= gross * MICROS_PER_CENT,
  };
}
