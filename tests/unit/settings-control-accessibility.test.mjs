import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import vm from "node:vm";
import { loadUiModule, elements } from "../helpers/ui-state-harness.mjs";
const base = "6d0de50ecc91387cfd2119481f78b52655d3e126";
const settings = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const ast = ts.createSourceFile(
  "settings.tsx",
  settings,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const attrs = (n) =>
  Object.fromEntries(
    n.attributes.properties
      .filter(ts.isJsxAttribute)
      .map((p) => [
        p.name.getText(ast),
        p.initializer?.text ?? p.initializer?.getText(ast) ?? true,
      ]),
  );
test("Personalization visible labels are associated with the three actual editable fields", () => {
  const labels = new Map(),
    fields = new Map();
  const visit = (n) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "label") {
      const a = attrs(n.openingElement);
      if (a.htmlFor)
        labels.set(
          a.htmlFor,
          n.children
            .map((x) => x.getText(ast))
            .join("")
            .trim(),
        );
    }
    if (ts.isJsxSelfClosingElement(n) && ["Input", "textarea"].includes(n.tagName.getText(ast)))
      fields.set(attrs(n).id, attrs(n));
    ts.forEachChild(n, visit);
  };
  visit(ast);
  for (const [id, label] of [
    ["settings-preferred-name", "Preferred name"],
    ["settings-extra-facts", "Anything KovaGPT should know about you"],
    ["settings-custom-instructions", "Custom instructions"],
  ]) {
    assert.equal(labels.get(id), label);
    assert.ok(fields.has(id));
  }
  assert.equal(fields.get("settings-preferred-name").className, "kova-personalization-name");
});
test("Only the two existing Help links opt in to phone sizing; destinations/close callbacks preserved", () => {
  const matches = [];
  const visit = (n) => {
    if (
      ts.isJsxElement(n) &&
      n.openingElement.tagName.getText(ast) === "Button" &&
      attrs(n.openingElement).className === "kova-settings-support-link"
    )
      matches.push(n);
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.equal(matches.length, 2);
  for (const node of matches) {
    assert.equal(attrs(node.openingElement).asChild, true);
    const link = node.children.find(ts.isJsxElement);
    assert.equal(attrs(link.openingElement).to, "/help");
    assert.match(attrs(link.openingElement).onClick, /onOpenChange\(false\)/);
  }
});
const personality = readFileSync("src/components/PersonalitySliders.tsx", "utf8"),
  pa = ts.createSourceFile(
    "personality.tsx",
    personality,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
let traits, renderTrait;
const find = (n) => {
  if (ts.isVariableDeclaration(n) && n.name.getText(pa) === "TRAITS") traits = n.initializer;
  if (ts.isCallExpression(n) && n.expression.getText(pa) === "TRAITS.map")
    renderTrait = n.arguments[0];
  ts.forEachChild(n, find);
};
find(pa);
const evaluate = (n, g = {}) =>
  vm.runInNewContext(
    ts.transpileModule("(" + n.getText(pa) + ")", {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        jsxFactory: "createElement",
      },
    }).outputText,
    {
      ...g,
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    },
  );
const slider = () =>
  loadUiModule("src/components/ui/slider.tsx", {
    react: { forwardRef: (fn) => fn },
    "@radix-ui/react-slider": { Root: "Root", Track: "Track", Range: "Range", Thumb: "Thumb" },
    "@/lib/utils": { cn: (...xs) => xs.filter(Boolean).join(" ") },
  }).Slider;
test("All ten trait names reach actual interactive thumbs; values/range/change mapping stay intact", () => {
  const list = evaluate(traits),
    updates = [],
    values = Object.fromEntries(list.map((t, i) => [t.key, i + 1])),
    render = evaluate(renderTrait, {
      Slider: "Slider",
      visibleValues: values,
      update: (...args) => updates.push(args),
    }),
    Slider = slider(),
    labels = [];
  for (const t of list) {
    const tree = render(t),
      props = elements(tree, (n) => n.type === "Slider")[0].props;
    assert.equal(props.thumbLabel, t.label);
    assert.equal(props.touchTarget, true);
    assert.deepEqual(Array.from(props.value), [values[t.key]]);
    assert.equal(props.min, 1);
    assert.equal(props.max, 10);
    assert.equal(props.step, 1);
    const root = Slider(props, null),
      thumb = elements(root, (n) => n.type === "Thumb")[0];
    labels.push(thumb.props["aria-label"]);
    assert.equal(root.props.onValueChange, props.onValueChange);
    root.props.onValueChange([7]);
    assert.deepEqual(updates.at(-1), [t.key, 7]);
    assert.match(root.props.className, /kova-touch-slider/);
  }
  assert.equal(labels.length, 10);
  assert.equal(new Set(labels).size, 10);
});
test("Shared slider retains default consumer geometry and does not leak custom props to its root", () => {
  const Slider = slider(),
    root = Slider({ value: [3], thumbLabel: "Example" }, null);
  assert.doesNotMatch(root.props.className, /kova-touch-slider/);
  assert.equal(root.props.thumbLabel, undefined);
  assert.equal(root.props.touchTarget, undefined);
  assert.deepEqual(root.props.value, [3]);
});
test("Personality loading, persistence, privacy and update logic before rendering are byte-identical", () => {
  const before = execFileSync("git", ["show", base + ":src/components/PersonalitySliders.tsx"], {
      encoding: "utf8",
    }),
    boundary = '  return (\n    <div className="relative rounded-2xl';
  assert.equal(personality.split(boundary)[0], before.split(boundary)[0]);
  assert.ok(personality.includes(boundary));
});
