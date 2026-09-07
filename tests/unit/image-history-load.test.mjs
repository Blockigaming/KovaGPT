import assert from "node:assert/strict";
import test from "node:test";
import { createImageHistoryLoadGuard } from "../../src/lib/image-history-load.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("clearing device history rejects an already pending read and releases its blobs", async (t) => {
  const revoked = [];
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  const read = deferred();
  const guard = createImageHistoryLoadGuard();
  let visible = ["old"];
  const pending = guard.load(
    () => read.promise,
    (items) => {
      visible = items;
    },
  );
  guard.invalidate();
  visible = [];
  read.resolve([
    { imageUrl: "blob:private-old", objectUrl: true },
    { imageUrl: "https://example.com/image.png" },
  ]);
  await pending;
  assert.deepEqual(visible, []);
  assert.deepEqual(revoked, ["blob:private-old"]);
});

test("an old account read cannot overwrite a newer account history", async (t) => {
  const revoked = [];
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  const old = deferred();
  const guard = createImageHistoryLoadGuard();
  let visible = [];
  const pending = guard.load(
    () => old.promise,
    (items) => {
      visible = items;
    },
  );
  guard.invalidate();
  const current = [{ imageUrl: "blob:current", objectUrl: true }];
  await guard.load(
    async () => current,
    (items) => {
      visible = items;
    },
  );
  old.resolve([{ imageUrl: "blob:previous", objectUrl: true }]);
  await pending;
  assert.deepEqual(visible, current);
  assert.deepEqual(revoked, ["blob:previous"]);
});
