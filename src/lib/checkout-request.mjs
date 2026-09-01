const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseCheckoutRequest(value) {
  if (
    !isRecord(value) ||
    typeof value.priceId !== "string" ||
    value.priceId.length === 0 ||
    (value.quantity !== undefined && value.quantity !== 1)
  ) {
    throw new TypeError("Invalid checkout request");
  }

  return Object.freeze({
    priceId: value.priceId,
    ...(value.quantity === 1 && { quantity: 1 }),
  });
}
