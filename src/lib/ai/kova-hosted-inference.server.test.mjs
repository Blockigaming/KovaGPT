import test from "node:test";
import assert from "node:assert/strict";
import {
  HOSTED_MODEL_MAP,
  isKovaHostedModelId,
  prepareKovaHostedRequest,
  requestKovaHostedChat,
} from "./kova-hosted-inference.server.mjs";

const request = {
  model: "kova-argon-5",
  stream: false,
  messages: [{ role: "system", content: "You are Kova." }, { role: "user", content: "Hello" }],
  max_completion_tokens: 1200,
};

test("all three Kova products map to fixed approved foundation IDs", () => {
  assert.deepEqual(HOSTED_MODEL_MAP, {
    "kova-xenon-4.6": "moonshotai/kimi-k3",
    "kova-neon-4.6": "deepseek/deepseek-v4.1-flash-1017",
    "kova-argon-5": "qwen/qwen3.5-flash",
  });
  assert.equal(isKovaHostedModelId("kova-argon-5"), true);
  assert.equal(isKovaHostedModelId("__proto__"), false);
});

test("generates OpenRouter-compatible chat body without leaking Kova alias as upstream ID", () => {
  const prepared = prepareKovaHostedRequest(request);
  assert.equal(prepared.endpoint, "https://openrouter.ai/api/v1/chat/completions");
  const body = JSON.parse(prepared.body);
  assert.equal(body.model, "qwen/qwen3.5-flash");
  assert.equal(body.max_tokens, 1200);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.messages[0].content, "You are Kova.");
});

test("rejects request-provided host and unknown model before network", () => {
  assert.throws(() => prepareKovaHostedRequest({ ...request, url: "https://bad.test" }));
  assert.throws(() => prepareKovaHostedRequest({ ...request, model: "not-approved" }));
});

test("rejects image inputs to text-only model, unsafe outputs and unbounded tokens", () => {
  assert.throws(() => prepareKovaHostedRequest({
    ...request,
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }],
  }));
  assert.throws(() => prepareKovaHostedRequest({ ...request, max_completion_tokens: 50_000 }));
  assert.throws(() => prepareKovaHostedRequest({ ...request, max_tokens: 20 }));
});

test("uses server key, preserves streaming response and supports cancellation", async () => {
  let called = false;
  const signal = new AbortController().signal;
  const response = await requestKovaHostedChat({
    request: { ...request, stream: true },
    token: "this-is-a-test-only-server-key",
    signal,
    fetchImpl: async (url, options) => {
      called = true;
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.match(options.headers.Authorization, /^Bearer this-is-a-test-only/);
      assert.ok(options.signal);
      return new Response("data: [DONE]\\n\\n", {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  assert.equal(called, true);
  assert.equal(response.status, 200);
});

test("rejects disabled credential, upstream errors and wrong content type", async () => {
  await assert.rejects(requestKovaHostedChat({ request, token: "missing" }), /api_key_unavailable/);
  await assert.rejects(requestKovaHostedChat({
    request, token: "this-is-a-test-only-server-key",
    fetchImpl: async () => new Response("upstream detail", { status: 500 }),
  }), /hosted_inference_unavailable/);
  await assert.rejects(requestKovaHostedChat({
    request, token: "this-is-a-test-only-server-key",
    fetchImpl: async () => new Response("<html>wrong</html>", {
      headers: { "content-type": "text/html" },
    }),
  }), /hosted_response_invalid/);
});
