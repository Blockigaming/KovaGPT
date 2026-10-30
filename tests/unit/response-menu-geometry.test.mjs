import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const source = read("src/components/ChatMessage.tsx");
const parsed = ts.createSourceFile(
  "ChatMessage.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const response = postcss.parse(read("src/components/response-action-refinement.css"));
const shared = postcss.parse(read("src/styles/spec400-system.css"));
const primitive = read("src/components/ui/dropdown-menu.tsx");
function rule(sheet, selector) {
  const matches = [];
  sheet.walkRules(selector, (node) => matches.push(node));
  assert.equal(matches.length, 1, `Exactly one rule must own ${selector}`);
  return matches[0];
}
function value(rule, property) {
  const matches = rule.nodes.filter((node) => node.prop === property);
  assert.equal(matches.length, 1);
  return matches[0].value;
}
const menu = rule(response, 'body .kova-response-menu[role="menu"]');
const defaultCap = primitive
  .match(/max-h-\[([^\]]+)\]/)?.[1]
  .replaceAll("var(--kova-overlay-vh)", "100dvh")
  .replaceAll("-1rem", " - 16px");
assert.ok(defaultCap, "The shared primitive owns a measured viewport-bounded cap");

// Source-level cascade and length arithmetic only. Native Popper placement,
// wheel/touch scrolling and keyboard reachability remain browser review work.
function argumentsOf(input) {
  const parts = [];
  let start = 0,
    depth = 0;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "(") depth++;
    if (input[i] === ")") depth--;
    if (depth === 0 && input[i] === ",") {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  return [...parts, input.slice(start).trim()];
}
function length(expression, viewportHeight, availableHeight, popoverHeight) {
  expression = expression.trim();
  const fn = expression.match(/^(var|calc|min)\(([\s\S]*)\)$/);
  if (fn) {
    const args = argumentsOf(fn[2]);
    if (fn[1] === "var") {
      assert.ok(
        [
          "--radix-dropdown-menu-content-available-height",
          "--radix-popover-content-available-height",
        ].includes(args[0]),
      );
      const measured =
        args[0] === "--radix-dropdown-menu-content-available-height"
          ? availableHeight
          : popoverHeight;
      return measured ?? length(args[1], viewportHeight, availableHeight, popoverHeight);
    }
    if (fn[1] === "min")
      return Math.min(
        ...args.map((arg) => length(arg, viewportHeight, availableHeight, popoverHeight)),
      );
    const difference = fn[2].split(" - ");
    assert.equal(difference.length, 2);
    return (
      length(difference[0], viewportHeight, availableHeight, popoverHeight) -
      length(difference[1], viewportHeight, availableHeight, popoverHeight)
    );
  }
  const literal = expression.match(/^(\d+)(px|dvh)$/);
  assert.ok(literal, `Unsupported source length ${expression}`);
  return Number(literal[1]) * (literal[2] === "dvh" ? viewportHeight / 100 : 1);
}

test("only response More receives the contained menu scope and retains its deliberate draft/focus handlers", () => {
  const contents = [];
  const visit = (node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(parsed) === "DropdownMenuContent"
    )
      contents.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const target = contents.filter((node) =>
    node.openingElement.getText(parsed).includes("kova-response-menu"),
  );
  assert.equal(target.length, 1);
  const menuSource = target[0].getText(parsed);
  assert.match(menuSource, /className="kova-response-menu w-60"/);
  assert.match(menuSource, /onDraftPrompt\(/);
  assert.match(menuSource, /responseDraftFocusRef.current/);
  assert.match(menuSource, /<DropdownMenuItem onSelect=\{onRetry\}>/);
  assert.match(menuSource, /Adds to your draft\. Send when ready\./);
  assert.doesNotMatch(
    target[0].openingElement.getText(parsed),
    /onKeyDown|onWheel|onTouch|avoidCollisions=\{false\}/,
  );
  assert.doesNotMatch(read("src/components/ui/dropdown-menu.tsx"), /kova-response-menu/);
});

test("the shared primitive owns ordinary menu bounds without a global role override", () => {
  assert.equal(menu.parent.type, "root");
  let globalRoleOverrides = 0;
  shared.walkRules((node) => {
    if (node.selector === 'body [role="menu"]') globalRoleOverrides++;
  });
  assert.equal(globalRoleOverrides, 0);
  assert.equal(length(defaultCap, 390, 173), 173);
  assert.equal(length(defaultCap, 390), 374);
  assert.ok(primitive.includes("supports-[height:100dvh]:[--kova-overlay-vh:100dvh]"));
  assert.ok(primitive.includes("overflow-y-auto overflow-x-hidden overscroll-contain"));
  assert.equal(
    menu.nodes.some((node) => node.important),
    false,
  );
  assert.match(value(menu, "max-height"), /--radix-dropdown-menu-content-available-height/);
});

test("1180×768 upward placement caps its border box to trigger-side space instead of the whole viewport", () => {
  const viewportHeight = 768;
  const availableHeight = 590; // Synthetic trigger-side space, not a native measurement.
  const scoped = length(value(menu, "max-height"), viewportHeight, availableHeight);
  const sharedCap = length(defaultCap, viewportHeight, availableHeight);
  assert.equal(scoped, 590);
  assert.equal(sharedCap, 590);
  assert.equal(value(menu, "box-sizing"), "border-box");
  assert.equal(value(menu, "overflow-y"), "auto");
  assert.equal(value(menu, "overflow-x"), "hidden");
  assert.equal(value(menu, "overscroll-behavior"), "contain");
  assert.ok(880 > scoped, "Long action lists scroll inside the bounded surface");
});

test("short upward/downward space and dynamic viewport changes retain the smaller bound", () => {
  for (const height of [320, 540, 768, 900]) {
    for (const available of [60, 160, 590, 1200, undefined]) {
      for (const [expression, gutter] of [
        [value(menu, "max-height"), 24],
        [defaultCap, 16],
      ]) {
        const actual = length(expression, height, available);
        assert.equal(actual, Math.min(available ?? height, height - gutter));
        assert.ok(actual <= height - gutter);
        if (available !== undefined) assert.ok(actual <= available);
      }
    }
  }
});
