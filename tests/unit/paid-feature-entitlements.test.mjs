import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveAgentEntitlement } from "../../src/agents/entitlement-policy.mjs";
import { getDeepResearchAccess } from "../../src/lib/ai/deep-research-access.mjs";

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

test("agent policy accepts only a paid tier already resolved by the database", () => {
  assert.equal(resolveAgentEntitlement("plus"), "plus");
  assert.equal(resolveAgentEntitlement("pro"), "pro");
  assert.equal(resolveAgentEntitlement("free"), null);
  assert.equal(resolveAgentEntitlement(null), null);
  assert.equal(resolveAgentEntitlement("plus_monthly"), null);
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

  assert.match(execution, /resolveEffectiveBillingTier\(caller\.supabaseAdmin, caller\.userId\)/);
  assert.match(execution, /return resolveAgentEntitlement\(tier\)/);
  assert.doesNotMatch(execution, /tierForLookupKey|\.from\("subscriptions"\)|price\.includes\(/);
});
