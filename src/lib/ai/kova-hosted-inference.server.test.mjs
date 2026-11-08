import test from "node:test";
import assert from "node:assert/strict";
import {
  HOSTED_MODEL_MAP,
  prepareKovaHostedRequest,
  requestKovaHostedChat,
} from "./kova-hosted-inference.server.mjs";
const request = {
  model: "kova-argon-4.6",
  messages: [{ role: "user", content: "Hello" }],
  max_completion_tokens: 1200,
};
const token = "synthetic-server-test-key";
const reply = (model, output = []) => ({
  model,
  status: "completed",
  output,
  usage: {
    input_tokens: 20,
    output_tokens: 10,
    total_tokens: 30,
    input_tokens_details: { cached_tokens: 5 },
    output_tokens_details: { reasoning_tokens: 3 },
  },
});

test("approved model mapping and trusted Kova identity on every native Responses request", () => {
  assert.deepEqual(HOSTED_MODEL_MAP, {
    "kova-xenon-5": "gpt-6.1-sol",
    "kova-neon-4.6": "gpt-6.1-terra",
    "kova-argon-4.6": "gpt-6-luna",
    "kova-argon-4.5": "gpt-5.6-luna",
    "kova-neon-4.5": "gpt-5.6-terra",
    "kova-xenon-4.6": "gpt-6-sol",
    "kova-xenon-6.1": "gpt-6-astra",
  });
  for (const [model, foundation] of Object.entries(HOSTED_MODEL_MAP)) {
    const prepared = prepareKovaHostedRequest({
      ...request,
      model,
      temperature: 0.7,
      reasoning: { effort: "max" },
    });
    const body = JSON.parse(prepared.body);
    assert.equal(prepared.endpoint, "https://api.openai.com/v1/responses");
    assert.equal(body.model, foundation);
    assert.match(body.instructions, /Introduce yourself using your Kova product name/);
    assert(body.instructions.includes(foundation));
    assert.match(body.instructions, /Never claim that Kova trained/);
    assert.equal(
      body.reasoning.effort,
      ["kova-xenon-5", "kova-xenon-6.1"].includes(model) ? "low" : "none",
    );
    assert.equal(body.temperature, undefined);
    assert.equal(body.max_output_tokens, 1200);
    assert.equal(body.store, false);
  }
});
test("rejects arbitrary endpoint, model, effort and unbounded outputs before network", () => {
  for (const extra of [
    { url: "https://bad.test" },
    { model: "__proto__" },
    { max_completion_tokens: 100000 },
    { max_tokens: 20 },
  ])
    assert.throws(() => prepareKovaHostedRequest({ ...request, ...extra }));
  assert.throws(() => prepareKovaHostedRequest(request, { effort: "invented" }));
});
test("all foundations accept bounded inline images and reject remote image fetches", () => {
  for (const model of Object.keys(HOSTED_MODEL_MAP)) {
    const messages = [
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
      },
    ];
    const body = JSON.parse(prepareKovaHostedRequest({ ...request, model, messages }).body);
    assert.equal(body.input[0].content[0].type, "input_image");
    messages[0].content[0].image_url.url = "https://private.example/image";
    assert.throws(() => prepareKovaHostedRequest({ ...request, model, messages }));
  }
});
test("function call and tool output retain call IDs across the Responses boundary", async () => {
  const body = JSON.parse(
    prepareKovaHostedRequest({
      ...request,
      messages: [
        ...request.messages,
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "search", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
      ],
      tools: [
        {
          type: "function",
          function: { name: "search", parameters: { type: "object", properties: {} } },
        },
      ],
      tool_choice: { type: "function", function: { name: "search" } },
    }).body,
  );
  assert.equal(body.input[1].type, "function_call");
  assert.deepEqual(body.input[2], {
    type: "function_call_output",
    call_id: "call_1",
    output: "result",
  });
  assert.equal(body.tools[0].name, "search");
  assert.equal(body.tool_choice.name, "search");
  const response = await requestKovaHostedChat({
    request,
    token,
    fetchImpl: async () =>
      Response.json(
        reply("gpt-6-luna-2026-11-01", [
          { type: "function_call", call_id: "call_2", name: "search", arguments: "{}" },
        ]),
      ),
  });
  const value = await response.json();
  assert.equal(value.model, "gpt-6-luna");
  assert.equal(value.choices[0].message.tool_calls[0].id, "call_2");
  assert.equal(value.usage.prompt_tokens_details.cached_tokens, 5);
  assert.equal(value.usage.completion_tokens_details.reasoning_tokens, 3);
});
test("stream translates native events and final usage without leaking private reasoning", async () => {
  const events = [
    { type: "response.created", response: { model: "gpt-6-luna" } },
    { type: "response.reasoning_summary_text.delta", delta: "private" },
    { type: "response.output_text.delta", delta: "Hello from Kova" },
    { type: "response.completed", response: reply("gpt-6-luna") },
  ];
  const response = await requestKovaHostedChat({
    request: { ...request, stream: true },
    token,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.redirect, "error");
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const text = await response.text();
  assert.match(text, /Hello from Kova/);
  assert.match(text, /prompt_tokens_details/);
  assert.match(text, /\[DONE\]/);
  assert.doesNotMatch(text, /private/);
});
test("wrong foundation, malformed response and failed HTTP never appear as successful replies", async () => {
  for (const response of [
    Response.json(reply("different-model")),
    Response.json({}),
    new Response("private provider error", { status: 500 }),
    new Response("<html>", { headers: { "content-type": "text/html" } }),
  ])
    await assert.rejects(
      requestKovaHostedChat({ request, token, fetchImpl: async () => response }),
    );
  await assert.rejects(requestKovaHostedChat({ request, token: "short" }));
});

test("native streamed refusals reach the customer with their usage receipt", async () => {
  const response = await requestKovaHostedChat({
    request: { ...request, stream: true },
    token,
    fetchImpl: async () =>
      new Response(
        [
          { type: "response.created", response: { model: "gpt-6-luna" } },
          { type: "response.refusal.delta", delta: "I cannot help with that request." },
          { type: "response.completed", response: reply("gpt-6-luna") },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  const text = await response.text();
  assert.match(text, /I cannot help with that request/);
  assert.match(text, /prompt_tokens_details/);
  assert.match(text, /\[DONE\]/);
});
