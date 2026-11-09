import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

// Execute the actual route and filter. Browser tests separately prove DOM focus,
// keyboard order, accessibility semantics, responsive layout, and real routing.
const academy = loadUiModule("src/lib/public-academy-content.ts", {});

function fixture() {
  const hooks = createHookHarness();
  let focusCount = 0;
  const { Route } = loadUiModule("src/routes/academy.tsx", {
    react: hooks.react,
    "@tanstack/react-router": { createFileRoute: () => (options) => options, Link: "Link" },
    "lucide-react": { ArrowRight: "ArrowRight", Search: "Search", X: "X" },
    "@/components/public/PublicSite": { PublicPageView: "PublicPageView" },
    "@/components/ui/button": { Button: "Button" },
    "@/components/ui/input": { Input: "Input" },
    "@/lib/public-academy-content": academy,
  });
  const render = () => hooks.render(Route.component);
  const input = (tree) => elements(tree, (node) => node.type === "Input")[0];
  const links = (tree) => elements(tree, (node) => node.type === "Link");
  const initial = render();
  input(initial).props.ref.current = { focus: () => focusCount++ };
  return { render, input, links, focusCount: () => focusCount };
}

test("the route filters guide links, announces counts, and preserves input focus while typing", () => {
  const f = fixture();
  let tree = f.render();
  assert.equal(f.links(tree).length, 37);
  f.input(tree).props.onChange({ target: { value: "  mental MODEL  " } });
  tree = f.render();
  assert.equal(f.input(tree).props.value, "  mental MODEL  ");
  assert.deepEqual(
    f.links(tree).map((node) => node.props.to),
    ["/academy/ai-fundamentals"],
  );
  const status = elements(tree, (node) => node.props.role === "status")[0];
  assert.match(text(status), /1\s+guide\s+found/);
  assert.equal(f.focusCount(), 0);
});

test("empty results can be cleared through either action, restoring all guides and search focus", () => {
  for (const label of ["Clear Academy search", "Clear search"]) {
    const f = fixture();
    f.input(f.render()).props.onChange({ target: { value: "no-such-guide-zzzz" } });
    let tree = f.render();
    assert.equal(f.links(tree).length, 0);
    assert.match(text(tree), /No guides found/);
    assert.match(
      text(elements(tree, (node) => node.props.role === "status")[0]),
      /0\s+guides\s+found/,
    );
    const clear = elements(
      tree,
      (node) => node.type === "Button" && (node.props["aria-label"] ?? text(node)) === label,
    )[0];
    clear.props.onClick();
    tree = f.render();
    assert.equal(f.input(tree).props.value, "");
    assert.equal(f.links(tree).length, 37);
    assert.doesNotMatch(text(tree), /No guides found/);
    assert.equal(f.focusCount(), 1);
  }
});

test("Escape clears a nonempty filter locally; composition and other keys remain untouched", () => {
  const f = fixture();
  f.input(f.render()).props.onChange({ target: { value: "brainstorm" } });
  let intercepted = 0;
  const key = (value, isComposing = false) => ({
    key: value,
    nativeEvent: { isComposing },
    preventDefault: () => intercepted++,
    stopPropagation: () => intercepted++,
  });
  f.input(f.render()).props.onKeyDown(key("Escape", true));
  f.input(f.render()).props.onKeyDown(key("Tab"));
  assert.equal(f.input(f.render()).props.value, "brainstorm");
  assert.equal(intercepted, 0);
  f.input(f.render()).props.onKeyDown(key("Escape"));
  assert.equal(f.input(f.render()).props.value, "");
  assert.equal(intercepted, 2);
  assert.equal(f.focusCount(), 1);
  f.input(f.render()).props.onKeyDown(key("Escape"));
  assert.equal(intercepted, 2);
});

test("submitting the inline search does not reload or navigate away from the route", () => {
  const f = fixture();
  let prevented = false;
  elements(f.render(), (node) => node.props.role === "search")[0].props.onSubmit({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
});
