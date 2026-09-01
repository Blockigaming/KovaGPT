export const CHECKOUT_RETURN_URL =
  "https://kovagpt.com/checkout/return?session_id={CHECKOUT_SESSION_ID}";

export function parseAllowedCheckoutReturnUrl(value) {
  if (value !== CHECKOUT_RETURN_URL) {
    throw new TypeError("Invalid checkout return URL");
  }
  return CHECKOUT_RETURN_URL;
}
