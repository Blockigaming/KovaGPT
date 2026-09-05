import assert from "node:assert/strict";
import test from "node:test";
import {
  createChatHistoryState,
  seedChatHistory,
  updateChatHistoryList,
  allowChatHistoryMigration,
  nextChatHistoryRequest,
  captureChatHistoryRequest,
  acknowledgeChatHistory,
  applyChatHistoryPage,
  resolveChatHistoryConflict,
  restoreChatHistoryState,
} from "../../src/lib/chat-history-state.mjs";
import { createChatHistoryController } from "../../src/lib/chat-history-controller.mjs";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";
const OWNER = "123e4567-e89b-42d3-a456-426614174000",
  OTHER = "223e4567-e89b-42d3-a456-426614174000",
  EPOCH = "323e4567-e89b-42d3-a456-426614174000";
const chat = (id = "chat", content = "hello") => ({
  id,
  title: id,
  mode: "instant",
  createdAt: 1,
  updatedAt: 2,
  messages: [{ id: "m", role: "user", content }],
});
const page = (records = [], options = {}) => ({
  ownerId: OWNER,
  epoch: EPOCH,
  reset: false,
  records,
  nextCursor: records.at(-1)?.sync_version ?? 0,
  currentVersion: records.at(-1)?.sync_version ?? 0,
  hasMore: false,
  ...options,
});
const row = (payload, revision = 1, sync_version = 1, mutation_id = crypto.randomUUID()) => ({
  id: payload?.id ?? "chat",
  payload,
  revision,
  sync_version,
  mutation_id,
  archived: false,
  deleted_at: payload ? null : new Date().toISOString(),
});
const loaded = async () => applyChatHistoryPage(createChatHistoryState(OWNER), page());
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

test("fresh devices pull every ordered owner row and advance a bounded cursor", async () => {
  let state = createChatHistoryState(OWNER);
  state = await applyChatHistoryPage(
    state,
    page([row(chat("one"))], { hasMore: true, currentVersion: 2 }),
  );
  assert.equal(state.complete, false);
  assert.equal(state.cursor, 1);
  state = await applyChatHistoryPage(state, page([row(chat("two"), 1, 2)]));
  assert.equal(state.complete, true);
  assert.equal(state.cursor, 2);
  assert.deepEqual(Object.keys(state.records), ["one", "two"]);
  await assert.rejects(
    applyChatHistoryPage(state, page([], { ownerId: OTHER, nextCursor: 2, currentVersion: 2 })),
    /invalid_response/,
  );
  await assert.rejects(
    applyChatHistoryPage(state, page([row(chat("one"), 1, 1)])),
    /invalid_response/,
  );
});
test("legacy migration requires an explicit choice and Temporary chats have no outbox", async () => {
  let state = await seedChatHistory(
    await loaded(),
    [chat(), { ...chat("secret"), temporary: true }],
    [],
  );
  assert.equal(nextChatHistoryRequest(state), null);
  assert.deepEqual(Object.keys(state.records), ["chat"]);
  state = allowChatHistoryMigration(state);
  assert.equal(nextChatHistoryRequest(state).id, "chat");
  state = await updateChatHistoryList(
    state,
    [chat(), { ...chat("secret"), temporary: true }],
    false,
  );
  assert.equal(state.records.secret, undefined);
  assert.throws(() => normalizeChatHistory({ ...chat(), temporary: true }, OWNER), /invalid/);
});
test("an ambiguous save retries the exact captured payload while a newer local edit survives its receipt", async () => {
  let state = await updateChatHistoryList(await loaded(), [chat()], false);
  const request = nextChatHistoryRequest(state);
  state = captureChatHistoryRequest(state, request);
  state = await updateChatHistoryList(state, [chat("chat", "newer draft")], false);
  assert.deepEqual(nextChatHistoryRequest(state), request);
  state = acknowledgeChatHistory(state, request, {
    id: "chat",
    mutationId: request.mutationId,
    revision: 1,
    syncVersion: 1,
  });
  assert.equal(state.records.chat.local.messages[0].content, "newer draft");
  assert.equal(state.records.chat.dirty, true);
  assert.equal(nextChatHistoryRequest(state).expectedRevision, 1);
});
test("another device creates an explicit conflict; keeping uses its current revision and cloud choice preserves its body", async () => {
  let state = await applyChatHistoryPage(await loaded(), page([row(chat())]));
  state = await updateChatHistoryList(state, [chat("chat", "my draft")], false);
  state = await applyChatHistoryPage(state, page([row(chat("chat", "other device"), 2, 2)]));
  assert.equal(nextChatHistoryRequest(state), null);
  assert.equal(state.records.chat.conflict.remote.messages[0].content, "other device");
  const kept = await resolveChatHistoryConflict(state, "chat", "keep");
  assert.equal(nextChatHistoryRequest(kept).expectedRevision, 2);
  const cloud = await resolveChatHistoryConflict(state, "chat", "cloud");
  assert.equal(cloud.records.chat.local.messages[0].content, "other device");
  assert.equal(cloud.records.chat.dirty, false);
});
test("expired deletion journals cannot silently resurrect an old chat identity", async () => {
  let state = await updateChatHistoryList(await loaded(), [chat()], false);
  state = await applyChatHistoryPage(state, page([], { epoch: crypto.randomUUID(), reset: true }));
  assert.equal(state.records.chat.conflict.epochChanged, true);
  assert.equal(nextChatHistoryRequest(state), null);
  const kept = await resolveChatHistoryConflict(state, "chat", "keep");
  assert.equal(kept.records.chat.local, null);
  const request = nextChatHistoryRequest(kept);
  assert.notEqual(request.id, "chat");
  assert.equal(request.expectedRevision, 0);
  assert.match(request.payload.title, /recovered/);
});
test("archive, restore and delete use one canonical identity without intermediate accidental removal", async () => {
  let state = await updateChatHistoryList(await loaded(), [chat()], false);
  state = await updateChatHistoryList(state, [chat()], true);
  state = await updateChatHistoryList(state, [], false);
  assert.ok(state.records.chat.local);
  assert.equal(state.records.chat.archived, true);
  state = await updateChatHistoryList(state, [chat()], false);
  state = await updateChatHistoryList(state, [], true);
  assert.ok(state.records.chat.local);
  assert.equal(state.records.chat.archived, false);
  state = await updateChatHistoryList(state, [], false);
  assert.equal(nextChatHistoryRequest(state).payload, null);
});
test("durable reload rejects foreign owner, altered body hashes and Temporary snapshots", async () => {
  const state = await updateChatHistoryList(await loaded(), [chat()], false);
  assert.equal(
    (await restoreChatHistoryState(structuredClone(state), OWNER)).records.chat.local.id,
    "chat",
  );
  await assert.rejects(restoreChatHistoryState(state, OTHER), /unavailable/);
  const changed = structuredClone(state);
  changed.records.chat.local.messages[0].content = "tampered";
  await assert.rejects(restoreChatHistoryState(changed, OWNER), /unavailable/);
  const temporary = structuredClone(state);
  temporary.records.chat.local.temporary = true;
  await assert.rejects(restoreChatHistoryState(temporary, OWNER), /invalid/);
});
function controllerHarness(transport, commitDevice = async () => {}) {
  const abort = new AbortController(),
    changes = [],
    statuses = [];
  const controller = createChatHistoryController({
    ownerId: OWNER,
    signal: abort.signal,
    loadDevice: async () => null,
    commitDevice,
    getLegacy: () => ({ active: [], archived: [] }),
    transport,
    changed: (value) => changes.push(value),
    status: (value) => statuses.push(value),
  });
  return { controller, abort, changes, statuses };
}
test("local editor dirtiness aborts a pending cloud commit before it can replace the draft", async () => {
  const begun = defer();
  let abortObserved = false;
  const h = controllerHarness(
    async () => page([row(chat("remote"))]),
    async (previous, next, { signal }) => {
      if (!previous) return;
      begun.resolve();
      await new Promise((resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            abortObserved = true;
            reject(new Error("aborted"));
          },
          { once: true },
        ),
      );
    },
  );
  await h.controller.initialize();
  const pumping = h.controller.pump();
  await begun.promise;
  h.controller.markDirty();
  await pumping;
  assert.equal(abortObserved, true);
  assert.equal(h.controller.getState().records.remote, undefined);
  assert.equal(h.controller.dirty, true);
});
test("a late owner A cloud result cannot render after principal lifetime ends", async () => {
  const response = defer();
  const h = controllerHarness(() => response.promise);
  await h.controller.initialize();
  const count = h.changes.length;
  const pumping = h.controller.pump();
  h.abort.abort();
  response.resolve(page([row(chat("private-A"))]));
  await pumping;
  assert.equal(h.changes.length, count);
  assert.equal(h.controller.getState().records["private-A"], undefined);
});
test("failed durable request capture sends no cloud write and preserves the unsaved draft", async () => {
  let fail = false,
    writes = 0;
  const h = controllerHarness(
    async ({ method }) => {
      if (method === "POST") writes++;
      return page();
    },
    async (previous, next) => {
      if (fail && Object.values(next.records).some((r) => r.request)) throw Error("disk full");
    },
  );
  await h.controller.initialize();
  await h.controller.pump();
  h.controller.markDirty();
  assert.equal(await h.controller.write([chat()], false), true);
  fail = true;
  await h.controller.pump();
  assert.equal(writes, 0);
  assert.equal(h.controller.getState().records.chat.local.id, "chat");
});
test("lost accepted response is reconciled by mutation identity without a duplicate write", async () => {
  let accepted = null,
    writes = 0;
  const h = controllerHarness(async ({ method, body, cursor }) => {
    if (method === "POST") {
      writes++;
      accepted = body;
      throw Error("connection lost");
    }
    return accepted && cursor === 0
      ? page([row(accepted.payload, 1, 1, accepted.mutationId)])
      : page([], { nextCursor: cursor, currentVersion: accepted ? 1 : 0 });
  });
  await h.controller.initialize();
  await h.controller.pump();
  h.controller.markDirty();
  await h.controller.write([chat()], false);
  await h.controller.pump();
  await h.controller.pump();
  assert.equal(writes, 1);
  assert.equal(h.controller.getState().records.chat.dirty, false);
  assert.equal(h.controller.getState().cursor, 1);
});

test("a definitive storage failure stays blocked after a healthy pull and exposes retry state", async () => {
  const h = controllerHarness(async ({ method, cursor }) => {
    if (method === "POST")
      throw Object.assign(Error("chat_history_storage_limit"), { status: 413 });
    return page([], { nextCursor: cursor, currentVersion: 0 });
  });
  await h.controller.initialize();
  await h.controller.pump();
  h.controller.markDirty();
  await h.controller.write([chat()], false);
  await h.controller.pump();
  await h.controller.pump();
  assert.equal(h.statuses.at(-1).phase, "blocked");
  assert.equal(h.statuses.at(-1).pending, 1);
  assert.equal(h.controller.getState().records.chat.failure, "chat_history_storage_limit");
});
test("reset-scan conflicts cannot discard a draft before the later authoritative row is read", async () => {
  const saved = await updateChatHistoryList(await loaded(), [chat("last", "device draft")], false),
    newEpoch = crypto.randomUUID();
  let count = 0;
  const h = controllerHarness(async () => {
    count++;
    return page([row(chat(`first-${count}`), 1, count)], {
      epoch: newEpoch,
      currentVersion: 20,
      hasMore: true,
      reset: count === 1,
    });
  });
  const c = createChatHistoryController({
    ownerId: OWNER,
    signal: h.abort.signal,
    loadDevice: async () => saved,
    commitDevice: async () => {},
    getLegacy: () => ({ active: [], archived: [] }),
    transport: async ({ cursor }) =>
      page([row(chat(`first-${cursor}`), 1, cursor + 1)], {
        epoch: newEpoch,
        currentVersion: 20,
        hasMore: true,
      }),
    changed: () => {},
    status: (value) => h.statuses.push(value),
  });
  await c.initialize();
  await c.pump();
  assert.equal(c.getState().complete, false);
  assert.deepEqual(h.statuses.at(-1).conflicts, []);
  await assert.rejects(c.resolve("last", "cloud"), /unsaved/);
  assert.equal(c.getState().records.last.local.messages[0].content, "device draft");
});
test("delayed archive followed by an already-captured autosave cannot unarchive and then delete the chat", async () => {
  const begun = defer(),
    release = defer();
  let hold = false;
  const h = controllerHarness(
    async () => page(),
    async (previous, next) => {
      if (hold && next.records.chat?.archived) {
        hold = false;
        begun.resolve();
        await release.promise;
      }
    },
  );
  await h.controller.initialize();
  await h.controller.pump();
  await h.controller.write([chat()], false);
  hold = true;
  const archiving = h.controller.write([chat()], true);
  await begun.promise;
  const oldAutosave = h.controller.write([chat()], false, true);
  release.resolve();
  await archiving;
  await oldAutosave;
  await h.controller.write([], false, true);
  assert.ok(h.controller.getState().records.chat.local);
  assert.equal(h.controller.getState().records.chat.archived, true);
});
