import assert from "node:assert/strict";
import test from "node:test";
import {
  clearImageHistory,
  deleteImageHistoryItem,
  loadImageHistory,
  persistImageHistoryItem,
} from "../../src/lib/image-history.ts";

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

function record(userKey, id, createdAt) {
  return {
    userKey,
    id,
    prompt: id,
    createdAt,
    image: new Blob([id], { type: "image/png" }),
  };
}

// This fixture deliberately provides only the IndexedDB factory. Exact-key
// queries must not require a separately installed IDBKeyRange global.
function installDatabase(t, initial = []) {
  const records = new Map(
    initial.map((item) => [JSON.stringify([item.userKey, item.id]), item]),
  );
  const queries = [];
  let closed = 0;
  const database = {
    close() {
      closed += 1;
    },
    transaction(name, mode) {
      assert.equal(name, "images");
      assert.ok(["readonly", "readwrite"].includes(mode));
      const transaction = {
        objectStore(storeName) {
          assert.equal(storeName, "images");
          return {
            put(item) {
              assert.equal(mode, "readwrite");
              records.set(JSON.stringify([item.userKey, item.id]), item);
            },
            delete(key) {
              assert.equal(mode, "readwrite");
              records.delete(JSON.stringify(key));
            },
            index(indexName) {
              assert.equal(indexName, "userKey");
              const read = (query, keysOnly) => {
                assert.equal(
                  typeof query,
                  "string",
                  "queries must retain an exact account key",
                );
                queries.push(query);
                const request = {};
                queueMicrotask(() => {
                  const matches = [...records.values()].filter(
                    (item) => item.userKey === query,
                  );
                  request.result = keysOnly
                    ? matches.map((item) => [item.userKey, item.id])
                    : matches;
                  request.onsuccess?.();
                });
                return request;
              };
              return {
                getAll: (query) => read(query, false),
                getAllKeys: (query) => read(query, true),
              };
            },
          };
        },
      };
      setImmediate(() => transaction.oncomplete?.());
      return transaction;
    },
  };
  replaceGlobal(t, "IDBKeyRange", undefined);
  replaceGlobal(t, "indexedDB", {
    open(name, version) {
      assert.equal(name, "kovagpt-image-history");
      assert.equal(version, 1);
      const request = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return { records, queries, closed: () => closed };
}

function release(items) {
  for (const item of items) URL.revokeObjectURL(item.imageUrl);
}

test("image history reads exact keys without a separate IDBKeyRange global", async (t) => {
  const database = installDatabase(t, [
    record("alice", "older", 1),
    record("alice", "newer", 2),
    record("alice-extra", "private-other-account", 3),
  ]);
  const items = await loadImageHistory("alice", 1);
  try {
    assert.deepEqual(
      items.map((item) => item.id),
      ["newer"],
    );
    assert.equal(items[0].objectUrl, true);
    assert.match(items[0].imageUrl, /^blob:/);
    assert.deepEqual(database.queries, ["alice"]);
    assert.equal(database.closed(), 1);
  } finally {
    release(items);
  }
});

test("image history prunes only the exact account without IDBKeyRange", async (t) => {
  const database = installDatabase(t, [
    record("alice", "old", 1),
    record("bob", "new", 2),
  ]);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(new Blob(["new"], { type: "image/png" })),
  );
  await persistImageHistoryItem(
    "alice",
    { id: "new", prompt: "new", createdAt: 3, imageUrl: "blob:test" },
    1,
  );
  assert.deepEqual([...database.records.keys()].sort(), [
    '["alice","new"]',
    '["bob","new"]',
  ]);
  assert.deepEqual(database.queries, ["alice"]);
  assert.equal(database.closed(), 1);
});

test("clearing history without IDBKeyRange deletes only the exact account", async (t) => {
  const database = installDatabase(t, [
    record("alice", "shared-id", 1),
    record("alice", "second", 2),
    record("alice-extra", "shared-id", 3),
  ]);
  await clearImageHistory("alice");
  assert.deepEqual(
    [...database.records.keys()],
    ['["alice-extra","shared-id"]'],
  );
  assert.deepEqual(database.queries, ["alice"]);
  assert.equal(database.closed(), 1);
});

test("image history reads wait for queued writes and deletion stays account-scoped", async (t) => {
  const database = installDatabase(t, [record("bob", "same-id", 1)]);
  let finishFetch;
  const response = new Promise((resolve) => {
    finishFetch = resolve;
  });
  t.mock.method(globalThis, "fetch", () => response);
  const pendingWrite = persistImageHistoryItem(
    "alice",
    { id: "same-id", prompt: "saved", createdAt: 2, imageUrl: "blob:test" },
    10,
  );
  const pendingRead = loadImageHistory("alice", 10);
  finishFetch(new Response(new Blob(["saved"], { type: "image/png" })));
  const [, items] = await Promise.all([pendingWrite, pendingRead]);
  try {
    assert.deepEqual(
      items.map((item) => item.id),
      ["same-id"],
    );
    await deleteImageHistoryItem("alice", "same-id");
    assert.deepEqual([...database.records.keys()], ['["bob","same-id"]']);
    assert.equal(database.closed(), 3);
  } finally {
    release(items);
  }
});

test("unavailable image history is an explicit error rather than an empty success", async (t) => {
  replaceGlobal(t, "indexedDB", undefined);
  replaceGlobal(t, "IDBKeyRange", undefined);
  await assert.rejects(
    loadImageHistory("alice", 10),
    /Persistent image history is unavailable/,
  );
  await assert.rejects(
    clearImageHistory("alice"),
    /Persistent image history is unavailable/,
  );
  await assert.rejects(
    deleteImageHistoryItem("alice", "id"),
    /Persistent image history is unavailable/,
  );
});
