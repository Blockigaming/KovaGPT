import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { parseAllowedBillingPortalUrl } from "../../src/lib/billing-portal-url.mjs";
import {
  billingReturnOriginConfigured,
  billingReturnUrls,
} from "../../src/lib/checkout-return-url.mjs";
const source = readFileSync("src/utils/payments.functions.ts", "utf8");
const code = ts.transpileModule(
  (
    source.slice(
      source.indexOf("export const createPortalSession"),
      source.indexOf("export type SubscriptionSummary"),
    ) +
    source.slice(
      source.indexOf("export const getSubscriptionSummary"),
      source.indexOf("type CheckoutSubscriptionRow"),
    )
  ).replace(/^export /gmu, ""),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
const empty = {
  tier: "free",
  effectiveTier: "free",
  inherited: false,
  activeSubscriptionCount: 0,
  billingConflict: false,
  status: null,
  priceId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialing: false,
};
function fixture({
  summary = empty,
  customers = [],
  conflict = false,
  error = false,
  url = "https://billing.stripe.com/p/session_fixture",
} = {}) {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push([name, args]);
      return { abortSignal: async () => ({ data: summary, error: null }) };
    },
    from(name) {
      assert.equal(name, "subscriptions");
      let other = false;
      const query = {
        select: () => query,
        eq: (key, value) => {
          calls.push([key, value]);
          return query;
        },
        neq: () => {
          other = true;
          return query;
        },
        limit: () => query,
        order: () => query,
        abortSignal: async () => ({
          data: other
            ? conflict
              ? [{ user_id: "other" }]
              : []
            : customers.map((id) =>
                typeof id === "string" ? { stripe_customer_id: id, status: "active" } : id,
              ),
          error: error ? { code: "503" } : null,
        }),
      };
      return query;
    },
  };
  const builder = () => ({
    middleware() {
      return this;
    },
    validator() {
      return this;
    },
    handler(fn) {
      return fn;
    },
  });
  const values = new Function(
    "createServerFn",
    "requireSupabaseAuth",
    "monthlyIntroBillingEnabled",
    "loose",
    "supabaseAdmin",
    "AbortSignal",
    "BILLING_ENV",
    "BILLING_PLANS",
    "billingPortalConfigurationId",
    "billingReturnOriginConfigured",
    "billingReturnUrls",
    "process",
    "requireMonthlyIntroReadiness",
    "createStripeClient",
    "parseAllowedBillingPortalUrl",
    `${code};return {getSubscriptionSummary,createPortalSession}`,
  )(
    builder,
    {},
    () => false,
    (x) => x,
    client,
    AbortSignal,
    "live",
    {},
    () => "bpc_fixture",
    billingReturnOriginConfigured,
    billingReturnUrls,
    { env: { KOVA_BILLING_RETURN_ORIGIN: "https://kovagpt.com" } },
    async () => {},
    () => ({
      billingPortal: {
        sessions: {
          create: async (params) => {
            calls.push(["portal", params]);
            return { url };
          },
        },
      },
    }),
    parseAllowedBillingPortalUrl,
  );
  return {
    calls,
    summary: () => values.getSubscriptionSummary({ context: { userId: "owner-uuid" } }),
    portal: () =>
      values.createPortalSession({
        context: { userId: "owner-uuid" },
        data: { customer: "cus_attacker" },
      }),
  };
}
test("Free and paid entitlement displays do not depend on future Checkout tables", async () => {
  for (const tier of ["free", "plus", "pro"]) {
    const f = fixture({ summary: { ...empty, tier, effectiveTier: tier } });
    const result = await f.summary();
    assert.equal(result.effectiveTier, tier);
    assert.equal(result.billingConflict, false);
    assert.equal(result.hasBillingAccount, false);
    assert.equal(result.billingPortalAvailable, false);
  }
});
test("a unique webhook-owned billing customer enables management before monthly Checkout activation", async () => {
  const f = fixture({
    summary: { ...empty, tier: "plus", effectiveTier: "plus", activeSubscriptionCount: 1 },
    customers: ["cus_owned", "cus_owned"],
  });
  assert.equal((await f.summary()).billingPortalAvailable, true);
  assert.equal((await f.portal()).url, "https://billing.stripe.com/p/session_fixture");
  assert.deepEqual(f.calls.find(([name]) => name === "portal")[1], {
    customer: "cus_owned",
    configuration: "bpc_fixture",
    return_url: "https://kovagpt.com/",
  });
  assert.ok(f.calls.some(([key, value]) => key === "user_id" && value === "owner-uuid"));
});
test("ambiguous, foreign, malformed or unavailable customer state never opens a portal", async () => {
  for (const options of [
    { customers: ["cus_one", "cus_two"] },
    { customers: ["cus_owned"], conflict: true },
    { customers: ["invalid"] },
    { error: true },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.summary());
    assert.ok("error" in (await f.portal()));
    assert.equal(
      f.calls.some(([name]) => name === "portal"),
      false,
    );
  }
});
test("portal redirects remain restricted to Stripe's allowlist", async () => {
  const f = fixture({ customers: ["cus_owned"], url: "https://attacker.example/session" });
  assert.ok("error" in (await f.portal()));
});

test("closed historic Customers do not hide an older current subscription", async () => {
  const f = fixture({
    customers: [
      {
        stripe_customer_id: "cus_newerClosed",
        status: "canceled",
        current_period_end: "2020-01-01T00:00:00Z",
      },
      {
        stripe_customer_id: "cus_current",
        status: "active",
        current_period_end: "2099-01-01T00:00:00Z",
      },
    ],
  });
  assert.ok("url" in (await f.portal()));
  assert.equal(f.calls.find(([name]) => name === "portal")[1].customer, "cus_current");
});
