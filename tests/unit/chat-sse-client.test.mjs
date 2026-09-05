import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatStreamError,
  chatResponseError,
  consumeChatSse,
} from "../../src/lib/chat-sse-client.mjs";

const encoder = new TextEncoder();

function chunkedStream(chunks, onCancel = () => {}) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
    cancel(reason) {
      onCancel(reason);
    },
  });
}

test("chat SSE accepts fragmented events only after a terminal DONE frame", async () => {
  const events = [];
  await consumeChatSse(
    chunkedStream([
      'data: {"choices":[{"index":0,"delta":{"content":"hel',
      'lo"}}]}\n',
      "\ndata: [DONE]\n\n",
    ]),
    { onEvent: (event) => events.push(event) },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].choices[0].delta.content, "hello");
});

test("terminal DONE releases the reader without aborting pending server accounting", async () => {
  let finishAccounting;
  let status = "pending";
  let cancelled = false;
  const accounting = new Promise((resolve) => {
    finishAccounting = resolve;
  });
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      await accounting;
      status = "completed";
      controller.close();
    },
    cancel() {
      cancelled = true;
      status = "client_disconnected";
    },
  });

  await consumeChatSse(stream, { idleTimeoutMs: 20 });
  assert.equal(stream.locked, false);
  assert.equal(cancelled, false);
  assert.equal(status, "pending", "the UI need not wait for server accounting");
  finishAccounting();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status, "completed");
  assert.equal(cancelled, false);
});

test("chat SSE accepts a generated-image frame above the legacy 2 MiB cap", async () => {
  const image = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024 + 1)}`;
  const event = {
    choices: [{ index: 0, delta: { kind: "image", content: image } }],
  };
  let received;
  await consumeChatSse(chunkedStream([`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`]), {
    onEvent: (value) => (received = value),
  });
  assert.equal(received.choices[0].delta.content.length, image.length);
});

test("chat SSE preserves typed provider error events", async () => {
  const event = {
    choices: [
      {
        index: 0,
        delta: {
          kind: "error",
          error: "KovaGPT took too long to respond.",
          code: "provider_timeout",
          category: "model_timeout",
          retryable: true,
          status: 504,
          request_id: "req_timeout",
        },
      },
    ],
  };
  await assert.rejects(
    consumeChatSse(chunkedStream([`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`])),
    (error) => {
      assert.ok(error instanceof ChatStreamError);
      assert.equal(error.message, "KovaGPT took too long to respond.");
      assert.equal(error.code, "provider_timeout");
      assert.equal(error.category, "model_timeout");
      assert.equal(error.retryable, true);
      assert.equal(error.status, 504);
      assert.equal(error.requestId, "req_timeout");
      return true;
    },
  );
});

test("chat SSE rejects malformed JSON instead of reinserting it forever", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("data: {not-json}\n\n"));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(consumeChatSse(stream), (error) => {
    assert.ok(error instanceof ChatStreamError);
    assert.equal(error.code, "chat_stream_malformed_json");
    assert.equal(error.retryable, true);
    assert.equal(error.category, "streaming_interruption");
    return true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("chat SSE rejects a clean EOF without DONE", async () => {
  await assert.rejects(
    consumeChatSse(
      chunkedStream(['data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n']),
    ),
    (error) => {
      assert.equal(error.code, "chat_stream_missing_done");
      assert.equal(error.status, 502);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("chat SSE times out when a transport never produces its next chunk", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(consumeChatSse(stream, { idleTimeoutMs: 20 }), (error) => {
    assert.equal(error.code, "chat_stream_timeout");
    assert.equal(error.status, 504);
    assert.equal(error.category, "streaming_interruption");
    assert.equal(error.retryable, true);
    return true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("chat SSE aborts a transport whose next read never settles", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  const pending = consumeChatSse(stream, { signal: controller.signal });
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("chat HTTP errors preserve explicit provider metadata", async () => {
  const error = await chatResponseError(
    Response.json(
      {
        error: "Provider rejected the request",
        code: "PROVIDER_UNAVAILABLE",
        category: "model_provider_failure",
        retryable: false,
        requestId: "req_123",
      },
      { status: 503, headers: { "Retry-After": "7" } },
    ),
  );
  assert.equal(error.message, "Provider rejected the request");
  assert.equal(error.code, "PROVIDER_UNAVAILABLE");
  assert.equal(error.category, "model_provider_failure");
  assert.equal(error.requestId, "req_123");
  assert.equal(error.status, 503);
  assert.equal(error.retryable, false);
  assert.equal(error.retryAfter, 7);
});

test("chat HTTP errors default retryability by status when the server omits it", async () => {
  const unavailable = await chatResponseError(Response.json({}, { status: 504 }));
  const invalid = await chatResponseError(Response.json({}, { status: 400 }));
  assert.equal(unavailable.retryable, true);
  assert.equal(invalid.retryable, false);
});
