import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { stripeSubscriptionBlocksCheckout } from "../../src/lib/stripe-subscription-status.mjs";
import { BILLING_ENV, resolveBillingPlan, tierForLookupKey } from "../../src/lib/billing-plans.ts";

const source = await readFile("src/utils/payments.functions.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, ""),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;

async function checkout({
  history = [],
  localRows = [],
  priceId = "plus_monthly",
  listError = false,
  enabled = true,
} = {}) {
  let sessionParams;
  let observed = 0;
  const stripe = {
    customers: { search: async () => ({ data: [{ id: "cus_Fixture" }] }) },
    prices: {
      list: async () => ({
        data: [
          { id: resolveBillingPlan(priceId).livePriceId, lookup_key: priceId, type: "recurring" },
        ],
      }),
    },
    subscriptions: {
      list: ({ customer, status, limit }) => ({
        async *[Symbol.asyncIterator]() {
          assert.equal(customer, "cus_Fixture");
          assert.equal(status, "all");
          assert.equal(limit, 100);
          if (listError) throw new Error("upstream unavailable");
          for (const subscription of history) {
            observed++;
            yield subscription;
          }
        },
      }),
    },
    checkout: {
      sessions: {
        create: async (params) => {
          sessionParams = params;
          return { client_secret: "session_secret" };
        },
      },
    },
  };
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    then(resolve) {
      return Promise.resolve({ data: localRows, error: null }).then(resolve);
    },
  };
  const context = {
    createStripeClient: () => stripe,
    durableStripeBillingEnabled: () => enabled,
    resolveStripeCustomerId: async () => "cus_Fixture",
    resolveDurableCheckoutSession: async ({ params }) => {
      sessionParams = params;
      return { client_secret: "session_secret" };
    },
    StripeCheckoutPendingError: class extends Error {},
    supabaseAdmin: {
      rpc: async () => ({
        error: null,
        data: {
          idempotencyKey: "fixture-key",
          stripeCustomerId: "cus_Fixture",
          trialEligible: false,
          outcome: "new",
          sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      }),
    },
    stripeSubscriptionBlocksCheckout,
    BILLING_ENV,
    resolveBillingPlan,
    tierForLookupKey,
    CHECKOUT_RETURN_URL: "https://kovagpt.com/checkout/return",
    requireSupabaseAuth: {},
    console: { error() {} },
    createServerFn: () => ({
      middleware() {
        return this;
      },
      validator() {
        return this;
      },
      handler(fn) {
        return fn;
      },
    }),
  };
  vm.runInNewContext(`${compiled}\nglobalThis.checkout = createCheckoutSession;`, context);
  const result = await context.checkout({
    data: { priceId },
    context: {
      userId: "userFixture",
      claims: { email: "fixture@example.test" },
      supabase: { from: () => query },
    },
  });
  return { result, sessionParams, observed };
}

const ended = { status: "incomplete_expired" };
test("authoritative history beyond page one blocks Checkout during webhook lag, including Pro", async () => {
  const history = [...Array.from({ length: 150 }, () => ended), { status: "active" }];
  const attempt = await checkout({ history, priceId: "pro_monthly" });
  assert.match(attempt.result.error, /open subscription/u);
  assert.equal(attempt.observed, 151);
  assert.equal(attempt.sessionParams, undefined);
});

test("history lookup failures cannot open an unchecked Checkout Session", async () => {
  const attempt = await checkout({ listError: true });
  assert.match(attempt.result.error, /unavailable/u);
  assert.equal(attempt.sessionParams, undefined);
});

test("unverified first-trial eligibility fails closed while proven returning history can checkout", async () => {
  const first = await checkout();
  assert.match(first.result.error, /30-day trial eligibility needs verification/u);
  assert.equal(first.sessionParams, undefined);
  const returning = await checkout({ history: [ended] });
  assert.equal(returning.sessionParams.subscription_data.trial_period_days, undefined);
  const staleExpired = await checkout({
    localRows: [{ status: "active", current_period_end: "2020-01-01T00:00:00Z" }],
  });
  assert.equal(staleExpired.result.clientSecret, "session_secret");
  assert.equal(staleExpired.sessionParams.subscription_data.trial_period_days, undefined);
});

test("malformed local periods continue to block Checkout without bypassing reviewed guards", async () => {
  const attempt = await checkout({ localRows: [{ status: "active", current_period_end: null }] });
  assert.match(attempt.result.error, /active subscription/u);
  assert.equal(attempt.observed, 0);
  assert.equal(attempt.sessionParams, undefined);
});

test("unverified rollout never starts Stripe Checkout", async () => {
  const attempt = await checkout({ enabled: false, priceId: "pro_monthly" });
  assert.match(attempt.result.error, /verified rollout/u);
  assert.equal(attempt.observed, 0);
  assert.equal(attempt.sessionParams, undefined);
});
