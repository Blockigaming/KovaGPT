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
      response: {
        status: "completed",
        usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
      },
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
    { type: "response.completed", response: { status: "completed", usage: {} } },
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

function nativeFixture(chunks, { cancel } = {}) {
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[index++]));
        // Deliberately leave the connection open: terminal provider events, not
        // an upstream EOF, must determine completion and failure.
      },
      cancel,
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

test("CRLF frames and split UTF-8 chunks preserve streamed text and terminal usage", async () => {
  const raw = new TextEncoder().encode(
    `event: response.output_text.delta\r\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "café" })}\r\n\r\n` +
      `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 3, output_tokens: 2 } } })}\r\n\r\n`,
  );
  const split = raw.indexOf(0xc3) + 1;
  let index = 0;
  const upstream = new Response(
    new ReadableStream({
      pull(controller) {
        if (index === 0) controller.enqueue(raw.slice(0, split));
        else if (index === 1) controller.enqueue(raw.slice(split));
        index++;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
  const text = await responsesStreamToChatStream(upstream).text();
  assert.match(text, /"content":"café"/u);
  assert.match(text, /"prompt_tokens":3/u);
  assert.equal(text.match(/data: \[DONE\]/gu)?.length, 1);
});

test("completed provider event finishes promptly without waiting for upstream close or teardown", async () => {
  let cancelled;
  const upstream = nativeFixture(
    [
      'data: {"type":"response.output_text.delta","delta":"real partial"}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":2}}}\n\n',
    ],
    {
      cancel(reason) {
        cancelled = reason;
        return new Promise(() => {});
      },
    },
  );
  const text = await Promise.race([
    responsesStreamToChatStream(upstream).text(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("terminal event stalled")), 100)),
  ]);
  assert.match(text, /data: \[DONE\]/u);
  assert.equal(cancelled, "provider_sse_complete");
});

test("failed, incomplete and error provider events reject promptly with sanitized failures", async () => {
  for (const type of ["response.failed", "response.incomplete", "error"]) {
    let cancelled;
    const upstream = nativeFixture(
      [`data: ${JSON.stringify({ type, error: { message: "private-provider-detail" } })}\n\n`],
      {
        cancel(reason) {
          cancelled = reason;
          return new Promise(() => {});
        },
      },
    );
    await assert.rejects(
      Promise.race([
        responsesStreamToChatStream(upstream).text(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("terminal error stalled")), 100),
        ),
      ]),
      (error) => {
        assert.match(error.message, /^provider_response_(?:failed|incomplete)$/u);
        assert.doesNotMatch(error.message, /private-provider-detail/u);
        return true;
      },
    );
    assert.equal(cancelled, "provider_sse_rejected");
  }
});

test("unknown native metadata cannot bypass the provider byte limit", async () => {
  let cancelled;
  const upstream = nativeFixture(
    ['data: {"type":"future.metadata","value":"' + "x".repeat(8 * 1024 * 1024)],
    {
      cancel(reason) {
        cancelled = reason;
      },
    },
  );
  await assert.rejects(responsesStreamToChatStream(upstream).text(), (error) => {
    assert.equal(error.code, "provider_response_too_large");
    return true;
  });
  assert.equal(cancelled, "provider_sse_rejected");
});

test("HTTP-200 JSON provider errors retain their non-stream content type", () => {
  const upstream = Response.json({ error: { message: "private-provider-detail" } });
  assert.equal(responsesStreamToChatStream(upstream), upstream);
  assert.match(upstream.headers.get("content-type"), /application\/json/u);
});

test("Stop settles even when native provider cancellation never settles", async () => {
  let cancelled;
  const upstream = nativeFixture(
    ['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'],
    {
      cancel(reason) {
        cancelled = reason;
        return new Promise(() => {});
      },
    },
  );
  const reader = responsesStreamToChatStream(upstream).body.getReader();
  await reader.read();
  await Promise.race([
    reader.cancel("stop"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Stop stalled")), 100)),
  ]);
  assert.equal(cancelled, "stop");
});

test("bare or malformed completed events cannot manufacture stream success", async () => {
  for (const response of [
    undefined,
    null,
    [],
    {},
    { status: "" },
    { status: "incomplete" },
    { status: "completed", error: { message: "private-detail" } },
  ]) {
    const event = { type: "response.completed", ...(response !== undefined ? { response } : {}) };
    await assert.rejects(
      responsesStreamToChatStream(nativeFixture([`data: ${JSON.stringify(event)}\n\n`])).text(),
      /provider_response_failed/u,
    );
  }
});
