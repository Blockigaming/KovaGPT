const ALLOWED_BILLING_RETURN_ORIGINS = new Set([
  "https://kovagpt.com",
  "https://kovagpt-prod-web.purpleglacier-b10c3746.eastus.azurecontainerapps.io",
]);

/** Billing chooses a deployment origin server-side; the browser never supplies a return URL. */
export function billingReturnUrls(origin) {
  if (!billingReturnOriginConfigured(origin)) throw new Error("billing_return_origin_unconfigured");
  return {
    checkout: `${origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    portal: `${origin}/`,
  };
}

export function billingReturnOriginConfigured(origin) {
  return typeof origin === "string" && ALLOWED_BILLING_RETURN_ORIGINS.has(origin);
}
