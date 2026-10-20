import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createChatPreflightRunner } from "../../src/lib/chat-preflight.server.mjs";

const source = await readFile(
  new URL("../../src/lib/billing-entitlement.server.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(
  source.replace(/^import[^\n]*\n/gmu, "").replace(/^export /gmu, ""),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture(response, throws = false) {
  const calls = [];
  const expectedSignal = {};
  const context = {
    loose: (client) => client,
    AbortSignal: {
      timeout: (ms) => {
        assert.equal(ms, 10_000);
        return expectedSignal;
      },
    },
  };
  vm.runInNewContext(
    `${compiled}\nglobalThis.subject={resolveUserBillingTier,resolveEffectiveBillingTier};`,
    context,
  );
  const client = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return {
        abortSignal: async (signal) => {
          assert.equal(signal, expectedSignal);
          if (throws) throw response;
          return response;
        },
      };
    },
  };
  return { ...context.subject, client, calls };
}

for (const [method, routine] of [
  ["resolveUserBillingTier", "billing_user_plan_tier"],
  ["resolveEffectiveBillingTier", "effective_user_plan_tier"],
]) {
  for (const tier of ["free", "plus", "pro"]) {
    test(`${routine} accepts authoritative ${tier} with one bounded exact RPC`, async () => {
      const f = fixture({ data: tier, error: null });
      assert.equal(await f[method](f.client, "nonsecret-owner-fixture"), tier);
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].name, routine);
      assert.equal(f.calls[0].args._user_id, "nonsecret-owner-fixture");
    });
  }
  test(`${routine} does not treat an RPC error as Free`, async () => {
    const f = fixture({
      data: "free",
      error: { message: "NONSECRET_FIXTURE_SQL_ERROR", code: "42883" },
    });
    await assert.rejects(f[method](f.client, "nonsecret-owner-fixture"), (error) => {
      assert.equal(error.code, "billing_entitlement_unavailable");
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      assert(!JSON.stringify(error).includes("NONSECRET_FIXTURE_SQL_ERROR"));
      return true;
    });
    assert.equal(f.calls.length, 1);
  });
  for (const [name, value] of [
    ["null", null],
    ["undefined", undefined],
    ["unknown tier", "enterprise"],
    ["empty string", ""],
    ["number", 0],
    ["object", {}],
    ["array", []],
  ]) {
    test(`${routine} rejects ${name} rather than normalizing to Free`, async () => {
      const f = fixture({ data: value, error: null });
      await assert.rejects(
        f[method](f.client, "nonsecret-owner-fixture"),
        (error) => error.code === "billing_entitlement_unavailable",
      );
      assert.equal(f.calls.length, 1);
    });
  }
  test(`${routine} sanitizes transport errors without retry or raw cause`, async () => {
    const f = fixture(new Error("NONSECRET_FIXTURE_TRANSPORT_ERROR"), true);
    await assert.rejects(f[method](f.client, "nonsecret-owner-fixture"), (error) => {
      assert.equal(error.message, "billing_entitlement_unavailable");
      assert.equal(error.cause, undefined);
      assert.equal(error.status, 503);
      return true;
    });
    assert.equal(f.calls.length, 1);
  });
  for (const [name, response] of [
    ["null", null],
    ["undefined", undefined],
    ["empty", {}],
    ["missing error", { data: "free" }],
  ]) {
    test(`${routine} rejects ${name} response contract`, async () => {
      const f = fixture(response);
      await assert.rejects(
        f[method](f.client, "nonsecret-owner-fixture"),
        (error) => error.code === "billing_entitlement_unavailable",
      );
      assert.equal(f.calls.length, 1);
    });
  }
}

test("chat preflight preserves a tier outage as retryable 503, not authentication failure", async () => {
  const f = fixture({ data: null, error: { code: "42883" } });
  const runner = createChatPreflightRunner({ requiredTimeoutMs: 100, totalTimeoutMs: 500 });
  try {
    await assert.rejects(
      runner.run("plan_entitlement", () =>
        f.resolveEffectiveBillingTier(f.client, "nonsecret-owner-fixture"),
      ),
      (error) => {
        assert.equal(error.status, 503);
        assert.notEqual(error.status, 401);
        assert.equal(error.code, "billing_entitlement_unavailable");
        assert.equal(error.stage, "plan_entitlement");
        assert.equal(error.retryable, true);
        assert.equal(error.message, "Your plan could not be verified. Please try again shortly.");
        return true;
      },
    );
  } finally {
    runner.close();
  }
});
