import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { opaqueFinanceId } from "../../src/finances/plaid-webhook.server.mjs";
import { readFinanceSnapshot } from "../../src/finances/finance-read.server.mjs";
import { readHealthSummary } from "../../src/health/health-read.server.mjs";
import { HEALTH_PROVIDERS } from "../../src/health/providers.mjs";

const owner = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const state = {
    lockdown: false,
    session: true,
    configured: true,
    decrypts: 0,
    network: [],
    calls: [],
    receipts: new Map(),
    dbError: false,
    auditError: false,
  };
  const finance = {
    id: opaqueFinanceId("plaid-item", "fixture-item"),
    owner_id: owner,
    provider: "plaid",
    status: "connected",
    deleted_at: null,
    item_reference_ciphertext: "finance-ciphertext",
  };
  const health = {
    id: "00000000-0000-4000-8000-000000000003",
    owner_id: owner,
    provider_id: "oura",
    workspace_id: null,
    status: "connected",
    deleted_at: null,
    updated_at: "version-1",
    token_expires_at: null,
    granted_scopes: ["daily"],
    access_token_ciphertext: "health-ciphertext",
  };
  state.finance = finance;
  state.health = health;
  const db = {
    from(table) {
      const filters = [];
      let operation, payload;
      const finish = async () => {
        state.calls.push({ table, filters: [...filters], operation });
        if (state.dbError) return { data: null, error: { code: "backend_unavailable" } };
        if (["insert", "upsert"].includes(operation)) {
          await state.onAudit?.();
          if (state.auditError) return { data: null, error: { code: "backend_unavailable" } };
          if (payload.id && !state.receipts.has(payload.id))
            state.receipts.set(payload.id, payload);
          return { data: payload, error: null };
        }
        const row = table === "financial_connections" ? state.finance : state.health;
        const data = row && filters.every(([key, value]) => row[key] === value) ? { ...row } : null;
        if (operation === "delete" && data) state.finance = null;
        return { data, error: null };
      };
      const chain = {
        select() {
          return chain;
        },
        eq(key, value) {
          filters.push([key, value]);
          return chain;
        },
        is(key, value) {
          filters.push([key, value]);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        insert(value) {
          operation = "insert";
          payload = value;
          return chain;
        },
        upsert(value) {
          operation = "upsert";
          payload = value;
          return chain;
        },
        delete() {
          operation = "delete";
          return chain;
        },
        maybeSingle: finish,
        single: finish,
        then(resolve, reject) {
          return finish().then(resolve, reject);
        },
      };
      return chain;
    },
  };
  const requestPlaid = async (path, body) => {
    state.network.push([path, body]);
    await state.onNetwork?.();
    if (state.providerError) throw new Error("plaid_503");
    if (path === "/accounts/get")
      return { accounts: [{ account_id: "a", name: "Checking", balances: { current: 100 } }] };
    if (path === "/transactions/get") return { transactions: [], total_transactions: 0 };
    return { request_id: "fixture-request" };
  };
  const modules = {
    "@/lib/lockdown-policy.mjs": {
      assertLockdownAllows: async () => {
        if (state.lockdown) throw new Error("lockdown");
      },
    },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: !state.rateLimited }),
    },
    "@/integrations/credential-vault.server": {
      decryptCredential: async (ciphertext) => {
        state.decrypts++;
        return ciphertext === "health-ciphertext"
          ? "health-token"
          : JSON.stringify({ item_id: "fixture-item", access_token: "access-production-fixture" });
      },
      encryptCredential: async (value) => `encrypted:${value}`,
    },
    "./plaid-request.server.mjs": {
      requestPlaid,
      financeCountry: (country) => country,
      financeLinkRequest: () => ({}),
      plaidConfiguration: () => ({ mode: "production" }),
    },
    "./plaid-webhook.server.mjs": { opaqueFinanceId },
    "./finance-read.server.mjs": { readFinanceSnapshot },
    "./providers.mjs": { HEALTH_PROVIDERS },
    "@/integrations/oauth-providers.server": {
      configuredOAuthProviders: () => (state.configured ? [{ id: "oura" }] : []),
    },
    "@/integrations/connected-tools.server": { refreshExpiringConnection: async () => null },
    "./health-read.server.mjs": {
      readHealthSummary: (provider, scopes, token, ensure) =>
        readHealthSummary(provider, scopes, token, ensure, async (url) => {
          state.network.push(url);
          await state.onNetwork?.();
          return Response.json({ data: [{ day: "2026-10-30", score: 80 }] });
        }),
    },
  };
  modules["./credential-vault.server"] = modules["@/integrations/credential-vault.server"];
  function load(path) {
    const exported = {};
    const source = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function("exports", "require", source)(exported, (id) => {
      assert.ok(Object.hasOwn(modules, id), id);
      return modules[id];
    });
    return exported;
  }
  const caller = (userId = owner) => ({
    userId,
    supabaseAdmin: db,
    revalidateSession: async () => state.session,
  });
  return {
    state,
    caller,
    db,
    finance: load("src/finances/plaid.server.ts"),
    health: load("src/health/health-accounts.server.ts"),
  };
}

test("foreign finance and health accounts cannot reach decryption or any provider", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.finance.readFinanceConnection(f.caller(stranger), f.state.finance.id),
    /finance_connection_not_found/,
  );
  await assert.rejects(
    () => f.finance.disconnectFinanceConnection(f.caller(stranger), f.state.finance.id),
    /finance_connection_not_found/,
  );
  await assert.rejects(
    () => f.health.readHealthAccount(f.caller(stranger), f.state.health.id),
    /health_account_unavailable/,
  );
  assert.equal(f.state.decrypts, 0);
  assert.equal(f.state.network.length, 0);
  for (const call of f.state.calls)
    assert.ok(call.filters.some(([key, value]) => key === "owner_id" && value === stranger));
});
test("Lockdown, rate protection, and an expired session stop both sensitive data domains", async () => {
  for (const field of ["lockdown", "rateLimited", "session"]) {
    const f = fixture();
    f.state[field] = field !== "session";
    await assert.rejects(() => f.finance.readFinanceConnection(f.caller(), f.state.finance.id));
    await assert.rejects(() => f.health.readHealthAccount(f.caller(), f.state.health.id));
    assert.equal(f.state.network.length, 0);
    assert.equal(f.state.decrypts, 0);
  }
});
test("provider reads are discarded if account access changes during the network call", async () => {
  for (const domain of ["finance", "health"]) {
    const f = fixture();
    f.state.onNetwork = () => {
      f.state[domain].status = "revoked";
    };
    if (domain === "finance")
      await assert.rejects(
        () => f.finance.readFinanceConnection(f.caller(), f.state.finance.id),
        /finance_connection_changed/,
      );
    else
      await assert.rejects(
        () => f.health.readHealthAccount(f.caller(), f.state.health.id),
        /health_binding_changed/,
      );
    assert.equal(f.state.network.length, 1);
  }
});
test("a failed audit cannot return finance or health results", async () => {
  const f = fixture();
  f.state.auditError = true;
  await assert.rejects(
    () => f.finance.readFinanceConnection(f.caller(), f.state.finance.id),
    /finance_audit_unavailable/,
  );
  await assert.rejects(
    () => f.health.readHealthAccount(f.caller(), f.state.health.id),
    /health_audit_unavailable/,
  );
});
test("disconnect retains the finance credential until Plaid confirms removal", async () => {
  const f = fixture();
  f.state.providerError = true;
  await assert.rejects(
    () => f.finance.disconnectFinanceConnection(f.caller(), f.state.finance.id),
    /plaid_503/,
  );
  assert.equal(f.state.finance.status, "connected");
  assert.equal(
    f.state.calls.some((call) => call.operation === "delete"),
    false,
  );
  f.state.providerError = false;
  assert.deepEqual(await f.finance.disconnectFinanceConnection(f.caller(), f.state.finance.id), {
    disconnected: true,
  });
  assert.equal(f.state.finance, null);
});
test("verified finance notification receipts are durable, deduplicated, and exclude raw Item IDs and tokens", async () => {
  const f = fixture();
  const event = {
    itemId: "fixture-item",
    type: "TRANSACTIONS",
    code: "SYNC_UPDATES_AVAILABLE",
    bodyHash: "a".repeat(64),
  };
  f.state.auditError = true;
  await assert.rejects(
    () => f.finance.persistFinanceWebhook(f.db, event),
    /finance_webhook_store_unavailable/,
  );
  assert.equal(f.state.receipts.size, 0);
  f.state.auditError = false;
  assert.deepEqual(await f.finance.persistFinanceWebhook(f.db, event), { received: true });
  await f.finance.persistFinanceWebhook(f.db, event);
  assert.equal(f.state.receipts.size, 1);
  const receipt = [...f.state.receipts.values()][0];
  assert.equal(receipt.owner_id, owner);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /fixture-item|access-production-fixture|finance-ciphertext/,
  );
});
test("unknown or removed Plaid Items never fetch financial data", async () => {
  const f = fixture();
  assert.deepEqual(
    await f.finance.persistFinanceWebhook(f.db, {
      itemId: "unknown",
      type: "ITEM",
      code: "ERROR",
      bodyHash: "b".repeat(64),
    }),
    { received: true, ignored: true },
  );
  assert.equal(f.state.decrypts, 0);
  assert.equal(f.state.network.length, 0);
  f.state.dbError = true;
  await assert.rejects(
    () => f.finance.persistFinanceWebhook(f.db, { itemId: "unknown" }),
    /finance_webhook_store_unavailable/,
  );
});
