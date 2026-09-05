import assert from "node:assert/strict";
import test from "node:test";
import {
  createChatSummarySnapshot,
  createChatHistoryPayload,
  writeMemoryForPrincipal,
  fetchForPrincipal,
} from "../../src/lib/chat-summary-snapshot.mjs";
import { acceptChatSummary } from "../../src/lib/chat-summary-policy.server.mjs";
import { normalizeChatPayload } from "../../src/lib/chat-ingress.server.mjs";
const id = "11111111-1111-4111-8111-111111111111";
const chatId = "22222222-2222-4222-8222-222222222222";
const history = Array.from({ length: 1201 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  content: `Turn ${index}`,
}));
const session = { user: { id }, access_token: "owner-token" };
const dependencies = (descriptor) => ({
  getSession: async () => ({ data: { session } }),
  fetchImpl: async () => Response.json({ enabled: true, descriptor }),
});

test("a delayed foreground request refuses account retargeting and pins the original token", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push(init);
    return Response.json({ ok: true });
  };
  await assert.rejects(
    fetchForPrincipal(
      id,
      "/api/chat",
      { method: "POST", body: "private chat" },
      {
        getSession: async () => ({
          data: { session: { user: { id: chatId }, access_token: "other-token" } },
        }),
        fetchImpl,
      },
    ),
    (error) => error.name === "AbortError",
  );
  assert.equal(calls.length, 0);
  await fetchForPrincipal(
    id,
    "/api/chat",
    { method: "POST", body: "private chat" },
    { getSession: async () => ({ data: { session } }), fetchImpl },
  );
  assert.equal(calls[0].headers.get("authorization"), "Bearer owner-token");
  assert.equal(calls[0].credentials, "omit");
});
function completed(snapshot) {
  return {
    id: chatId,
    completed_start: snapshot.start,
    completed_count: snapshot.count,
    completed_digest: snapshot.digest,
    completed_summary: "Earlier context",
    completed_at: "2026-09-05T00:00:00Z",
    requested_start: snapshot.start,
    requested_count: snapshot.count,
    requested_digest: snapshot.digest,
    status: "completed",
  };
}

test("a 1201-message archive catches up through bounded increments without truncating local history", async () => {
  const before = structuredClone(history);
  let descriptor = null;
  let turns = 0;
  for (let step = 0; step < 20; step++) {
    const next = await createChatSummarySnapshot(history, 0, descriptor);
    if (!next) break;
    assert.ok(next.messages.length <= 88);
    assert.equal(next.messages.length, next.count - (descriptor?.completed_count ?? 0));
    if (descriptor) {
      assert.equal(next.baseId, descriptor.id);
      assert.equal(next.baseDigest, descriptor.completed_digest);
    }
    turns += next.messages.length;
    descriptor = completed(next);
  }
  assert.equal(turns, 1189);
  assert.equal(descriptor.completed_count, 1189);
  assert.deepEqual(history, before);
  const payload = await createChatHistoryPayload(history, 0, {
    principal: id,
    chatId,
    memoryEnabled: true,
    ...dependencies(descriptor),
  });
  assert.equal(payload.messages.length, 100);
  assert.equal(payload.historyOffset, 1101);
  assert.equal(payload.messages.at(-1).content, "Turn 1200");
  assert.equal(normalizeChatPayload(payload).messages.length, 100);
  assert.ok(acceptChatSummary(descriptor, { ...payload, temporary: false, memoryEnabled: true }));
});

test("editing a prefix outside the transport window restarts incremental work and rejects its stale proof", async () => {
  const snapshot = await createChatSummarySnapshot(history);
  const descriptor = completed(snapshot);
  const edited = structuredClone(history);
  edited[0].content = "Changed after summarization";
  const next = await createChatSummarySnapshot(edited, 0, descriptor);
  assert.equal(next.baseCount, undefined);
  assert.equal(next.count, 88);
  assert.notEqual(next.digest, descriptor.completed_digest);
  const payload = await createChatHistoryPayload(edited, 0, {
    principal: id,
    chatId,
    memoryEnabled: true,
    ...dependencies(descriptor),
  });
  assert.equal(payload.summaryProof, undefined);
});

test("converted Temporary history stays excluded after the transport window advances", async () => {
  const snapshot = await createChatSummarySnapshot(history, 1000);
  assert.equal(snapshot.start, 1000);
  assert.equal(snapshot.messages[0].content, "Turn 1000");
  const payload = await createChatHistoryPayload(history, 1000, {
    temporary: true,
    principal: id,
    chatId,
    memoryEnabled: true,
    ...dependencies(completed(snapshot)),
  });
  assert.equal(payload.memoryStartIndex, 1000);
  assert.equal(payload.historyOffset, 1101);
  assert.equal(payload.summaryProof, undefined);
  assert.equal(normalizeChatPayload(payload).memoryStartIndex, 1000);
});

test("catch-up writes are context-only and unchanged terminal failures do not restart forever", async () => {
  const active = { id: chatId, messages: history, temporary: false, memoryStartIndex: 0 };
  const calls = [];
  const deps = {
    getSession: async () => ({ data: { session } }),
    contextOnly: true,
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      return init.method === "POST"
        ? Response.json({ ok: true })
        : Response.json({ enabled: true, descriptor: null });
    },
  };
  const result = await writeMemoryForPrincipal(active, id, deps);
  assert.equal(result.continue, true);
  const posted = JSON.parse(calls.find(([, init]) => init.method === "POST")[1].body);
  assert.equal(posted.contextOnly, true);
  assert.equal(posted.contextSummary.messages.length, 88);
  const failed = {
    ...completed(posted.contextSummary),
    status: "failed",
    completed_count: null,
    completed_start: null,
    completed_digest: null,
  };
  calls.length = 0;
  const terminal = await writeMemoryForPrincipal(active, id, {
    ...deps,
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      return Response.json({ enabled: true, descriptor: failed });
    },
  });
  assert.equal(terminal.continue, false);
  assert.equal(calls.length, 1);
});
