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
    node.arguments[0]?.getText(file).includes('drawer.addEventListener("touchstart", onStart')
  )
    effect = node.arguments[0].getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(effect, "Run the actual drawer closing gesture effect");
const compiled = ts.transpileModule(`return (${effect})();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const listeners = new Map();
  let closed = 0,
    selected = false;
  class Element {
    parentElement = null;
    scrollWidth = 100;
    clientWidth = 100;
    overflowX = "visible";
    editable = false;
    closest() {
      return this.editable ? this : null;
    }
    addEventListener(name, callback, options) {
      if (name === "touchstart" || name === "touchmove") assert.equal(options.passive, true);
      listeners.set(name, callback);
    }
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    }
  }
  const drawer = new Element();
  const target = new Element();
  target.parentElement = drawer;
  const cleanup = new Function(
    "open",
    "drawerRef",
    "isMobileViewport",
    "Element",
    "getComputedStyle",
    "swipeToggleRef",
    "isClearSidebarSwipe",
    "window",
    compiled,
  )(
    true,
    { current: drawer },
    () => true,
    Element,
    (el) => ({ overflowX: el.overflowX }),
    { current: () => closed++ },
    isClearSidebarSwipe,
    { getSelection: () => ({ isCollapsed: !selected }) },
  );
  const dispatch = (name, { x = 200, y = 150, time = 0, count = 1 } = {}) => {
    const touches = Array.from({ length: count }, (_, id) => ({
      identifier: id,
      clientX: x,
      clientY: y,
    }));
    listeners.get(name)?.({ target, touches, timeStamp: time });
  };
  return {
    target,
    dispatch,
    cleanup,
    closed: () => closed,
    select: () => {
      selected = true;
    },
    listeners,
  };
}

test("quick deliberate right swipe closes once and removes listeners on cleanup", () => {
  const f = fixture();
  f.dispatch("touchstart");
  f.dispatch("touchmove", { x: 310, time: 100 });
  f.dispatch("touchmove", { x: 320, time: 110 });
  assert.equal(f.closed(), 1);
  f.cleanup();
  assert.equal(f.listeners.size, 0);
});

for (const scenario of [
  "selected before start",
  "selection during gesture",
  "suspended drawer",
  "long press",
  "vertical scroll",
  "horizontal scroll",
  "editable",
  "multiple touches",
  "cancelled",
]) {
  test(`drawer stays open during ${scenario}`, () => {
    const f = fixture();
    if (scenario === "selected before start") f.select();
    if (scenario === "editable") f.target.editable = true;
    if (scenario === "horizontal scroll") {
      f.target.scrollWidth = 500;
      f.target.overflowX = "auto";
    }
    f.dispatch("touchstart");
    if (scenario === "selection during gesture") f.select();
    if (scenario === "suspended drawer") f.target.parentElement.inert = true;
    if (scenario === "vertical scroll") f.dispatch("touchmove", { x: 190, y: 220, time: 50 });
    if (scenario === "multiple touches") f.dispatch("touchmove", { count: 2, time: 50 });
    if (scenario === "cancelled") f.dispatch("touchcancel");
    f.dispatch("touchmove", { x: 310, time: scenario === "long press" ? 900 : 100 });
    assert.equal(f.closed(), 0);
    f.cleanup();
  });
}
