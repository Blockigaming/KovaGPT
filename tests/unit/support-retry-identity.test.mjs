import assert from "node:assert/strict";
import test from "node:test";
import { supportRetryIdentity } from "../../src/lib/support-retry-identity.mjs";
import { clearPrincipalBrowserStorage } from "../../src/lib/principal-browser-storage.mjs";
function memory() {
  const rows = new Map();
  return {
    rows,
    get length() {
      return rows.size;
    },
    key(i) {
      return [...rows.keys()][i];
    },
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
    removeItem: (key) => rows.delete(key),
  };
}
test("unchanged request recovers its reference across callers without storing private body", async () => {
  const storage = memory();
  const a = await supportRetryIdentity(storage, "actor-a", "Private help message", () => true);
  const b = await supportRetryIdentity(storage, "actor-a", "Private help message", () => true);
  assert.equal(a.requestId, b.requestId);
  assert.equal(b.persisted, true);
  assert.doesNotMatch([...storage.rows.values()].join(""), /Private help message/);
  const other = await supportRetryIdentity(storage, "actor-b", "Private help message", () => true);
  assert.notEqual(a.requestId, other.requestId);
  const changed = await supportRetryIdentity(storage, "actor-a", "Changed message", () => true);
  assert.notEqual(a.requestId, changed.requestId);
});
test("unavailable or malformed storage does not claim persistence; stale account cannot write", async () => {
  const denied = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  };
  assert.equal((await supportRetryIdentity(denied, null, "message", () => true)).persisted, false);
  const storage = memory();
  await assert.rejects(
    supportRetryIdentity(storage, "actor", "message", () => false),
    /account changed/,
  );
  assert.equal(storage.rows.size, 0);
});
test("principal cleanup removes retry references from session storage", async () => {
  const storage = memory();
  await supportRetryIdentity(storage, "actor-a", "message", () => true);
  await clearPrincipalBrowserStorage("actor-a", {
    locks: { request: async (_key, fn) => fn() },
    sessionStorage: storage,
    localStorage: memory(),
  });
  assert.equal(storage.rows.size, 0);
});
