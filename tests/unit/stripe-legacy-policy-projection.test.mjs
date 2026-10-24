import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { resolveBillingPlan } from "../../src/lib/billing-plans.ts";

const source = await readFile("src/lib/stripe-legacy-projection.server.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, ""),
  {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const correlation = "11111111-1111-4111-8111-111111111111";
function fixture(result = { data: { duplicate: false, outcome: "applied" } }) {
  const calls = [];
  const context = {
    resolveBillingPlan,
    loose: (client) => client,
    Buffer,
    AbortSignal,
    supabaseAdmin: {
      rpc(name, args) {
        calls.push({ name, args });
        return {
          abortSignal(signal) {
            assert.ok(signal instanceof AbortSignal);
            return Promise.resolve(result);
          },
        };
      },
    },
  };
  vm.runInNewContext(
    `${compiled}\nglobalThis.normalize = normalizeLegacyStripeEvent; globalThis.project = projectLegacyStripeEvent;`,
    context,
  );
  return {
    calls,
    normalize: (event, env = "live") =>
      JSON.parse(JSON.stringify(context.normalize(event, env, correlation))),
    project: (event, env = "live") => context.project(event, env, correlation),
  };
}
const subscription = (options = {}) => ({
  id: "sub_Existing",
  customer: "cus_Owner",
  status: "active",
  cancel_at_period_end: false,
  metadata: { userId: "wrong-owner-not-authority", email: "not-retained@example.test" },
  items: {
    has_more: false,
    data: [
      {
        current_period_start: 1792368000,
        current_period_end: 1795046400,
        price: {
          id: resolveBillingPlan("plus_monthly").livePriceId,
          lookup_key: "plus_monthly",
          product: "prod_Plus",
        },
      },
    ],
  },
  ...options,
});
const event = (type = "customer.subscription.updated", object = subscription()) => ({
  id: "evt_Existing",
  created: 1792368000,
  livemode: true,
  type,
  data: { object },
});

test("existing trials and cancellation schedules retain status, periods and monthly Price without new trials/discounts", () => {
  const f = fixture();
  const trial = f.normalize(
    event("customer.subscription.updated", subscription({ status: "trialing" })),
  );
  assert.equal(trial.projection.status, "trialing");
  assert.equal(trial.projection.priceId, resolveBillingPlan("plus_monthly").livePriceId);
  assert.equal(trial.projection.periodStart, "2026-10-19T00:00:00.000Z");
  assert.equal(trial.projection.periodEnd, "2026-11-19T00:00:00.000Z");
  const cancel = f.normalize(
    event("customer.subscription.updated", subscription({ cancel_at_period_end: true })),
  );
  assert.equal(cancel.projection.status, "active");
  assert.equal(cancel.projection.cancelAtPeriodEnd, true);
  assert.equal("discounts" in cancel.projection, false);
  assert.equal("trial_end" in cancel.projection, false);
});

test("legitimate Plus/Pro plan changes resolve only existing immutable live Price ids", () => {
  const f = fixture();
  const object = subscription();
  object.items.data[0].price = {
    id: resolveBillingPlan("pro_monthly").livePriceId,
    lookup_key: "pro_monthly",
    product: "prod_Pro",
  };
  assert.equal(
    f.normalize(event("customer.subscription.updated", object)).projection.priceId,
    resolveBillingPlan("pro_monthly").livePriceId,
  );
});

test("retired Pro subscriptions preserve their exact Price without reopening it for Checkout", () => {
  const object = subscription({ status: "trialing", cancel_at_period_end: true });
  const retired = "price_1UAzhRAEZlsb6DBYlafU4mhc";
  object.items.data[0].price = { id: retired, lookup_key: null, product: "prod_ExistingPro" };
  const projection = fixture().normalize(event("customer.subscription.updated", object)).projection;
  assert.equal(projection.priceId, retired);
  assert.equal(projection.status, "trialing");
  assert.equal(projection.cancelAtPeriodEnd, true);
  assert.equal(resolveBillingPlan(retired), null);
});

test("renewal and payment events update legacy status only and support the configured/new invoice subscription shapes", () => {
  const f = fixture();
  for (const [type, status] of [
    ["invoice.paid", "active"],
    ["invoice.payment_failed", "past_due"],
    ["invoice.payment_action_required", "incomplete"],
    ["invoice.voided", "past_due"],
  ]) {
    const normalized = f.normalize(
      event(type, { id: "in_Renewal", customer: "cus_Owner", subscription: "sub_Existing" }),
    );
    assert.deepEqual(normalized.projection, {
      kind: "invoice_status",
      stripeSubscriptionId: "sub_Existing",
      customerId: "cus_Owner",
      status,
    });
    assert.equal(normalized.objectId, "in_Renewal");
  }
  const nested = f.normalize(
    event("invoice.paid", {
      id: "in_Renewal",
      customer: "cus_Owner",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_Existing" },
      },
    }),
  );
  assert.equal(nested.subscriptionId, "sub_Existing");
});

test("a subscription deletion changes no historical price, period or trial field", () => {
  const projection = fixture().normalize(
    event("customer.subscription.deleted", { id: "sub_Existing", customer: "cus_Owner" }),
  ).projection;
  assert.deepEqual(projection, {
    kind: "subscription_deleted",
    stripeSubscriptionId: "sub_Existing",
    customerId: "cus_Owner",
    status: "canceled",
  });
});

test("metadata and raw Stripe object fields never cross the atomic ownership boundary", async () => {
  const f = fixture();
  await f.project(event());
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "kova_policy_apply_legacy_event");
  assert.equal(f.calls[0].args.p_environment, "live");
  const normalized = f.calls[0].args.p_event;
  assert.deepEqual(
    Object.keys(normalized).sort(),
    [
      "eventId",
      "type",
      "createdAt",
      "correlationId",
      "objectId",
      "customerId",
      "subscriptionId",
      "invoiceId",
      "checkoutSessionId",
      "outcome",
      "projection",
    ].sort(),
  );
  assert.equal(JSON.stringify(normalized).includes("wrong-owner"), false);
  assert.equal(JSON.stringify(normalized).includes("not-retained"), false);
  assert.equal("userId" in normalized, false);
  assert.equal(normalized.customerId, "cus_Owner");
  assert.doesNotMatch(source, /\.from\(|\.upsert\(|\.update\(|\.delete\(/u);
});

test("unknown price ids and conflicting lookup keys fail before the RPC, not by removing a guard", async () => {
  for (const price of [
    { id: "price_Unknown", lookup_key: "plus_monthly", product: "prod_Fixture" },
    {
      id: resolveBillingPlan("plus_monthly").livePriceId,
      lookup_key: "pro_monthly",
      product: "prod_Fixture",
    },
  ]) {
    const f = fixture();
    const object = subscription();
    object.items.data[0].price = price;
    await assert.rejects(
      f.project(event("customer.subscription.updated", object)),
      /price_unqualified/u,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("incomplete item collections, invalid periods/status and invoice identity conflicts fail closed", async () => {
  const invalid = [
    subscription({ items: { has_more: true, data: [] } }),
    subscription({ status: "unknown" }),
    subscription({ cancel_at_period_end: "false" }),
    subscription({
      items: {
        has_more: false,
        data: [
          {
            price: { id: resolveBillingPlan("plus_monthly").livePriceId, product: "prod_Fixture" },
            current_period_start: 10,
            current_period_end: 9,
          },
        ],
      },
    }),
  ];
  for (const object of invalid) {
    const f = fixture();
    await assert.rejects(
      f.project(event("customer.subscription.updated", object)),
      /legacy_event_/u,
    );
    assert.equal(f.calls.length, 0);
  }
  await assert.rejects(
    fixture().project(
      event("invoice.paid", {
        id: "in_Conflict",
        customer: "cus_Owner",
        subscription: "sub_One",
        parent: { type: "subscription_details", subscription_details: { subscription: "sub_Two" } },
      }),
    ),
    /subscription_binding_invalid/u,
  );
});

test("expired Checkout is ledger-only; unknown event types do not mutate or claim an event", async () => {
  const f = fixture();
  const normalized = f.normalize(
    event("checkout.session.expired", { id: "cs_Expired", customer: "cus_Owner" }),
  );
  assert.equal(normalized.projection, null);
  assert.equal(normalized.outcome, "checkout_expired");
  const ignored = await f.project(event("customer.updated", { id: "cus_Owner" }));
  assert.equal(ignored.ignored, true);
  assert.equal(f.calls.length, 0);
});

test("duplicate and retired-customer outcomes are explicit, while atomic failures are retryable sanitized errors", async () => {
  const duplicate = await fixture({
    data: { duplicate: true, outcome: "already_processed" },
  }).project(event());
  assert.equal(duplicate.duplicate, true);
  const orphan = await fixture({ data: { duplicate: false, outcome: "orphaned" } }).project(
    event(),
  );
  assert.equal(orphan.orphaned, true);
  await assert.rejects(
    fixture({ error: { message: "not-printed-in-error" } }).project(event()),
    (error) => error.message === "legacy_subscription_atomic_projection_failed",
  );
});

test("atomic same-state and already-processed outcomes enforce their exact duplicate contract", async () => {
  const same = await fixture({ data: { duplicate: false, outcome: "same_state" } }).project(
    event(),
  );
  assert.equal(same.duplicate, false);
  for (const value of [
    { duplicate: false, outcome: "already_processed" },
    { duplicate: true, outcome: "same_state" },
    { duplicate: true, outcome: "applied" },
    { duplicate: false, outcome: "unknown" },
  ]) {
    await assert.rejects(fixture({ data: value }).project(event()), /atomic_result_invalid/u);
  }
});
