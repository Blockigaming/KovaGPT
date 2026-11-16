const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseCheckoutRequest(value) {
  if (!isRecord(value)) {
    throw new TypeError("Invalid checkout request");
  }

  const priceId = Object.hasOwn(value, "priceId") ? value.priceId : undefined;
  const quantity = Object.hasOwn(value, "quantity") ? value.quantity : undefined;
  const couponId = Object.hasOwn(value, "couponId") ? value.couponId : undefined;
  if (
    typeof priceId !== "string" ||
    priceId.length === 0 ||
    (quantity !== undefined && quantity !== 1) ||
    (couponId !== undefined &&
      couponId !== null &&
      (typeof couponId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(couponId)))
  ) {
    throw new TypeError("Invalid checkout request");
  }

  const parsed = Object.assign(Object.create(null), { priceId });
  if (quantity === 1) parsed.quantity = 1;
  if (couponId !== undefined) parsed.couponId = couponId;
  return Object.freeze(parsed);
}
