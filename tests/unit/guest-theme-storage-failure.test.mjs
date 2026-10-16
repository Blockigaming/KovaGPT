import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const source = ts.createSourceFile(
  "ChatWorkspace.tsx",
  readFileSync("src/components/ChatWorkspace.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let owner, effect, initialLoad;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(source) === "onChangeTheme")
    owner = node.initializer.expression;
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
    const fn = node.arguments[0],
      body = fn?.getText(source) ?? "";
    if (body.includes("applyThemeMode") && body.includes("if (!settingsReady)")) effect = fn;
    if (body.includes("setSettings(loaded)")) initialLoad = fn;
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(owner && effect && initialLoad);
function execute(node, globals) {
  const code = ts.transpileModule(`const fn=${node.getText(source)};fn;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(code, globals);
}
for (const failure of ["unavailable", "quota"])
  test(`explicit guest theme survives its actual effect when storage is ${failure}`, () => {
    const classes = new Set(),
      memory = new Map();
    const storage =
      failure === "unavailable"
        ? undefined
        : {
            getItem: (key) => memory.get(key) ?? null,
            setItem() {
              throw Error("quota");
            },
          };
    const document = {
      documentElement: {
        classList: {
          toggle(name, on) {
            if (on) classes.add(name);
            else classes.delete(name);
          },
        },
      },
    };
    const theme = loadUiModule(
      "src/lib/theme.ts",
      {},
      { window: { matchMedia: () => ({ matches: false }) }, document, localStorage: storage },
    );
    let settings = { mode: "dark", customInstructions: "Current draft" };
    theme.applyThemeMode("dark");
    const change = execute(owner, {
      settingsReady: true,
      applyThemeMode: theme.applyThemeMode,
      setSettings: (next) => {
        settings = next(settings);
      },
    });
    change("light");
    execute(effect, {
      settingsReady: true,
      userKey: null,
      settings,
      applyThemeMode: theme.applyThemeMode,
      loadThemeMode: theme.loadThemeMode,
    })();
    assert.equal(settings.mode, "light");
    assert.equal(settings.customInstructions, "Current draft");
    assert.equal(classes.has("dark"), false);
  });
test("guest hydration seeds settings from the existing device mode before applying the theme", () => {
  // Execute the real account-load effect through the settings/theme portion;
  // abort after theme application so unrelated chat I/O never runs.
  let captured, applied;
  const stop = Symbol("end of relevant effect");
  const globals = {
    isLoaded: true,
    userKey: null,
    storagePrincipal: "guest",
    loadSettings: () => ({ mode: "dark", customInstructions: "Existing" }),
    loadThemeMode: () => "light",
    setSettings: (value) => {
      captured = value;
    },
    applyThemeMode: (mode) => {
      applied = mode;
      throw stop;
    },
    clearRetryTimer() {},
  };
  function bind(node) {
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (name.endsWith("Ref") && !(name in globals)) globals[name] = { current: null };
      if (name.startsWith("set") && !(name in globals)) globals[name] = () => {};
    }
    ts.forEachChild(node, bind);
  }
  bind(initialLoad);
  try {
    execute(initialLoad, globals)();
  } catch (error) {
    if (error !== stop) throw error;
  }
  assert.equal(applied, "light");
  assert.equal(captured.mode, "light");
  assert.equal(captured.customInstructions, "Existing");
});
