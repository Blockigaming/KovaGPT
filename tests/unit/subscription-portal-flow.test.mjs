import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionPortalFlow } from "../../src/lib/subscription-portal-flow.mjs";

const plan = { livePriceId: "price_pro", lookupKey: "pro_monthly" };
function fixture() {
  const price = {
    id: "price_pro",
    active: true,
    livemode: true,
    lookup_key: "pro_monthly",
    currency: "usd",
    recurring: { interval: "month" },
    product: "prod_pro",
  };
  const subscription = {
    id: "sub_owned",
    customer: "cus_owner",
    livemode: true,
    status: "active",
    items: {
      has_more: false,
      data: [{ id: "si_owned", quantity: 1, price: { product: "prod_plus" } }],
    },
  };
  const list = { has_more: false, data: [subscription] },
    calls = [];
  const stripe = {
    prices: {
      retrieve: async (id) => {
        calls.push(["price", id]);
        return price;
      },
    },
    subscriptions: {
      list: async (args) => {
        calls.push(["list", args]);
        return list;
      },
      update: () => assert.fail("A portal review must never mutate a subscription"),
    },
  };
  return {
    price,
    subscription,
    list,
    calls,
    review: () => subscriptionPortalFlow(stripe, "cus_owner", plan, ["prod_plus", "prod_pro"]),
  };
}
test("existing customer receives a fixed-price Stripe confirmation flow without a charge", async () => {
  const f = fixture();
  assert.deepEqual(await f.review(), {
    type: "subscription_update_confirm",
    subscription_update_confirm: {
      subscription: "sub_owned",
      items: [{ id: "si_owned", price: "price_pro", quantity: 1 }],
    },
  });
  assert.deepEqual(f.calls, [
    ["price", "price_pro"],
    ["list", { customer: "cus_owner", status: "all", limit: 100 }],
  ]);
});
test("inactive, test-mode, foreign or nonmonthly prices never open a plan-change flow", async () => {
  for (const change of [
    { active: false },
    { livemode: false },
    { product: "prod_foreign" },
    { lookup_key: "other" },
    { currency: "eur" },
    { recurring: { interval: "year" } },
  ]) {
    const f = fixture();
    Object.assign(f.price, change);
    await assert.rejects(f.review(), /price_unavailable/);
    assert.equal(f.calls.length, 1);
  }
});
test("ambiguous or foreign subscriptions fail closed before opening hosted billing", async () => {
  for (const mutate of [
    (f) => {
      f.list.has_more = true;
    },
    (f) => {
      f.list.data.push({ ...f.subscription, id: "sub_second" });
    },
    (f) => {
      f.list.data = [];
    },
    (f) => {
      f.subscription.customer = "cus_other";
    },
    (f) => {
      f.subscription.livemode = false;
    },
    (f) => {
      f.subscription.items.has_more = true;
    },
    (f) => {
      f.subscription.items.data.push({ ...f.subscription.items.data[0], id: "si_second" });
    },
    (f) => {
      f.subscription.items.data[0].quantity = 2;
    },
    (f) => {
      f.subscription.items.data[0].price.product = "prod_foreign";
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.review(), /ambiguous/);
  }
});
