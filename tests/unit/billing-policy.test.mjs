import assert from "node:assert/strict";
import test from "node:test";
import {
  createMonthlyIntroCheckout,
  reconcileMonthlyIntroCheckout,
  reconcileAccountMonthlyIntroCheckout,
  resolvePolicyCustomer,
  validateMonthlyIntroCoupon,
  validateMonthlyIntroPrice,
} from "../../src/lib/billing-policy.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const claimId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const now = Date.UTC(2026, 9, 19);
const returnUrl = "https://kovagpt.com/billing?session_id={CHECKOUT_SESSION_ID}";
const plan = { lookupKey: "plus_monthly", livePriceId: "price_Plus" };
const coupon = {
  id: "intro50",
  valid: true,
  livemode: true,
  percent_off: 50,
  amount_off: null,
  duration: "once",
  times_redeemed: 0,
  max_redemptions: null,
  redeem_by: null,
};
const price = {
  id: plan.livePriceId,
  lookup_key: plan.lookupKey,
  active: true,
  type: "recurring",
  livemode: true,
  recurring: { interval: "month", interval_count: 1 },
  unit_amount: 2000,
};
const activeSubscription = (status = "active") => ({
  status,
  items: { has_more: false, data: [{ current_period_end: Math.floor(now / 1000) + 3600 }] },
});
const iterable = (rows) => ({
  async *[Symbol.asyncIterator]() {
    yield* rows;
  },
});

function fixture({
  redeemed = false,
  accountState = "active",
  existingClaim = null,
  subscriptions = [],
  createError = false,
  mapped = true,
  customerError = false,
} = {}) {
  const db = {
    redeemed,
    accountState,
    claim: existingClaim,
    customerId: mapped ? "cus_Owner" : null,
    calls: [],
  };
  const calls = [];
  const sessions = new Map();
  const idempotency = new Map();
  const supabase = {
    rpc: async (name, args = {}) => {
      db.calls.push({ name, args });
      if (name === "kova_policy_readiness")
        return { data: { schemaVersion: "monthly-intro-v1", ready: true, recoveryHours: 720 } };
      if (name === "kova_policy_claim_customer") {
        if (db.accountState !== "active" || customerError)
          return { error: { message: "account_deletion_pending" } };
        return {
          data: db.customerId
            ? { state: "mapped", customerId: db.customerId }
            : { state: "pending", requestId, requestedAt: new Date(now).toISOString() },
        };
      }
      if (name === "kova_policy_complete_customer") {
        db.customerId = args.p_customer;
        return { data: db.customerId };
      }
      if (name === "kova_policy_claim_checkout") {
        if (db.accountState !== "active") return { error: { message: "account_deletion_pending" } };
        if (!db.claim || ["completed", "expired"].includes(db.claim.state)) {
          db.claim = {
            claimId,
            idempotencyKey: `kova-checkout:${claimId}`,
            requestedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 45 * 60 * 1000).toISOString(),
            returnUrl: args.p_return_url,
            priceId: args.p_price,
            couponId: db.redeemed ? null : args.p_coupon,
            introEligible: !db.redeemed,
            customerId: db.customerId,
            state: "pending",
            environment: args.p_environment,
          };
        }
        return { data: { ...db.claim } };
      }
      if (name === "kova_policy_attach_checkout") {
        assert.equal(args.p_claim, db.claim.claimId);
        if (db.claim.sessionId && db.claim.sessionId !== args.p_session) return { error: {} };
        db.claim.sessionId = args.p_session;
        if (db.claim.state === "pending") db.claim.state = "open";
        return { data: { ...db.claim } };
      }
      if (name === "kova_policy_settle_checkout") {
        db.claim.state = args.p_outcome;
        if (args.p_outcome === "completed" && db.claim.introEligible) db.redeemed = true;
        return { data: { ...db.claim } };
      }
      if (name === "kova_policy_checkout_status") return { data: { ...db.claim } };
      if (name === "kova_policy_pending_checkout")
        return { data: db.claim ? { ...db.claim } : null };
      throw new Error(`unexpected fixture RPC ${name}`);
    },
  };
  const executeRpc = supabase.rpc.bind(supabase);
  supabase.rpc = (name, args) => ({
    abortSignal(signal) {
      assert.ok(signal instanceof AbortSignal);
      return executeRpc(name, args);
    },
  });
  const stripe = {
    prices: { list: async () => ({ data: [structuredClone(price)] }) },
    coupons: { retrieve: async () => structuredClone(coupon) },
    customers: {
      retrieve: async () => ({
        id: "cus_Owner",
        livemode: true,
        metadata: { userId },
        discount: null,
      }),
      search: async () => ({ data: [], has_more: false }),
      create: async (params, options) => {
        calls.push({ method: "customer.create", params, options });
        return { id: "cus_Owner", ...params };
      },
    },
    subscriptions: { list: () => iterable(subscriptions) },
    checkout: {
      sessions: {
        list: () => iterable([...sessions.values()]),
        retrieve: async (id) => structuredClone(sessions.get(id)),
        create: async (params, options) => {
          calls.push({ method: "checkout.create", params, options });
          if (createError) throw new Error("nonsecret ambiguous fixture failure");
          let session = idempotency.get(options.idempotencyKey);
          if (!session) {
            session = {
              id: "cs_One",
              customer: params.customer,
              livemode: true,
              mode: "subscription",
              metadata: params.metadata,
              return_url: params.return_url,
              line_items: {
                has_more: false,
                data: [{ quantity: 1, price: { id: params.line_items[0].price } }],
              },
              discounts: params.discounts ?? null,
              expires_at: params.expires_at,
              status: "open",
              client_secret: "nonsecret_fixture_client_secret",
            };
            idempotency.set(options.idempotencyKey, session);
            sessions.set(session.id, session);
          }
          return structuredClone(session);
        },
      },
    },
  };
  const input = {
    stripe,
    supabase,
    userId,
    environment: "live",
    email: "fixture@example.test",
    plan,
    couponId: coupon.id,
    returnUrl,
    now,
  };
  return { input, stripe, supabase, db, calls, sessions };
}

test("both monthly paid tiers retain their Price and use 50%-once, never new trial fields", async () => {
  for (const tier of [plan, { lookupKey: "pro_monthly", livePriceId: "price_Pro" }]) {
    const f = fixture();
    f.input.plan = tier;
    f.stripe.prices.list = async () => ({
      data: [{ ...price, id: tier.livePriceId, lookup_key: tier.lookupKey }],
    });
    await createMonthlyIntroCheckout(f.input);
    const request = f.calls.find((call) => call.method === "checkout.create").params;
    assert.deepEqual(request.line_items, [{ price: tier.livePriceId, quantity: 1 }]);
    assert.deepEqual(request.discounts, [{ coupon: "intro50" }]);
    assert.deepEqual(request.subscription_data, { metadata: { userId } });
    assert.equal("trial_period_days" in request.subscription_data, false);
    assert.equal("trial_end" in request.subscription_data, false);
    assert.equal(request.ui_mode, "embedded_page");
    assert.equal(request.managed_payments.enabled, true);
  }
});

test("renewal is a once-duration Stripe contract, not a local price rewrite or subscription update", () => {
  assert.equal(validateMonthlyIntroCoupon(coupon, coupon.id, "live", now).duration, "once");
  assert.equal(validateMonthlyIntroPrice(price, plan, "live").unit_amount, 2000);
  for (const invalid of [
    { duration: "forever" },
    { duration: "repeating" },
    { percent_off: 100 },
    { amount_off: 500 },
    { applies_to: { products: ["prod_OnlyOne"] } },
    { valid: false },
    { redeem_by: Math.floor(now / 1000) + 365 * 24 * 60 * 60 },
    { max_redemptions: 999, times_redeemed: 1 },
  ]) {
    assert.throws(
      () => validateMonthlyIntroCoupon({ ...coupon, ...invalid }, coupon.id, "live", now),
      /coupon_invalid/u,
    );
  }
});

test("yearly, quarterly, inactive, wrong environment and zero-valued prices fail closed", () => {
  for (const invalid of [
    { recurring: { interval: "year", interval_count: 1 } },
    { recurring: { interval: "month", interval_count: 3 } },
    { active: false },
    { livemode: false },
    { unit_amount: 0 },
    { id: "price_Unexpected" },
  ]) {
    assert.throws(
      () => validateMonthlyIntroPrice({ ...price, ...invalid }, plan, "live"),
      /price_invalid/u,
    );
  }
});

test("concurrent Checkouts share one durable claim and one Stripe identity across all plans", async () => {
  const f = fixture();
  const sessions = await Promise.all([
    createMonthlyIntroCheckout(f.input),
    createMonthlyIntroCheckout(f.input),
  ]);
  assert.equal(sessions[0].id, sessions[1].id);
  assert.equal(
    new Set(
      f.calls
        .filter((call) => call.method === "checkout.create")
        .map((call) => call.options.idempotencyKey),
    ).size,
    1,
  );
  f.input.plan = { lookupKey: "pro_monthly", livePriceId: "price_Pro" };
  f.stripe.prices.list = async () => ({
    data: [{ ...price, id: "price_Pro", lookup_key: "pro_monthly" }],
  });
  await assert.rejects(createMonthlyIntroCheckout(f.input), /checkout_claim_invalid/u);
});

test("existing trials, active subscriptions and scheduled cancellations are never modified", async () => {
  for (const status of ["trialing", "active", "past_due", "incomplete"]) {
    const f = fixture({ subscriptions: [activeSubscription(status)] });
    await assert.rejects(createMonthlyIntroCheckout(f.input), /active_subscription_exists/u);
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.claim, null);
  }
});

test("authoritative history after page one still blocks Checkout during webhook lag", async () => {
  const history = [
    ...Array.from({ length: 150 }, () => ({ status: "incomplete_expired" })),
    activeSubscription(),
  ];
  const f = fixture({ subscriptions: history });
  await assert.rejects(createMonthlyIntroCheckout(f.input), /active_subscription_exists/u);
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.claim, null);
});

test("cancellation/rejoining after redemption has no new discount and no trial", async () => {
  const f = fixture({
    redeemed: true,
    subscriptions: [
      {
        status: "canceled",
        items: { has_more: false, data: [{ current_period_end: Math.floor(now / 1000) - 1 }] },
      },
    ],
  });
  await createMonthlyIntroCheckout(f.input);
  const request = f.calls[0].params;
  assert.equal("discounts" in request, false);
  assert.deepEqual(request.subscription_data, { metadata: { userId } });
});

test("redeemed account upgrading or downgrading cannot regain discount", async () => {
  for (const candidate of [plan, { lookupKey: "pro_monthly", livePriceId: "price_Pro" }]) {
    const f = fixture({ redeemed: true });
    f.input.plan = candidate;
    f.stripe.prices.list = async () => ({
      data: [{ ...price, id: candidate.livePriceId, lookup_key: candidate.lookupKey }],
    });
    await createMonthlyIntroCheckout(f.input);
    assert.equal("discounts" in f.calls[0].params, false);
  }
});

test("scheduling deletion blocks new Checkout before any Customer POST; recovery keeps existing intro history", async () => {
  const f = fixture({ redeemed: true, accountState: "scheduled" });
  await assert.rejects(createMonthlyIntroCheckout(f.input), /shared_state_unavailable/u);
  assert.equal(f.calls.length, 0);
  f.db.accountState = "active";
  await createMonthlyIntroCheckout(f.input);
  assert.equal("discounts" in f.calls[0].params, false);
});

test("a truly new UUID after final deletion is eligible; no email-hash or cross-deletion history lookup", async () => {
  const f = fixture();
  f.input.userId = "44444444-4444-4444-8444-444444444444";
  f.stripe.customers.retrieve = async () => ({
    id: "cus_Owner",
    livemode: true,
    metadata: { userId: f.input.userId },
    discount: null,
  });
  await createMonthlyIntroCheckout(f.input);
  assert.deepEqual(f.calls[0].params.discounts, [{ coupon: "intro50" }]);
  assert.equal(
    f.db.calls.some(({ args }) => "email" in args),
    false,
  );
});

test("a signed completion must still prove price/coupon/customer before it burns eligibility", async () => {
  const f = fixture();
  const session = await createMonthlyIntroCheckout(f.input);
  f.sessions.get(session.id).status = "complete";
  await reconcileMonthlyIntroCheckout({ ...f.input, claimId, sessionId: session.id });
  assert.equal(f.db.redeemed, true);
  assert.equal(f.db.claim.state, "completed");
});

test("tampered Customer, price, coupon, owner and mode cannot settle or reveal a Session secret", async () => {
  for (const tamper of [
    (session) => {
      session.customer = "cus_Other";
    },
    (session) => {
      session.line_items.data[0].price.id = "price_Other";
    },
    (session) => {
      session.discounts = [{ coupon: "wrong" }];
    },
    (session) => {
      session.metadata.userId = "wrong";
    },
    (session) => {
      session.livemode = false;
    },
  ]) {
    const f = fixture();
    const session = await createMonthlyIntroCheckout(f.input);
    const record = f.sessions.get(session.id);
    record.status = "complete";
    tamper(record);
    await assert.rejects(
      reconcileMonthlyIntroCheckout({ ...f.input, claimId, sessionId: session.id }),
      /identity_mismatch/u,
    );
    assert.equal(f.db.redeemed, false);
  }
});

test("ambiguous POST retains its claim; elapsed idempotency or expiry never means a fresh attempt", async () => {
  const f = fixture({ createError: true });
  await assert.rejects(createMonthlyIntroCheckout(f.input), /ambiguous fixture/u);
  const previousClaim = structuredClone(f.db.claim);
  f.input.now = now + 31 * 24 * 60 * 60 * 1000;
  await assert.rejects(createMonthlyIntroCheckout(f.input), /reconciliation_pending/u);
  assert.deepEqual(f.db.claim, previousClaim);
  assert.equal(f.calls.filter((call) => call.method === "checkout.create").length, 1);
});

test("cleanup does not create a Customer or Session and cannot clear an absent or paginated match", async () => {
  for (const page of [
    { data: [], has_more: false },
    { data: [], has_more: true },
  ]) {
    const f = fixture({ createError: true });
    await assert.rejects(createMonthlyIntroCheckout(f.input));
    f.stripe.checkout.sessions.list = async () => page;
    await assert.rejects(
      reconcileAccountMonthlyIntroCheckout({ ...f.input, stripeFactory: () => f.stripe }),
      /reconciliation_pending/u,
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.db.claim.state, "pending");
  }
});

test("cleanup settles confirmed expiration without redeeming and never relies on 30-day wall-clock age", async () => {
  const f = fixture();
  const session = await createMonthlyIntroCheckout(f.input);
  f.sessions.get(session.id).status = "expired";
  await reconcileAccountMonthlyIntroCheckout({ ...f.input, stripeFactory: () => f.stripe });
  assert.equal(f.db.claim.state, "expired");
  assert.equal(f.db.redeemed, false);
  assert.equal(f.calls.length, 1);
});

test("Customer creation always obtains deletion-fenced durable identity first; email never selects owner", async () => {
  const f = fixture({ mapped: false });
  assert.equal(await resolvePolicyCustomer(f.input), "cus_Owner");
  assert.deepEqual(
    f.db.calls.map(({ name }) => name),
    ["kova_policy_claim_customer", "kova_policy_complete_customer"],
  );
  assert.equal(f.calls[0].params.metadata.kovaPolicyCustomer, requestId);
  assert.equal(f.calls[0].params.email, "fixture@example.test");
});

test("an existing or unreported Customer discount is preserved and blocks unchecked stacking/inheritance", async () => {
  for (const customer of [
    { id: "cus_Owner", livemode: true, metadata: { userId }, discount: { id: "di_Existing" } },
    { id: "cus_Owner", livemode: true, metadata: { userId } },
  ]) {
    const f = fixture({ redeemed: true });
    f.stripe.customers.retrieve = async () => customer;
    await assert.rejects(createMonthlyIntroCheckout(f.input), /customer_discount_requires_review/u);
    assert.equal(f.calls.length, 0);
    assert.equal(f.db.claim, null);
  }
});

test("production shared-state operations must support a real abort deadline", async () => {
  const f = fixture();
  f.supabase.rpc = async () => ({ data: {} });
  await assert.rejects(createMonthlyIntroCheckout(f.input), /shared_state_deadline_unavailable/u);
  assert.equal(f.calls.length, 0);
});
