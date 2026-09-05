import assert from "node:assert/strict";
import test from "node:test";
import {
  createChatSummarySnapshot,
  createMemoryWritePayload,
  writeMemoryForPrincipal,
} from "../../src/lib/chat-summary-snapshot.mjs";
import {
  prepareChatSummary,
  acceptChatSummary,
  processChatSummaryBatch,
} from "../../src/lib/chat-summary-policy.server.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const messages = Array.from({ length: 32 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  content: `Turn ${index}`,
}));
const input = { messages, memoryStartIndex: 0, temporary: false, memoryEnabled: true };
function completed(snapshot) {
  return {
    id,
    completed_start: snapshot.start,
    completed_count: snapshot.count,
    completed_digest: snapshot.digest,
    completed_summary: "The user chose the blue design.",
    completed_at: "2026-09-04T23:00:00Z",
  };
}

test("summary admission honors consent, Temporary mode, and the converted-chat boundary", () => {
  const snapshot = prepareChatSummary({ ...input, memoryStartIndex: 8 });
  assert.equal(snapshot.start, 8);
  assert.equal(snapshot.count, 12);
  assert.deepEqual(snapshot.messages, messages.slice(8, -12));
  for (const patch of [
    { temporary: true },
    { memoryEnabled: false },
    { memoryStartIndex: -1 },
    { memoryStartIndex: 100 },
    { memoryStartIndex: 0.5 },
  ])
    assert.equal(prepareChatSummary({ ...input, ...patch }), null);
  assert.equal(prepareChatSummary({ ...input, messages: messages.slice(0, 15) }), null);
  assert.equal(prepareChatSummary({ ...input, messages: Array(101).fill(messages[0]) }), null);
});

test("same-chat context accepts an unchanged prefix and rejects edits, truncation, or privacy changes", () => {
  const snapshot = prepareChatSummary(input);
  const row = completed(snapshot);
  assert.equal(acceptChatSummary(row, input)?.source.id, id);
  const extended = acceptChatSummary(row, {
    ...input,
    messages: [...messages, messages[0], messages[1]],
  });
  assert.match(extended.block, /UNSUMMARIZED CONTINUATION/);
  assert.match(extended.block, /Turn 20/);
  assert.match(extended.block, /Turn 21/);
  assert.equal(acceptChatSummary(row, { ...input, messages: [...messages, ...messages] }), null);
  const edited = structuredClone(messages);
  edited[0].content = "Edited after summary";
  assert.equal(acceptChatSummary(row, { ...input, messages: edited }), null);
  for (const patch of [
    { temporary: true },
    { memoryEnabled: false },
    { memoryStartIndex: 2 },
    { messages: messages.slice(0, 22) },
  ])
    assert.equal(acceptChatSummary(row, { ...input, ...patch }), null);
  assert.equal(acceptChatSummary({ ...row, completed_summary: "x".repeat(3001) }, input), null);
});

test("worker input is bounded while every source character still participates in the stale digest", () => {
  const long = messages.map((message) => ({ ...message, content: "x".repeat(1200) }));
  const snapshot = prepareChatSummary({ ...input, messages: long });
  assert.ok(snapshot.messages.every((message) => message.content.length === 256));
  long[0].content = long[0].content.slice(0, -1) + "y";
  assert.notEqual(snapshot.digest, prepareChatSummary({ ...input, messages: long }).digest);
});

function claimed() {
  return { id, requested_revision: 7, lease_token: "lease", input_messages: messages.slice(0, 4) };
}

test("worker completion carries the immutable revision and lease and reports superseded work", async () => {
  const calls = [];
  const result = await processChatSummaryBatch({
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: name.startsWith("claim") ? [claimed()] : false };
    },
    summarize: async () => "Summary",
  });
  assert.equal(result.superseded, 1);
  assert.equal(result.completed, 0);
  assert.deepEqual(calls[1], [
    "settle_chat_context_summary",
    { p_id: id, p_revision: 7, p_lease: "lease", p_summary: "Summary" },
  ]);
});

test("provider and durable settlement failures remain retryable without false completion", async () => {
  const calls = [];
  const result = await processChatSummaryBatch({
    rpc: async (name, args) => {
      calls.push(args);
      return { data: name.startsWith("claim") ? [claimed()] : true };
    },
    summarize: async () => {
      throw new Error("timeout");
    },
  });
  assert.equal(result.completed, 0);
  assert.equal(result.retrying, 1);
  assert.equal(calls[1].p_summary, null);
  await assert.rejects(
    processChatSummaryBatch({
      rpc: async (name) =>
        name.startsWith("claim") ? { data: [claimed()] } : { data: null, error: "offline" },
      summarize: async () => "Summary",
    }),
    /database_unavailable/,
  );
});

test("a settled final-attempt failure is reported as failed rather than retrying", async () => {
  const result = await processChatSummaryBatch({
    rpc: async (name) => ({
      data: name.startsWith("claim") ? [{ ...claimed(), attempts: 3 }] : true,
    }),
    summarize: async () => null,
  });
  assert.equal(result.failed, 1);
  assert.equal(result.retrying, 0);
});

test("incremental provider work receives the exact durable prior summary", async () => {
  const job = {
    ...claimed(),
    input_previous_summary: "Preserve the signed agreement",
    input_messages: [messages[0]],
  };
  const result = await processChatSummaryBatch({
    rpc: async (name) => ({ data: name.startsWith("claim") ? [job] : true }),
    summarize: async (newTurns, previousSummary) => {
      assert.equal(newTurns.length, 1);
      assert.equal(previousSummary, "Preserve the signed agreement");
      return "Updated summary";
    },
  });
  assert.equal(result.completed, 1);
});

test("browser and server use the identical full-prefix digest and bounded excerpts", async () => {
  const full = {
    ...input,
    messages: messages.map((message) => ({ ...message, content: "𝄞é".repeat(1500) })),
    memoryStartIndex: 4,
  };
  assert.deepEqual(
    await createChatSummarySnapshot(full.messages, full.memoryStartIndex),
    prepareChatSummary(full),
  );
});

test("memory payload never includes pre-conversion content in its title, summaries, or excerpts", async () => {
  const active = { id, temporary: false, memoryStartIndex: 8, messages: [...messages] };
  active.messages[0] = { role: "user", content: "Private temporary secret" };
  const payload = await createMemoryWritePayload(active);
  assert.equal(payload.title, "Turn 8");
  assert.equal(payload.memoryEnabled, true);
  assert.equal(payload.temporary, false);
  assert.deepEqual(payload.messages, messages.slice(8));
  assert.equal(payload.contextSummary.start, 8);
  assert.equal(payload.contextSummary.count, 12);
  assert.ok(!JSON.stringify(payload).includes("Private temporary secret"));
  assert.equal(await createMemoryWritePayload({ ...active, temporary: true }), null);
});

test("summary excerpts preserve complete Unicode at the storage boundary", async () => {
  const full = {
    ...input,
    messages: messages.map((message) => ({ ...message, content: "x" + "😀".repeat(200) })),
  };
  const snapshot = prepareChatSummary(full);
  assert.equal(snapshot.messages[0].content.length, 255);
  assert.equal(snapshot.messages[0].content.endsWith("😀"), true);
  assert.deepEqual(await createChatSummarySnapshot(full.messages, 0), snapshot);
});

test("delayed browser snapshots never move to another account's access token", async () => {
  const active = { id, temporary: false, messages };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init]);
    return init.method === "POST"
      ? new Response(null, { status: 204 })
      : Response.json({ enabled: false });
  };
  await writeMemoryForPrincipal(active, id, {
    getSession: async () => ({
      data: { session: { user: { id: "other" }, access_token: "other-token" } },
    }),
    fetchImpl,
  });
  assert.equal(calls.length, 0);
  await writeMemoryForPrincipal(active, id, {
    getSession: async () => ({
      data: { session: { user: { id }, access_token: "original-token" } },
    }),
    fetchImpl,
  });
  assert.equal(calls.length, 2);
  for (const [, init] of calls) {
    assert.equal(init.headers.Authorization, "Bearer original-token");
    assert.equal(init.credentials, "omit");
  }
});
