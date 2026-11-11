import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canDisplayFreeIntroOffer } from "../../src/lib/free-offer-eligibility-policy.mjs";

const base = {
  summary: {
    tier: "free",
    effectiveTier: "free",
    activeSubscriptionCount: 0,
    billingConflict: false,
    billingSetupIncomplete: false,
    trialing: false,
  },
  redeemed: false,
  pendingClaim: false,
  billingEnabled: true,
  couponConfigured: true,
};
test("offer requires a verified unambiguous free account and real coupon", () => {
  assert.equal(canDisplayFreeIntroOffer(base), true);
  for (const change of [
    { redeemed: true },
    { pendingClaim: true },
    { couponConfigured: false },
    { billingEnabled: false },
    { summary: { ...base.summary, tier: "plus" } },
    { summary: { ...base.summary, effectiveTier: "pro" } },
    { summary: { ...base.summary, activeSubscriptionCount: 1 } },
    { summary: { ...base.summary, billingConflict: true } },
    { summary: { ...base.summary, billingSetupIncomplete: true } },
    { summary: null },
  ]) {
    assert.equal(canDisplayFreeIntroOffer({ ...base, ...change }), false, JSON.stringify(change));
  }
});
test("unknown billing fields fail closed", () => {
  assert.equal(canDisplayFreeIntroOffer({ ...base, summary: { tier: "free" } }), false);
  assert.equal(canDisplayFreeIntroOffer({ ...base, redeemed: undefined }), false);
});
test("user-visible offer requires server precheck, never bare free-tier status", () => {
  const source = readFileSync("src/components/FreeOfferButton.tsx", "utf8");
  const backend = readFileSync("src/lib/free-offer-eligibility.functions.ts", "utf8");
  assert.match(source, /getFreeOfferEligibility/);
  assert.match(source, /!offer\.eligible/);
  assert.match(backend, /kova_policy_intro_redemptions/);
  assert.match(backend, /kova_policy_checkout_claims/);
});

test("eligible offer notice is server-evidenced and has an actionable checkout destination", () => {
  const source = readFileSync("src/components/FreeOfferButton.tsx", "utf8");
  assert.match(source, /if \(eligible && variant === "toolbar"\)/);
  assert.match(source, /id: "offer_available"/);
  assert.match(source, /confirmed: true/);
  assert.match(source, /campaignId: "monthly-intro-v1"/);
  assert.match(source, /to: "\/subscribe"/);
  const dismissal = readFileSync("src/lib/notification-dismissal-policy.mjs", "utf8");
  assert.match(dismissal, /PROMOTIONAL_BILLING_IDS/);
});
