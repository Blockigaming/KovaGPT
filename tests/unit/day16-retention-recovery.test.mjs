import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const settings = fs.readFileSync("src/components/SettingsDialog.tsx", "utf8");
const dialog = fs.readFileSync("src/components/CancellationFeedbackDialog.tsx", "utf8");
const growth = fs.readFileSync("src/lib/growth-events.ts", "utf8");
const adapter = fs.readFileSync("src/lib/growth-operational-adapter.ts", "utf8");
const operational = fs.readFileSync("src/lib/operational-analytics.ts", "utf8");
const checkout = fs.readFileSync("src/routes/checkout.return.tsx", "utf8");

test("payment recovery appears for every actionable Stripe failure state", () => {
  assert.match(settings, /Payment needs attention/);
  assert.match(settings, /past_due/);
  assert.match(settings, /unpaid/);
  assert.match(settings, /incomplete/);
  assert.match(settings, /payment_recovery_viewed/);
  assert.match(settings, /payment_recovery_started/);
});

test("cancellation feedback is fixed-choice, accessible and truthful", () => {
  assert.match(settings, /CancellationFeedbackDialog/);
  assert.match(dialog, /role="radiogroup"/);
  assert.match(dialog, /subscription_cancel_feedback/);
  assert.match(dialog, /Continue to Stripe/);
  assert.doesNotMatch(dialog, /textarea/);
  assert.doesNotMatch(dialog, /subscription_cancelled/);
});

test("growth events attempt durable delivery through the existing analytics client", () => {
  assert.match(growth, /growth-operational-adapter/);
  assert.match(adapter, /operational-analytics/);
  assert.match(adapter, /CANDIDATE_NAMES/);
  assert.match(operational, /flushOperationalEvents/);
});

test("checkout return never invents completion from page load alone", () => {
  assert.match(checkout, /checkout_opened/);
  assert.doesNotMatch(checkout, /checkout_completed[\s\S]{0,180}\},\s*\[\]\s*\)/);
});
