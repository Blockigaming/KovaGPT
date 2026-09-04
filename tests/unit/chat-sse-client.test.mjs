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

  await assert.rejects(
    consumeChatSse(stream),
    (error) => {
      assert.ok(error instanceof ChatStreamError);
      assert.equal(error.code, "chat_stream_malformed_json");
      assert.equal(error.retryable, true);
      return true;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("chat SSE rejects a clean EOF without DONE", async () => {
  await assert.rejects(
    consumeChatSse(
      chunkedStream([
        'data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n',
      ]),
    ),
    (error) => {
      assert.equal(error.code, "chat_stream_missing_done");
      assert.equal(error.status, 502);
      assert.equal(error.retryable, true);
      return true;
    },
  );
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
