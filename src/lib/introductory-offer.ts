import { CAPABILITY_REGISTRY } from "@/lib/capability-registry";
import type { BillingTier } from "@/lib/billing-plans";

/**
 * Public offer presentation only. The server verifies account history, the
 * selected plan and the discount before creating a checkout session.
 */
export const INTRODUCTORY_OFFER_LABEL = "50% off the first paid month, once per account";
export const INTRODUCTORY_OFFER_CHECKOUT_REVIEW =
  "Stripe Checkout confirms eligibility, the first payment and renewal amount before you subscribe.";
// The isolated lifecycle preview cannot create a real purchase.
export const INTRODUCTORY_OFFER_UNAVAILABLE = "No purchase can start from this review preview.";
export const INTRODUCTORY_OFFER_HISTORY =
  "Once per account. Cancellation, rejoining, changing plans and recovery during the 30-day deletion grace period keep the same offer history. A genuinely new account after confirmed, completed deletion may be eligible again.";
export const INTRODUCTORY_OFFER_EXISTING =
  "New subscriptions do not receive a free trial. Existing trials and subscriptions keep their current terms. Check Billing or Stripe for your verified status and charges.";

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function introductoryOfferForTier(tier: BillingTier) {
  const plan = CAPABILITY_REGISTRY.plans[tier];
  if (tier === "free") return null;
  const firstMonthUsd = Math.round(plan.monthlyPriceUsd * 100 * 0.5) / 100;
  return {
    firstMonthUsd,
    renewalMonthUsd: plan.monthlyPriceUsd,
    firstPaymentLabel: formatUsd(firstMonthUsd),
    renewalLabel: formatUsd(plan.monthlyPriceUsd),
    paymentCopy: `${formatUsd(firstMonthUsd)} for the first month, then ${formatUsd(plan.monthlyPriceUsd)}/month. USD, plus applicable tax.`,
  };
}
