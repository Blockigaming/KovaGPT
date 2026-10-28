import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import postcss from "postcss";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const require = createRequire(import.meta.url);
const SwitchPrimitives = require("@radix-ui/react-switch");
const source = read("src/components/ui/switch.tsx");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => (name === "@/lib/utils" ? { cn: (...values) => twMerge(clsx(values)) } : require(name)),
  module,
  module.exports,
);
const { Switch } = module.exports;
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const tokens = (tag) => attr(tag, "class").split(/\s+/);
function markup(props = {}) {
  const html = renderToStaticMarkup(React.createElement(Switch, props));
  const tag = (slot) => {
    const found = html.match(new RegExp(`<[^>]+data-slot="${slot}"[^>]*>`));
    assert.ok(found, `Missing ${slot}`);
    return found[0];
  };
  return { html, root: tag("switch"), track: tag("switch-track"), thumb: tag("switch-thumb") };
}

// Real React/Radix server markup plus source CSS/utility arithmetic. These tests
// do not measure native layout, pointer hit testing, or keyboard event dispatch.
for (const checked of [false, true]) {
  test(`${checked ? "on" : "off"} switch separates a real 44px target from its horizontal track`, () => {
    const { root, track, thumb, html } = markup({ checked, "aria-label": "Use saved memory" });
    for (const token of [
      "h-11",
      "w-11",
      "min-h-11",
      "min-w-11",
      "shrink-0",
      "items-center",
      "justify-center",
      "border-0",
      "p-0",
      "bg-transparent",
    ])
      assert.ok(tokens(root).includes(token), token);
    for (const token of ["h-5", "w-9", "shrink-0", "border-2", "rounded-full"])
      assert.ok(tokens(track).includes(token), token);
    for (const token of ["h-4", "w-4", "shrink-0", "rounded-full"])
      assert.ok(tokens(thumb).includes(token), token);
    const length = (tag, axis) =>
      Number(
        tokens(tag)
          .find((v) => v.startsWith(`${axis}-`))
          .split("-")
          .at(-1),
      ) * 4;
    const target = { width: length(root, "w"), height: length(root, "h") };
    const visible = { width: length(track, "w"), height: length(track, "h") };
    const state = checked ? "checked" : "unchecked";
    const travelToken = tokens(thumb).find((token) =>
      token.startsWith(`data-[state=${state}]:translate-x-`),
    );
    const travel = Number(travelToken.split("-").at(-1)) * 4;
    const border = 2;
    assert.deepEqual(target, { width: 44, height: 44 });
    assert.deepEqual(visible, { width: 36, height: 20 });
    assert.equal(length(thumb, "h"), visible.height - border * 2);
    assert.equal(length(thumb, "w"), 16);
    assert.equal(travel, checked ? visible.width - border * 2 - length(thumb, "w") : 0);
    assert.ok(travel + length(thumb, "w") <= visible.width - border * 2);
    assert.match(html, /data-slot="switch-track"[^>]*><span[^>]*data-slot="switch-thumb"/);
    assert.equal(attr(root, "role"), "switch");
    assert.equal(attr(root, "type"), "button");
    assert.equal(attr(root, "aria-label"), "Use saved memory");
    assert.equal(attr(root, "aria-checked"), String(checked));
    assert.equal(attr(root, "data-state"), state);
    assert.equal(attr(thumb, "data-state"), state);
    assert.equal(attr(track, "aria-hidden"), "true");
    assert.equal(attr(track, "tabindex"), undefined);
    assert.equal(attr(thumb, "tabindex"), undefined);
  });
}

test("track and thumb retain semantic colors and keyboard focus stays on the Radix target", () => {
  const { root, track, thumb } = markup();
  assert.ok(tokens(root).includes("group/switch"));
  assert.ok(tokens(track).includes("group-data-[state=checked]/switch:bg-primary"));
  assert.ok(tokens(track).includes("group-data-[state=unchecked]/switch:bg-input"));
  assert.ok(tokens(thumb).includes("bg-white"));
  assert.ok(tokens(thumb).includes("data-[state=checked]:bg-primary-foreground"));
  for (const token of [
    "focus-visible:ring-2",
    "focus-visible:ring-ring",
    "focus-visible:ring-offset-2",
    "focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed",
    "disabled:opacity-50",
  ])
    assert.ok(tokens(root).includes(token), token);
  for (const child of [track, thumb]) assert.ok(tokens(child).includes("pointer-events-none"));
});

test("props, event callbacks, and ref pass to the same Radix Root without a second activation handler", () => {
  const calls = [];
  const ref = React.createRef();
  const props = {
    id: "memory-toggle",
    "aria-describedby": "memory-hint",
    "aria-labelledby": "memory-label",
    name: "memory",
    value: "enabled",
    form: "preferences",
    required: true,
    disabled: true,
    defaultChecked: true,
    tabIndex: 0,
    className: "consumer-class",
    onCheckedChange: (value) => calls.push(value),
    onClick: () => {},
    onKeyDown: () => {},
  };
  const tree = Switch.render(props, ref);
  assert.equal(tree.type, SwitchPrimitives.Root);
  assert.equal(tree.props.ref, ref);
  for (const [key, value] of Object.entries(props)) {
    if (key !== "className") assert.equal(tree.props[key], value, key);
  }
  assert.ok(tree.props.className.includes("consumer-class"));
  assert.deepEqual(calls, [], "Rendering must not execute a change");
  const { root, html } = markup(props);
  assert.equal(attr(root, "aria-checked"), "true");
  assert.equal(attr(root, "aria-required"), "true");
  assert.match(root, /disabled=""/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*name="memory"/);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 1);
  assert.doesNotMatch(source, /onClick=|onKeyDown=|onPointerDown=|useState|useEffect/);
});

test("Settings retains the real mobile button minimum and no dialog-only pseudo target or thumb override", () => {
  const settings = postcss.parse(read("src/components/account-surfaces.css"));
  settings.walkRules((rule) => assert.doesNotMatch(rule.selector, /\[role=["']switch["']\]/));
  const sheet = postcss.parse(read("src/styles.css"));
  const rules = [];
  sheet.walkRules((rule) => {
    if (rule.selectors.includes(".kova-settings-dialog button")) rules.push(rule);
  });
  const mobile = rules.find((rule) => rule.parent.params === "(max-width: 1023px)");
  assert.ok(mobile);
  assert.equal(mobile.nodes.find((node) => node.prop === "min-height").value, "44px");
  assert.ok(mobile.selectors.includes(".kova-secondary-page button"));
  assert.doesNotMatch(source, /before:|after:|max-h-5|min-h-5/);
});

test("sidebar layout grows only label text and leaves switch track, thumb, and hover color independent", () => {
  const sheet = postcss.parse(read("src/styles/sidebar-personalization.css"));
  const rules = [];
  sheet.walkRules((rule) => rules.push(rule));
  const label = rules.find((rule) => rule.selector === ".kova-sidebar-shortcut-choice > span");
  assert.equal(label.nodes.find((node) => node.prop === "flex").value, "1");
  assert.equal(
    rules.some((rule) => rule.selector === ".kova-sidebar-shortcut-choice span"),
    false,
  );
  assert.ok(
    rules.some((rule) =>
      rule.selectors.includes('.kova-sidebar-personalization button:not([role="switch"]):hover'),
    ),
  );
  assert.equal(
    rules.some((rule) => rule.selectors.includes(".kova-sidebar-personalization button:hover")),
    false,
  );
  assert.ok(
    rules.some((rule) =>
      rule.selectors.includes(".kova-sidebar-personalization button:focus-visible"),
    ),
  );
});

function parse(path) {
  const file = ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { file, nodes };
}
function execute(code, dependencies) {
  return new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(...Object.values(dependencies));
}
function consumerSwitch(path, dependencies) {
  const { file, nodes } = parse(path);
  const switches = nodes.filter(
    (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "Switch",
  );
  assert.equal(switches.length, 1);
  return execute(`return (${switches[0].getText(file)});`, { React, Switch, ...dependencies });
}

test("Settings ToggleRow keeps its label/hint association and original change callback", () => {
  const { file, nodes } = parse("src/components/SettingsDialog.tsx");
  const row = nodes.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "ToggleRow",
  );
  const ToggleRow = execute(`${row.getText(file)}; return ToggleRow;`, {
    React,
    Switch,
    useId: () => "memory-control",
  });
  const changes = [];
  const props = {
    title: "Use saved memory",
    hint: "Remember context",
    checked: false,
    onCheckedChange: (value) => changes.push(value),
  };
  const tree = ToggleRow(props);
  const control = tree.props.children[1];
  assert.equal(control.type, Switch);
  assert.equal(control.props.onCheckedChange, props.onCheckedChange);
  control.props.onCheckedChange(true);
  control.props.onCheckedChange(false);
  assert.deepEqual(changes, [true, false]);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /<label for="memory-control"[^>]*>Use saved memory<\/label>/);
  assert.match(html, /id="memory-control-hint"[^>]*>Remember context/);
  assert.match(html, /id="memory-control" aria-describedby="memory-control-hint"/);
});

test("sidebar shortcut switch keeps its label and immediate add/remove handler", () => {
  let shortcuts = ["projects"];
  const changes = [];
  const render = () =>
    consumerSwitch("src/components/Sidebar.tsx", {
      shortcut: { id: "work", label: "Work" },
      railShortcuts: shortcuts,
      changeRailShortcuts: (value) => {
        shortcuts = value;
        changes.push(value);
      },
    });
  assert.equal(render().props["aria-label"], "Work");
  assert.equal(render().props.checked, false);
  render().props.onCheckedChange(true);
  assert.equal(render().props.checked, true);
  render().props.onCheckedChange(false);
  assert.deepEqual(changes, [["projects", "work"], ["projects"]]);
});

test("Personality Auto-adapt keeps its accessible name and existing controlled callback", () => {
  const changes = [];
  const toggleAuto = (value) => changes.push(value);
  for (const visibleAutoAdapt of [false, true]) {
    const control = consumerSwitch("src/components/PersonalitySliders.tsx", {
      visibleAutoAdapt,
      toggleAuto,
    });
    assert.equal(control.props["aria-label"], "Auto-adapt to me");
    assert.equal(control.props.checked, visibleAutoAdapt);
    assert.equal(control.props.onCheckedChange, toggleAuto);
    control.props.onCheckedChange(!visibleAutoAdapt);
  }
  assert.deepEqual(changes, [true, false]);
});
