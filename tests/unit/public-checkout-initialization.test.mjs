import test from "node:test";
import assert from "node:assert/strict";
import { createHookHarness, elements, loadUiModule } from "../helpers/ui-state-harness.mjs";

function fixture({
  configured = true,
  result = { clientSecret: "synthetic-checkout-secret" },
} = {}) {
  const hooks = createHookHarness();
  let requests = 0;
  const { StripeEmbeddedCheckout } = loadUiModule(
    "src/components/StripeEmbeddedCheckout.tsx",
    {
      react: {
        ...hooks.react,
        useMemo(factory, deps) {
          const memo = hooks.react.useRef(null);
          if (
            !memo.current ||
            deps.some((value, index) => !Object.is(value, memo.current.deps[index]))
          )
            memo.current = { deps, value: factory() };
          return memo.current.value;
        },
      },
      "@stripe/react-stripe-js": {
        EmbeddedCheckoutProvider: "StripeProvider",
        EmbeddedCheckout: "StripeFrame",
      },
      "@tanstack/react-router": { Link: "Link" },
      "@/components/BillingPortalButton": { BillingPortalButton: "BillingPortalButton" },
      "lucide-react": { Loader2: "Loader" },
      "@/lib/stripe": {
        getStripe: () => {
          if (!configured) throw Error("missing public configuration");
          return Promise.resolve({});
        },
      },
      "@/utils/payments.functions": {
        createCheckoutSession: async () => {
          requests++;
          return result;
        },
      },
    },
    { console: { error() {} } },
  );
  const render = (userId = "owner-a") =>
    hooks.render(() => StripeEmbeddedCheckout({ priceId: "plus_monthly", userId }));
  const options = () =>
    elements(render(), (node) => node.type === "StripeProvider")[0].props.options;
  return { hooks, render, options, count: () => requests };
}

test("repeated Stripe initialization and parent renders share one checkout attempt", async () => {
  const f = fixture();
  const first = f.options();
  const a = first.fetchClientSecret();
  const b = first.fetchClientSecret();
  assert.equal(a, b);
  assert.equal(await a, "synthetic-checkout-secret");
  assert.equal(f.count(), 1);
  assert.equal(f.options(), first);
  assert.equal(await f.options().fetchClientSecret(), "synthetic-checkout-secret");
  assert.equal(f.count(), 1);
});

test("missing Stripe configuration displays an error without creating a session", () => {
  const f = fixture({ configured: false });
  const tree = f.render();
  assert.equal(tree.props["data-checkout-state"], "error");
  assert.equal(elements(tree, (node) => node.type === "StripeProvider").length, 0);
  assert.equal(f.count(), 0);
});

test("a rejected checkout attempt does not repeat or leak its private error", async () => {
  const f = fixture({ result: { error: "synthetic private provider detail" } });
  const options = f.options();
  await assert.rejects(options.fetchClientSecret(), /Secure checkout couldn't load/);
  await assert.rejects(options.fetchClientSecret(), /Secure checkout couldn't load/);
  assert.equal(f.count(), 1);
  assert.equal(f.render().props["data-checkout-state"], "error");
});
