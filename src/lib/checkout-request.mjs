const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseCheckoutRequest(value) {
  if (!isRecord(value)) {
    throw new TypeError("Invalid checkout request");
  }

  const priceId = Object.hasOwn(value, "priceId") ? value.priceId : undefined;
  const quantity = Object.hasOwn(value, "quantity") ? value.quantity : undefined;
  if (
    typeof priceId !== "string" ||
    priceId.length === 0 ||
    (quantity !== undefined && quantity !== 1)
  ) {
    throw new TypeError("Invalid checkout request");
  }

  const parsed = Object.assign(Object.create(null), { priceId });
  if (quantity === 1) parsed.quantity = 1;
  return Object.freeze(parsed);
}
