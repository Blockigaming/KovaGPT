import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveAgentEntitlement } from "../../src/agents/entitlement-policy.mjs";
import { getDeepResearchAccess } from "../../src/lib/ai/deep-research-access.mjs";

const exactTier = (priceId) =>
  priceId === "plus_monthly" ? "plus" : priceId === "pro_monthly" ? "pro" : "free";

test("Deep Research rejects anonymous and free callers before a provider can run", async () => {
  let providerCalls = 0;
  const provider = async () => {
    providerCalls += 1;
    return "provider-result";
  };

  for (const input of [
    { requested: true, authenticated: false, tier: "free", owner: false },
    { requested: true, authenticated: true, tier: "free", owner: false },
  ]) {
    const access = getDeepResearchAccess(input);
    assert.equal(access.allowed, false);
    if (access.allowed) await provider();
  }

  assert.equal(providerCalls, 0);
  assert.equal(
    getDeepResearchAccess({
      requested: true,
      authenticated: true,
      tier: "plus",
      owner: false,
    }).allowed,
    true,
  );
});

test("agent entitlement accepts only live, exact, active, unexpired paid plans", () => {
  const now = Date.parse("2026-08-01T00:00:00.000Z");
  const resolve = (rows) =>
    resolveAgentEntitlement(rows, {
      billingEnvironment: "live",
      tierForLookupKey: exactTier,
      now,
    });

  assert.equal(
    resolve([
      {
        environment: "live",
        price_id: "plus_monthly",
        status: "active",
        current_period_end: "2026-09-01T00:00:00.000Z",
      },
    ]),
    "plus",
  );
  assert.equal(
    resolve([
      {
        environment: "live",
        price_id: "pro_monthly",
        status: "trialing",
        current_period_end: "2026-09-01T00:00:00.000Z",
      },
    ]),
    "pro",
  );

  for (const row of [
    {
      environment: "sandbox",
      price_id: "pro_monthly",
      status: "active",
      current_period_end: "2026-09-01T00:00:00.000Z",
    },
    {
      environment: "live",
      price_id: "plus_monthly_lookalike",
      status: "active",
      current_period_end: "2026-09-01T00:00:00.000Z",
    },
    {
      environment: "live",
      price_id: "pro_monthly",
      status: "canceled",
      current_period_end: "2026-09-01T00:00:00.000Z",
    },
    {
      environment: "live",
      price_id: "plus_monthly",
      status: "active",
      current_period_end: "2026-07-31T23:59:59.000Z",
    },
  ]) {
    assert.equal(resolve([row]), null);
  }
});

test("server routes wire entitlement checks ahead of costly research/provider calls", async () => {
  const chat = await readFile(new URL("../../src/routes/api/chat.ts", import.meta.url), "utf8");
  const execution = await readFile(
    new URL("../../src/agents/execution.server.ts", import.meta.url),
    "utf8",
  );

  const accessGate = chat.indexOf("getDeepResearchAccess({");
  assert.notEqual(accessGate, -1);
  assert.ok(accessGate < chat.indexOf("missingAiProviderResponse()"));
  assert.ok(accessGate < chat.indexOf("return handleDeepResearchRequest("));

  assert.match(execution, /\.eq\("environment", BILLING_ENV\)/);
  assert.match(execution, /resolveAgentEntitlement\(data/);
  assert.doesNotMatch(execution, /price\.includes\(/);
});
