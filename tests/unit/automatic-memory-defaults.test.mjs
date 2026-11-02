import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { APPEARANCE_DEFAULTS } from "../../src/lib/appearance-preferences.mjs";

function script(path) {
  return stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "transform" })
    .replace(/^import\b[\s\S]*?;\s*/gm, "")
    .replace(/^export\s*\{[^}]+\}\s*from\s*[^;]+;\s*/gm, "")
    .replace(/\bexport\s+(?=const|function)/g, "");
}
function settings(stored = new Map()) {
  const context = vm.createContext({
    APPEARANCE_DEFAULTS,
    DEFAULT_THEME: {},
    window: {},
    loadThemeMode: () => "dark",
    loadStoredSettings: (owner) => stored.get(owner) ?? null,
  });
  vm.runInContext(
    script("src/lib/settings-types.ts") +
      script("src/lib/use-nova-settings.ts") +
      "\nthis.load = loadSettings;",
    context,
  );
  return (owner) => context.load(owner);
}
test("new browser settings enable automatic memory without saving another account's choices", () => {
  const load = settings();
  const result = load("new-owner");
  assert.equal(result.rememberAcross, true);
  assert.equal(result.automaticMemory, true);
});
test("automatic defaults preserve an existing account's explicit memory opt-out", () => {
  const load = settings(
    new Map([["opted-out", { rememberAcross: false, automaticMemory: false }]]),
  );
  assert.equal(load("opted-out").rememberAcross, false);
  assert.equal(load("opted-out").automaticMemory, false);
  assert.equal(load("different-owner").rememberAcross, true);
  assert.equal(load("different-owner").automaticMemory, true);
});
