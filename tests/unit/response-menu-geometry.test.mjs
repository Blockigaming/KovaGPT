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
const ordinary = rule(shared, 'body [role="menu"]');

// Source-level cascade and length arithmetic only. Native Popper placement,
// wheel/touch scrolling and keyboard reachability remain browser review work.
function specificity(selector) {
  const ids = selector.match(/#[\w-]+/g) ?? [];
  const attributes = selector.match(/\[[^\]]+\]/g) ?? [];
  const classes = selector.match(/\.[\w-]+/g) ?? [];
  const types = selector.replace(/\[[^\]]+\]|[.#][\w-]+/g, "").match(/[a-z]+/g) ?? [];
  return ids.length * 10_000 + (attributes.length + classes.length) * 100 + types.length;
}
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

test("response max-height wins the actual unlayered shared menu cap regardless of CSS load order", () => {
  assert.equal(menu.parent.type, "root");
  assert.equal(ordinary.parent.type, "root");
  assert.equal(length(value(ordinary, "max-height"), 390, 173), 173);
  assert.equal(length(value(ordinary, "max-height"), 390, undefined, 173), 173);
  assert.equal(length(value(ordinary, "max-height"), 390), 366);
  assert.ok(specificity(menu.selector) > specificity(ordinary.selector));
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
  const sharedCap = length(value(ordinary, "max-height"), viewportHeight, availableHeight);
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
      for (const target of [menu, ordinary]) {
        const actual = length(value(target, "max-height"), height, available);
        assert.equal(actual, Math.min(available ?? height, height - 24));
        assert.ok(actual <= height - 24);
        if (available !== undefined) assert.ok(actual <= available);
      }
    }
  }
});
