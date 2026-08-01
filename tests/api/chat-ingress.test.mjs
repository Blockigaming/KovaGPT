import assert from "node:assert/strict";
import test from "node:test";

import {
  ChatIngressError,
  readChatRequest,
  toChatIngressErrorEnvelope,
} from "../../src/lib/chat-ingress.server.mjs";

test("malformed chat JSON maps to a stable 400 API envelope with request ID", async () => {
  let error;
  try {
    await readChatRequest(
      new Request("https://kovagpt.com/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ChatIngressError);
  assert.equal(error.status, 400);
  const envelope = toChatIngressErrorEnvelope(error, "req_api_test", "2026-08-02T00:00:00.000Z");
  assert.equal(envelope.requestId, "req_api_test");
  assert.equal(envelope.code, "invalid_json");
  assert.equal(envelope.category, "bad_request");
  assert.equal(envelope.retryable, false);
});

test("oversized chat JSON maps to a stable 413 API envelope", async () => {
  await assert.rejects(
    readChatRequest(
      new Request("https://kovagpt.com/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "x".repeat(100) }],
        }),
      }),
      64,
    ),
    (error) =>
      error instanceof ChatIngressError &&
      error.status === 413 &&
      error.code === "request_too_large",
  );
});

test("non-JSON chat payloads map to a stable 415 API envelope", async () => {
  await assert.rejects(
    readChatRequest(
      new Request("https://kovagpt.com/api/chat", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      }),
    ),
    (error) =>
      error instanceof ChatIngressError &&
      error.status === 415 &&
      error.code === "unsupported_media_type",
  );
});
