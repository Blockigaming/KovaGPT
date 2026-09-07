import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { WebhookProcessingError } from "../../src/lib/webhook-reliability.mjs";
const source = await readFile("src/routes/api/public/payments/webhook.ts", "utf8");
const file = ts.createSourceFile("webhook.ts", source, ts.ScriptTarget.Latest, true);
const handler = file.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "handleWebhook",
);
const compiled = ts.transpileModule(handler.getText(file).replace(/^export /u, ""), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(enabled, invalidSignature = false) {
  const calls = [];
  const context = {
    WebhookProcessingError,
    verifyWebhook: async () => {
      calls.push("verify");
      if (invalidSignature) throw new Error("invalid signature");
      return { id: "evt_fixture" };
    },
    durableStripeBillingEnabled: () => enabled,
    createStripeClient: () => {
      calls.push("client");
      return { subscriptions: { retrieve() {} } };
    },
    processStripeEvent: async () => {
      calls.push("process");
      return { duplicate: false };
    },
    supabaseAdmin: {},
    priceIdFrom() {},
    billingOutcome() {},
  };
  vm.runInNewContext(`${compiled}\nglobalThis.run=handleWebhook;`, context);
  return { calls, run: () => context.run({}, "live", "fixture") };
}
test("disabled durable rollout verifies signatures then returns a retryable failure without writes", async () => {
  const f = fixture(false);
  await assert.rejects(
    f.run(),
    (error) => error instanceof WebhookProcessingError && error.status === 503,
  );
  assert.deepEqual(f.calls, ["verify"]);
});
test("enabled durable rollout reaches the atomic handler only after signature verification", async () => {
  const f = fixture(true);
  await f.run();
  assert.deepEqual(f.calls, ["verify", "client", "process"]);
  const invalid = fixture(true, true);
  await assert.rejects(invalid.run(), /invalid signature/u);
  assert.deepEqual(invalid.calls, ["verify"]);
});
