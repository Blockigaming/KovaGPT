import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as principalStorage from "../../src/lib/principal-browser-storage.mjs";
import {
  parsePluginListPreferences,
  parseProjectListPreferences,
  parseScheduledTaskListPreferences,
  PLUGIN_LIST_STORAGE_BASE,
  PROJECT_LIST_STORAGE_BASE,
  SCHEDULED_TASK_LIST_STORAGE_BASE,
} from "../../src/lib/management-list-preferences.mjs";

const code = ts.transpileModule(
  readFileSync(
    new URL("../../src/hooks/use-principal-session-preferences.ts", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function memoryStorage(entries = []) {
  const values = new Map(entries);
  const reads = [];
  const writes = [];
  return {
    reads,
    writes,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem(key) {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
}

// Execute the actual hook with deterministic hook/effect scheduling. This can inspect
// an identity-change render before passive effects, without a browser or live service.
function fixture({
  storage = memoryStorage(),
  parser = parseScheduledTaskListPreferences,
  base = SCHEDULED_TASK_LIST_STORAGE_BASE,
  denyGetter = false,
} = {}) {
  const window = new EventTarget();
  let getterReads = 0;
  Object.defineProperty(window, "sessionStorage", {
    get() {
      getterReads += 1;
      if (denyGetter) throw new Error("Storage getter denied");
      return storage;
    },
  });
  const slots = [];
  let index = 0;
  let pending = [];
  let dirty = false;
  let owner;
  let result;
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots))
        slots[slot] = { value: typeof initial === "function" ? initial() : initial };
      return [
        slots[slot].value,
        (next) => {
          slots[slot].value = typeof next === "function" ? next(slots[slot].value) : next;
          dirty = true;
        },
      ];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useMemo(create, deps) {
      const slot = index++;
      if (!same(slots[slot]?.deps, deps)) slots[slot] = { value: create(), deps };
      return slots[slot].value;
    },
    useCallback(callback, deps) {
      return react.useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!same(slots[slot]?.deps, deps)) {
        const previous = slots[slot];
        slots[slot] = { effect, deps, cleanup: previous?.cleanup };
        pending.push(slots[slot]);
      }
    },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    window,
    require: (name) => {
      if (name === "react") return react;
      if (name === "@/lib/principal-browser-storage.mjs")
        return {
          ...principalStorage,
          safeBrowserStorage: (area) => principalStorage.safeBrowserStorage(area, window),
        };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  const render = (...owners) => {
    if (owners.length) owner = owners[0];
    index = 0;
    dirty = false;
    result = exports.usePrincipalSessionPreferences(base, owner, parser);
    return result;
  };
  const flush = () => {
    for (let attempts = 0; pending.length || dirty; attempts++) {
      assert.ok(attempts < 15, "effect scheduling must settle");
      const effects = pending;
      pending = [];
      for (const entry of effects) {
        entry.cleanup?.();
        entry.cleanup = entry.effect();
      }
      if (dirty) render();
    }
    return result;
  };
  return {
    storage,
    render,
    flush,
    get getterReads() {
      return getterReads;
    },
    clear(userKey) {
      const event = new Event(principalStorage.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT);
      event.detail = { principal: principalStorage.browserStoragePrincipal(userKey) };
      window.dispatchEvent(event);
    },
    replayEffects() {
      for (const entry of slots.filter((slot) => slot.effect)) {
        entry.cleanup?.();
        entry.cleanup = entry.effect();
      }
      return flush();
    },
    unmount() {
      for (const entry of slots) entry.cleanup?.();
    },
  };
}

const key = (owner, base = SCHEDULED_TASK_LIST_STORAGE_BASE) =>
  principalStorage.principalScopedStorageKey(base, owner);
const defaults = { query: "", filter: "active" };
const saved = { query: "private task query", filter: "paused" };

test("hydration and Strict Mode effect replay preserve saved preferences without writing", () => {
  const storage = memoryStorage([[key("A"), JSON.stringify(saved)]]);
  const f = fixture({ storage });
  assert.deepEqual(f.render("A")[0], defaults);
  assert.deepEqual(f.flush()[0], saved);
  assert.deepEqual(f.replayEffects()[0], saved);
  assert.equal(storage.writes.length, 0);
  f.unmount();
  const remount = fixture({ storage });
  remount.render("A");
  assert.deepEqual(remount.flush()[0], saved);
});

test("auth loading is storage-free and cannot overwrite a saved principal or guest query", () => {
  const storage = memoryStorage([
    [key("A"), JSON.stringify(saved)],
    [key(null), '{"query":"guest"}'],
  ]);
  const f = fixture({ storage });
  f.render(undefined);
  let result = f.flush();
  result[1]({ query: "loading state" });
  assert.equal(f.getterReads, 0);
  assert.equal(storage.writes.length, 0);
  f.render("A");
  result = f.flush();
  assert.deepEqual(result[0], saved);
  assert.deepEqual(f.render(undefined)[0], defaults);
  f.flush();
  assert.equal(storage.writes.length, 0);
  f.render("A");
  assert.deepEqual(f.flush()[0], saved);
});

test("an account switch renders new defaults immediately and rejects the previous setter", () => {
  const storage = memoryStorage([
    [key("A"), JSON.stringify(saved)],
    [key("B"), '{"query":"B query","filter":"all"}'],
    [key(null), '{"query":"guest query","filter":"active"}'],
  ]);
  const f = fixture({ storage });
  f.render("A");
  const staleUpdate = f.flush()[1];
  assert.deepEqual(f.render("B")[0], defaults);
  staleUpdate({ query: "must never enter B storage" });
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(f.flush()[0], { query: "B query", filter: "all" });
  staleUpdate({ filter: "paused" });
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(f.render(null)[0], defaults);
  assert.deepEqual(f.flush()[0], { query: "guest query", filter: "active" });
});

test("only user changes write, patch updates compose, and remount restores them", () => {
  const f = fixture();
  f.render("A");
  const update = f.flush()[1];
  update({ query: "scheduled review" });
  update({ filter: "all", records: [{ id: "private" }], status: "failed" });
  assert.deepEqual(f.flush()[0], { query: "scheduled review", filter: "all" });
  assert.deepEqual(JSON.parse(f.storage.getItem(key("A"))), {
    query: "scheduled review",
    filter: "all",
  });
  f.unmount();
  update({ query: "stale unmounted callback" });
  assert.equal(f.storage.writes.length, 2);
  const remount = fixture({ storage: f.storage });
  remount.render("A");
  assert.deepEqual(remount.flush()[0], { query: "scheduled review", filter: "all" });
});

test("cleanup events reset current state without recreating private queries in storage", () => {
  const f = fixture({ storage: memoryStorage([[key("A"), JSON.stringify(saved)]]) });
  f.render("A");
  f.flush();
  f.clear("B");
  assert.deepEqual(f.flush()[0], saved);
  principalStorage.clearPrincipalBrowserStorage("A", {
    localStorage: null,
    sessionStorage: f.storage,
  });
  f.clear("A");
  const result = f.flush();
  assert.deepEqual(result[0], defaults);
  assert.equal(f.storage.getItem(key("A")), null);
  assert.equal(f.storage.writes.length, 0);
  result[1]({ filter: "all" });
  assert.deepEqual(JSON.parse(f.storage.getItem(key("A"))), { query: "", filter: "all" });
});

test("an outgoing account's late clear event cannot reset incoming preferences", () => {
  const f = fixture({ storage: memoryStorage([[key("B"), JSON.stringify(saved)]]) });
  f.render("A");
  f.flush();
  f.render("B");
  f.clear("A");
  assert.deepEqual(f.flush()[0], saved);
  assert.equal(f.storage.writes.length, 0);
});

test("storage getter/read/write denial leaves bounded in-memory preferences usable", () => {
  for (const denial of ["getter", "read", "write"]) {
    const storage = memoryStorage();
    if (denial === "read")
      storage.getItem = () => {
        throw new Error("Read denied");
      };
    if (denial === "write")
      storage.setItem = () => {
        throw new Error("Write denied");
      };
    const f = fixture({ storage, denyGetter: denial === "getter" });
    f.render("A");
    const result = f.flush();
    assert.deepEqual(result[0], defaults);
    result[1]({ query: "local only", filter: "paused" });
    assert.deepEqual(f.flush()[0], { query: "local only", filter: "paused" });
  }
});

test("Plugins uses the same lifecycle with only sanitized query/category/filter persistence", () => {
  const parser = (raw) => parsePluginListPreferences(raw, ["Email", "Development"]);
  const f = fixture({ parser, base: PLUGIN_LIST_STORAGE_BASE });
  f.render("A");
  f.flush()[1]({
    query: "github",
    category: "Development",
    connectionFilter: "connected",
    accounts: ["secret"],
    scopes: ["read"],
  });
  assert.deepEqual(JSON.parse(f.storage.getItem(key("A", PLUGIN_LIST_STORAGE_BASE))), {
    query: "github",
    category: "Development",
    connectionFilter: "connected",
  });
  f.clear("A");
  assert.deepEqual(f.flush()[0], { query: "", category: "all", connectionFilter: "all" });
});

test("Projects isolates all five controls on account change and resets them on mounted cleanup", () => {
  const projectDefaults = {
    query: "",
    sort: "opened",
    scope: "all",
    archived: false,
    view: "grid",
  };
  const previous = {
    query: "private project",
    sort: "name",
    scope: "shared",
    archived: true,
    view: "list",
  };
  const storage = memoryStorage([[key("A", PROJECT_LIST_STORAGE_BASE), JSON.stringify(previous)]]);
  const f = fixture({
    storage,
    parser: parseProjectListPreferences,
    base: PROJECT_LIST_STORAGE_BASE,
  });
  f.render("A");
  assert.deepEqual(f.flush()[0], previous);
  assert.deepEqual(f.render("B")[0], projectDefaults);
  assert.deepEqual(f.flush()[0], projectDefaults);
  assert.equal(storage.writes.length, 0);
  f.render("A");
  assert.deepEqual(f.flush()[0], previous);
  principalStorage.clearPrincipalBrowserStorage("A", {
    localStorage: null,
    sessionStorage: storage,
  });
  f.clear("A");
  assert.deepEqual(f.flush()[0], projectDefaults);
  assert.equal(storage.getItem(key("A", PROJECT_LIST_STORAGE_BASE)), null);
  assert.equal(storage.writes.length, 0);
  f.flush()[1]({ view: "list" });
  assert.deepEqual(JSON.parse(storage.getItem(key("A", PROJECT_LIST_STORAGE_BASE))), {
    ...projectDefaults,
    view: "list",
  });
});

test("Projects preferences remain usable when the browser storage getter is denied", () => {
  const f = fixture({
    parser: parseProjectListPreferences,
    base: PROJECT_LIST_STORAGE_BASE,
    denyGetter: true,
  });
  f.render("A");
  f.flush()[1]({
    query: "local project",
    sort: "updated",
    scope: "owned",
    archived: true,
    view: "list",
  });
  assert.deepEqual(f.flush()[0], {
    query: "local project",
    sort: "updated",
    scope: "owned",
    archived: true,
    view: "list",
  });
});
