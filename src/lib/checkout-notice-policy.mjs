/**
 * A successful checkout redirect is not payment verification. Keep a short
 * account-scoped marker only so the return page can announce a backend-confirmed
 * paid plan without implying the redirect itself activated a subscription.
 */
export const CHECKOUT_ORIGIN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function checkoutOriginKey(userId) {
  return typeof userId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
      ? "kova:checkout-origin:" + userId
      : null;
}
export function activeCheckoutOrigin(value, ownerId, now = Date.now()) {
  if (!value || typeof value !== "object" || !checkoutOriginKey(ownerId))
    return false;
  return value.ownerId === ownerId &&
    Number.isSafeInteger(value.startedAt) &&
    now >= value.startedAt &&
    now - value.startedAt <= CHECKOUT_ORIGIN_MAX_AGE_MS;
}
