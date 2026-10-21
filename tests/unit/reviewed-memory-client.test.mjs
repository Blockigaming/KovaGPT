import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReviewedMemorySource,
  saveReviewedMemory,
} from "../../src/lib/reviewed-memory-client.mjs";
import {
  configureMemoryWrites,
  blockMemoryWrites,
  deleteSavedMemoryAfterDraining,
  resetMemoryWriteCoordinatorForTests,
} from "../../src/lib/memory-write-coordinator.mjs";
const ownerId = "11111111-1111-4111-8111-111111111111";
const conversation = {
  id: "chat-one",
  title: "Review",
  mode: "instant",
  createdAt: 1,
  updatedAt: 2,
  messages: Array.from({ length: 4 }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 ? "assistant" : "user",
    content: `Turn ${i}`,
  })),
};
const state = {
  ownerId,
  records: {
    [conversation.id]: {
      revision: 3,
      local: conversation,
      localHash: "hash",
      serverHash: "hash",
      dirty: false,
      migration: false,
      request: null,
      conflict: null,
    },
  },
};
const input = {
  ownerId,
  conversation,
  revision: 3,
  text: "  Keep these exact words.  ",
  isCurrent: () => true,
};
const setup = (options = {}) => {
  const calls = [];
  return {
    calls,
    deps: {
      loadDevice: async (owner) => {
        calls.push(["load", owner]);
        return state;
      },
      request: async (...args) => {
        calls.push(["POST", ...args]);
        return Response.json({ ok: true, saved: true, chatId: conversation.id });
      },
      ...options,
    },
  };
};
test.beforeEach(() => {
  resetMemoryWriteCoordinatorForTests();
  configureMemoryWrites({ principal: ownerId, enabled: true });
});

test("opening/reviewing eligibility reads existing local sync state and performs no request", async () => {
  const fixture = setup();
  const source = await loadReviewedMemorySource(ownerId, conversation, fixture.deps);
  assert.equal(source.revision, 3);
  assert.deepEqual(fixture.calls, [["load", ownerId]]);
});
test("final confirmation sends exact text once with real revision and no transcript or generated text", async () => {
  const fixture = setup();
  await saveReviewedMemory(input, fixture.deps);
  assert.deepEqual(
    fixture.calls.map(([kind]) => kind),
    ["load", "POST"],
  );
  const [, owner, path, init] = fixture.calls[1];
  assert.equal(owner, ownerId);
  assert.equal(path, "/api/memory");
  assert.deepEqual(JSON.parse(init.body), {
    operation: "save_reviewed_memory",
    chatId: conversation.id,
    expectedRevision: 3,
    memoryEnabled: true,
    temporary: false,
    confirmed: true,
    text: input.text,
  });
});
for (const modified of [
  null,
  { ...state, ownerId: "other" },
  { ...state, records: {} },
  ...["dirty", "migration", "request", "conflict"].map((key) => ({
    ...state,
    records: { [conversation.id]: { ...state.records[conversation.id], [key]: true } },
  })),
]) {
  test(`missing/unsynced/foreign/conflicted source cannot write: ${JSON.stringify(modified)}`, async () => {
    const fixture = setup({ loadDevice: async () => modified });
    await assert.rejects(saveReviewedMemory(input, fixture.deps), /already synced/);
    assert.equal(fixture.calls.length, 0);
  });
}
test("short chat and stale revision are ineligible without triggering synchronization", async () => {
  const fixture = setup();
  await assert.rejects(
    saveReviewedMemory(
      { ...input, conversation: { ...conversation, messages: conversation.messages.slice(0, 2) } },
      fixture.deps,
    ),
    /four non-temporary messages/,
  );
  await assert.rejects(saveReviewedMemory({ ...input, revision: 2 }, fixture.deps), /chat changed/);
  assert.equal(
    fixture.calls.some(([name]) => name === "POST"),
    false,
  );
});
test("memory opt-out and owner changes reject queued explicit saves", async () => {
  for (const block of [
    () => blockMemoryWrites(ownerId),
    () => configureMemoryWrites({ principal: "other", enabled: true }),
  ]) {
    resetMemoryWriteCoordinatorForTests();
    configureMemoryWrites({ principal: ownerId, enabled: true });
    const fixture = setup();
    const pending = saveReviewedMemory(input, fixture.deps);
    block();
    await assert.rejects(pending, /turned off or your account changed/);
    assert.equal(fixture.calls.length, 0);
  }
});
test("draft lifetime invalidation after eligibility prevents dispatch", async () => {
  let current = true;
  const fixture = setup({
    loadDevice: async () => {
      current = false;
      return state;
    },
  });
  await assert.rejects(
    saveReviewedMemory({ ...input, isCurrent: () => current }, fixture.deps),
    /no longer current/,
  );
  assert.equal(fixture.calls.length, 0);
});
test("late success after owner or draft change cannot become a success notification", async () => {
  let current = true;
  const fixture = setup({
    request: async () => {
      current = false;
      return Response.json({ ok: true, saved: true, chatId: conversation.id });
    },
  });
  await assert.rejects(
    saveReviewedMemory({ ...input, isCurrent: () => current }, fixture.deps),
    /no longer current/,
  );
});
for (const value of [{ ok: true }, { ok: true, saved: true, chatId: "other" }, { ok: false }]) {
  test(`only a confirmed exact-chat write is success: ${JSON.stringify(value)}`, async () => {
    await assert.rejects(
      saveReviewedMemory(input, setup({ request: async () => Response.json(value) }).deps),
      /Could not confirm/,
    );
  });
}
test("privacy deletion waits for an explicit reviewed write to settle", async () => {
  let release;
  const started = [];
  const fixture = setup({
    request: async () => {
      started.push("write");
      await new Promise((r) => {
        release = r;
      });
      return Response.json({ ok: true, saved: true, chatId: conversation.id });
    },
  });
  const pending = saveReviewedMemory(input, fixture.deps);
  await new Promise((r) => setImmediate(r));
  const deletion = deleteSavedMemoryAfterDraining({
    principal: ownerId,
    run: async () => {
      started.push("delete");
    },
  });
  assert.deepEqual(started, ["write"]);
  release();
  await pending;
  await deletion;
  assert.deepEqual(started, ["write", "delete"]);
});

test("identical idle refresh preserves memory review identity; actual content and privacy changes invalidate it", async () => {
  const { sameReviewedMemoryConversation } =
    await import("../../src/lib/reviewed-memory-policy.mjs");
  assert.equal(
    sameReviewedMemoryConversation(conversation, structuredClone(conversation), ownerId),
    true,
  );
  for (const changed of [
    { ...conversation, id: "another-chat" },
    { ...conversation, memoryStartIndex: 2 },
    { ...conversation, temporary: true },
    {
      ...conversation,
      messages: conversation.messages.map((message, index) =>
        index === 0 ? { ...message, content: "Changed" } : message,
      ),
    },
  ])
    assert.equal(sameReviewedMemoryConversation(conversation, changed, ownerId), false);
});
