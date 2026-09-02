export type BillingTier = "free" | "plus" | "pro";

export const BILLING_ENV = "live" as const;

export const BILLING_PLANS = Object.freeze({
  plus_monthly: {
    lookupKey: "plus_monthly",
    livePriceId: "price_1UAzhHAEZlsb6DBYWw2oUCeO",
    tier: "plus",
    trialPeriodDays: 30,
  },
  pro_monthly: {
    lookupKey: "pro_monthly",
    livePriceId: "price_1UAzhRAEZlsb6DBYlafU4mhc",
    tier: "pro",
    trialPeriodDays: 0,
  },
} as const);

export type BillingLookupKey = keyof typeof BILLING_PLANS;

export function resolveBillingPlan(value: string | null | undefined) {
  if (!value) return null;
  if (Object.prototype.hasOwnProperty.call(BILLING_PLANS, value)) {
    return BILLING_PLANS[value as BillingLookupKey];
  }
  return Object.values(BILLING_PLANS).find((plan) => plan.livePriceId === value) ?? null;
}

export function tierForLookupKey(value: string | null | undefined): BillingTier {
  return resolveBillingPlan(value)?.tier ?? "free";
}
