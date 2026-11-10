import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notificationDefinition } from "../../src/lib/notification-catalog.mjs";

const code = (path) => readFileSync(path, "utf8");
test("hosted checkout notices follow the server checkout result", () => {
  const value=code("src/components/StripeEmbeddedCheckout.tsx");
  assert.ok(value.indexOf('id: "checkout_started"') > value.indexOf('if (url.origin !== "https://checkout.stripe.com")'));
  assert.ok(value.indexOf('id: "checkout_unavailable"') > value.indexOf("} catch (reason) {"));
  assert.equal(notificationDefinition("checkout_started")?.group,"billing");
});
test("onboarding complete notification follows successful persistence", () => {
  const value=code("src/components/OnboardingDialog.tsx");
  assert.ok(value.indexOf('id: "settings_updated"') > value.indexOf("await persistOnboarding()"));
  assert.ok(value.indexOf('id: "settings_updated"') < value.indexOf('await navigate({ to: "/" })'));
});
test("signup verification notices do not imply an authenticated session or delivered email", () => {
  const value=code("src/routes/auth.tsx");
  assert.ok(value.includes('id: "email_verification_required"'));
  assert.ok(value.includes("If this address can be registered"));
  assert.ok(value.includes('id: "welcome"'));
  assert.ok(!value.includes('id: "email_sent"'));
});
