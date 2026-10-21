import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import * as policy from "../../src/lib/chat-trash-policy.mjs";
import { createTrashReviewFixtures } from "../../src/lib/chat-trash-review-fixtures.mjs";
const { DAY_MS, retentionPreview, customRetention, expireTrash } = policy;
const now = 100 * DAY_MS;
const fixtures = createTrashReviewFixtures(now);
const state = {
  retentionMs: 30 * DAY_MS,
  entries: [fixtures.deleted, fixtures.expiringSoon, fixtures.expired],
};
test("default is precisely 30 days and fixture statuses have real timestamps", () => {
  assert.equal(policy.DEFAULT_TRASH_RETENTION_MS, 30 * DAY_MS);
  assert.equal(fixtures.deleted.expiresAt - fixtures.deleted.deletedAt, 30 * DAY_MS);
  assert.equal(fixtures.restored.restoredAt > fixtures.restored.deletedAt, true);
  assert.equal(expireTrash(state, now).entries.length, 2);
});
test("every requested preset exists and custom duration rejects unsafe values", () => {
  assert.deepEqual(
    policy.TRASH_RETENTION_OPTIONS.map((x) => x.value),
    [0, 3600000, DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS],
  );
  assert.equal(customRetention("1.5", "hours"), 5400000);
  for (const value of ["", "0", "-1", "NaN", "Infinity", "1e4", "0.0001", "999999999999999999"])
    assert.throws(() => customRetention(value, "days"));
  assert.throws(() => customRetention("2", "months"));
});
test("shortening and instant calculate irreversible effects without mutating data on cancel", () => {
  const original = JSON.stringify(state);
  const preview = retentionPreview(state, DAY_MS, now);
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.expired.length, 3);
  assert.equal(JSON.stringify(state), original);
  assert.equal(retentionPreview(state, 0, now).requiresConfirmation, true);
  assert.equal(retentionPreview(state, 60 * DAY_MS, now).requiresConfirmation, false);
});
async function storeFixture({ confirm = true, failWrite = false, save = async () => true } = {}) {
  const data = new Map();
  const writes = [];
  const chat = fixtures.deleted.conversation;
  const mocks = {
    ...policy,
    confirmPermanentChat: async () => confirm,
    chatStoragePrincipal: (owner) => (owner ? `user:${encodeURIComponent(owner)}` : "guest"),
    sanitizeArchivedConversations: (items) =>
      items.filter((x) => x?.id && Array.isArray(x.messages)),
    canWriteChatHistory: () => true,
    loadConversations: () => [],
    saveConversations: async (...args) => {
      writes.push(args);
      return save();
    },
    localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrite) throw Error("full");
        data.set(key, value);
      },
    },
    window: { confirm: () => confirm, dispatchEvent() {} },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
  };
  const source = stripTypeScriptTypes(await readFile("src/lib/chat-trash.ts", "utf8"), {
    mode: "transform",
  }).replace(/^import[\s\S]*?;\s*/gm, "");
  const key = crypto.randomUUID();
  globalThis[key] = mocks;
  const module = await import(
    "data:text/javascript;base64," +
      Buffer.from(
        `const {${Object.keys(mocks).join(",")}}=globalThis[${JSON.stringify(key)}];\n${source}`,
      ).toString("base64") +
      "#" +
      key
  );
  delete globalThis[key];
  return { module, data, writes, chat };
}
test("Trash is principal scoped and persisted before history deletion; drafts untouched", async () => {
  const f = await storeFixture();
  await f.module.moveChatToTrash("alice", f.chat, [f.chat]);
  assert.equal(f.module.readChatTrash("alice").entries.length, 1);
  assert.equal(f.module.readChatTrash("bob").entries.length, 0);
  assert.equal(f.module.readChatTrash(null).entries.length, 0);
  assert.deepEqual([...f.data.keys()], ["kova-chat-trash-v1:user:alice"]);
  assert.equal(f.writes.length, 1);
});
test("storage failure cannot remove live chat", async () => {
  const f = await storeFixture({ failWrite: true });
  await assert.rejects(f.module.moveChatToTrash("alice", f.chat, [f.chat]));
  assert.equal(f.writes.length, 0);
});
test("history failure keeps recoverable payload", async () => {
  const f = await storeFixture({ save: async () => false });
  await assert.rejects(f.module.moveChatToTrash("alice", f.chat, [f.chat]));
  assert.equal(f.module.readChatTrash("alice").entries.length, 1);
});
test("instant deletion cancellation keeps all data", async () => {
  const f = await storeFixture({ confirm: false });
  f.module.writeChatTrash("alice", { retentionMs: 0, entries: [] });
  assert.equal(await f.module.moveChatToTrash("alice", f.chat, [f.chat]), false);
  assert.equal(f.writes.length, 0);
});
test("restore succeeds before removing Trash entry; expired entry cannot restore", async () => {
  const f = await storeFixture();
  await f.module.moveChatToTrash("alice", f.chat, [f.chat]);
  assert.equal(await f.module.restoreChatTrash("alice", f.chat.id), true);
  assert.equal(f.module.readChatTrash("alice").entries.length, 0);
  f.module.writeChatTrash("alice", state);
  assert.equal(await f.module.restoreChatTrash("alice", fixtures.expired.conversation.id), false);
});
test("stale principal callbacks cannot write or restore", async () => {
  const f = await storeFixture();
  assert.equal(await f.module.moveChatToTrash("alice", f.chat, [f.chat], () => false), false);
  assert.equal(await f.module.restoreChatTrash("alice", f.chat.id, () => false), false);
  assert.equal(f.data.size, 0);
});
test("lengthening retention never revives an already-expired copy", () => {
  const preview = retentionPreview(state, 60 * DAY_MS, now);
  assert.equal(
    preview.next.entries.some(
      (entry) => entry.conversation.id === fixtures.expired.conversation.id,
    ),
    false,
  );
});
test("failed restoration preserves Trash and drafts", async () => {
  const f = await storeFixture({ save: async () => false });
  const fresh = createTrashReviewFixtures(Date.now());
  f.module.writeChatTrash("alice", { retentionMs: 30 * DAY_MS, entries: [fresh.deleted] });
  assert.equal(await f.module.restoreChatTrash("alice", fresh.deleted.conversation.id), false);
  assert.equal(f.module.readChatTrash("alice").entries.length, 1);
});
test("principal changes during restore cannot remove original Trash copy", async () => {
  let current = true;
  const f = await storeFixture({
    save: async () => {
      current = false;
      return true;
    },
  });
  const fresh = createTrashReviewFixtures(Date.now());
  f.module.writeChatTrash("alice", { retentionMs: 30 * DAY_MS, entries: [fresh.deleted] });
  assert.equal(
    await f.module.restoreChatTrash("alice", fresh.deleted.conversation.id, () => current),
    false,
  );
  assert.equal(f.module.readChatTrash("alice").entries.length, 1);
});
test("corrupt Trash is not silently overwritten", async () => {
  const f = await storeFixture();
  f.data.set(f.module.trashStorageKey("alice"), "broken");
  await assert.rejects(f.module.moveChatToTrash("alice", f.chat, [f.chat]));
  assert.equal(f.writes.length, 0);
  assert.equal(f.data.get(f.module.trashStorageKey("alice")), "broken");
});
test("panel and cleanup contracts expose honest retention and destructive confirmation", async () => {
  const panel = await readFile("src/components/ChatTrashPanel.tsx", "utf8");
  assert.match(
    panel.replace(/\s+/g, " "),
    /Scheduled server deletion and cross-device Trash are\s+not available yet/,
  );
  assert.match(panel, /AlertDialogContent/);
  assert.doesNotMatch(panel, /window.confirm\(/);
  assert.match(panel, /cancelRef.current\?\.focus/);
  assert.match(panel, /pending.generation !== ownerRef.current.generation/);
  assert.match(panel, /Trash changed while this confirmation was open/);
  assert.match(panel, /Delete permanently/);
  assert.match(panel, /Restore/);
  const cleanup = await readFile("src/lib/principal-browser-storage.mjs", "utf8");
  assert.match(cleanup, /kova-chat-trash-v1:\$\{principal\}/);
});
