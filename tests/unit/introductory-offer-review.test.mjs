import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { reactFixture, text } from "../helpers/kova-react-fixture.mjs";
import * as sampleModule from "../../review-kit/introductory-offer-review-fixture.mjs";
import { ACCOUNT_DELETION_GRACE_MS } from "../../src/lib/account-deletion-grace.mjs";

const cache = new Map();
function sourceModule(path) {
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name.startsWith("@/lib/"));
    return sourceModule(name.replace("@/", "src/") + (name.endsWith(".mjs") ? "" : ".ts"));
  });
  cache.set(path, exports);
  return exports;
}
const offers = sourceModule("src/lib/introductory-offer.ts");
const registry = sourceModule("src/lib/capability-registry.ts");
const {
  createIntroductoryOfferSample: create,
  introductoryOfferSampleReducer: reduce,
  introductoryOfferSampleEligibility: eligibility,
} = sampleModule;
const event = (state, type, extra = {}) => ({
  accountId: state.accountId,
  generation: state.generation,
  type,
  ...extra,
});
const step = (state, type, extra) => reduce(state, event(state, type, extra));

test("offer amounts derive from the canonical plan catalog while server eligibility remains authoritative", () => {
  assert.equal(Object.hasOwn(offers, "INTRODUCTORY_OFFER_CHECKOUT_READY"), false);
  assert.match(offers.INTRODUCTORY_OFFER_LABEL, /first paid month, once per account/);
  assert.match(offers.INTRODUCTORY_OFFER_CHECKOUT_REVIEW, /confirms eligibility/);
  assert.equal(offers.introductoryOfferForTier("free"), null);
  for (const tier of ["plus", "pro"]) {
    const offer = offers.introductoryOfferForTier(tier);
    assert.equal(offer.firstMonthUsd, registry.CAPABILITY_REGISTRY.plans[tier].monthlyPriceUsd / 2);
    assert.equal(offer.renewalMonthUsd, registry.CAPABILITY_REGISTRY.plans[tier].monthlyPriceUsd);
    assert.match(offer.paymentCopy, /first month, then .*\/month\. USD, plus applicable tax/);
    assert.equal(registry.CAPABILITY_REGISTRY.plans[tier].trialPeriodDays, 0);
    assert.equal(
      sourceModule("src/lib/billing-plans.ts").BILLING_PLANS[`${tier}_monthly`].trialPeriodDays,
      0,
    );
  }
  assert.equal(
    offers.introductoryOfferForTier("plus").paymentCopy,
    "$8 for the first month, then $16/month. USD, plus applicable tax.",
  );
  assert.equal(
    offers.introductoryOfferForTier("pro").paymentCopy,
    "$40 for the first month, then $80/month. USD, plus applicable tax.",
  );
});

test("once used, a fictional account retains usage through repeat payment, cancellation, rejoin, plan switch and recovery", () => {
  let state = create();
  const originalId = state.accountId;
  assert.equal(eligibility(state), "eligible-sample");
  state = step(state, "record-first-payment");
  const used = state;
  assert.equal(step(state, "record-first-payment"), state);
  for (const action of ["cancel", "rejoin", "change-plan", "schedule-deletion", "recover"]) {
    state = step(state, action);
    assert.equal(state.accountId, originalId);
    assert.equal(state.offerUsed, true, action);
    assert.equal(state.priorSubscription, true, action);
    assert.notEqual(eligibility(state), "eligible-sample", action);
  }
  assert.equal(state.tier, "pro");
  assert.equal(eligibility(state), "already-used");
  assert.equal(used.offerUsed, true, "previous snapshots are not mutated");
});

test("thirty-day deadline does not prove deletion or restore eligibility; only a distinct new-account sample can reset history", () => {
  let state = step(create("used"), "schedule-deletion");
  const oldIdentity = state.accountId;
  assert.equal(
    Date.parse(state.recoveryDeadline) - Date.parse(sampleModule.OFFER_SAMPLE_REQUESTED_AT),
    ACCOUNT_DELETION_GRACE_MS,
  );
  assert.equal(ACCOUNT_DELETION_GRACE_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(step(state, "create-new-account"), state);
  state = step(state, "pass-deadline");
  assert.equal(state.accountStatus, "expired");
  assert.equal(state.offerUsed, true);
  assert.equal(step(state, "recover"), state);
  assert.equal(step(state, "create-new-account"), state);
  state = step(state, "load-deletion-receipt");
  assert.equal(state.accountStatus, "deleted");
  assert.equal(state.offerUsed, true);
  assert.equal(eligibility(state), "account-unavailable");
  const next = step(state, "create-new-account");
  assert.notEqual(next.accountId, oldIdentity);
  assert.equal(next.previousAccountDeletionConfirmed, true);
  assert.equal(next.offerUsed, false);
  assert.equal(eligibility(next), "eligible-sample");
  assert.equal(
    step(next, "create-new-account"),
    next,
    "repeated create does not reset the current account",
  );
});

test("grandfathered trials and subscriptions retain their terms, while missing history fails closed", () => {
  for (const scenario of ["existing-trial", "existing-subscription"]) {
    const state = create(scenario);
    assert.equal(eligibility(state), "grandfathered");
    assert.equal(step(state, "record-first-payment"), state);
    assert.equal(
      step(step(state, "schedule-deletion"), "recover").grandfathered,
      state.grandfathered,
    );
    assert.equal(state.subscription, scenario === "existing-trial" ? "trialing" : "active");
  }
  for (const scenario of ["unverified", "invalid-fixture"])
    assert.equal(eligibility(create(scenario)), "unverified");
});

test("review fixture events are identity-scoped and stale selections cannot reset or consume history", () => {
  const state = create("used");
  assert.equal(reduce(state, { ...event(state, "recover"), accountId: "other-account" }), state);
  assert.equal(
    reduce(state, {
      ...event(state, "select-sample", { scenario: "new-account" }),
      generation: -1,
    }),
    state,
  );
  const replacement = step(state, "select-sample", { scenario: "new-account" });
  assert.equal(replacement.generation, state.generation + 1);
  assert.equal(reduce(replacement, event(state, "record-first-payment")), replacement);
});

function pricingFixture(isSignedIn) {
  const calls = [];
  const f = reactFixture("src/routes/pricing.tsx", (exports) => exports.PricingPage, {
    sourceSuffix: "\nexport { PricingPage };",
    modules: {
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({
          user: { id: "sample", email: "sample@example.test" },
          isSignedIn,
          isLoaded: true,
        }),
        useClerkSafe: () => ({ openSignIn: () => calls.push("sign-in") }),
      },
      "@/hooks/useStripeCheckout": {
        useStripeCheckout: () => ({
          openCheckout: (options) => calls.push({ type: "checkout", options: { ...options } }),
          closeCheckout: () => calls.push("close"),
          isOpen: false,
          checkoutElement: null,
        }),
      },
      "@/components/EnterpriseContactDialog": { EnterpriseContactDialog: "enterprise-dialog" },
      "@/components/public/PublicShell": { PublicShell: "public-shell" },
      "@/components/public/PlanComparison": { PlanComparison: "comparison" },
      "@/components/ui/dialog": {
        Dialog: "dialog",
        DialogContent: "dialog-content",
        DialogDescription: "dialog-description",
        DialogHeader: "dialog-header",
        DialogTitle: "dialog-title",
      },
      "@/lib/capability-registry": registry,
      "@/lib/introductory-offer": offers,
    },
  });
  f.render();
  return { ...f, calls };
}

test("pricing routes signed-in paid CTAs to canonical checkout and guests to sign-in without claiming eligibility", () => {
  for (const signedIn of [true, false]) {
    const f = pricingFixture(signedIn);
    const paid = f
      .nodes()
      .filter((n) => n.type?.name === "PlanCard" && ["Plus", "Pro"].includes(n.props.name));
    assert.equal(paid.length, 2);
    for (const card of paid) {
      assert.ok(!card.props.ctaDisabled);
      assert.equal(card.props.cta, card.props.name === "Plus" ? "Start Plus" : "Upgrade to Pro");
      assert.match(card.props.note, /first paid month, once per account/);
      assert.match(card.props.paymentNote, /^If eligible: .*first month, then/);
      card.props.onCta({ currentTarget: {} });
      card.props.onCta({ currentTarget: {} });
    }
    assert.deepEqual(
      f.calls,
      signedIn
        ? ["plus", "plus", "pro", "pro"].map((tier) => ({
            type: "checkout",
            options: {
              priceId: registry.CAPABILITY_REGISTRY.plans[tier].lookupKey,
              customerEmail: "sample@example.test",
              userId: "sample",
            },
          }))
        : ["sign-in", "sign-in", "sign-in", "sign-in"],
    );
    assert.match(f.text(), /Stripe Checkout confirms eligibility/);
    assert.match(f.text(), /Existing trials and subscriptions keep their current terms/);
    assert.match(f.text(), /New subscriptions do not receive a free trial/);
    assert.doesNotMatch(
      f.text(),
      /review proposal|Proposed first payment|Eligibility unverified|Offer checkout unavailable|30-day trial for eligible first-time subscribers/,
    );
  }
});

test("the actual review component exposes all lifecycle samples and preserves history through its callbacks", async () => {
  const f = reactFixture(
    "review-kit/components/IntroductoryOfferPreview.tsx",
    (exports) => exports.IntroductoryOfferPreview,
    {
      modules: {
        "@/lib/capability-registry": registry,
        "@/lib/introductory-offer": offers,
        "../introductory-offer-review-fixture.mjs": sampleModule,
      },
    },
  );
  f.render();
  assert.equal(
    f.nodes().filter((n) => n.type === "option").length,
    sampleModule.INTRODUCTORY_OFFER_REVIEW_SCENARIOS.length,
  );
  assert.match(f.text(), /No real account is checked or changed/);
  for (const label of [
    "Record sample first payment",
    "Cancel sample subscription",
    "Rejoin same sample account",
    "Change sample plan",
    "Schedule sample deletion",
    "Recover same sample account",
  ])
    await f.click(label);
  assert.match(f.text(), /Used on this account/);
  assert.match(f.text(), /Already used · no second introductory discount/);
  assert.ok(
    f
      .nodes()
      .filter((n) => n.type === "button")
      .every((n) => text(n) !== "Record sample first payment"),
  );
  for (const [id] of sampleModule.INTRODUCTORY_OFFER_REVIEW_SCENARIOS) {
    f.find("select").props.onChange({ target: { value: id } });
    await f.flush();
    assert.equal(f.find("select").props.value, id);
    assert.match(f.text(), /No real account is checked or changed/);
  }
});

test("offer samples remain isolated from payment, account APIs and persistent client storage", () => {
  for (const path of [
    "review-kit/components/IntroductoryOfferPreview.tsx",
    "review-kit/introductory-offer-review-fixture.mjs",
    "src/lib/introductory-offer.ts",
  ])
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /fetch\(|useServerFn|localStorage|sessionStorage|createCheckoutSession|supabase|stripe\.checkout/,
    );
  assert.match(
    readFileSync("review-kit/core-preview.tsx", "utf8"),
    /"Introductory offer": IntroductoryOfferPreview/,
  );
  assert.doesNotMatch(readFileSync("review-kit/core-preview.tsx", "utf8"), /Trials: TrialPreview/);
});
