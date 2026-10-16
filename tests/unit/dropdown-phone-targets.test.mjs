import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import postcss from "postcss";
import { dropdown, actionVariants, contentProps, select } from "../helpers/dropdown-fixture.mjs";
const base = "2d0d06fc6dbc3b0640b270740075a8eeb9b3fab7",
  old = (path) => execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
test("Shared dropdown only receives four sizing classes; refs, keyboard/selection callbacks, children unchanged", () => {
  const path = "src/components/ui/dropdown-menu.tsx",
    source = readFileSync(path, "utf8");
  assert.equal((source.match(/kova-dropdown-item/g) || []).length, 4);
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(compile(source.replaceAll("kova-dropdown-item ", "")), compile(old(path)));
  assert.deepEqual(
    execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        base,
        "--",
        "src/components/ui/dropdown-menu.tsx",
        "src/components/ui/select.tsx",
        "src/styles/core-system.css",
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n"),
    [path, "src/components/ui/select.tsx", "src/styles/core-system.css"],
  );
  const cssPath = "src/styles/core-system.css",
    prior = old(cssPath),
    current = readFileSync(cssPath, "utf8");
  assert.ok(current.startsWith(prior));
  const rules = [];
  postcss.parse(current.slice(prior.length)).walkRules((r) => rules.push(r));
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].selectors, [".kova-dropdown-item", ".kova-select-item"]);
  assert.equal(rules[0].parent.params, "(max-width: 767px)");
  assert.deepEqual(
    rules[0].nodes.map((d) => [d.prop, d.value]),
    [["min-height", "44px"]],
  );
});
test("Disabled/selection/inset/asChild props still reach the original Radix primitives without executing actions", () => {
  const onSelect = () => {
      throw new Error("must not execute");
    },
    onCheckedChange = onSelect;
  for (const [name] of actionVariants) {
    const tree = dropdown["DropdownMenu" + name]({
      disabled: true,
      checked: true,
      value: "existing",
      inset: true,
      asChild: true,
      onSelect,
      onCheckedChange,
      children: "Existing label",
    });
    assert.equal(tree.props.disabled, true);
    assert.equal(tree.props.asChild, true);
    assert.equal(tree.props.onSelect, onSelect);
    assert.equal(tree.props.onCheckedChange, onCheckedChange);
    assert.match(tree.props.className, /kova-dropdown-item/);
    if (name === "CheckboxItem") assert.equal(tree.props.checked, true);
  }
  for (const name of ["Label", "Separator"])
    assert.doesNotMatch(dropdown["DropdownMenu" + name]({}).props.className, /kova-dropdown-item/);
  for (const sub of [false, true]) {
    const props = contentProps(sub);
    assert.equal(props.collisionPadding, 8);
    assert.match(props.className, /overflow-y-auto/);
    assert.match(props.className, /content-available-height/);
  }
});

test("Custom Select only gains one option marker; native select and all values/handlers/viewport/scroll controls remain unchanged", () => {
  const path = "src/components/ui/select.tsx",
    source = readFileSync(path, "utf8");
  assert.equal((source.match(/kova-select-item/g) || []).length, 1);
  const compile = (s) =>
    ts.transpileModule(s, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  assert.equal(compile(source.replaceAll("kova-select-item ", "")), compile(old(path)));
  const item = select.SelectItem({
    value: "medium",
    disabled: true,
    children: "Medium - balanced",
  });
  assert.equal(item.props.value, "medium");
  assert.equal(item.props.disabled, true);
  for (const name of [
    "SelectTrigger",
    "SelectLabel",
    "SelectSeparator",
    "SelectScrollUpButton",
    "SelectScrollDownButton",
  ])
    assert.doesNotMatch(select[name]({}).props.className, /kova-select-item/);
});
