import assert from "node:assert/strict";
import test from "node:test";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
function fixture({ confirm = true, save = true, writable = true } = {}) {
  const historyEvents = new EventTarget();
  let historyWritable = writable;
  const chat = { id: "chat", title: "Chat" },
    other = { id: "other", title: "Other" };
  const values = new Map([
    ["active:A", JSON.stringify([chat, other])],
    ["archived:A", JSON.stringify([chat])],
    [
      "kova-chat-trash-v1:A",
      JSON.stringify({ entries: [{ conversation: chat }, { conversation: other }] }),
    ],
  ]);
  const events = [];
  const module = loadUiModule(
    "src/lib/permanent-chat-delete.ts",
    {
      "./chat-delete-undo": {
        deleteChatWithUndo: async (_owner, _id, _current, commit) => (confirm ? commit() : false),
        readChatDeleteIntents: () => [],
      },
      "./chat-history-bridge": {
        CHAT_HISTORY_CHANGED_EVENT: "kova:chat-history-changed",
        canWriteChatHistory: () => historyWritable,
      },
      "./chat-store": {
        loadConversations: () => [chat, other],
        saveConversations: async (owner, items) => {
          events.push([owner, items]);
          return save;
        },
        chatStoragePrincipal: (owner) => owner,
        conversationStorageKey: (owner) => `active:${owner}`,
        archivedConversationStorageKey: (owner) => `archived:${owner}`,
        clearDraft: (owner, id) => events.push(["draft", owner, id]),
      },
    },
    {
      window: historyEvents,
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    },
  );
  return {
    run: (current) => module.permanentlyDeleteChat("A", chat, current),
    ready: () => {
      historyWritable = true;
      historyEvents.dispatchEvent(new Event("kova:chat-history-changed"));
    },
    events,
    values,
  };
}
test("permanent removal clears active, archived, draft and legacy Trash copies of only the chosen chat", async () => {
  const f = fixture();
  assert.equal(await f.run(() => true), true);
  assert.equal(JSON.parse(f.values.get("active:A")).length, 1);
  assert.equal(JSON.parse(f.values.get("archived:A")).length, 0);
  assert.equal(
    JSON.parse(f.values.get("kova-chat-trash-v1:A")).entries[0].conversation.id,
    "other",
  );
  assert.equal(f.events[0][1][0].id, "other");
  assert.deepEqual(f.events[1], ["draft", "A", "chat"]);
});
test("canceled Undo window and replaced account cannot persist deletion", async () => {
  const f = fixture({ confirm: false });
  assert.equal(await f.run(() => true), false);
  assert.equal(f.events.length, 0);
  const g = fixture();
  assert.equal(await g.run(() => false), false);
  assert.equal(g.events.length, 0);
});
test("failed history persistence keeps all legacy recovery copies and reports failure", async () => {
  const f = fixture({ save: false });
  await assert.rejects(
    f.run(() => true),
    /could not be saved/,
  );
  assert.equal(JSON.parse(f.values.get("active:A")).length, 2);
  assert.equal(JSON.parse(f.values.get("kova-chat-trash-v1:A")).entries.length, 2);
});

test("deletion started during history initialization waits for writable state without losing the click", async () => {
  const f = fixture({ writable: false });
  const operation = f.run(() => true);
  await Promise.resolve();
  assert.equal(f.events.length, 0, "No deletion is committed before history initializes");
  f.ready();
  assert.equal(await operation, true);
  assert.equal(f.events[0][1].length, 1);
  assert.equal(f.events[0][1][0].id, "other");
});

test("a deletion waiting for history must not commit after the account changes", async () => {
  const f = fixture({ writable: false });
  let current = true;
  const operation = f.run(() => current);
  await Promise.resolve();
  current = false;
  f.ready();
  assert.equal(await operation, false);
  assert.equal(f.events.length, 0);
});
