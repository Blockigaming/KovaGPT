import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDeveloperOperation } from "../../src/lib/pricing/developer-api-aliases.mjs";
import { developerChatCompletion } from "../../src/lib/pricing/developer-chat-compat.mjs";
import { parseDeveloperInput } from "../../src/lib/pricing/developer-platform-policy.mjs";

const search = {
  model: "kova-search",
  query: "Find sources",
  max_output_tokens: 100,
  max_tool_calls: 2,
};
const chat = {
  model: "kova-fast",
  messages: [{ role: "user", content: "hello" }],
  max_completion_tokens: 100,
};
const options = { publicModel: "kova-fast", expectedModels: ["provider-model"], stream: false };
const native = {
  id: "resp_fixture",
  model: "provider-model",
  created_at: 1795651200,
  status: "completed",
  output: [
    { type: "reasoning", encrypted_content: "private" },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }] },
  ],
  usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
};
const sse = (event) => "data: " + JSON.stringify(event) + "\n\n";
const stream = (data) => new Response(data, { headers: { "Content-Type": "text/event-stream" } });

test("standalone search normalizes into the bounded native tool contract", () => {
  const normalized = normalizeDeveloperOperation("search", search);
  const parsed = parseDeveloperInput(normalized.operation, normalized.input);
  assert.equal(parsed.capability, "chat");
  assert.equal(parsed.body.tool_choice, "required");
  assert.equal(parsed.body.max_tool_calls, 2);
  assert.equal(parsed.body.stream, false);
  assert.equal(parsed.body.store, false);
  for (const patch of [
    { max_tool_calls: 4 },
    { stream: true },
    { query: "" },
    { url: "https://private" },
  ])
    assert.throws(
      () => normalizeDeveloperOperation("search", { ...search, ...patch }),
      /input_invalid/,
    );
});

test("Chat Completions history and output ceiling normalize without retaining provider state", () => {
  const normalized = normalizeDeveloperOperation("chat/completions", chat);
  const parsed = parseDeveloperInput(normalized.operation, normalized.input);
  assert.deepEqual(parsed.body.input, chat.messages);
  assert.equal(parsed.body.max_output_tokens, 100);
  assert.equal(parsed.body.store, false);
  for (const patch of [
    { max_tokens: 10 },
    { max_completion_tokens: undefined },
    { tools: [] },
    { messages: [{ role: "tool", content: "unsafe" }] },
    { messages: [{ role: "user", content: [{ type: "image_url" }] }] },
    { store: true },
  ])
    assert.throws(
      () => normalizeDeveloperOperation("chat/completions", { ...chat, ...patch }),
      /input_invalid/,
    );
});

test("JSON compatibility preserves refusal, token usage and public aliases without private reasoning", async () => {
  const value = await (await developerChatCompletion(Response.json(native), options)).json();
  assert.equal(value.object, "chat.completion");
  assert.equal(value.model, "kova-fast");
  assert.equal(value.choices[0].message.content, "Hello");
  assert.equal(value.choices[0].finish_reason, "stop");
  assert.equal(value.usage.total_tokens, 12);
  assert.doesNotMatch(JSON.stringify(value), /private|provider-model/);
  const incomplete = {
    ...native,
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "refusal", refusal: "Unavailable" }],
      },
    ],
  };
  const partial = await (await developerChatCompletion(Response.json(incomplete), options)).json();
  assert.equal(partial.choices[0].finish_reason, "length");
  assert.equal(partial.choices[0].message.refusal, "Unavailable");
  for (const patch of [
    { model: "wrong" },
    { status: "failed" },
    { usage: { input_tokens: 10, output_tokens: 2, total_tokens: 1 } },
    { output: [{ type: "function_call" }] },
  ])
    await assert.rejects(
      () => developerChatCompletion(Response.json({ ...native, ...patch }), options),
      /provider_unavailable/,
    );
});

test("SSE compatibility requires the real terminal receipt and matching observed text", async () => {
  const created = sse({ type: "response.created", response: native });
  const delta = sse({ type: "response.output_text.delta", delta: "Hello" });
  const terminal = sse({ type: "response.completed", response: native });
  const result = await developerChatCompletion(stream(created + delta + terminal), {
    ...options,
    stream: true,
  });
  const output = await result.text();
  assert.match(output, /"object":"chat.completion.chunk"/);
  assert.match(output, /"content":"Hello"/);
  assert.match(output, /"finish_reason":"stop"/);
  assert.match(output, /data: \[DONE\]/);
  assert.doesNotMatch(output, /private|provider-model/);
  for (const invalid of [created + delta, created + terminal, created + delta + terminal + delta]) {
    const rejected = await developerChatCompletion(stream(invalid), { ...options, stream: true });
    await assert.rejects(() => rejected.text(), /provider_unavailable/);
  }
});

test(
  "compatibility stream never stalls on byte fragmentation or reasoning-only frames",
  { timeout: 2000 },
  async () => {
    const text = "Héllo";
    const receipt = structuredClone(native);
    receipt.output[1].content[0].text = text;
    const source =
      sse({ type: "response.created", response: receipt }) +
      sse({ type: "response.reasoning_summary_text.delta", delta: "private" }) +
      sse({ type: "response.output_text.delta", delta: text }) +
      sse({ type: "response.completed", response: receipt });
    const bytes = new TextEncoder().encode(source.replaceAll("\n", "\r\n"));
    let offset = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
          else controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const result = await developerChatCompletion(response, { ...options, stream: true });
    const output = await result.text();
    assert.match(output, /Héllo/);
    assert.match(output, /data: \[DONE\]/);
    assert.doesNotMatch(output, /private/);
  },
);
