import test from "node:test";
import assert from "node:assert/strict";
const root = process.env.KOVA_REVIEW_SOURCE_DIR ?? ".";
const policy = await import(
  new URL(
    `${root.startsWith("/") ? root : process.cwd() + "/" + root}/src/lib/principal-browser-storage.mjs`,
    "file:",
  ).href
);
const { readDeviceRecord, saveDeviceRecord } = await import(
  new URL(
    `${root.startsWith("/") ? root : process.cwd() + "/" + root}/src/lib/device-records.mjs`,
    "file:",
  ).href
);
function fixture() {
  const rows = new Map(),
    queues = new Map();
  const storage = {
    getItem: (k) => rows.get(k) ?? null,
    setItem: (k, v) => rows.set(k, v),
    removeItem: (k) => rows.delete(k),
    key: (i) => [...rows.keys()][i] ?? null,
    get length() {
      return rows.size;
    },
  };
  const locks = {
    request: (key, fn) => {
      const p = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
      queues.set(key, p);
      return p;
    },
  };
  const read = (actor = "A") => readDeviceRecord(storage, "kova-image-brief", actor, "composer");
  const write = (prior, actor = "A") =>
    saveDeviceRecord({
      storage,
      locks,
      base: "kova-image-brief",
      actor,
      target: "composer",
      value: { prompt: "private unsent" },
      expectedRevision: prior.revision,
      expectedDeletionEpoch: prior.deletionEpoch,
      current: () => true,
    });
  return { storage, locks, read, write };
}
for (const existing of [false, true])
  test(`clear fences pending ${existing ? "existing" : "first"} save in another tab without relying on an event`, async () => {
    const f = fixture();
    if (existing) await f.write(f.read());
    const stale = f.read(),
      b = f.read("B");
    const clearing = policy.clearPrincipalBrowserStorage("A", {
      localStorage: f.storage,
      sessionStorage: f.storage,
      locks: f.locks,
    });
    const staleSave = f.write(stale);
    await clearing;
    await assert.rejects(staleSave, /changed in another tab/);
    assert.equal(f.read().value, null);
    await f.write(b, "B");
    assert.equal(f.read("B").value.prompt, "private unsent");
  });
test("clear ordered after an admitted write removes it and permits only a new-epoch draft", async () => {
  const f = fixture();
  const pending = f.write(f.read());
  const clearing = policy.clearPrincipalBrowserStorage("A", {
    localStorage: f.storage,
    sessionStorage: f.storage,
    locks: f.locks,
  });
  await pending;
  await clearing;
  assert.equal(f.read().value, null);
  await f.write(f.read());
  assert.equal(f.read().value.prompt, "private unsent");
});
