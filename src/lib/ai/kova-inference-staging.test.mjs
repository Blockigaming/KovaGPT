import test from "node:test";
import assert from "node:assert/strict";
import { requestStagingInference, validateInferenceEndpoint } from "./kova-inference-staging.mjs";

test("rejects insecure and private inference endpoints", () => {
  for (const endpoint of [
    "http://inference.example.com/", "https://localhost/",
    "https://127.0.0.1/", "https://10.0.0.2/",
    "https://inference.example.com/path", "https://user:pass@inference.example.com/",
  ]) assert.throws(() => validateInferenceEndpoint(endpoint));
});
test("sends authenticated staging request with expected model", async () => {
  let called = false;
  const response = await requestStagingInference({
    endpoint: "https://inference.example.com/",
    token: "test-staging-token-123",
    modelId: "kova-argon-1",
    body: { messages: [{ role: "user", content: "hello" }], stream: true },
    fetchImpl: async (url, init) => {
      called = true;
      assert.equal(url, "https://inference.example.com/v1/chat/completions");
      assert.equal(init.headers.Authorization, "Bearer test-staging-token-123");
      assert.equal(JSON.parse(init.body).model, "kova-argon-1");
      return new Response("ok", { status: 200 });
    },
  });
  assert.equal(called, true);
  assert.equal(response.status, 200);
});
test("unknown model fails before network request", async () => {
  await assert.rejects(requestStagingInference({
    endpoint: "https://inference.example.com/",
    token: "test-staging-token-123",
    modelId: "unknown",
    fetchImpl: () => { throw new Error("must not fetch"); },
  }), /unknown_kova_model/);
});
