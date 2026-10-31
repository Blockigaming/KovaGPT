import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { applyReadingPreferences } from "../../src/lib/appearance-preferences.mjs";

const defaults = Object.freeze({
  mode: "dark",
  readingSize: 16,
  readingWidth: 760,
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const source = stripTypeScriptTypes(readFileSync("src/lib/use-nova-settings.ts", "utf8"), {
  mode: "transform",
})
  .replace(/^import\b[\s\S]*?;\s*/gm, "")
  .replace(/^export\s*\{[^}]+\}\s*from\s*[^;]+;\s*/gm, "")
  .replace(/\bexport\s+(?=function)/g, "");

// Execute the real hook with independently scheduled render/effect queues.
// Storage delivery is an explicit boundary so an older passive render can be
// held until after another tab has committed a newer user edit.
function tab(records, initialOwner = "owner-a") {
  const hooks = [],
    effects = [],
    writes = [],
    messages = [],
    savedEvents = [];
  const listeners = new Map(),
    styles = new Map();
  let cursor = 0,
    current,
    owner = initialOwner,
    resolved = true,
    failWrites = false;
  const changed = (before, after) => !before || after.some((v, i) => !Object.is(v, before[i]));
  const context = {
    DEFAULT_SETTINGS: defaults,
    settingsKey: (user) => `nova-gpt-settings-v1:${user ?? "guest"}`,
    loadStoredSettings: (user) => (records.has(user) ? clone(records.get(user)) : null),
    saveStoredSettings(user, value) {
      if (failWrites) throw new Error("storage full");
      writes.push({ owner: user, value: clone(value) });
      records.set(user, clone(value));
    },
    loadThemeMode: () => "dark",
    applyThemeMode() {},
    applyReadingPreferences,
    PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "principal-cleared",
    isPrincipalBrowserStorageClearedEvent: (event, user) => event.detail?.ownerId === user,
    toast: { error: (message) => messages.push(message) },
    document: {
      documentElement: {
        style: { setProperty: (k, v) => styles.set(k, v) },
        dataset: {},
      },
    },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    window: {
      addEventListener(type, handler) {
        const handlers = listeners.get(type) ?? new Set();
        handlers.add(handler);
        listeners.set(type, handlers);
      },
      removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
      dispatchEvent: (event) => savedEvents.push(event),
    },
    useRef(initial) {
      const i = cursor++;
      hooks[i] ??= { current: initial };
      return hooks[i];
    },
    useState(initial) {
      const i = cursor++;
      hooks[i] ??= { value: initial };
      return [
        hooks[i].value,
        (next) => {
          hooks[i].value = typeof next === "function" ? next(hooks[i].value) : next;
        },
      ];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (changed(hooks[i]?.deps, deps)) hooks[i] = { value: fn, deps };
      return hooks[i].value;
    },
    useEffect(run, deps) {
      const i = cursor++;
      if (!changed(hooks[i]?.deps, deps)) return;
      const previous = hooks[i];
      hooks[i] = { deps, cleanup: previous?.cleanup };
      effects.push(() => {
        previous?.cleanup?.();
        hooks[i].cleanup = run();
      });
    },
  };
  const { useNovaSettings } = vm.runInNewContext(`${source}\n({ useNovaSettings })`, context);
  const render = () => {
    cursor = 0;
    current = useNovaSettings(owner, resolved);
    return current;
  };
  const flushEffects = () => {
    for (const run of effects.splice(0)) run();
  };
  const settle = () => {
    for (let i = 0; i < 5; i++) {
      render();
      flushEffects();
    }
    render();
  };
  const emit = (type, event) => {
    for (const handler of listeners.get(type) ?? []) handler(event);
  };
  const storage = (user = owner) =>
    emit("storage", {
      key: context.settingsKey(user),
      newValue: JSON.stringify(records.get(user)),
    });
  return {
    render,
    flushEffects,
    settle,
    storage,
    writes,
    messages,
    savedEvents,
    styles,
    edit: (value) => current[1]((previous) => ({ ...previous, ...value })),
    captureSetter: () => current[1],
    principal: (next, ready = true) => {
      owner = next;
      resolved = ready;
    },
    clear: (user) => {
      records.delete(user);
      emit("principal-cleared", { detail: { ownerId: user } });
    },
    denyWrites: () => {
      failWrites = true;
    },
    settings: () => current[0],
  };
}

test("a delayed passive tab cannot overwrite a newer explicit reading-size edit", () => {
  const records = new Map([["owner-a", clone(defaults)]]);
  const settings = tab(records),
    chat = tab(records);
  settings.settle();
  chat.settle();
  settings.writes.length = 0;
  chat.writes.length = 0;
  settings.edit({ readingSize: 18 });
  settings.settle();
  chat.storage();
  chat.render(); // Hold this tab's older 18px effect.
  settings.edit({ readingSize: 20 });
  settings.settle();
  chat.flushEffects();
  assert.equal(records.get("owner-a").readingSize, 20);
  assert.equal(chat.writes.length, 0, "passive synchronization must not echo a stale snapshot");
  chat.storage();
  chat.settle();
  assert.equal(chat.styles.get("--kova-reading-size"), "20px");
  assert.deepEqual(
    settings.writes.map((entry) => entry.value.readingSize),
    [18, 20],
  );
});

test("hydration and passive settings delivery apply appearance without saving or emitting edit events", () => {
  const records = new Map([["owner-a", { ...defaults, readingSize: 18 }]]);
  const view = tab(records);
  view.settle();
  assert.equal(view.styles.get("--kova-reading-size"), "18px");
  records.set("owner-a", { ...defaults, readingSize: 20 });
  view.storage();
  view.settle();
  assert.equal(view.styles.get("--kova-reading-size"), "20px");
  assert.equal(view.writes.length, 0);
  assert.equal(view.savedEvents.length, 0);
});

test("a setter captured before an account switch cannot save or render the previous principal", () => {
  const records = new Map([
    ["owner-a", { ...defaults, readingSize: 18 }],
    ["owner-b", clone(defaults)],
  ]);
  const view = tab(records);
  view.settle();
  const stale = view.captureSetter();
  view.writes.length = 0;
  view.principal("owner-b");
  view.render();
  stale((previous) => ({ ...previous, readingSize: 20 }));
  view.settle();
  assert.equal(view.settings().readingSize, 16);
  assert.equal(records.get("owner-a").readingSize, 18);
  assert.equal(view.writes.length, 0);
});

test("privacy cleanup invalidates a pending explicit write and cannot recreate deleted preferences", () => {
  const records = new Map([["owner-a", clone(defaults)]]);
  const view = tab(records);
  view.settle();
  view.writes.length = 0;
  view.edit({ readingSize: 20 });
  view.render();
  view.clear("owner-a");
  view.flushEffects();
  view.settle();
  assert.equal(records.has("owner-a"), false);
  assert.equal(view.writes.length, 0);
});

test("an explicit edit remains visible and reports optional storage failure without a saved event", () => {
  const records = new Map([["owner-a", clone(defaults)]]);
  const view = tab(records);
  view.settle();
  view.savedEvents.length = 0;
  view.denyWrites();
  view.edit({ readingSize: 18 });
  view.settle();
  assert.equal(view.styles.get("--kova-reading-size"), "18px");
  assert.equal(records.get("owner-a").readingSize, 16);
  assert.equal(view.messages.length, 1);
  assert.equal(view.savedEvents.length, 0);
});
