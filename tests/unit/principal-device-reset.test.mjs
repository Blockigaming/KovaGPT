import assert from "node:assert/strict";
import test from "node:test";
import { resetPrincipalDeviceData } from "../../src/lib/principal-device-reset.mjs";

function storage(values = {}) {
  const rows = new Map(Object.entries(values));
  return {
    rows,
    get length() {
      return rows.size;
    },
    key: (index) => [...rows.keys()][index] ?? null,
    getItem: (key) => rows.get(key) ?? null,
    removeItem: (key) => rows.delete(key),
  };
}

test("a global reset awaits image deletion for the captured account and invalidates pending views first", async () => {
  const local = storage({
    "kovagpt:v2:image-history:A": "private-a",
    "kovagpt:v2:image-history:B": "private-b",
  });
  const session = storage();
  const events = [];
  let release;
  const pendingDelete = new Promise((resolve) => {
    release = resolve;
  });
  let finished = false;
  let currentUser = "A";
  const pending = resetPrincipalDeviceData(currentUser, {
    storage: { localStorage: local, sessionStorage: session },
    notify: (owner) => events.push(["invalidate", owner]),
    clearChatHistory: async () => {},
    clearImageHistory: async (owner) => {
      events.push(["delete", owner]);
      await pendingDelete;
    },
  }).then((result) => {
    finished = true;
    return result;
  });
  currentUser = "B";
  await Promise.resolve();
  assert.equal(finished, false);
  assert.deepEqual(events, [
    ["invalidate", "A"],
    ["delete", "A"],
  ]);
  assert.equal(local.getItem("kovagpt:v2:image-history:A"), null);
  assert.equal(local.getItem(`kovagpt:v2:image-history:${currentUser}`), "private-b");
  release();
  const result = await pending;
  assert.equal(result.imageHistory.cleared, true);
  assert.deepEqual(result.imageHistory.failures, []);
});

test("an IndexedDB deletion failure is reported without exposing database error contents", async () => {
  const result = await resetPrincipalDeviceData("A", {
    storage: { localStorage: storage(), sessionStorage: storage() },
    notify: () => {},
    clearChatHistory: async () => {},
    clearImageHistory: async () => {
      throw new Error("private image payload");
    },
  });
  assert.equal(result.resolved, true);
  assert.equal(result.imageHistory.cleared, false);
  assert.deepEqual(result.imageHistory.failures, ["image_history_clear_failed"]);
});

test("unresolved identity cannot clear image history and guest reset cannot target account image stores", async () => {
  const touched = [];
  const options = {
    storage: { localStorage: storage(), sessionStorage: storage() },
    notify: (owner) => touched.push(["notify", owner]),
    clearChatHistory: async () => {},
    clearImageHistory: async (owner) => {
      touched.push(["delete", owner]);
    },
  };
  assert.equal((await resetPrincipalDeviceData(undefined, options)).resolved, false);
  assert.deepEqual(touched, []);
  const guest = await resetPrincipalDeviceData(null, options);
  assert.equal(guest.imageHistory.cleared, true);
  assert.deepEqual(touched, [["notify", null]]);
});

test("privacy reset fences late chat writers before durable deletion and reports chat-store failure separately", async () => {
  const { canWriteChatHistory } = await import("../../src/lib/chat-history-bridge.ts");
  const owner = "reset-chat-owner";
  let reject;
  const wait = new Promise((resolve, no) => {
    reject = no;
  });
  const pending = resetPrincipalDeviceData(owner, {
    storage: { localStorage: storage(), sessionStorage: storage() },
    notify: () => assert.equal(canWriteChatHistory(owner), false),
    clearChatHistory: async () => wait,
    clearImageHistory: async () => {},
  });
  assert.equal(canWriteChatHistory(owner), false);
  assert.equal(canWriteChatHistory("unrelated-chat-owner"), true);
  reject(Error("private cached chat failure"));
  const result = await pending;
  assert.equal(result.chatHistory.cleared, false);
  assert.deepEqual(result.chatHistory.failures, ["chat_history_clear_failed"]);
  assert.equal(result.imageHistory.cleared, true);
});

test("device reset awaits installed-app erasure and reports a failed acknowledgement", async () => {
  let complete;
  let finished = false;
  const pending = resetPrincipalDeviceData("A", {
    storage: { localStorage: null, sessionStorage: null },
    notify: () => {},
    clearImageHistory: async () => {},
    clearChatHistory: async () => {},
    clearPwaData: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  }).then((result) => {
    finished = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(finished, false);
  complete();
  assert.equal((await pending).pwa.cleared, true);
  const failed = await resetPrincipalDeviceData("A", {
    storage: { localStorage: null, sessionStorage: null },
    notify: () => {},
    clearImageHistory: async () => {},
    clearChatHistory: async () => {},
    clearPwaData: async () => {
      throw Error("blocked");
    },
  });
  assert.equal(failed.pwa.cleared, false);
  assert.deepEqual(failed.pwa.failures, ["pwa_clear_failed"]);
});
