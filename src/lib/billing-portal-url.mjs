const ALLOWED_BILLING_PORTAL_HOSTS = new Set(["billing.stripe.com"]);

/**
 * Return a normalized Stripe-hosted billing URL, or null when navigation would
 * leave the allowlisted HTTPS host contract.
 */
export function parseAllowedBillingPortalUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_BILLING_PORTAL_HOSTS.has(url.hostname)) return null;
    if (url.port || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
