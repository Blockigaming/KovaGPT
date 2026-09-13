export function fundingCheckoutParameters(
  attempt: Record<string, unknown>,
  origin: string,
): Record<string, unknown>;
export function verifiedFundingReceipt(
  attempt: Record<string, unknown>,
  session: unknown,
  charge: unknown,
  dispute?: unknown,
  adjustmentTransactions?: unknown[],
): { state: "expired" | "open" | "paid"; url?: string; receipt: Record<string, unknown> | null };
