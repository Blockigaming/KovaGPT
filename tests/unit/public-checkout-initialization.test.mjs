import test from "node:test";
import assert from "node:assert/strict";
import {
  createHookHarness,
  elements,
  loadUiModule,
  deferred,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";
function fixture({
  result = { url: "https://checkout.stripe.com/c/pay/fixture" },
  owner = "owner-a",
} = {}) {
  const hooks = createHookHarness();
  let requests = 0,
    currentOwner = owner;
  const redirects = [];
  const { StripeEmbeddedCheckout } = loadUiModule(
    "src/components/StripeEmbeddedCheckout.tsx",
    {
      react: hooks.react,
      "@/components/auth/ClerkSafe": {
        useUser: () => ({
          user: currentOwner ? { id: currentOwner } : null,
          isLoaded: true,
          isSignedIn: Boolean(currentOwner),
        }),
      },
      "@/components/BillingPortalButton": { BillingPortalButton: "BillingPortalButton" },
      "@/utils/payments.functions": {
        createCheckoutSession: async () => {
          requests++;
          return await result;
        },
      },
    },
    { URL, window: { location: { assign: (url) => redirects.push(url) } } },
  );
  const render = (userId = currentOwner) =>
    hooks.render(() => StripeEmbeddedCheckout({ priceId: "plus_monthly", userId }));
  const button = () => elements(render(), (node) => node.type === "button")[0];
  return {
    render,
    button,
    redirects,
    count: () => requests,
    owner: (value) => {
      currentOwner = value;
    },
  };
}
test("repeated clicks and parent renders share one pending hosted checkout", async () => {
  const pending = deferred();
  const f = fixture({ result: pending.promise });
  f.button().props.onClick();
  f.button().props.onClick();
  assert.equal(f.count(), 1);
  assert.equal(f.button().props.disabled, true);
  pending.resolve({ url: "https://checkout.stripe.com/c/pay/fixture" });
  await settle();
  assert.deepEqual(f.redirects, ["https://checkout.stripe.com/c/pay/fixture"]);
});
test("unresolved or mismatched accounts cannot create a checkout session", async () => {
  const f = fixture({ owner: null });
  assert.equal(f.button().props.disabled, true);
  f.button().props.onClick();
  await settle();
  assert.equal(f.count(), 0);
  const g = fixture();
  const mismatch = elements(g.render("owner-b"), (n) => n.type === "button")[0];
  assert.equal(mismatch.props.disabled, true);
  mismatch.props.onClick();
  await settle();
  assert.equal(g.count(), 0);
});
test("an unknown failure is private and an explicit retry is allowed", async () => {
  const f = fixture({ result: { error: "synthetic private provider detail" } });
  f.button().props.onClick();
  await settle();
  assert.equal(f.render().props["data-checkout-state"], "error");
  assert.match(text(f.render()), /Secure checkout could not open/);
  assert.doesNotMatch(text(f.render()), /private provider detail/);
  f.button().props.onClick();
  await settle();
  assert.equal(f.count(), 2);
  assert.deepEqual(f.redirects, []);
});
test("account replacement and foreign redirect URLs never navigate", async () => {
  const pending = deferred();
  const f = fixture({ result: pending.promise });
  f.button().props.onClick();
  f.owner("owner-b");
  f.render();
  pending.resolve({ url: "https://checkout.stripe.com/c/pay/old-owner" });
  await settle();
  assert.deepEqual(f.redirects, []);
  const g = fixture({ result: { url: "https://evil.example/payment" } });
  g.button().props.onClick();
  await settle();
  assert.deepEqual(g.redirects, []);
  assert.equal(g.render().props["data-checkout-state"], "error");
});
