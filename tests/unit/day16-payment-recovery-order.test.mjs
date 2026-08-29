import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const settings = fs.readFileSync("src/components/SettingsDialog.tsx", "utf8");

test("derived subscription display tier is never read before declaration", () => {
  const declaration = settings.indexOf("const displayedSubscriptionTier");

  assert.ok(declaration >= 0);

  assert.doesNotMatch(settings.slice(0, declaration), /\bdisplayedSubscriptionTier\b/);
});

test("payment recovery uses actual Stripe subscription state", () => {
  assert.match(settings, /payment_recovery_viewed/);

  assert.match(settings, /payment_recovery_started/);

  assert.match(settings, /plan:\s*subSummary\?\.tier\s*\?\?\s*undefined/);

  for (const status of ["past_due", "unpaid", "incomplete"]) {
    assert.match(settings, new RegExp(status));
  }
});

test("payment recovery exposes a real Stripe recovery action", () => {
  assert.match(settings, /Payment needs attention/);
  assert.match(settings, /Fix payment/);
  assert.match(settings, /handleManageBilling/);
});
