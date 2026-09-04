import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("pricing keeps the published prices and production checkout lookup keys", async () => {
  const [pricing, registry] = await Promise.all([
    read("src/routes/pricing.tsx"),
    read("src/lib/capability-registry.ts"),
  ]);

  assert.match(
    registry,
    /plus:\s*\{[\s\S]*?monthlyPriceUsd:\s*16,[\s\S]*?lookupKey:\s*BILLING_PLANS\.plus_monthly\.lookupKey/,
  );
  assert.match(
    registry,
    /pro:\s*\{[\s\S]*?monthlyPriceUsd:\s*89,[\s\S]*?lookupKey:\s*BILLING_PLANS\.pro_monthly\.lookupKey/,
  );
  assert.match(pricing, /useStripeCheckout\(\)/);
  assert.match(
    pricing,
    /openCheckout\(\{\s*priceId,\s*customerEmail: user\?\.email,\s*userId: user\?\.id/,
  );
  assert.match(pricing, /CAPABILITY_REGISTRY\.plans\.plus\.lookupKey!/);
  assert.match(pricing, /CAPABILITY_REGISTRY\.plans\.pro\.lookupKey!/);
});

test("checkout uses an accessible modal with truthful loading and safe errors", async () => {
  const [pricing, checkout] = await Promise.all([
    read("src/routes/pricing.tsx"),
    read("src/components/StripeEmbeddedCheckout.tsx"),
  ]);

  assert.match(pricing, /<Dialog open=\{isOpen\}/);
  assert.match(pricing, /onOpenChange=\{\(open\) => !open && closeCheckout\(\)\}/);
  assert.match(pricing, /<DialogTitle>Secure checkout<\/DialogTitle>/);
  assert.match(pricing, /<DialogDescription>/);
  assert.match(pricing, /aria-busy=\{checkoutStatus === "loading"\}/);
  assert.match(pricing, /role="status" aria-live="polite"/);
  assert.match(
    pricing,
    /role="status" aria-live="polite"[\s\S]*?<div\s+ref=\{checkoutRegionRef\}\s+aria-busy=/,
  );
  assert.match(pricing, /state === "loaded"/);
  assert.match(pricing, /Secure checkout loaded/);
  assert.doesNotMatch(pricing, /querySelector\("iframe"\)/);
  assert.match(pricing, /onCloseAutoFocus=/);
  assert.match(pricing, /requestAnimationFrame\(\(\) => trigger\.focus\(\)\)/);
  assert.match(pricing, /\[&>button\]:h-11 \[&>button\]:w-11/);
  assert.doesNotMatch(pricing, /fixed inset-0 z-50 bg-black\/70/);
  assert.match(checkout, /const CHECKOUT_ERROR_MESSAGE =/);
  assert.match(checkout, /const ACTIVE_SUBSCRIPTION_ERROR_MESSAGE =/);
  assert.match(checkout, /result\.error === ACTIVE_SUBSCRIPTION_ERROR_MESSAGE/);
  assert.match(checkout, /setCheckoutErrorMessage\(publicErrorMessage\)/);
  assert.match(checkout, /onLoadCapture=/);
  assert.match(checkout, /event\.target instanceof HTMLIFrameElement/);
  assert.match(checkout, /data-checkout-state=\{checkoutFrameLoaded \? "loaded" : "loading"\}/);
  assert.match(checkout, /errorName: safeErrorName\(error\)/);
  assert.match(checkout, /throw new Error\(publicErrorMessage, \{ cause: error \}\)/);
  assert.doesNotMatch(checkout, /setCheckoutErrorMessage\(result\.error\)/);
  assert.doesNotMatch(checkout, /setError\(msg\)/);
});

test("plan cards expose a coherent hierarchy and aligned, 44px actions", async () => {
  const pricing = await read("src/routes/pricing.tsx");

  assert.match(pricing, /id="pricing-title"/);
  assert.match(pricing, /aria-label="KovaGPT plans"/);
  assert.match(pricing, /data-pricing-plan=\{name\.toLowerCase\(\)\}/);
  assert.match(pricing, /<article[\s\S]*?<h2[\s\S]*?<ul[\s\S]*?<button/);
  assert.match(pricing, /type="button"/);
  assert.match(pricing, /mt-auto inline-flex min-h-11 w-full/);
  assert.match(pricing, /shadow-lg shadow-foreground\/10/);
  assert.doesNotMatch(pricing, /hsl\(var\(--foreground\)/);
});
