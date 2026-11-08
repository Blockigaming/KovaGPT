import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isClearSidebarSwipe } from "../../src/lib/sidebar-swipe.mjs";

const source = readFileSync("src/components/Sidebar.tsx", "utf8");
const file = ts.createSourceFile(
  "Sidebar.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let effect;
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(file) === "useEffect" &&
    node.arguments[0]?.getText(file).includes('document.addEventListener("touchstart", start')
  )
    effect = node.arguments[0].getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(effect, "Run the actual drawer opening gesture effect");
const compiled = ts.transpileModule(`return (${effect})();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const listeners = new Map();
  let toggles = 0,
    selected = false,
    modal = false;
  class Element {
    parentElement = null;
    scrollWidth = 100;
    clientWidth = 100;
    overflowX = "visible";
    editable = false;
    closest(selector) {
      return selector === ".kova-assistant, .kova-app-shell" || this.editable ? this : null;
    }
  }
  const target = new Element();
  const cleanup = new Function(
    "open",
    "document",
    "window",
    "Element",
    "isMobileViewport",
    "getComputedStyle",
    "swipeToggleRef",
    "isClearSidebarSwipe",
    compiled,
  )(
    false,
    {
      querySelector: () => (modal ? target : null),
      addEventListener(name, callback, options) {
        if (name === "touchstart" || name === "touchmove") assert.equal(options.passive, true);
        listeners.set(name, callback);
      },
      removeEventListener(name, callback) {
        if (listeners.get(name) === callback) listeners.delete(name);
      },
    },
    { getSelection: () => ({ isCollapsed: !selected }) },
    Element,
    () => true,
    (el) => ({ overflowX: el.overflowX }),
    { current: () => toggles++ },
    isClearSidebarSwipe,
  );
  return {
    target,
    cleanup,
    listeners,
    toggles: () => toggles,
    select: (value) => {
      selected = value;
    },
    showModal: (value) => {
      modal = value;
    },
    dispatch(name, { x = 12, y = 100, time = 0, count = 1 } = {}) {
      listeners.get(name)?.({
        target,
        timeStamp: time,
        touches: Array.from({ length: count }, (_, identifier) => ({
          identifier,
          clientX: x,
          clientY: y,
        })),
      });
    },
  };
}

test("deliberate opening swipe toggles once and cleans up passive listeners", () => {
  const f = fixture();
  f.dispatch("touchstart");
  f.dispatch("touchmove", { x: 122, time: 100 });
  f.dispatch("touchmove", { x: 132, time: 120 });
  assert.equal(f.toggles(), 1);
  f.cleanup();
  assert.equal(f.listeners.size, 0);
});

for (const interruption of ["selection", "modal"]) {
  test(`opening swipe cancels when ${interruption} starts during the gesture`, () => {
    const f = fixture();
    f.dispatch("touchstart");
    const interrupt = interruption === "selection" ? f.select : f.showModal;
    interrupt(true);
    f.dispatch("touchmove", { x: 122, time: 100 });
    interrupt(false);
    f.dispatch("touchmove", { x: 142, time: 150 });
    assert.equal(f.toggles(), 0);
    f.cleanup();
  });
}

for (const interruption of [
  "vertical scroll",
  "horizontal scroll",
  "editable",
  "multiple touches",
  "cancelled",
]) {
  test(`opening swipe leaves ${interruption} alone`, () => {
    const f = fixture();
    if (interruption === "horizontal scroll") {
      f.target.scrollWidth = 500;
      f.target.overflowX = "auto";
    }
    if (interruption === "editable") f.target.editable = true;
    f.dispatch("touchstart");
    if (interruption === "vertical scroll") f.dispatch("touchmove", { x: 17, y: 160, time: 30 });
    if (interruption === "multiple touches") f.dispatch("touchmove", { count: 2, time: 30 });
    if (interruption === "cancelled") f.dispatch("touchcancel");
    f.dispatch("touchmove", { x: 122, time: 100 });
    assert.equal(f.toggles(), 0);
    f.cleanup();
  });
}

test("opening gesture must begin at the screen edge", () => {
  const f = fixture();
  f.dispatch("touchstart", { x: 100 });
  f.dispatch("touchmove", { x: 220, time: 100 });
  assert.equal(f.toggles(), 0);
  f.cleanup();
});
