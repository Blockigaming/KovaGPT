export const USAGE_CREDIT_TIERS: readonly ["plus", "pro"];

export function canBuyUsageCredits(tier: unknown): tier is "plus" | "pro";

export const DEFAULT_USAGE_CREDIT_MARGIN_BPS: 1000;

export function quoteUsageCreditDebit(input: {
  costMicros: number;
  topUpCents: number;
  paymentFeeCents: number;
  targetMarginBps?: number;
}): { debitMicros: number; fitsWithinFundingLotFaceValue: boolean };
