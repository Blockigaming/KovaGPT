import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("pricing keeps the published prices and production checkout lookup keys", async () => {
  const [pricing, registry, billingPlans, manualHandoff, rollout] = await Promise.all([
    read("src/routes/pricing.tsx"),
    read("src/lib/capability-registry.ts"),
    read("src/lib/billing-plans.ts"),
    read("docs/release/KOVAGPT_MANUAL_HANDOFF.md"),
    read("docs/release/STRIPE_BILLING_ROLLOUT.md"),
  ]);

  assert.match(
    registry,
    /plus:\s*\{[\s\S]*?monthlyPriceUsd:\s*16,[\s\S]*?lookupKey:\s*BILLING_PLANS\.plus_monthly\.lookupKey/,
  );
  assert.match(
    registry,
    /pro:\s*\{[\s\S]*?monthlyPriceUsd:\s*80,[\s\S]*?lookupKey:\s*BILLING_PLANS\.pro_monthly\.lookupKey/,
  );
  assert.match(
    billingPlans,
    /pro_monthly:\s*\{[\s\S]*?lookupKey:\s*"pro_monthly",[\s\S]*?livePriceId:\s*"price_1UEw6FAEZlsb6DBYuksCKOBR"/,
  );
  assert.doesNotMatch(billingPlans, /price_1UAzhRAEZlsb6DBYlafU4mhc/);
  assert.match(pricing, /useNavigate\(\)/);
  assert.match(pricing, /navigate\(\{ to: "\/subscribe"[\s\S]*search: \{ plan: priceId \}/);
  assert.match(pricing, /CAPABILITY_REGISTRY\.plans\.plus\.lookupKey!/);
  assert.match(pricing, /CAPABILITY_REGISTRY\.plans\.pro\.lookupKey!/);
  assert.match(
    manualHandoff,
    /current live Pro price\s+`price_1UEw6FAEZlsb6DBYuksCKOBR` \(USD 80\/month\)/u,
  );
  assert.match(
    manualHandoff,
    /historical Pro price\s+`price_1UAzhRAEZlsb6DBYlafU4mhc` \(USD 89\/month\)/u,
  );
  assert.match(manualHandoff, /do not offer it for\s+new USD 80 checkouts/u);
  assert.match(manualHandoff, /do not create\s+another Price for this rollout/u);
  assert.doesNotMatch(manualHandoff, /must\s+create a new immutable recurring Pro Price/u);
  assert.match(
    rollout,
    /legacy Pro updates and upserts preserve the exact Price ID already stored/u,
  );
  assert.match(
    rollout,
    /user-level Checkout attempt does not prove which subscription it created/u,
  );
  assert.match(rollout, /remains visibly quarantined under that unmapped value/u);
  assert.match(rollout, /grants no paid\s+entitlement/u);
  assert.match(
    rollout,
    /quarantines exact-looking Pro rows[\s\S]*?no authoritative Stripe event or observation provenance/u,
  );
  assert.match(
    rollout,
    /If a row appears later, disable legacy intake and run exact-ID\s+reconciliation/u,
  );
  assert.match(
    rollout,
    /`20260904231210`, `20260904231213`,\s*`20260913013131`, `20260913023331`, `20260913153000`, and\s*`20260913210000` in timestamp order/u,
  );
});

test("checkout uses an account-bound page with truthful loading and safe errors", async () => {
  const [pricing, checkout, subscribe] = await Promise.all([
    read("src/routes/pricing.tsx"),
    read("src/components/StripeEmbeddedCheckout.tsx"),
    read("src/routes/subscribe.tsx"),
  ]);
  assert.doesNotMatch(pricing, /<Dialog/);
  assert.match(subscribe, /<main/);
  assert.match(subscribe, /Complete your subscription/);
  assert.match(subscribe, /Back to plans/);
  assert.match(subscribe, /!isLoaded/);
  assert.match(subscribe, /!isSignedIn/);
  assert.match(subscribe, /key=\{`\$\{user\?\.id\}:\$\{plan\}`\}/);
  assert.match(checkout, /data-checkout-state=\{error \? "error" : busy \? "loading" : "ready"\}/);
  assert.match(checkout, /const CHECKOUT_ERROR_MESSAGE =/);
  assert.match(checkout, /const ACTIVE_SUBSCRIPTION_ERROR_MESSAGE =/);
  assert.match(checkout, /SAFE_CHECKOUT_ERRORS\.has\(reason\.message\)/);
  assert.match(checkout, /current\.current !== scope/);
  assert.match(checkout, /url\.origin !== "https:\/\/checkout\.stripe\.com"/);
  assert.match(checkout, /window\.location\.assign\(url\.href\)/);
  assert.doesNotMatch(
    checkout,
    /EmbeddedCheckoutProvider|HTMLIFrameElement|setError\(result\.error\)/,
  );
});

test("plan cards expose aligned 44px actions and the flat ChatGPT pricing hierarchy", async () => {
  const [pricing, surfaces] = await Promise.all([
    read("src/routes/pricing.tsx"),
    read("src/components/account-surfaces.css"),
  ]);

  assert.match(pricing, /id="pricing-title"/);
  assert.match(pricing, /aria-label="KovaGPT plans"/);
  assert.match(pricing, /data-pricing-plan=\{planId\}/);
  assert.match(pricing, /<article[\s\S]*?<h2[\s\S]*?<button[\s\S]*?<ul/);
  assert.match(pricing, /data-ui-reference="chatgpt-pricing-plan-card"/);
  assert.match(pricing, /md:row-span-6 md:h-full md:grid-rows-subgrid/);
  assert.match(pricing, /type="button"/);
  assert.match(pricing, /inline-flex h-11 w-full/);
  assert.match(
    surfaces,
    /\.kova-pricing-page \.kova-plan-card\s*\{[^}]*max-width: 384px;[^}]*row-gap: 20px;[^}]*box-shadow: none;/,
  );
  assert.match(
    surfaces,
    /\.kova-pricing-page \.kova-plan-card:hover\s*\{[^}]*transform: none;[^}]*box-shadow: none;/,
  );
  assert.doesNotMatch(pricing, /hsl\(var\(--foreground\)/);
});
