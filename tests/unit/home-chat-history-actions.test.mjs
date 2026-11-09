import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
async function fixture(save = async () => true, ready = true) {
  const events = [],
    chat = { id: "chat-a", messages: [], title: "A" },
    key = crypto.randomUUID();
  const mocks = {
    canSendChatHistory: () => ready,
    toast: {
      success: (...v) => events.push(["success", ...v]),
      error: (...v) => events.push(["error", ...v]),
    },
    readChatTrash: () => ({ retentionMs: 30 * 86400000, entries: [{ conversation: chat }] }),
    permanentlyDeleteChat: async (...args) => {
      events.push(["save", ...args]);
      return save();
    },
    restoreChatTrash: async () => true,
    archiveConversation: async () => true,
    loadConversations: () => [],
    removeArchivedConversation: async () => true,
    saveConversations: async (...args) => {
      events.push(["save", ...args]);
      return save();
    },
  };
  const source = stripTypeScriptTypes(
    await readFile(new URL("../../src/lib/home-chat-history-actions.ts", import.meta.url), "utf8"),
    { mode: "transform" },
  ).replace(/^import[\s\S]*?;\s*/gm, "");
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
  let active = true;
  const context = {
    ownerId: "owner-a",
    items: [chat],
    current: () => active,
    setItems: () => events.push(["items"]),
    activeId: chat.id,
    setActive: (id) => events.push(["active", id]),
  };
  return {
    module,
    context,
    events,
    chat,
    clear: () => {
      active = false;
    },
  };
}
test("an action delayed across account clear cannot persist or change the new view", async () => {
  const f = await fixture();
  f.clear();
  await f.module.removeHomeChat(f.context, f.chat.id);
  assert.deepEqual(f.events, []);
});
test("early chat deletion gives feedback without removing history", async () => {
  const f = await fixture(async () => true, false);
  await f.module.removeHomeChat(f.context, f.chat.id);
  assert.deepEqual(f.events.map((row) => row[0]), ["error"]);
  assert.match(f.events[0][1], /Chat history is still loading/);
});
test("deletion clears the active view before the grace period and removes it only after a committed delete", async () => {
  const f = await fixture();
  await f.module.removeHomeChat(f.context, f.chat.id);
  assert.deepEqual(
    f.events.map((row) => row[0]),
    ["active", "save", "items"],
  );
  assert.deepEqual(f.events[0], ["active", null]);
});
test("Undo restores the active chat without persisting a removal", async () => {
  const f = await fixture(async () => false);
  await f.module.removeHomeChat(f.context, f.chat.id);
  assert.deepEqual(
    f.events.map((row) => row[0]),
    ["active", "save", "active"],
  );
  assert.deepEqual(f.events.at(-1), ["active", f.chat.id]);
});
test("a late successful durable delete does not repaint a replacement principal", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const f = await fixture(() => pending);
  const action = f.module.removeHomeChat(f.context, f.chat.id);
  f.clear();
  finish(true);
  await action;
  assert.deepEqual(
    f.events.map((row) => row[0]),
    ["active", "save"],
  );
});
