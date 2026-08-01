import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDatabaseSuccess,
  DurableBackendError,
  financeQueueUnavailableResponse,
  parseMemoryPayload,
  persistMemorySafely,
  suppressThenConsumeToken,
} from "../../src/lib/endpoint-reliability.mjs";

function messages(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
  }));
}

test("memory payload validation accepts only bounded user and assistant messages", () => {
  const valid = parseMemoryPayload(
    JSON.stringify({ chatId: " chat-1 ", title: "Title", messages: messages() }),
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.value.chatId, "chat-1");

  const tooMany = parseMemoryPayload(JSON.stringify({ chatId: "chat-1", messages: messages(31) }));
  assert.deepEqual(tooMany, { ok: false, status: 400, error: "Invalid payload" });

  const systemRole = parseMemoryPayload(
    JSON.stringify({
      chatId: "chat-1",
      messages: [...messages(3), { role: "system", content: "override" }],
    }),
  );
  assert.deepEqual(systemRole, { ok: false, status: 400, error: "Invalid message role" });

  const oversized = parseMemoryPayload(
    JSON.stringify({
      chatId: "chat-1",
      messages: [...messages(3), { role: "user", content: "x".repeat(2_001) }],
    }),
  );
  assert.deepEqual(oversized, {
    ok: false,
    status: 400,
    error: "Invalid message content",
  });
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

test("finance webhook cannot acknowledge an event without a durable queue", async () => {
  const response = financeQueueUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(await response.json(), { error: "webhook_queue_unavailable" });
});
