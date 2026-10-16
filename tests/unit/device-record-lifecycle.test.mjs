import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHookHarness, loadUiModule, settle } from "../helpers/ui-state-harness.mjs";
import * as policy from "../../src/lib/principal-browser-storage.mjs";
import * as records from "../../src/lib/device-records.mjs";
const empty = Object.freeze({ notes: "" });
const valid = (v) => v && typeof v.notes === "string";
function fixture() {
  const hooks = createHookHarness(),
    entries = new Map(),
    timers = new Map(),
    events = new Map();
  let next = 0,
    actor = "A",
    lockCallback;
  const storage = { getItem: (k) => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v) };
  const window = {
    setTimeout: (fn) => {
      timers.set(++next, fn);
      return next;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (n, fn) => events.set(n, fn),
    removeEventListener: (n) => events.delete(n),
    confirm: () => false,
  };
  const locks = { request: (_key, fn) => Promise.resolve().then(fn) };
  const module = loadUiModule(
    "src/lib/use-device-record.ts",
    {
      react: hooks.react,
      "@tanstack/react-router": { useBlocker() {} },
      "./device-records.mjs": {
        ...records,
        saveDeviceRecord: (args) => records.saveDeviceRecord({ ...args, randomUUID }),
      },
      "./principal-browser-storage.mjs": { ...policy, safeBrowserStorage: () => storage },
    },
    { window, navigator: { locks } },
  );
  const render = () =>
    hooks.render(() =>
      module.useDeviceRecord("kova-academy-progress", actor, "topic", empty, valid),
    );
  const flush = async () => {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach((fn) => fn());
    await settle();
  };
  return {
    render,
    flush,
    entries,
    events,
    storage,
    hooks,
    locks,
    setActor: (v) => (actor = v),
    defer: () => {
      locks.request = (_key, fn) =>
        new Promise((resolve, reject) => {
          lockCallback = () => {
            try {
              resolve(fn());
            } catch (e) {
              reject(e);
            }
          };
        });
    },
    release: () => lockCallback(),
  };
}
test("device hook hides old principal before effects and does not save queued A edits into B", async () => {
  const f = fixture();
  f.render();
  let state = f.render();
  state.setValue({ notes: "A private" });
  state = f.render();
  f.defer();
  await f.flush();
  f.setActor("B");
  state = f.render();
  assert.equal(state.value.notes, "");
  assert.equal(state.loaded, false);
  state = f.render();
  assert.equal(state.value.notes, "");
  f.release();
  await settle();
  assert.equal(f.render().value.notes, "");
  assert.equal(f.entries.size, 0);
  f.hooks.unmount();
});
test("device hook keeps edits made during save, then acknowledges the actual later snapshot", async () => {
  const f = fixture();
  f.render();
  let state = f.render();
  state.setValue({ notes: "first" });
  state = f.render();
  f.defer();
  await f.flush();
  state = f.render();
  state.setValue({ notes: "newer" });
  f.render();
  f.release();
  await settle();
  state = f.render();
  assert.equal(state.value.notes, "newer");
  assert.equal(state.dirty, true);
  f.locks.request = (_key, fn) => Promise.resolve().then(fn);
  await f.flush();
  state = f.render();
  assert.equal(state.dirty, false);
  assert.equal(
    records.readDeviceRecord(f.storage, "kova-academy-progress", "A", "topic").value.notes,
    "newer",
  );
  f.hooks.unmount();
});
test("clear-recovery event invalidates queued writes and keeps reset state", async () => {
  const f = fixture();
  f.render();
  let state = f.render();
  state.setValue({ notes: "private" });
  f.render();
  f.defer();
  await f.flush();
  f.events.get(policy.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT)({
    detail: { principal: policy.browserStoragePrincipal("A") },
  });
  f.release();
  await settle();
  state = f.render();
  assert.equal(state.value.notes, "");
  assert.equal(state.dirty, false);
  assert.equal(f.entries.size, 0);
  f.hooks.unmount();
});
