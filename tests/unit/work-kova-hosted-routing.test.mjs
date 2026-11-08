import assert from "node:assert/strict";
import test from "node:test";
import { configuredProvider } from "../../work-runner/provider.mjs";
import { HOSTED_CHAT_URL } from "../../src/lib/ai/kova-hosted-inference.server.mjs";

const foundations = [
  ["kova-argon-4.6", "gpt-6-luna", 8192],
  ["kova-neon-4.6", "gpt-6.1-terra", 8192],
  ["kova-xenon-5", "gpt-6.1-sol", 8192],
];
const question = {
  kind: "question",
  text: "Choose the next step.",
  options: ["Continue", "Review"],
};
const input = (model) => ({
  model,
  phase: "coordinator",
  reservationId: crypto.randomUUID(),
  coordinatorObjective: "Prepare the requested result",
  objective: "Ask for the next step",
  directions: [],
  maxOutputTokens: 300,
});
const response = (model) => ({
  model,
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(question) }] }],
  usage: {
    input_tokens: 120,
    output_tokens: 80,
    total_tokens: 200,
    input_tokens_details: { cached_tokens: 20 },
    output_tokens_details: { reasoning_tokens: 10 },
  },
});

for (const [alias, foundation, cap] of foundations) {
  test(`Work ${alias} calls the approved OpenAI foundation and normalizes its metered structured result`, async () => {
    const calls = [];
    const controller = new AbortController();
    const provider = configuredProvider(
      {
        responsesUrl: HOSTED_CHAT_URL,
        providerKey: "offline-hosted-key-for-work",
        models: [alias],
      },
      async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json(response(foundation));
      },
    );
    assert.equal(provider.modelCapabilities[0].maxOutputTokens, cap);
    const request = input(alias);
    const result = await provider.reason(request, { signal: controller.signal });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
    assert.equal(calls[0].init.redirect, "error");
    assert.equal(calls[0].init.headers["api-key"], undefined);
    assert.equal(calls[0].init.headers.Authorization, "Bearer offline-hosted-key-for-work");
    assert.ok(calls[0].init.signal);
    const payload = JSON.parse(calls[0].init.body);
    assert.equal(payload.model, foundation);
    assert.equal(payload.max_output_tokens, request.maxOutputTokens);
    assert.equal(payload.stream, false);
    assert.deepEqual(payload.text.format, { type: "json_object" });
    assert.deepEqual(
      payload.reasoning,
      alias === "kova-xenon-5" ? { effort: "low" } : { effort: "none" },
    );
    assert.ok(payload.instructions.includes("Return one JSON object"));
    assert.equal(result.status, "question");
    assert.equal(result.receipt.reservationId, request.reservationId);
    assert.equal(result.receipt.inputTokens, 120);
    assert.equal(result.receipt.outputTokens, 80);
    assert.equal(result.receipt.cachedInputTokens, 20);
    assert.equal(result.receipt.reasoningTokens, 10);
    assert.deepEqual(result.receipt.directive.options, ["Continue", "Review"]);
  });
}

test("hosted Work refuses provider substitution, mixed credential destinations, invented effort and inflated capabilities", async () => {
  for (const config of [
    { responsesUrl: "https://unapproved.example/v1/responses", models: ["kova-argon-4.6"] },
    { responsesUrl: HOSTED_CHAT_URL, models: ["kova-argon-4.6", "gpt-5.6-luna"] },
    {
      responsesUrl: HOSTED_CHAT_URL,
      models: ["kova-argon-4.6"],
      modelCapabilities: [{ model: "kova-argon-4.6", reasoningEfforts: [], maxOutputTokens: 8193 }],
    },
    {
      responsesUrl: HOSTED_CHAT_URL,
      models: ["kova-neon-4.6"],
      modelCapabilities: [
        { model: "kova-neon-4.6", reasoningEfforts: ["minimal"], maxOutputTokens: 8192 },
      ],
    },
  ])
    assert.throws(
      () => configuredProvider({ ...config, providerKey: "offline-hosted-key-for-work" }),
      /work_(?:provider_configuration|model_capabilities)_invalid/,
    );
  let calls = 0;
  const provider = configuredProvider(
    {
      responsesUrl: HOSTED_CHAT_URL,
      providerKey: "offline-hosted-key-for-work",
      models: ["kova-argon-4.6"],
    },
    async () => {
      calls++;
      return Response.json(response("gpt-6-luna"));
    },
  );
  for (const request of [
    { ...input("kova-argon-4.6"), maxOutputTokens: 8193 },
    { ...input("kova-argon-4.6"), reasoningEffort: "minimal" },
    input("kova-xenon-5"),
  ])
    await assert.rejects(provider.reason(request, {}), /work_provider_model_invalid/);
  assert.equal(calls, 0);
});

test("a failed or unmetered hosted response never becomes a successful Work result", async () => {
  for (const reply of [
    () => Response.json({ error: "private provider details" }, { status: 401 }),
    () => Response.json({ model: "gpt-6-luna", status: "completed", output: [] }),
  ]) {
    const provider = configuredProvider(
      {
        responsesUrl: HOSTED_CHAT_URL,
        providerKey: "offline-hosted-key-for-work",
        models: ["kova-argon-4.6"],
      },
      async () => reply(),
    );
    await assert.rejects(
      provider.reason(input("kova-argon-4.6"), {}),
      (error) =>
        /unavailable|usage_missing|response_invalid/.test(error.message) &&
        !error.message.includes("private"),
    );
  }
});
