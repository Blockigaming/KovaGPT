import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { loadUiModule, deferred } from "../helpers/ui-state-harness.mjs";
const { readCollectionPage, CollectionPageInput } = loadUiModule(
  "src/lib/read-bounded-collection.ts",
  { zod: { z } },
  { AbortSignal, TextEncoder, Error },
);
test("one bounded page exposes continuation even under a lower server cap", async () => {
  let calls = 0;
  const result = await readCollectionPage(
    async () => {
      calls++;
      return { data: [{ id: "a" }], count: 100003, error: null };
    },
    "Records",
    null,
    20,
  );
  assert.equal(calls, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.cursor, "a");
});
test("invalid cursor, oversized rows and bytes fail without partial pages", async () => {
  for (const result of [
    { data: null, error: null },
    { data: [{ id: "b" }, { id: "a" }], count: 2, error: null },
    { data: [{ id: "a" }], count: 1, error: {} },
    { data: [{ id: "a", body: "x".repeat(2_000_000) }], count: 1, error: null },
    { data: [{ id: "a" }, { id: "b" }, { id: "c" }], count: 3, error: null },
  ])
    await assert.rejects(readCollectionPage(async () => result, "Records", null, 2));
  await assert.rejects(
    readCollectionPage(
      async () => ({ data: [{ id: "a" }], count: 1, error: null }),
      "Records",
      "a",
      2,
    ),
  );
  assert.throws(() => CollectionPageInput.parse({ cursor: "bad cursor" }));
});
test("cancellation before and during the bounded request exposes no page", async () => {
  const controller = new AbortController(),
    pending = deferred();
  let calls = 0;
  const read = async (signal) => {
    calls++;
    assert.equal(signal, controller.signal);
    return pending.promise;
  };
  const loading = readCollectionPage(read, "Records", null, 10, controller.signal);
  controller.abort();
  pending.resolve({ data: [{ id: "a" }], count: 1, error: null });
  await assert.rejects(loading, { name: "AbortError" });
  await assert.rejects(readCollectionPage(read, "Records", null, 10, controller.signal), {
    name: "AbortError",
  });
  assert.equal(calls, 1);
});

test("completion requires an empty response; no full-table count is needed", async () => {
  const first = await readCollectionPage(
    async () => ({ data: [{ id: "a" }], error: null }),
    "Records",
    null,
    10,
  );
  assert.equal(first.cursor, "a");
  const end = await readCollectionPage(async () => ({ data: [], error: null }), "Records", "a", 10);
  assert.equal(end.cursor, null);
});
