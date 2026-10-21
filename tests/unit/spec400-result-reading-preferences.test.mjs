import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import postcss from "postcss";
import { applyReadingPreferences } from "../../src/lib/appearance-preferences.mjs";

const source = readFileSync("src/routes/index.tsx", "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declarations = [];
const readingEffects = [];
let themeEffect;
let dialog;
function visit(node) {
  if (
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((declaration) =>
      [
        "[settings, setSettings]",
        "[settingsPrincipal, setSettingsPrincipal]",
        "settingsReady",
      ].includes(declaration.name.getText(ast)),
    )
  )
    declarations.push(node.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    if (node.getText(ast).includes("applyReadingPreferences("))
      readingEffects.push(node.getText(ast));
    if (
      node
        .getText(ast)
        .includes("applyThemeMode(userKey === null ? loadThemeMode() : (settings.mode")
    )
      themeEffect = node.getText(ast);
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "SettingsDialog")
    dialog = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);

const defaults = {
  readingSize: 16,
  readingWidth: 760,
  density: "comfortable",
  motion: "full",
  mode: "dark",
};

// Execute the route's actual state declarations, effects and mounted dialog
// props. DOM/React scheduling is synthetic; browser glyph/layout QA is separate.
function fixture() {
  assert.equal(readingEffects.length, 1, "The mounted workspace must apply reading preferences");
  assert.equal(declarations.length, 3);
  assert.ok(themeEffect);
  assert.ok(dialog);
  const slots = [];
  const properties = new Map();
  const writes = [];
  const themes = [];
  const root = {
    style: {
      setProperty: (key, value) => {
        properties.set(key, value);
        writes.push([key, value]);
      },
    },
    dataset: {},
  };
  let cursor = 0;
  let pending = [];
  let current;
  const context = {
    DEFAULT_SETTINGS: defaults,
    isLoaded: true,
    storagePrincipal: "owner-a",
    userKey: "owner-a",
    document: { documentElement: root },
    applyReadingPreferences,
    applyThemeMode: (mode) => themes.push(mode),
    loadThemeMode: () => "light",
    settingsOpen: true,
    setSettingsOpen() {},
    openHelp() {},
    settingsTab: "appearance",
    settingsReturnFocusRef: { current: null },
    SettingsDialog: "SettingsDialog",
    React: { createElement: (type, props) => ({ type, props }) },
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [
        slots[index].value,
        (value) => {
          slots[index].value = value;
        },
      ];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (
        !slots[index] ||
        dependencies.some((value, i) => !Object.is(value, slots[index].dependencies[i]))
      ) {
        slots[index] = { dependencies };
        pending.push(effect);
      }
    },
  };
  const compiled = ts.transpileModule(
    `globalThis.render = () => {
      ${declarations.join("\n")}
      ${readingEffects[0]};
      ${themeEffect};
      return { dialog: (${dialog}), setSettingsPrincipal };
    };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } },
  ).outputText;
  vm.runInNewContext(compiled, context);
  const render = () => {
    cursor = 0;
    current = context.render();
    for (const effect of pending.splice(0)) effect();
  };
  render();
  return {
    properties,
    writes,
    themes,
    root,
    load(settings = defaults) {
      current.dialog.props.onChange(settings);
      current.setSettingsPrincipal(context.storagePrincipal);
      render();
    },
    change(patch) {
      current.dialog.props.onChange({ ...current.dialog.props.settings, ...patch });
      render();
    },
    principal(userKey, isLoaded = true) {
      context.userKey = userKey;
      context.storagePrincipal = userKey ?? "guest";
      context.isLoaded = isLoaded;
      render();
    },
  };
}

test("mounted Appearance settings immediately propagate all three Result reading sizes", () => {
  const f = fixture();
  assert.equal(f.writes.length, 0, "Unloaded settings must not overwrite the root");
  f.load();
  for (const readingSize of [18, 20, 16]) {
    f.change({ readingSize });
    assert.equal(f.properties.get("--kova-reading-size"), `${readingSize}px`);
  }
  assert.deepEqual(f.themes, ["dark"], "Reading changes must not reapply the theme");
});

test("mounted settings preserve bounded width, density and motion application", () => {
  const f = fixture();
  f.load();
  f.change({ readingWidth: 900, density: "compact", motion: "reduced" });
  assert.equal(f.properties.get("--kova-reading-width"), "900px");
  assert.equal(
    f.properties.has("--chat-content-width"),
    false,
    "Reading preferences must not restore the obsolete separate content-width override",
  );
  assert.deepEqual(f.root.dataset, { kovaDensity: "compact", kovaMotion: "reduced" });
  f.change(defaults);
  assert.equal(f.properties.get("--kova-reading-width"), "760px");
  assert.deepEqual(f.root.dataset, { kovaDensity: "comfortable", kovaMotion: "full" });
});

test("reading application waits for the current principal while guest theme remains canonical", () => {
  const f = fixture();
  f.load({ ...defaults, readingSize: 20 });
  const previous = f.writes.length;
  f.principal("owner-b", false);
  f.principal("owner-b");
  assert.equal(f.writes.length, previous, "Old-principal values must not be reapplied");
  f.load({ ...defaults, readingSize: 18 });
  assert.equal(f.properties.get("--kova-reading-size"), "18px");
  f.principal(null);
  f.load();
  assert.equal(f.properties.get("--kova-reading-size"), "16px");
  assert.equal(f.themes.at(-1), "light", "Guest theme still comes from loadThemeMode");
});

test("Result prose owns the reading token; code, action labels and ordinary mobile fields stay fixed", () => {
  const result = postcss.parse(readFileSync("src/components/result-editor.css", "utf8"));
  const system = postcss.parse(readFileSync("src/styles/spec400-system.css", "utf8"));
  const value = (sheet, selector) => {
    const matches = [];
    sheet.walkRules(selector, (rule) =>
      rule.walkDecls("font-size", (declaration) => matches.push(declaration.value)),
    );
    assert.equal(matches.length, 1);
    return matches[0];
  };
  assert.equal(value(result, ".kova-result-textarea"), "var(--kova-reading-size, 16px)");
  assert.equal(value(result, ".kova-result-textarea.font-mono"), "14px");
  assert.equal(
    value(result, ".kova-result-toolbar button,\n.kova-result-secondary-toolbar button"),
    "13px",
  );
  assert.equal(value(system, "body :is(input, textarea, select)"), "1rem");
  assert.match(source, /if \(attachments\.length \|\| tempChat \|\| isStreaming \|\| result\)/);
});
