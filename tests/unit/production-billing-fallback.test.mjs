import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/utils/payments.functions.ts", "utf8");
const handler = source.slice(
  source.indexOf("export const getSubscriptionSummary ="),
  source.indexOf("type CheckoutSubscriptionRow"),
);
const compiled = ts.transpileModule(handler.replace(/^export /u, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function fixture({ summary, mapping, monthly = false }) {
  const calls = [];
  const client = {
    rpc: (name, args) => {
      calls.push(["rpc", name, args]);
      return { abortSignal: async () => ({ data: summary, error: null }) };
    },
    from: (name) => {
      calls.push(["table", name]);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => chain,
        abortSignal: async () => mapping,
      };
      return chain;
    },
  };
  const createServerFn = () => ({
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
  const fn = new Function(
    "createServerFn",
    "requireSupabaseAuth",
    "monthlyIntroBillingEnabled",
    "loose",
    "supabaseAdmin",
    "AbortSignal",
    "BILLING_ENV",
    "BILLING_PLANS",
    "billingPortalConfigurationId",
    `${compiled}; return getSubscriptionSummary;`,
  )(
    createServerFn,
    {},
    () => monthly,
    (value) => value,
    client,
    AbortSignal,
    "live",
    {},
    () => null,
  );
  return { run: () => fn({ context: { userId: "owner-uuid" } }), calls };
}

const emptySummary = {
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

for (const code of ["PGRST205", "42P01"]) {
  test(`missing customer-binding table ${code} blocks plan changes without paid access`, async () => {
    const f = fixture({
      summary: emptySummary,
      mapping: { data: null, error: { code } },
    });
    const result = await f.run();
    assert.equal(result.tier, "free");
    assert.equal(result.effectiveTier, "free");
    assert.equal(result.billingConflict, true);
    assert.equal(result.billingSetupIncomplete, true);
    assert.equal(result.hasBillingAccount, false);
    assert.equal(result.billingPortalAvailable, false);
    assert.deepEqual(
      f.calls.map((call) => call[0]),
      ["rpc", "table"],
    );
  });
}

test("missing mapping cannot conceal an active subscription or paid tier", async () => {
  for (const summary of [
    { ...emptySummary, tier: "plus", effectiveTier: "plus" },
    { ...emptySummary, activeSubscriptionCount: 1, billingConflict: true },
  ]) {
    const f = fixture({ summary, mapping: { data: null, error: { code: "PGRST205" } } });
    await assert.rejects(f.run(), /Billing details couldn't be verified/);
  }
});

test("other binding errors still fail instead of masquerading as an empty account", async () => {
  const f = fixture({
    summary: emptySummary,
    mapping: { data: null, error: { code: "42501" } },
  });
  await assert.rejects(f.run(), /Billing details couldn't be verified/);
});

test("known binding remains authoritative", async () => {
  const f = fixture({
    summary: emptySummary,
    mapping: { data: { stripe_customer_id: "cus_fixture" }, error: null },
  });
  const result = await f.run();
  assert.equal(result.billingConflict, false);
  assert.equal(result.billingSetupIncomplete, undefined);
  assert.equal(result.hasBillingAccount, true);
});
