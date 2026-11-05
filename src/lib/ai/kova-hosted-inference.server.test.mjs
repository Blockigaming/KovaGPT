import test from "node:test";
import assert from "node:assert/strict";
import {
  HOSTED_MODEL_MAP,
  isKovaHostedModelId,
  prepareKovaHostedRequest,
  requestKovaHostedChat,
} from "./kova-hosted-inference.server.mjs";

const request = {
  model: "kova-argon-4.6",
  stream: false,
  messages: [
    { role: "system", content: "You are Kova." },
    { role: "user", content: "Hello" },
  ],
  max_completion_tokens: 1200,
};

test("all three Kova products map to fixed approved foundation IDs", () => {
  assert.deepEqual(HOSTED_MODEL_MAP, {
    "kova-xenon-5": "moonshotai/kimi-k3",
    "kova-neon-4.6": "meta-llama/llama-4-maverick",
    "kova-argon-4.6": "deepseek/deepseek-v4-flash-0731",
  });
  assert.equal(isKovaHostedModelId("kova-argon-4.6"), true);
  assert.equal(isKovaHostedModelId("__proto__"), false);
});

test("generates OpenRouter-compatible chat body without leaking Kova alias as upstream ID", () => {
  const prepared = prepareKovaHostedRequest(request);
  assert.equal(prepared.endpoint, "https://openrouter.ai/api/v1/chat/completions");
  const body = JSON.parse(prepared.body);
  assert.equal(body.model, "deepseek/deepseek-v4-flash-0731");
  assert.equal(body.max_tokens, 1200);
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.messages[0].content, "You are Kova.");
});

test("rejects request-provided host and unknown model before network", () => {
  assert.throws(() => prepareKovaHostedRequest({ ...request, url: "https://bad.test" }));
  assert.throws(() => prepareKovaHostedRequest({ ...request, model: "not-approved" }));
});

test("rejects image inputs to text-only model, unsafe outputs and unbounded tokens", () => {
  assert.throws(() =>
    prepareKovaHostedRequest({
      ...request,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }],
    }),
  );
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
  await assert.rejects(
    requestKovaHostedChat({
      request,
      token: "this-is-a-test-only-server-key",
      fetchImpl: async () => new Response("upstream detail", { status: 500 }),
    }),
    /hosted_inference_unavailable/,
  );
  await assert.rejects(
    requestKovaHostedChat({
      request,
      token: "this-is-a-test-only-server-key",
      fetchImpl: async () =>
        new Response("<html>wrong</html>", {
          headers: { "content-type": "text/html" },
        }),
    }),
    /hosted_response_invalid/,
  );
});

test("each Kova tier has distinct upstream budget and reasoning policy", () => {
  for (const [alias, expectedModel, effort, max] of [
    ["kova-argon-4.6", "deepseek/deepseek-v4-flash-0731", undefined, 4096],
    ["kova-neon-4.6", "meta-llama/llama-4-maverick", undefined, 8192],
    ["kova-xenon-5", "moonshotai/kimi-k3", "max", 16384],
  ]) {
    const prepared = prepareKovaHostedRequest({
      ...request,
      model: alias,
      max_completion_tokens: max,
    });
    const body = JSON.parse(prepared.body);
    assert.equal(body.model, expectedModel);
    assert.equal(body.max_tokens, max);
    assert.equal(body.reasoning?.effort, effort);
    assert.equal(body.provider.sort, "latency");
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.provider.allow_fallbacks, true);
    assert.ok(body.provider.max_price.prompt > 0);
    assert.ok(body.provider.max_price.completion > 0);
    assert.throws(() =>
      prepareKovaHostedRequest({
        ...request,
        model: alias,
        max_completion_tokens: max + 1,
      }),
    );
  }
});
test("Maverick and Kimi accept bounded inline image inputs while original Flash stays text-only", () => {
  const prepared = prepareKovaHostedRequest({
    ...request,
    model: "kova-xenon-5",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
    ],
  });
  assert.equal(JSON.parse(prepared.body).messages[0].content[1].type, "image_url");
  assert.throws(
    () =>
      prepareKovaHostedRequest({
        ...request,
        model: "kova-argon-4.6",
        messages: [
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
          },
        ],
      }),
    /hosted_model_vision_unavailable/,
  );

  assert.throws(() =>
    prepareKovaHostedRequest({
      ...request,
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://private.example/image.png" } }],
        },
      ],
    }),
  );
});
