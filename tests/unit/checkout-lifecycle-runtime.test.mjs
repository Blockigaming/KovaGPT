import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";
function fixture(result) {
  let count = 0,
    finish;
  const request = new Promise((resolve) => {
    finish = resolve;
  });
  const f = reactFixture(
    "src/components/StripeEmbeddedCheckout.tsx",
    ({ StripeEmbeddedCheckout }) =>
      () =>
        StripeEmbeddedCheckout({ priceId: "plus_monthly", userId: "owner-a" }),
    {
      modules: {
        "@stripe/react-stripe-js": {
          EmbeddedCheckoutProvider: "stripe-provider",
          EmbeddedCheckout: "stripe-checkout",
        },
        "@tanstack/react-router": { Link: "link" },
        "@/lib/stripe": { getStripe: async () => ({ fixture: true }) },
        "@/utils/payments.functions": {
          createCheckoutSession: () => {
            count++;
            return request;
          },
        },
      },
    },
  );
  return { f, finish: () => finish(result), count: () => count };
}
test("embedded checkout reuses one session attempt across render and frame-load changes", async () => {
  const { f, finish, count } = fixture({ clientSecret: "fixture_secret" });
  await f.flush();
  const fetchSecret = f.find("stripe-provider").props.options.fetchClientSecret;
  const first = fetchSecret(),
    second = fetchSecret();
  f.render();
  assert.equal(f.find("stripe-provider").props.options.fetchClientSecret, fetchSecret);
  assert.equal(first, second);
  assert.equal(count(), 1);
  finish();
  assert.equal(await first, "fixture_secret");
  f.unmount();
});
test("existing subscribers get an actionable billing route and no automatic second attempt", async () => {
  const { f, finish, count } = fixture({
    error: "Existing subscription",
    code: "active_subscription",
  });
  await f.flush();
  const secret = f.find("stripe-provider").props.options.fetchClientSecret();
  finish();
  await assert.rejects(secret, /active subscription/);
  await f.flush();
  assert.equal(f.find("link").props.params.section, "billing");
  assert.equal(count(), 1);
  f.unmount();
});
test("late checkout credentials cannot be returned after the view closes", async () => {
  const { f, finish } = fixture({ clientSecret: "must-not-return" });
  await f.flush();
  const secret = f.find("stripe-provider").props.options.fetchClientSecret();
  f.unmount();
  finish();
  await assert.rejects(secret, /Secure checkout/);
});
