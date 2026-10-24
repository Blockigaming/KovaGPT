import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createContentLoader } from "../../scripts/publication/source-loader.mjs";

test("both paid monthly plans publish the once-per-account first-month offer without new trials", () => {
  const { load } = createContentLoader();
  const registry = load("src/lib/capability-registry.ts").CAPABILITY_REGISTRY;
  const billingPlans = load("src/lib/billing-plans.ts").BILLING_PLANS;
  for (const tier of ["plus", "pro"]) {
    assert.equal(registry.plans[tier].trialPeriodDays, 0);
    assert.equal(billingPlans[`${tier}_monthly`].trialPeriodDays, 0);
  }
  assert.equal(registry.plans.plus.monthlyPriceUsd, 16);
  assert.equal(registry.plans.pro.monthlyPriceUsd, 80);
  const pricing = readFileSync("src/routes/pricing.tsx", "utf8");
  assert.match(pricing, /50% off the first paid month, once per account/);
  assert.match(pricing, /Regular monthly pricing follows/);
  const cards = [...pricing.matchAll(/<PlanCard\b[\s\S]*?\/>/g)].map(([card]) => card);
  for (const tier of ["plus", "pro"]) {
    const card = cards.find((value) => value.includes(`plans.${tier}.name`));
    assert.ok(card, `missing ${tier} card`);
    assert.match(card, /note=\{MONTHLY_INTRO_NOTE\}/);
    assert.match(card, /taxNotice/);
  }
  assert.doesNotMatch(pricing, /day trial|trial eligibility/);
  assert.match(pricing, /regular renewal price and date, tax/);
});

test("help copy distinguishes the new monthly offer, grandfathered trials and recoverable deletion", () => {
  const { load } = createContentLoader();
  const faqs = load("src/lib/help-center-data.ts").HELP_FAQS;
  const introductory = faqs.find(
    (faq) => faq.question === "How does the first-month discount work?",
  );
  assert.ok(introductory);
  assert.match(introductory.answer, /Plus or Pro monthly subscription, once per account/);
  assert.match(introductory.answer, /Later months use the regular published monthly price/);
  assert.match(introductory.answer, /New subscriptions do not receive a free trial/);
  assert.match(introductory.answer, /existing trials keep their original terms/);
  assert.equal(
    faqs.some((faq) => faq.question === "How does the Plus trial work?"),
    false,
  );
  const deletion = faqs.find((faq) => faq.question === "How do I delete my account?");
  assert.match(deletion.answer, /remain recoverable for 30 days/);
  assert.match(deletion.answer, /Recover account before the displayed deadline/);
  assert.match(deletion.answer, /does not cancel billing or reset your first-month discount/);
  const finalization = faqs.find(
    (faq) => faq.question === "What happens when I delete my account?",
  );
  assert.match(finalization.answer, /Final cleanup starts only after that deadline/);
  assert.match(finalization.answer, /Pending status is not proof that deletion finished/);
});
