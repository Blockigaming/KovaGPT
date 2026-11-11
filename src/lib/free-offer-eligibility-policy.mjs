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

/** A configured coupon ID is not proof of a redeemable first-month offer. */
export function isVerifiedFirstMonthCoupon(coupon, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!coupon || typeof coupon !== "object" || coupon.deleted === true) return false;
  return (
    coupon.valid === true &&
    coupon.percent_off === 50 &&
    coupon.duration === "once" &&
    (coupon.redeem_by === null ||
      (Number.isSafeInteger(coupon.redeem_by) && coupon.redeem_by > nowSeconds)) &&
    (coupon.max_redemptions === null ||
      (Number.isInteger(coupon.max_redemptions) &&
        coupon.max_redemptions > 0 &&
        Number.isInteger(coupon.times_redeemed) &&
        coupon.times_redeemed < coupon.max_redemptions))
  );
}
