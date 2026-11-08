export const TEAM_PRICES = Object.freeze({
  standard_month: { key: "kova_team_standard_monthly", amount: 2500, interval: "month" },
  standard_year: { key: "kova_team_standard_annual", amount: 24000, interval: "year" },
  premium_month: { key: "kova_team_premium_monthly", amount: 12500, interval: "month" },
  premium_year: { key: "kova_team_premium_annual", amount: 120000, interval: "year" },
});
export function validateTeamSelection(value) {
  if (
    !value ||
    !["month", "year"].includes(value.interval) ||
    !Number.isInteger(value.standard) ||
    !Number.isInteger(value.premium) ||
    value.standard < 0 ||
    value.premium < 0 ||
    value.standard + value.premium < 2 ||
    value.standard + value.premium > 150
  )
    throw new Error("Choose 2–150 seats and a monthly or annual billing period.");
  return { standard: value.standard, premium: value.premium, interval: value.interval };
}
export function validateTeamPrice(price, definition, live = true) {
  if (
    !price?.active ||
    price.livemode !== live ||
    price.currency !== "usd" ||
    price.lookup_key !== definition.key ||
    price.unit_amount !== definition.amount ||
    price.recurring?.interval !== definition.interval ||
    price.recurring?.interval_count !== 1 ||
    price.recurring?.usage_type !== "licensed" ||
    price.billing_scheme !== "per_unit"
  )
    throw new Error("Team pricing is not configured correctly. No payment was started.");
  return price.id;
}
export function teamCheckoutUrl(value) {
  const url = new URL(value);
  if (url.origin !== "https://checkout.stripe.com")
    throw new Error("Secure checkout is unavailable.");
  return url.href;
}
