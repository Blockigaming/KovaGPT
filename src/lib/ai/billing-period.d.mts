export type BillingPeriodRow = {
  environment?: string | null;
  status?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
};

export function resolveCurrentBillingPeriod(
  rows: BillingPeriodRow[] | null | undefined,
  options?: { billingEnvironment?: string; now?: number },
): [string, string] | null;
