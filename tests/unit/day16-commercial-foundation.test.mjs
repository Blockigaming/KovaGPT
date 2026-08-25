import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "src/lib/growth-events.ts",
  "src/lib/feature-analytics.ts",
  "src/components/GrowthAttribution.tsx",
  "src/components/OnboardingDialog.tsx",
  "src/routes/pricing.tsx",
];

test("Day 16 commercial foundation contains onboarding referral and conversion instrumentation", () => {
  for (const file of required) {
    assert.equal(fs.existsSync(file), true, `${file} must exist`);
  }

  const growth = fs.readFileSync("src/lib/growth-events.ts", "utf8");

  for (const event of [
    "onboarding_completed",
    "pricing_viewed",
    "upgrade_prompt_viewed",
    "upgrade_started",
    "checkout_completed",
    "payment_recovery_viewed",
    "subscription_cancel_feedback",
    "referral_landed",
    "feature_before_upgrade",
  ]) {
    assert.match(growth, new RegExp(event));
  }
});
