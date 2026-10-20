import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { BillingPolicyError } from "../../src/lib/billing-policy.mjs";
import { BILLING_ENV, resolveBillingPlan } from "../../src/lib/billing-plans.ts";

const source = await readFile("src/utils/payments.functions.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, ""),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;

async function checkout({
  localRows = [],
  priceId = "plus_monthly",
  enabled = true,
  adapterError = null,
} = {}) {
  let options;
  let clientCreations = 0;
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    abortSignal() {
      return this;
    },
    then(resolve) {
      return Promise.resolve({ data: localRows, error: null }).then(resolve);
    },
  };
  const context = {
    process: { env: { STRIPE_MONTHLY_INTRO_COUPON_ID: "nonsecret_fixture_coupon" } },
    createStripeClient: () => {
      clientCreations++;
      return {};
    },
    monthlyIntroBillingEnabled: () => enabled,
    createMonthlyIntroCheckout: async (input) => {
      options = input;
      if (adapterError) throw adapterError;
      return { client_secret: "nonsecret_fixture_secret" };
    },
    BillingPolicyError,
    AbortSignal,
    supabaseAdmin: {},
    loose: (client) => client,
    BILLING_ENV,
    resolveBillingPlan,
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
    data: { priceId, environment: "sandbox" },
    context: {
      userId: "fixtureUser",
      claims: { email: "fixture@example.test" },
      supabase: { from: () => query },
    },
  });
  return { result, options, clientCreations };
}

test("handler passes canonical monthly Price, fixed URL, configured Coupon and live environment to the verified adapter", async () => {
  const attempt = await checkout({ priceId: "pro_monthly" });
  assert.equal(attempt.result.clientSecret, "nonsecret_fixture_secret");
  assert.equal(attempt.options.plan, resolveBillingPlan("pro_monthly"));
  assert.equal(attempt.options.environment, "live");
  assert.equal(attempt.options.couponId, "nonsecret_fixture_coupon");
  assert.equal(attempt.options.returnUrl, "https://kovagpt.com/checkout/return");
});

test("expired local history reaches the authoritative adapter, without reinstating trials", async () => {
  const attempt = await checkout({
    localRows: [{ status: "active", current_period_end: "2020-01-01T00:00:00Z" }],
  });
  assert.equal(attempt.result.clientSecret, "nonsecret_fixture_secret");
  assert.equal(attempt.options.plan.trialPeriodDays, 0);
});

test("malformed or open local subscription periods continue to block another Checkout", async () => {
  for (const end of [null, "bad-date", new Date(Date.now() + 3600000).toISOString()]) {
    const attempt = await checkout({ localRows: [{ status: "active", current_period_end: end }] });
    assert.match(attempt.result.error, /active subscription/u);
    assert.equal(attempt.options, undefined);
  }
});

test("unverified policy rollout stops before a Stripe client or adapter exists", async () => {
  const attempt = await checkout({ enabled: false });
  assert.match(attempt.result.error, /verified rollout/u);
  assert.equal(attempt.clientCreations, 0);
  assert.equal(attempt.options, undefined);
});

test("authoritative active and unknown outcomes are handled without a second payment attempt", async () => {
  const active = await checkout({
    adapterError: new BillingPolicyError("billing_policy_active_subscription_exists"),
  });
  assert.match(active.result.error, /open subscription/u);
  const pending = await checkout({
    adapterError: new BillingPolicyError("billing_policy_checkout_reconciliation_pending"),
  });
  assert.match(pending.result.error, /no second payment attempt/u);
});
