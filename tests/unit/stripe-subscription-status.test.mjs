import assert from "node:assert/strict";
import test from "node:test";

import { stripeSubscriptionBlocksCheckout } from "../../src/lib/stripe-subscription-status.mjs";

const now = 1_700_000_000;
const subscription = (status, currentPeriodEnd, overrides = {}) => ({
  status,
  items: {
    data: [{ current_period_end: currentPeriodEnd }],
    has_more: false,
  },
  ...overrides,
});

test("Checkout blocks every open or unknown Stripe status", () => {
  for (const status of [
    "trialing",
    "active",
    "past_due",
    "incomplete",
    "unpaid",
    "paused",
    "future_status",
  ]) {
    assert.equal(stripeSubscriptionBlocksCheckout(subscription(status, now - 1), now), true);
  }
  assert.equal(
    stripeSubscriptionBlocksCheckout(subscription("incomplete_expired", now + 100), now),
    false,
  );
});

test("canceled Checkout history is allowed only after its one item expires", () => {
  assert.equal(stripeSubscriptionBlocksCheckout(subscription("canceled", now + 1), now), true);
  assert.equal(stripeSubscriptionBlocksCheckout(subscription("canceled", now), now), false);
  assert.equal(stripeSubscriptionBlocksCheckout(subscription("canceled", now - 1), now), false);
});

test("Checkout fails closed for ambiguous, paginated, or malformed item projections", () => {
  assert.equal(
    stripeSubscriptionBlocksCheckout(
      subscription("canceled", now - 1, {
        items: {
          data: [{ current_period_end: now - 1 }, { current_period_end: now - 1 }],
          has_more: false,
        },
      }),
      now,
    ),
    true,
  );
  assert.equal(
    stripeSubscriptionBlocksCheckout(
      subscription("canceled", now - 1, {
        items: { data: [{ current_period_end: now - 1 }], has_more: true },
      }),
      now,
    ),
    true,
  );
  assert.equal(
    stripeSubscriptionBlocksCheckout(
      subscription("canceled", now - 1, {
        items: { data: [{ current_period_end: now - 1 }] },
      }),
      now,
    ),
    true,
  );
  assert.equal(stripeSubscriptionBlocksCheckout(null, now), true);
  assert.equal(stripeSubscriptionBlocksCheckout(subscription("canceled", null), now), true);
});
