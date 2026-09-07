import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { timingSafeEqualText } from "../../src/lib/http-security.server.ts";
import { stripeEventMatchesEnvironment } from "../../src/lib/stripe-event-mode.mjs";
import { readUtf8BodyBounded } from "../../src/lib/endpoint-reliability.mjs";

const source = await readFile("src/lib/stripe.server.ts", "utf8");
const compiled = ts.transpileModule(
  source.replace(/^import .*;\n/gmu, "").replace(/^export /gmu, ""),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;
const secret = "webhook-fixture-secret";
const context = {
  process: {
    env: { PAYMENTS_LIVE_WEBHOOK_SECRET: secret, PAYMENTS_SANDBOX_WEBHOOK_SECRET: secret },
  },
  crypto: webcrypto,
  TextEncoder,
  Buffer,
  timingSafeEqualText,
  stripeEventMatchesEnvironment,
  readUtf8BodyBounded,
};
vm.runInNewContext(`${compiled}\nglobalThis.verify = verifyWebhook;`, context);

const validEvent = {
  id: "evt_valid",
  created: Math.floor(Date.now() / 1000),
  livemode: true,
  type: "customer.subscription.updated",
  data: { object: { id: "sub_valid" } },
};
function signedRequest(event, timestamp = String(Math.floor(Date.now() / 1000))) {
  const body = JSON.stringify(event);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return new Request("https://example.test/webhook?env=live", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${digest}` },
    body,
  });
}

test("a valid signature still requires the event mode to match the selected webhook", async () => {
  const event = await context.verify(signedRequest(validEvent), "live");
  assert.equal(event.id, "evt_valid");
  assert.equal(event.livemode, true);
  await assert.rejects(
    context.verify(signedRequest(validEvent), "sandbox"),
    /environment mismatch/u,
  );
  await assert.rejects(
    context.verify(signedRequest({ ...validEvent, livemode: undefined }), "live"),
    /environment mismatch/u,
  );
});

test("signed malformed envelopes and nonnumeric replay timestamps are rejected", async () => {
  for (const event of [
    { ...validEvent, id: "" },
    { ...validEvent, created: -1 },
    { ...validEvent, created: 1.5 },
    { ...validEvent, data: null },
    { ...validEvent, type: "" },
  ]) {
    await assert.rejects(context.verify(signedRequest(event), "live"), /Invalid webhook/u);
  }
  await assert.rejects(
    context.verify(signedRequest(validEvent, "NaN"), "live"),
    /signature format/u,
  );
});

test("oversized undeclared streaming bodies are canceled before complete buffering", async () => {
  let pulls = 0;
  let canceled = false;
  const request = new Request("https://example.test/webhook", {
    method: "POST",
    duplex: "half",
    headers: { "stripe-signature": "t=1,v1=unused" },
    body: new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1_024 * 1_024));
      },
      cancel() {
        canceled = true;
      },
    }),
  });
  await assert.rejects(context.verify(request, "live"), /Invalid webhook body/u);
  assert.equal(canceled, true);
  assert.ok(pulls <= 4, "the reader must stop near the byte budget");
});
