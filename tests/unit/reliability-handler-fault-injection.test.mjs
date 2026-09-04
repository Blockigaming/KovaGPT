import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertDatabaseSuccess,
  BodyReadError,
  DurableBackendError,
  financeQueueUnavailableResponse,
  noStoreJson,
  parseMemoryPayload,
  persistMemorySafely,
  readResponseBytesBounded,
  readUtf8BodyBounded,
  suppressThenConsumeToken,
  unsubscribeLinkState,
} from "../../src/lib/endpoint-reliability.mjs";

function messages(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
  }));
}

function streamRequest(chunks, headers = {}) {
  let cancelReason;
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel(reason) {
      cancelReason = reason;
    },
  });
  const request = new Request("https://kovagpt.com/test", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  });
  return { request, getCancelReason: () => cancelReason };
}

test("bounded UTF-8 reader rejects declared and streamed byte overflows", async () => {
  const declared = streamRequest([new TextEncoder().encode("small")], { "content-length": "7" });
  await assert.rejects(
    readUtf8BodyBounded(declared.request, 6),
    (error) => error instanceof BodyReadError && error.status === 413,
  );

  let cancelReason;
  const values = [new Uint8Array(4), new Uint8Array(4)];
  const streamed = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () =>
          values.length > 0 ? { done: false, value: values.shift() } : { done: true },
        cancel: async (reason) => {
          cancelReason = reason;
        },
        releaseLock: () => undefined,
      }),
    },
  };
  await assert.rejects(
    readUtf8BodyBounded(streamed, 6),
    (error) => error instanceof BodyReadError && error.status === 413,
  );
  assert.equal(cancelReason, "request_too_large");
});

test("bounded response reader rejects declared overflow without reading", async () => {
  let readerRequested = false;
  let cancelReason;
  const response = {
    headers: new Headers({ "content-length": "7" }),
    body: {
      async cancel(reason) {
        cancelReason = reason;
      },
      getReader() {
        readerRequested = true;
        throw new Error("declared overflow must not acquire a reader");
      },
    },
  };

  await assert.rejects(
    readResponseBytesBounded(response, 6),
    (error) =>
      error instanceof BodyReadError && error.status === 413 && error.code === "response_too_large",
  );
  assert.equal(readerRequested, false);
  assert.equal(cancelReason, "response_too_large");

  response.headers = new Headers({ "content-length": "1.5" });
  await assert.rejects(
    readResponseBytesBounded(response, 6),
    (error) =>
      error instanceof BodyReadError &&
      error.status === 502 &&
      error.code === "invalid_content_length",
  );
  assert.equal(cancelReason, "invalid_content_length");
});

test("bounded response reader cancels streamed overflow at the byte limit", async () => {
  let cancelReason;
  let released = false;
  const overflowChunks = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])];
  const overflow = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () =>
          overflowChunks.length > 0
            ? { done: false, value: overflowChunks.shift() }
            : { done: true },
        cancel: async (reason) => {
          cancelReason = reason;
        },
        releaseLock: () => {
          released = true;
        },
      }),
    },
  };

  await assert.rejects(
    readResponseBytesBounded(overflow, 6),
    (error) =>
      error instanceof BodyReadError && error.status === 413 && error.code === "response_too_large",
  );
  assert.equal(cancelReason, "response_too_large");
  assert.equal(released, true);

  const acceptedChunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5, 6])];
  const accepted = {
    headers: new Headers({ "content-length": "0006" }),
    body: {
      getReader: () => ({
        read: async () =>
          acceptedChunks.length > 0
            ? { done: false, value: acceptedChunks.shift() }
            : { done: true },
        cancel: async () => undefined,
        releaseLock: () => undefined,
      }),
    },
  };
  assert.deepEqual(Array.from(await readResponseBytesBounded(accepted, 6)), [1, 2, 3, 4, 5, 6]);
});

test("bounded response reader rejects truncated identity bodies", async () => {
  let released = false;
  const chunks = [new Uint8Array([1, 2, 3, 4])];
  const response = {
    headers: new Headers({ "content-length": "6" }),
    body: {
      getReader: () => ({
        read: async () =>
          chunks.length > 0 ? { done: false, value: chunks.shift() } : { done: true },
        cancel: async () => undefined,
        releaseLock: () => {
          released = true;
        },
      }),
    },
  };

  await assert.rejects(
    readResponseBytesBounded(response, 6),
    (error) =>
      error instanceof BodyReadError &&
      error.status === 502 &&
      error.code === "content_length_mismatch",
  );
  assert.equal(released, true);

  await assert.rejects(
    readResponseBytesBounded({ headers: new Headers({ "content-length": "1" }), body: null }, 6),
    (error) => error instanceof BodyReadError && error.code === "content_length_mismatch",
  );
});

test("bounded response reader ignores encoded wire-length mismatch", async () => {
  const chunks = [new Uint8Array([1, 2, 3, 4, 5, 6])];
  const response = {
    headers: new Headers({ "content-encoding": "gzip", "content-length": "4" }),
    body: {
      getReader: () => ({
        read: async () =>
          chunks.length > 0 ? { done: false, value: chunks.shift() } : { done: true },
        cancel: async () => undefined,
        releaseLock: () => undefined,
      }),
    },
  };

  assert.deepEqual(Array.from(await readResponseBytesBounded(response, 6)), [1, 2, 3, 4, 5, 6]);
});

test("bounded UTF-8 reader counts bytes, validates length, and decodes valid text", async () => {
  const multibyte = streamRequest([new TextEncoder().encode("éé")]);
  await assert.rejects(
    readUtf8BodyBounded(multibyte.request, 3),
    (error) => error instanceof BodyReadError && error.status === 413,
  );

  const invalidLength = streamRequest([new Uint8Array([1])], { "content-length": "1.5" });
  await assert.rejects(
    readUtf8BodyBounded(invalidLength.request, 10),
    (error) => error instanceof BodyReadError && error.code === "invalid_content_length",
  );

  const valid = streamRequest([
    new TextEncoder().encode("hello "),
    new TextEncoder().encode("世界"),
  ]);
  assert.equal(await readUtf8BodyBounded(valid.request, 12), "hello 世界");
});

test("memory payload validation accepts only bounded user and assistant messages", () => {
  const valid = parseMemoryPayload(
    JSON.stringify({
      chatId: " chat-1 ",
      title: "Title",
      memoryEnabled: true,
      temporary: false,
      messages: messages(),
    }),
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.value.chatId, "chat-1");

  const tooMany = parseMemoryPayload(
    JSON.stringify({
      chatId: "chat-1",
      memoryEnabled: true,
      temporary: false,
      messages: messages(31),
    }),
  );
  assert.deepEqual(tooMany, { ok: false, status: 400, error: "Invalid payload" });

  const systemRole = parseMemoryPayload(
    JSON.stringify({
      chatId: "chat-1",
      memoryEnabled: true,
      temporary: false,
      messages: [...messages(3), { role: "system", content: "override" }],
    }),
  );
  assert.deepEqual(systemRole, { ok: false, status: 400, error: "Invalid message role" });

  const oversized = parseMemoryPayload(
    JSON.stringify({
      chatId: "chat-1",
      title: "t".repeat(121),
      memoryEnabled: true,
      temporary: false,
      messages: [...messages(3), { role: "user", content: "x".repeat(2_001) }],
    }),
  );
  assert.equal(oversized.ok, true);
  assert.equal(oversized.value.title.length, 120);
  assert.equal(oversized.value.messages.at(-1).content.length, 2_000);
});

test("memory payload validation fails closed when consent is off or chat is temporary", () => {
  const base = { chatId: "chat-1", messages: messages() };
  for (const payload of [
    base,
    { ...base, memoryEnabled: false, temporary: false },
    { ...base, memoryEnabled: true, temporary: true },
    { ...base, memoryEnabled: true },
  ]) {
    assert.deepEqual(parseMemoryPayload(JSON.stringify(payload)), {
      ok: false,
      status: 400,
      error: "Invalid payload",
    });
  }
});

test("memory persistence never succeeds after an upsert failure", async () => {
  let pruneCalled = false;
  await assert.rejects(
    persistMemorySafely({
      upsert: async () => ({ data: null, error: new Error("database offline") }),
      listOverflow: async () => {
        pruneCalled = true;
        return { data: [] };
      },
      deleteOverflow: async () => ({ data: null }),
    }),
    (error) => error instanceof DurableBackendError && error.operation === "memory_upsert",
  );
  assert.equal(pruneCalled, false);
});

test("memory list and delete database errors cannot become empty or ok responses", () => {
  assert.throws(
    () => assertDatabaseSuccess({ data: null, error: new Error("read failed") }, "memory_list"),
    (error) => error instanceof DurableBackendError && error.operation === "memory_list",
  );
  assert.throws(
    () => assertDatabaseSuccess({ data: null, error: new Error("delete failed") }, "memory_delete"),
    (error) => error instanceof DurableBackendError && error.operation === "memory_delete",
  );
});

test("automatic memory summarization never consumes the foreground chat quota", async () => {
  const source = await readFile(new URL("../../src/routes/api/memory.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\benforceQuota\b/);
  assert.doesNotMatch(source, /DAILY_CHAT_LIMIT_BY_TIER/);
  assert.match(source, /caller\.tier === "free"/);
  assert.match(source, /status: 204/);

  const clientSource = await readFile(
    new URL("../../src/routes/index.tsx", import.meta.url),
    "utf8",
  );
  assert.match(clientSource, /active\.messages\s*\.slice\(-30\)/);
  assert.match(clientSource, /active\.title\.slice\(0, 120\)/);
  assert.match(clientSource, /message\.content\.slice\(0, 2000\)/);
});

test("memory persistence surfaces pruning lookup and deletion failures", async () => {
  await assert.rejects(
    persistMemorySafely({
      upsert: async () => ({ data: null }),
      listOverflow: async () => ({ data: null, error: new Error("read failed") }),
      deleteOverflow: async () => ({ data: null }),
    }),
    (error) => error.operation === "memory_prune_lookup",
  );

  await assert.rejects(
    persistMemorySafely({
      upsert: async () => ({ data: null }),
      listOverflow: async () => ({ data: [{ id: "old" }] }),
      deleteOverflow: async () => ({ data: null, error: new Error("delete failed") }),
    }),
    (error) => error.operation === "memory_prune_delete",
  );
});

test("unsubscribe never consumes a token before durable suppression", async () => {
  const calls = [];
  await assert.rejects(
    suppressThenConsumeToken({
      alreadyUsed: false,
      suppress: async () => {
        calls.push("suppress");
        return { data: null, error: new Error("write failed") };
      },
      consume: async () => {
        calls.push("consume");
        return { data: null };
      },
    }),
    (error) => error.operation === "unsubscribe_suppression",
  );
  assert.deepEqual(calls, ["suppress"]);
});

test("unsubscribe retries reassert suppression and only then consume the token", async () => {
  const firstAttempt = [];
  await suppressThenConsumeToken({
    alreadyUsed: false,
    suppress: async () => {
      firstAttempt.push("suppress");
      return { data: null };
    },
    consume: async () => {
      firstAttempt.push("consume");
      return { data: null };
    },
  });
  assert.deepEqual(firstAttempt, ["suppress", "consume"]);

  const retry = [];
  await suppressThenConsumeToken({
    alreadyUsed: true,
    suppress: async () => {
      retry.push("suppress");
      return { data: null };
    },
    consume: async () => {
      retry.push("consume");
      return { data: null };
    },
  });
  assert.deepEqual(retry, ["suppress"]);
});

test("unsubscribe reports a token update failure and a retry repeats suppression", async () => {
  const calls = [];
  await assert.rejects(
    suppressThenConsumeToken({
      alreadyUsed: false,
      suppress: async () => {
        calls.push("suppress");
        return { data: null };
      },
      consume: async () => {
        calls.push("consume");
        return { data: null, error: new Error("token write failed") };
      },
    }),
    (error) => error.operation === "unsubscribe_token_update",
  );

  await suppressThenConsumeToken({
    alreadyUsed: false,
    suppress: async () => {
      calls.push("suppress");
      return { data: null };
    },
    consume: async () => {
      calls.push("consume");
      return { data: null };
    },
  });
  assert.deepEqual(calls, ["suppress", "consume", "suppress", "consume"]);
});

test("legacy used tokens self-heal unless durable suppression is proven", () => {
  assert.deepEqual(
    unsubscribeLinkState({ alreadyUsed: false, suppressionResult: { data: null } }),
    { valid: true },
  );
  assert.deepEqual(unsubscribeLinkState({ alreadyUsed: true, suppressionResult: { data: null } }), {
    valid: true,
  });
  assert.deepEqual(
    unsubscribeLinkState({
      alreadyUsed: true,
      suppressionResult: { data: { email: "stored but never returned" } },
    }),
    { valid: false, reason: "already_unsubscribed" },
  );
  assert.throws(
    () =>
      unsubscribeLinkState({
        alreadyUsed: true,
        suppressionResult: { data: null, error: new Error("lookup failed") },
      }),
    (error) => error.operation === "unsubscribe_suppression_lookup",
  );
});

test("unsubscribe responses are never cacheable and source logs no token material", async () => {
  const response = noStoreJson({ valid: true });
  assert.equal(response.headers.get("cache-control"), "no-store");

  const source = await readFile(
    new URL("../../src/routes/email/unsubscribe.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /token_prefix|token\.slice\s*\(/);
  assert.doesNotMatch(source, /Response\.json\s*\(/);
});

test("changed request handlers use the bounded reader instead of request.text", async () => {
  for (const path of [
    "../../src/routes/api/memory.ts",
    "../../src/routes/api/finances/webhook.ts",
    "../../src/routes/email/unsubscribe.ts",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /readUtf8BodyBounded/);
    assert.doesNotMatch(source, /request\.text\s*\(/);
  }
});

test("finance webhook cannot acknowledge an event without a durable queue", async () => {
  const response = financeQueueUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(await response.json(), { error: "webhook_queue_unavailable" });
});
