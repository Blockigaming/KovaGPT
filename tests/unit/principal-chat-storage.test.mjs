import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  archivedConversationStorageKey,
  chatStoragePrincipal,
  clearPrincipalChatStorage,
  conversationStorageKey,
  draftStorageKey,
  loadArchivedConversations,
  loadConversations,
  loadDraft,
  loadPendingActive,
  pendingActiveStorageKey,
  saveArchivedConversations,
  saveConversations,
  persistTemporaryConversation,
  saveDraft,
  savePendingActive,
} from "../../src/lib/chat-store.ts";

class MemoryStorage {
  #values = new Map();

  failRemoveFor = new Set();

  get length() {
    return this.#values.size;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    if (this.failRemoveFor.delete(String(key))) throw new Error("storage disabled");
    this.#values.delete(String(key));
  }

  clear() {
    this.#values.clear();
    this.failRemoveFor.clear();
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

function conversation(id, title = id) {
  return {
    id,
    title,
    messages: [],
    mode: "instant",
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => storage.clear());

test("account switches isolate active chats, archives, drafts, and pending selection", () => {
  const accountA = "account-a";
  const accountB = "account-b";
  const chatA = conversation("chat-a");
  const chatB = conversation("chat-b");

  saveConversations(accountA, [chatA]);
  saveArchivedConversations(accountA, [conversation("archive-a")]);
  saveDraft(accountA, chatA.id, "private draft A");
  savePendingActive(accountA, chatA.id);

  assert.deepEqual(loadConversations(accountB), []);
  assert.deepEqual(loadArchivedConversations(accountB), []);
  assert.equal(loadDraft(accountB, chatA.id), "");
  assert.equal(loadPendingActive(accountB), null);

  saveConversations(accountB, [chatB]);
  saveArchivedConversations(accountB, [conversation("archive-b")]);
  saveDraft(accountB, chatB.id, "private draft B");
  savePendingActive(accountB, chatB.id);

  assert.deepEqual(loadConversations(accountA), [chatA]);
  assert.equal(loadArchivedConversations(accountA)[0].id, "archive-a");
  assert.equal(loadDraft(accountA, chatA.id), "private draft A");
  assert.equal(loadPendingActive(accountA), chatA.id);

  assert.deepEqual(loadConversations(accountB), [chatB]);
  assert.equal(loadArchivedConversations(accountB)[0].id, "archive-b");
  assert.equal(loadDraft(accountB, chatB.id), "private draft B");
  assert.equal(loadPendingActive(accountB), chatB.id);
});

test("clearing one account cannot delete another account's browser data", () => {
  saveConversations("account-a", [conversation("chat-a")]);
  saveConversations("account-b", [conversation("chat-b")]);
  saveArchivedConversations("account-a", [conversation("archive-a")]);
  saveArchivedConversations("account-b", [conversation("archive-b")]);
  saveDraft("account-a", "chat-a", "draft A");
  saveDraft("account-a", "chat-a-2", "second draft A");
  saveDraft("account-b", "chat-b", "draft B");
  savePendingActive("account-a", "chat-a");
  savePendingActive("account-b", "chat-b");

  clearPrincipalChatStorage("account-a");

  assert.deepEqual(loadConversations("account-a"), []);
  assert.deepEqual(loadArchivedConversations("account-a"), []);
  assert.equal(loadDraft("account-a", "chat-a"), "");
  assert.equal(loadDraft("account-a", "chat-a-2"), "");
  assert.equal(loadPendingActive("account-a"), null);
  assert.equal(loadConversations("account-b")[0].id, "chat-b");
  assert.equal(loadArchivedConversations("account-b")[0].id, "archive-b");
  assert.equal(loadDraft("account-b", "chat-b"), "draft B");
  assert.equal(loadPendingActive("account-b"), "chat-b");
});

test("current-principal cleanup continues when one browser key cannot be removed", () => {
  saveConversations("account-a", [conversation("chat-a")]);
  saveArchivedConversations("account-a", [conversation("archive-a")]);
  saveDraft("account-a", "chat-a", "draft A");
  savePendingActive("account-a", "chat-a");
  saveConversations("account-b", [conversation("chat-b")]);
  storage.failRemoveFor.add(conversationStorageKey("account-a"));

  assert.doesNotThrow(() => clearPrincipalChatStorage("account-a"));

  assert.equal(loadConversations("account-a")[0].id, "chat-a");
  assert.deepEqual(loadArchivedConversations("account-a"), []);
  assert.equal(loadDraft("account-a", "chat-a"), "");
  assert.equal(loadPendingActive("account-a"), null);
  assert.equal(loadConversations("account-b")[0].id, "chat-b");
});

test("guest cleanup cannot match and remove signed-in draft namespaces", () => {
  saveDraft(null, "guest-chat", "guest draft");
  saveDraft("account-a", "chat-a", "private draft A");
  storage.setItem("kova-draft:legacy-guest", "legacy guest draft");

  clearPrincipalChatStorage(null);

  assert.equal(loadDraft(null, "guest-chat"), "");
  assert.equal(storage.getItem("kova-draft:legacy-guest"), null);
  assert.equal(loadDraft("account-a", "chat-a"), "private draft A");
});

test("unscoped legacy data migrates only into the guest namespace", () => {
  const legacyConversation = conversation("legacy-chat");
  const legacyArchive = conversation("legacy-archive");
  storage.setItem("nova-gpt-conversations-v2", JSON.stringify([legacyConversation]));
  storage.setItem("kovagpt:archived", JSON.stringify([legacyArchive]));
  storage.setItem("kova-draft:legacy-chat", "legacy draft");
  storage.setItem("nova-gpt-pending-active", "legacy-chat");

  assert.deepEqual(loadConversations("signed-in-account"), []);
  assert.deepEqual(loadArchivedConversations("signed-in-account"), []);
  assert.equal(loadDraft("signed-in-account", "legacy-chat"), "");
  assert.equal(loadPendingActive("signed-in-account"), null);

  assert.deepEqual(loadConversations(null), [legacyConversation]);
  assert.deepEqual(loadArchivedConversations(null), [legacyArchive]);
  assert.equal(loadDraft(null, "legacy-chat"), "legacy draft");
  assert.equal(loadPendingActive(null), "legacy-chat");

  assert.equal(storage.getItem("nova-gpt-conversations-v2"), null);
  assert.equal(storage.getItem("kovagpt:archived"), null);
  assert.equal(storage.getItem("kova-draft:legacy-chat"), null);
  assert.equal(storage.getItem("nova-gpt-pending-active"), null);
});

test("every principal receives distinct deterministic storage keys", () => {
  const principals = [null, "account-a", "account-b"];
  assert.deepEqual(
    new Set(principals.map((value) => chatStoragePrincipal(value))).size,
    principals.length,
  );
  assert.equal(new Set(principals.map(conversationStorageKey)).size, principals.length);
  assert.equal(new Set(principals.map(archivedConversationStorageKey)).size, principals.length);
  assert.equal(new Set(principals.map((value) => draftStorageKey(value, "chat"))).size, 3);
  assert.equal(new Set(principals.map(pendingActiveStorageKey)).size, principals.length);
});

test("temporary conversion persists a memory boundary and excludes other private chats", () => {
  const active = { ...conversation("temporary"), temporary: true, temporaryContext: "clean" };
  const other = { ...conversation("other-private"), temporary: true };
  const regular = conversation("regular");
  const converted = persistTemporaryConversation("account-a", active, [active, other, regular]);
  assert.ok(converted);
  assert.deepEqual(
    converted.map((item) => item.id),
    ["temporary", "regular"],
  );
  assert.equal(converted[0].temporary, false);
  assert.equal(converted[0].temporaryContext, undefined);
  assert.equal(converted[0].memoryStartIndex, active.messages.length);
  assert.deepEqual(converted[0].messages, active.messages);
  assert.equal(active.temporary, true);
  assert.equal(loadConversations("account-a")[0].memoryStartIndex, active.messages.length);
  assert.deepEqual(loadConversations("account-b"), []);
});

test("temporary conversion reports storage failure without changing the private conversation", () => {
  const active = { ...conversation("temporary"), temporary: true };
  const setItem = storage.setItem;
  storage.setItem = () => {
    throw new Error("quota exceeded");
  };
  try {
    assert.equal(persistTemporaryConversation("account-a", active, [active]), null);
    assert.equal(active.temporary, true);
    assert.equal(active.memoryStartIndex, undefined);
  } finally {
    storage.setItem = setItem;
  }
});
