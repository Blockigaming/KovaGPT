import test from "node:test";
import assert from "node:assert/strict";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
function fixture(initial = new Map()) {
  let now = 10000,
    sequence = 0;
  const timers = new Map(),
    offers = [],
    values = initial;
  const api = loadUiModule(
    "src/lib/chat-delete-undo.ts",
    {
      sonner: {
        toast: {
          success: (label, options) => {
            offers.push({ label, ...options });
            return offers.length;
          },
          dismiss: () => {},
        },
      },
      "./principal-browser-storage.mjs": {
        safeBrowserStorage: () => ({
          getItem: (k) => values.get(k) ?? null,
          setItem: (k, v) => values.set(k, v),
        }),
      },
      "./chat-store": { chatStoragePrincipal: (owner) => owner ?? "guest" },
    },
    {
      Date: { now: () => now },
      setTimeout: (fn, ms) => {
        const id = ++sequence;
        timers.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return {
    api,
    offers,
    values,
    advance: async (ms) => {
      now += ms;
      for (const [id, t] of [...timers])
        if (t.at <= now) {
          timers.delete(id);
          await t.fn();
        }
    },
    now: () => now,
  };
}
test("Undo at 4999ms cancels deletion and stores no chat content", async () => {
  const f = fixture();
  let commits = 0;
  const result = f.api.deleteChatWithUndo(
    "A",
    "chat",
    () => true,
    async () => {
      commits++;
      return true;
    },
  );
  assert.equal(f.api.readChatDeleteIntents("A")[0].deadline, 15000);
  assert.deepEqual(Object.keys(JSON.parse([...f.values.values()][0])[0]).sort(), [
    "deadline",
    "id",
  ]);
  await f.advance(4999);
  assert.equal(commits, 0);
  f.offers[0].action.onClick();
  assert.equal(await result, false);
  await f.advance(2);
  assert.equal(commits, 0);
  assert.equal(f.api.readChatDeleteIntents("A").length, 0);
});
test("expiry commits exactly once, deduplicates clicks, and rejects a late Undo", async () => {
  const f = fixture();
  let commits = 0;
  const commit = async () => {
    commits++;
    return true;
  };
  const result = f.api.deleteChatWithUndo("A", "chat", () => true, commit);
  assert.equal(
    f.api.deleteChatWithUndo("A", "chat", () => true, commit),
    result,
  );
  await f.advance(5000);
  assert.equal(await result, true);
  f.offers[0].action.onClick();
  await f.advance(10000);
  assert.equal(commits, 1);
  assert.equal(f.api.readChatDeleteIntents("A").length, 0);
});
test("account replacement retains only an ID intent; reload resumes the original deadline", async () => {
  const f = fixture();
  let active = true,
    commits = 0;
  const result = f.api.deleteChatWithUndo(
    "A",
    "chat",
    () => active,
    async () => {
      commits++;
      return true;
    },
  );
  active = false;
  await f.advance(5000);
  assert.equal(await result, false);
  assert.equal(commits, 0);
  assert.equal(f.api.readChatDeleteIntents("B").length, 0);
  const resumed = f.api.deleteChatWithUndo(
    "A",
    "chat",
    () => true,
    async () => {
      commits++;
      return true;
    },
  );
  await f.advance(0);
  assert.equal(await resumed, true);
  assert.equal(commits, 1);
  assert.equal(f.offers.length, 1, "expired intents must not receive a fresh Undo window");
});
test("a failed permanent save reports failure and does not claim deletion", async () => {
  const f = fixture();
  const result = f.api.deleteChatWithUndo(
    "A",
    "chat",
    () => true,
    async () => {
      throw Error("storage failed");
    },
  );
  const rejected = assert.rejects(result, /storage failed/);
  await f.advance(5000);
  await rejected;
  assert.equal(f.api.readChatDeleteIntents("A").length, 0);
});

test("clearing the owner namespace cancels a queued deletion without recreating its key", async () => {
  const f = fixture();
  let commits = 0;
  const first = f.api.deleteChatWithUndo(
    "A",
    "chat",
    () => true,
    async () => {
      commits++;
      return true;
    },
  );
  f.values.clear();
  await f.advance(5000);
  assert.equal(await first, false);
  assert.equal(commits, 0);
  assert.equal(f.values.size, 0);
});
test("a fresh deletion after a cross-tab Undo receives its own deadline", async () => {
  const f = fixture();
  let commits = 0;
  const commit = async () => {
    commits++;
    return true;
  };
  const first = f.api.deleteChatWithUndo("A", "chat", () => true, commit);
  await f.advance(1000);
  f.values.clear();
  const second = f.api.deleteChatWithUndo("A", "chat", () => true, commit);
  assert.equal(await first, false);
  await f.advance(4000);
  assert.equal(commits, 0);
  await f.advance(1000);
  assert.equal(await second, true);
  assert.equal(commits, 1);
});
