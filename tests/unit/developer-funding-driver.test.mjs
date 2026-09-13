import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import Stripe from "stripe";
import { paymentFixture } from "../helpers/developer-funding-fixture.mjs";
const slot = Symbol.for("kova.funding-test");
async function fixture() {
  const base = paymentFixture();
  const attempt = {
    ...base.attempt,
    owner_id: "owner-a",
    lease_token: crypto.randomUUID(),
    revision: 1,
    checkout_session_id: base.session.id,
    created_at: new Date().toISOString(),
    checkout_expires_at: new Date(Date.now() + 3600000).toISOString(),
  };
  base.session.payment_intent.latest_charge = base.charge;
  const state = {
    ...base,
    attempt,
    rpcs: [],
    calls: [],
    createError: false,
    event: null,
    owner: "owner-a",
    enabled: false,
    history: [],
    queries: [],
  };
  const db = {
    from(table) {
      let range;
      const orders = [];
      state.queries.push({ table, orders });
      const data = () =>
        table === "developer_account_owners"
          ? { account_id: attempt.account_id }
          : table === "developer_funding_attempts"
            ? range
              ? state.history.slice(range[0], range[1] + 1)
              : state.history
            : [];
      const q = {
        maybeSingle: async () => ({ data: data(), error: null }),
        then(resolve) {
          return Promise.resolve({ data: data(), error: null }).then(resolve);
        },
      };
      for (const method of ["select", "eq", "gt", "limit"]) q[method] = () => q;
      q.order = (column) => {
        orders.push(column);
        return q;
      };
      q.range = (from, to) => {
        range = [from, to];
        return q;
      };
      return q;
    },
    rpc(name, args) {
      state.rpcs.push({ name, args });
      if (name === "start_developer_checkout") {
        state.attempt.checkout_create_started_at = new Date().toISOString();
        state.attempt.checkout_create_parameters = structuredClone(args.p_parameters);
      }
      const data =
        name === "claim_developer_funding"
          ? [state.attempt]
          : name === "start_developer_checkout"
            ? state.attempt
            : true;
      return { abortSignal: async () => ({ data, error: null }) };
    },
  };
  const sdk = new Stripe("sk_test_fixture");
  const stripe = {
    webhooks: sdk.webhooks,
    checkout: {
      sessions: {
        async create(params, options) {
          state.calls.push({ operation: "create", params, options });
          if (state.createError) throw new Error("lost transport response");
          return state.session;
        },
        async retrieve(id) {
          state.calls.push({ operation: "retrieve", id });
          return state.session;
        },
        async list(params) {
          state.calls.push({ operation: "list", params });
          return { data: [state.session], has_more: false };
        },
      },
    },
    charges: {
      async retrieve() {
        return state.charge;
      },
    },
    paymentIntents: {
      async retrieve() {
        return state.session.payment_intent;
      },
    },
  };
  globalThis[slot] = { state, db, stripe };
  let source = await readFile(
    new URL("../../src/lib/pricing/developer-funding.server.ts", import.meta.url),
    "utf8",
  );
  source = source.replace(/import\s*\{[^}]+\}\s*from\s*"([^"]+)";/g, (full, path) => {
    if (path === "./developer-offer-verification.server")
      return 'const verifyConfiguredCreditOffer=async()=>{const s=globalThis[Symbol.for("kova.funding-test")].state;s.calls.push({operation:"verify"});if(s.verifyError)throw new Error("tax_readiness_required");};';
    if (path.startsWith("./"))
      return full.replace(
        JSON.stringify(path),
        JSON.stringify(new URL(`../../src/lib/pricing/${path.slice(2)}`, import.meta.url).href),
      );
    if (path === "@/lib/endpoint-reliability.mjs" || path === "@/lib/bounded-json.server.mjs")
      return full.replace(
        JSON.stringify(path),
        JSON.stringify(new URL(`../../src/lib/${path.slice(6)}`, import.meta.url).href),
      );
    if (path === "@supabase/supabase-js")
      return 'const createClient=()=>globalThis[Symbol.for("kova.funding-test")].db;';
    if (path === "@/lib/stripe.server")
      return 'const createStripeClient=()=>globalThis[Symbol.for("kova.funding-test")].stripe;';
    if (path === "@/lib/runtime-env.server")
      return 'const runtimeEnv=(key)=>key==="DEVELOPER_PAYMENTS_ENV"?"sandbox":key==="DEVELOPER_PAYMENTS_ORIGIN"?"https://kovagpt.com":key==="DEVELOPER_PAYMENTS_WEBHOOK_SECRET"?"whsec_fixture":key==="KOVA_DEVELOPER_PAYMENTS_ENABLED"?String(globalThis[Symbol.for("kova.funding-test")].state.enabled):"configured";';
    if (path === "@/lib/api-auth.server")
      return 'const requireVerifiedUser=async()=>({userId:globalThis[Symbol.for("kova.funding-test")].state.owner});';
    if (path === "@/lib/auth-security.mjs") return "const isCrossSiteMutation=()=>false;";
    if (path === "@/lib/distributed-rate-limit.server")
      return "const consumeApplicationRateLimit=async()=>({allowed:true});";
    return "";
  });
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(compiled + `\n// ${crypto.randomUUID()}`).toString("base64")}`
  );
  return { state, module, sdk };
}
test("the actual worker passes only verified processor evidence to the matching lease and works when new purchases are disabled", async () => {
  const { state, module } = await fixture();
  assert.equal(await module.processDeveloperFunding(state.attempt.id), true);
  const done = state.rpcs.find((x) => x.name === "complete_developer_funding");
  assert.equal(done.args.p_lease, state.attempt.lease_token);
  assert.equal(done.args.p_receipt.fee, 35);
  assert.equal(done.args.p_receipt.chargeId, state.charge.id);
});
test("a lost create retries the exact idempotency key and parameters without granting credit", async () => {
  const { state, module } = await fixture();
  state.attempt.checkout_session_id = null;
  state.createError = true;
  assert.equal(await module.processDeveloperFunding(state.attempt.id), false);
  assert.equal(await module.processDeveloperFunding(state.attempt.id), false);
  const creates = state.calls.filter((x) => x.operation === "create");
  assert.deepEqual(creates[0], creates[1]);
  assert.equal(
    state.rpcs.some((x) => x.name === "complete_developer_funding"),
    false,
  );
  assert.equal(state.rpcs.filter((x) => x.name === "defer_developer_funding").length, 2);
  state.attempt.checkout_create_started_at = new Date(Date.now() - 24 * 3600000).toISOString();
  await module.processDeveloperFunding(state.attempt.id);
  assert.equal(state.calls.filter((x) => x.operation === "create").length, 2);
  assert.equal(state.rpcs.at(-1).name, "record_developer_checkout_discovery");
});
test("a malformed processor fee leaves the attempt queued and does not publish a receipt", async () => {
  const { state, module } = await fixture();
  state.charge.balance_transaction.fee = null;
  assert.equal(await module.processDeveloperFunding(state.attempt.id), false);
  assert.equal(
    state.rpcs.some((x) => x.name === "complete_developer_funding"),
    false,
  );
  assert.equal(state.rpcs.at(-1).name, "defer_developer_funding");
});
test("the real Stripe signature and environment checks reject forged webhook input before touching the ledger", async () => {
  const { state, module, sdk } = await fixture();
  const payload = JSON.stringify({
    id: "evt_fixture",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: state.session.id } },
  });
  const request = (body, signature) =>
    new Request("https://kovagpt.com/api/developer/payments/webhook", {
      method: "POST",
      body,
      headers: { "stripe-signature": signature },
    });
  assert.equal(
    (await module.handleDeveloperFundingWebhook(request(payload, "invalid"))).status,
    400,
  );
  assert.equal(state.rpcs.length, 0);
  const wrong = JSON.stringify({
    id: "evt_wrong",
    type: "checkout.session.completed",
    livemode: true,
    data: { object: { id: state.session.id } },
  });
  assert.equal(
    (
      await module.handleDeveloperFundingWebhook(
        request(
          wrong,
          sdk.webhooks.generateTestHeaderString({ payload: wrong, secret: "whsec_fixture" }),
        ),
      )
    ).status,
    400,
  );
  assert.equal(state.rpcs.length, 0);
  assert.equal(
    (
      await module.handleDeveloperFundingWebhook(
        request(
          payload,
          sdk.webhooks.generateTestHeaderString({ payload, secret: "whsec_fixture" }),
        ),
      )
    ).status,
    200,
  );
  const queued = state.rpcs.find((x) => x.name === "queue_developer_funding");
  assert.equal(queued.args.p_session, state.session.id);
});
test("a changed principal or disabled purchases fail before any payment creation", async () => {
  const { state, module } = await fixture();
  for (const expected of ["owner-b", "owner-a"]) {
    const response = await module.handleDeveloperFunding(
      new Request("https://kovagpt.com/api/developer/funding", {
        method: "POST",
        headers: { "X-Kova-Expected-User": expected },
        body: "{}",
      }),
    );
    assert.equal(response.status, expected === "owner-b" ? 409 : 503);
  }
  assert.equal(state.calls.length, 0);
  assert.equal(state.rpcs.length, 0);
});

test("changed tax or price readiness blocks a new checkout without issuing a processor create", async () => {
  const { state, module } = await fixture();
  state.attempt.checkout_session_id = null;
  state.verifyError = true;
  assert.equal(await module.processDeveloperFunding(state.attempt.id), false);
  assert.equal(
    state.calls.some((call) => call.operation === "create"),
    false,
  );
  assert.equal(state.rpcs.at(-1).name, "defer_developer_funding");
});

test("a previously dispatched exact create can recover its cached response after price retirement", async () => {
  const { state, module } = await fixture();
  state.attempt.checkout_session_id = null;
  state.createError = true;
  assert.equal(await module.processDeveloperFunding(state.attempt.id), false);
  state.verifyError = true;
  state.createError = false;
  assert.equal(await module.processDeveloperFunding(state.attempt.id), true);
  const creates = state.calls.filter((x) => x.operation === "create");
  assert.deepEqual(creates[0], creates[1]);
  assert.equal(state.calls.filter((x) => x.operation === "verify").length, 1);
});

test("payment history remains readable and paginated after purchases are disabled", async () => {
  const { state, module } = await fixture();
  state.history = Array.from({ length: 63 }, (_, id) => ({ id, state: "paid" }));
  for (const [page, length, first, more] of [
    [1, 25, 25, true],
    [2, 13, 50, false],
  ]) {
    const response = await module.handleDeveloperFunding(
      new Request(
        `https://kovagpt.com/api/developer/funding?accountId=${state.attempt.account_id}&page=${page}`,
        { headers: { "X-Kova-Expected-User": "owner-a" } },
      ),
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.enabled, false);
    assert.equal(data.attempts.length, length);
    assert.equal(data.attempts[0].id, first);
    assert.equal(data.hasMore, more);
  }
  assert.deepEqual(state.queries.find((q) => q.table === "developer_funding_attempts").orders, [
    "created_at",
    "id",
  ]);
});
