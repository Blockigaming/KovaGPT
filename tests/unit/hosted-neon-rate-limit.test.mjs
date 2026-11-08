import assert from "node:assert/strict";
import test from "node:test";
import { requestKovaHostedChat } from "../../src/lib/ai/kova-hosted-inference.server.mjs";
import { requestHostedEffort } from "../../src/lib/ai/hosted-effort.server.mjs";
const token = "synthetic-unit-test-server-token";
const request = {
  model: "kova-neon-4.6",
  stream: false,
  messages: [{ role: "user", content: "19 times 23" }],
  max_tokens: 100,
};
for (const model of ["kova-argon-4.6", "kova-neon-4.6", "kova-xenon-5"])
  for (const status of [429, 503, 401])
    test(`${model} HTTP ${status} is concealed and never automatically replayed`, async () => {
      let calls = 0;
      await assert.rejects(
        requestKovaHostedChat({
          request: { ...request, model },
          token,
          fetchImpl: async () => {
            calls++;
            return new Response("private provider detail", {
              status,
              headers: { "Retry-After": "0" },
            });
          },
        }),
        (error) =>
          error.message === "kova_hosted_inference_unavailable" &&
          error.status === (status === 429 ? 429 : 502),
      );
      assert.equal(calls, 1);
    });
test("revoked generation authorization prevents all paid calls", async () => {
  let calls = 0;
  await assert.rejects(
    requestHostedEffort({
      request: { ...request, stream: true },
      mode: "ultra",
      token,
      beforeSend: async () => {
        throw new Error("reservation_expired");
      },
      fetchImpl: async () => {
        calls++;
        return Response.json({});
      },
    }),
    /reservation_expired/,
  );
  assert.equal(calls, 0);
});
test("cancelled requests never reach the provider", async () => {
  let calls = 0;
  await assert.rejects(
    requestKovaHostedChat({
      request,
      token,
      signal: AbortSignal.abort(),
      fetchImpl: async () => {
        calls++;
        return Response.json({});
      },
    }),
  );
  assert.equal(calls, 0);
});
