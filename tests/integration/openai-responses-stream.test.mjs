import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { responsesStreamToChatStream } from "../../src/lib/ai/responses-compat.server.mjs";

async function mockResponses(events) {
  const server = createServer((request, response) => {
    assert.equal(request.url, "/v1/responses");
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const event of events)
      response.write(`data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const upstream = await fetch(`http://127.0.0.1:${address.port}/v1/responses`, {
    method: "POST",
    body: JSON.stringify({ model: "gpt-4.1-nano", stream: true }),
  });
  return { response: responsesStreamToChatStream(upstream), close: () => server.close() };
}

test("mock Responses API text, function arguments, unknown events and usage translate to Kova SSE", async () => {
  const mock = await mockResponses([
    { type: "response.output_text.delta", delta: "Hel" },
    { type: "future.unknown.event", value: "ignored" },
    { type: "response.output_text.delta", delta: "lo" },
    { type: "response.function_call_arguments.delta", output_index: 0, delta: '{"q":"x"}' },
    {
      type: "response.completed",
      response: { usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } },
    },
  ]);
  const text = await mock.response.text();
  mock.close();
  assert.match(text, /"content":"Hel"/);
  assert.match(text, /"content":"lo"/);
  assert.match(text, /"arguments":"\{\\"q\\":\\"x\\"\}"/);
  assert.match(text, /"prompt_tokens":12/);
  assert.match(text, /data: \[DONE\]/);
  assert.doesNotMatch(text, /future\.unknown/);
});

test("malformed provider JSON rejects and cancels the translated stream", async () => {
  const mock = await mockResponses([
    { type: "response.output_text.delta", delta: "partial" },
    "{malformed",
    { type: "response.completed", response: { usage: {} } },
  ]);
  await assert.rejects(mock.response.text(), /invalid_provider_sse_json/);
  mock.close();
});

test("abrupt or usage-less provider streams fail instead of inventing successful completion", async () => {
  const mock = await mockResponses([{ type: "response.output_text.delta", delta: "partial" }]);
  await assert.rejects(mock.response.text(), /incomplete_provider_stream/);
  mock.close();
});

test("browser cancellation cancels the upstream provider reader", async () => {
  let cancelled = false;
  const upstream = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"response.output_text.delta","delta":"slow"}\n\n',
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const reader = responsesStreamToChatStream(upstream).body.getReader();
  await reader.read();
  await reader.cancel("stop");
  assert.equal(cancelled, true);
});
