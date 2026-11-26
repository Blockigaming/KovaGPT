export function canBuyUsageCredits(tier: unknown): tier is "free" | "plus" | "pro";

export function canUseCreditsForModel(tier: unknown, modelId: unknown): boolean;

export const DEFAULT_USAGE_CREDIT_MARGIN_BPS: 1000;

export function quoteUsageCreditDebit(input: {
  costMicros: number;
  topUpCents: number;
  paymentFeeCents: number;
  targetMarginBps?: number;
}): { debitMicros: number; fitsWithinFundingLotFaceValue: boolean };
