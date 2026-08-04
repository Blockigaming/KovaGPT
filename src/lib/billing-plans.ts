export type BillingTier = "free" | "plus" | "pro";

export const BILLING_ENV = "live" as const;

export const BILLING_PLANS = Object.freeze({
  plus_monthly: {
    lookupKey: "plus_monthly",
    tier: "plus",
    trialPeriodDays: 30,
  },
  pro_monthly: {
    lookupKey: "pro_monthly",
    tier: "pro",
    trialPeriodDays: 0,
  },
} as const);

export type BillingLookupKey = keyof typeof BILLING_PLANS;

export function resolveBillingPlan(value: string | null | undefined) {
  if (!value || !Object.prototype.hasOwnProperty.call(BILLING_PLANS, value)) return null;
  return BILLING_PLANS[value as BillingLookupKey];
}

export function tierForLookupKey(value: string | null | undefined): BillingTier {
  return resolveBillingPlan(value)?.tier ?? "free";
}
