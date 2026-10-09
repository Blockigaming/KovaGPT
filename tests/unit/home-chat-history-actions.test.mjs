import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
async function fixture(save = async () => true) {
  const events = [],
    chat = { id: "chat-a", messages: [], title: "A" },
    key = crypto.randomUUID();
  const mocks = {
    newId: () => crypto.randomUUID(),
    toast: {
      success: (...v) => events.push(["success", ...v]),
      error: (...v) => events.push(["error", ...v]),
    },
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
test("rename and duplicate do not update the view when saving fails", async () => {
  for (const action of ["renameHomeChat", "duplicateHomeChat"]) {
    const f = await fixture(async () => false);
    assert.equal(await f.module[action](f.context, f.chat.id, "New title"), false);
    assert.deepEqual(
      f.events.map((row) => row[0]),
      ["save", "error"],
    );
  }
});

test("a rename acknowledged after account clear does not update the new view", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const f = await fixture(() => pending);
  const action = f.module.renameHomeChat(f.context, f.chat.id, "New title");
  f.clear();
  finish(true);
  assert.equal(await action, false);
  assert.deepEqual(
    f.events.map((row) => row[0]),
    ["save"],
  );
});
test("Undo remains bound to the original account generation", async () => {
  const f = await fixture();
  await f.module.removeHomeChat(f.context, f.chat.id);
  const undo = f.events.find((row) => row[0] === "success")[2].action.onClick;
  const count = f.events.length;
  f.clear();
  await undo();
  assert.equal(f.events.length, count);
});

test("Undo uses the workspace mutation guard when supplied", async () => {
  const f = await fixture();
  const calls = [];
  f.context.restore = async (chat, archived) => {
    calls.push({ id: chat.id, archived });
  };
  await f.module.removeHomeChat(f.context, f.chat.id, false);
  const undo = f.events.find((row) => row[0] === "success")[2].action.onClick;
  const count = f.events.length;
  await undo();
  assert.deepEqual(calls, [{ id: f.chat.id, archived: false }]);
  assert.equal(f.events.length, count);
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
    ["save"],
  );
});

test("renaming or duplicating a saved chat does not persist a separate temporary chat", async () => {
  for (const action of ["renameHomeChat", "duplicateHomeChat"]) {
    const f = await fixture();
    f.context.items.push({ id: "temporary", title: "Private", messages: [], temporary: true });
    assert.equal(await f.module[action](f.context, f.chat.id, "New title"), true);
    const saved = f.events.find((row) => row[0] === "save")[2];
    assert.ok(saved.every((chat) => !chat.temporary));
  }
});
