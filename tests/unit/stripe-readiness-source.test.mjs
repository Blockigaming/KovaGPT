import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../../src/lib/readiness.server.ts", import.meta.url);

test("billing readiness is split and account-scoped", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(moduleUrl, "utf8");

  assert.match(source, /STRIPE_LIVE_ACCOUNT_ID/);
  assert.match(source, /PUBLIC_STRIPE_ACCOUNT_ID/);
  assert.match(source, /stripeWebhook:/);
  assert.match(source, /stripeCheckout:/);
  assert.match(source, /stripePortal:/);
  assert.match(source, /VITE_PAYMENTS_CLIENT_TOKEN/);
  assert.match(source, /STRIPE_BILLING_PORTAL_CONFIGURATION_ID/);
  assert.match(source, /PAYMENTS_LIVE_WEBHOOK_SECRET/);
  assert.match(
    source,
    /stripeWebhookConfigured\(\)[\s\S]*stripeCheckoutConfigured\(\)[\s\S]*stripePortalConfigured\(\)/,
  );
});
