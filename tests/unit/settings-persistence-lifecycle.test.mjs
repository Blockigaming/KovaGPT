import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  isPrincipalBrowserStorageClearedEvent,
  browserStoragePrincipal,
} from "../../src/lib/principal-browser-storage.mjs";
import assert from "node:assert/strict";
import { createHookHarness, loadUiModule } from "../helpers/ui-state-harness.mjs";
import { settingsKey } from "../../src/lib/settings-storage.ts";
function fixture({ deferEffects = false } = {}) {
  const pendingEffects = [];
  const hooks = createHookHarness(),
    values = new Map(),
    errors = [],
    writes = [],
    timers = new Map();
  let id = 0,
    unavailable = false;
  const { usePersistSettings } = loadUiModule(
    process.env.KOVA_SETTINGS_EFFECT_SOURCE ?? "src/lib/use-persist-settings.ts",
    {
      react: {
        ...hooks.react,
        useEffect: deferEffects ? (effect) => pendingEffects.push(effect) : hooks.react.useEffect,
      },
      "@/lib/settings-storage": { settingsKey },
      "@/lib/principal-browser-storage.mjs": {
        safeBrowserStorage: () => ({
          setItem: (key, value) => {
            if (unavailable) throw Error("Storage unavailable");
            writes.push([key, value]);
            values.set(key, value);
          },
        }),
      },
      sonner: { toast: { error: (message) => errors.push(message) } },
    },
    {
      window: {},
      setTimeout: (callback) => {
        timers.set(++id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const generation = { current: 0 };
  const principalRef = { current: "a" };
  return {
    values,
    errors,
    writes,
    generation,
    principalRef,
    flushEffects() {
      for (const effect of pendingEffects.splice(0)) effect();
    },
    fail() {
      unavailable = true;
    },
    render(settings, userKey = "a", settingsReady = true) {
      principalRef.current = userKey;
      hooks.render(usePersistSettings, {
        settings,
        userKey,
        settingsReady,
        storageGenerationRef: generation,
        storagePrincipal: userKey,
        storagePrincipalRef: principalRef,
      });
    },
    flush() {
      for (const cb of timers.values()) cb();
      timers.clear();
    },
    dispose: () => hooks.unmount(),
  };
}
const initial = { mode: "dark", sendOnEnter: true, customInstructions: "Original" };
test("last settings edit survives immediate route unmount", () => {
  const f = fixture();
  f.render(initial);
  f.flush();
  f.render({ ...initial, customInstructions: "Last edit", sendOnEnter: false });
  f.dispose();
  f.flush();
  assert.equal(JSON.parse(f.values.get(settingsKey("a"))).customInstructions, "Last edit");
  assert.equal(JSON.parse(f.values.get(settingsKey("a"))).sendOnEnter, false);
});
test("account switch preserves final old-account edit without copying it to next principal", () => {
  const f = fixture();
  try {
    f.render(initial);
    f.flush();
    f.render({ ...initial, customInstructions: "Account A draft" });
    f.generation.current++;
    f.render(initial, "b", false);
    f.render({ ...initial, customInstructions: "Account B", mode: "light" }, "b");
    f.flush();
    assert.equal(JSON.parse(f.values.get(settingsKey("a"))).customInstructions, "Account A draft");
    assert.equal(JSON.parse(f.values.get(settingsKey("b"))).customInstructions, "Account B");
  } finally {
    f.dispose();
  }
});
test("theme changes retain current fields and unresolved/reset settings cannot repopulate storage", () => {
  const f = fixture();
  try {
    f.render({ ...initial, customInstructions: "Current draft" });
    f.render({ ...initial, customInstructions: "Current draft", mode: "system" });
    assert.deepEqual(JSON.parse(f.values.get(settingsKey("a"))), {
      ...initial,
      customInstructions: "Current draft",
      mode: "system",
    });
    f.values.clear();
    f.generation.current++;
    f.render(initial, "a", false);
    f.flush();
    assert.equal(f.values.size, 0);
  } finally {
    f.dispose();
  }
});
test("storage failure reports unsaved settings without throwing or claiming persistence", () => {
  const f = fixture();
  try {
    f.fail();
    assert.doesNotThrow(() => {
      f.render(initial);
      f.flush();
    });
    assert.equal(f.values.size, 0);
    assert.match(f.errors[0], /could not be saved/);
  } finally {
    f.dispose();
  }
});

// Compile the actual ChatWorkspace callback, retaining its guards and mutation order.
function actualPrincipalReset(generation, userKey, calls) {
  const file = ts.createSourceFile(
    "ChatWorkspace.tsx",
    readFileSync("src/components/ChatWorkspace.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "handlePrincipalReset")
      callback = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(callback);
  const globals = {
    storageGenerationRef: generation,
    userKey,
    isPrincipalBrowserStorageClearedEvent,
    DEFAULT_SETTINGS: initial,
    clearRetryTimer() {},
    configureMemoryWrites() {},
  };
  function bind(node) {
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (name.startsWith("set")) globals[name] = (value) => calls.push([name, value]);
      if (name.endsWith("Ref") && !(name in globals)) globals[name] = { current: null };
    }
    ts.forEachChild(node, bind);
  }
  bind(callback);
  const compiled = ts.transpileModule(`const reset = ${callback.getText(file)}; reset;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(compiled, globals);
}
test("queued passive settings effect cannot resurrect data after the actual principal-reset callback", () => {
  const f = fixture({ deferEffects: true }),
    calls = [];
  f.render({ ...initial, customInstructions: "Old private instructions" });
  const reset = actualPrincipalReset(f.generation, "a", calls);
  f.values.clear();
  reset({ detail: { principal: browserStoragePrincipal("a") } });
  assert.equal(f.generation.current, 1);
  assert.ok(calls.some(([name, value]) => name === "setSettingsPrincipal" && value === null));
  f.flushEffects();
  assert.equal(f.values.size, 0);
  assert.equal(f.errors.length, 0);
});
test("another account reset does not retire the current queued settings edit", () => {
  const f = fixture({ deferEffects: true });
  f.render(initial);
  actualPrincipalReset(
    f.generation,
    "a",
    [],
  )({ detail: { principal: browserStoragePrincipal("b") } });
  f.flushEffects();
  assert.deepEqual(JSON.parse(f.values.get(settingsKey("a"))), initial);
});
test("principal transition rejects a queued old-owner effect even before the load effect advances generation", () => {
  const f = fixture({ deferEffects: true });
  f.render({ ...initial, customInstructions: "Old A" });
  f.principalRef.current = "b";
  f.flushEffects();
  assert.equal(f.values.size, 0);
});
test("A to B to A rejects a queued obsolete epoch and allows fresh ready settings", () => {
  const f = fixture({ deferEffects: true });
  f.render({ ...initial, customInstructions: "Old A" });
  f.generation.current++;
  f.render(initial, "b", false);
  f.generation.current++;
  f.render({ ...initial, customInstructions: "Fresh A" }, "a", true);
  f.flushEffects();
  assert.equal(f.values.size, 1);
  assert.equal(JSON.parse(f.values.get(settingsKey("a"))).customInstructions, "Fresh A");
  assert.equal(f.writes.length, 1);
});
test("account switch admits only fresh ready B settings after invalidating pending A", () => {
  const f = fixture({ deferEffects: true });
  f.render({ ...initial, customInstructions: "Old A" });
  f.generation.current++;
  f.render(initial, "b", false);
  f.render({ ...initial, customInstructions: "Fresh B" }, "b", true);
  f.flushEffects();
  assert.equal(f.values.has(settingsKey("a")), false);
  assert.equal(JSON.parse(f.values.get(settingsKey("b"))).customInstructions, "Fresh B");
});
