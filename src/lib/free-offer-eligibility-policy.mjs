/**
 * Client marketing visibility is a conservative hint, never an authorization
 * to apply a discount. Checkout independently verifies eligibility.
 */
export function canDisplayFreeIntroOffer({
  summary,
  redeemed,
  pendingClaim,
  billingEnabled,
  couponConfigured,
} = {}) {
  return (
    billingEnabled === true &&
    couponConfigured === true &&
    summary !== null &&
    typeof summary === "object" &&
    !Array.isArray(summary) &&
    summary.tier === "free" &&
    summary.effectiveTier === "free" &&
    summary.activeSubscriptionCount === 0 &&
    summary.billingConflict === false &&
    summary.billingSetupIncomplete !== true &&
    summary.trialing !== true &&
    redeemed === false &&
    pendingClaim === false
  );
}
