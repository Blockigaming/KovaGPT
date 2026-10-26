import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/Sidebar.tsx", "utf8");
const file = ts.createSourceFile(
  "Sidebar.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let openingEffect;
const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(file) === "useEffect" &&
    node.arguments[0]?.getText(file).includes("if (!open || !mobileViewport) return;")
  )
    openingEffect = node.arguments[0].getText(file);
  ts.forEachChild(node, visit);
};
visit(file);
assert.ok(openingEffect, "Execute the actual mobile drawer effect");

function fixture({ mobile = true, open = true, visible = false, acceptsFocus = true } = {}) {
  const calls = [],
    frames = new Map(),
    listeners = new Map();
  let nextFrame = 0,
    now = 0;
  const document = {
    body: null,
    documentElement: null,
    activeElement: null,
    addEventListener(name, handler, capture = false) {
      const entries = listeners.get(name) ?? [];
      entries.push({ handler, capture });
      listeners.set(name, entries);
    },
    removeEventListener(name, handler, capture = false) {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter(
          (entry) => entry.handler !== handler || entry.capture !== capture,
        ),
      );
    },
    querySelector(selector) {
      if (selector.includes("aria-modal")) return drawer.dataset.state === "open" ? drawer : null;
      return menu;
    },
  };
  const dispatch = (name, event) => {
    for (const entry of [...(listeners.get(name) ?? [])].sort(
      (a, b) => Number(b.capture) - Number(a.capture),
    ))
      entry.handler(event);
  };
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
      this.offsetParent = {};
      this.style = {};
      this.disabled = false;
      this.inert = false;
    }
    closest(selector) {
      if (selector === "[inert]") return drawer.inert ? drawer : null;
      if (selector.includes("kova-assistant")) return root;
      if (selector.includes("role=")) return drawer.contains(this) ? drawer : null;
      return null;
    }
    focus(options) {
      calls.push(["focus", this.name, options]);
      if (this === close && (!visible || !acceptsFocus)) return;
      document.activeElement = this;
      dispatch("focusin", { target: this });
    }
  }
  document.body = new Element("body");
  document.documentElement = new Element("html");
  const menu = new Element("open menu"),
    close = new Element("close sidebar"),
    search = new Element("search"),
    last = new Element("last action");
  const content = new Element("main");
  Object.defineProperty(content, "inert", {
    get: () => Boolean(content.isInert),
    set: (value) => {
      content.isInert = value;
      if (value && document.activeElement === menu) document.activeElement = document.body;
    },
  });
  const root = { querySelector: () => content };
  const drawer = new Element("drawer");
  drawer.dataset = { state: open ? "open" : "closed" };
  drawer.querySelector = () => close;
  drawer.querySelectorAll = () => [search, close, last];
  drawer.contains = (target) => [search, close, last].includes(target);
  document.activeElement = menu;
  const dependencies = {
    open,
    mobileViewport: mobile,
    document,
    Element,
    HTMLElement: Element,
    drawerRef: { current: drawer },
    lastFocusedRef: { current: null },
    navigationOwnsFocusRef: { current: false },
    swipeToggleRef: { current: () => calls.push(["toggle"]) },
    isMobileViewport: () => mobile,
    getComputedStyle: () => ({ visibility: visible ? "visible" : "hidden" }),
    window: {
      performance: { now: () => now },
      requestAnimationFrame(callback) {
        frames.set(++nextFrame, callback);
        return nextFrame;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
    },
  };
  dependencies.requestAnimationFrame = dependencies.window.requestAnimationFrame;
  const cleanup = new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(`return (${openingEffect});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(...Object.values(dependencies))();
  return {
    calls,
    frames,
    listeners,
    document,
    menu,
    close,
    search,
    last,
    drawer,
    content,
    cleanup,
    dispatch,
    setVisible(value) {
      visible = value;
    },
    tick(ms = 16) {
      now += ms;
      for (const [id, callback] of [...frames]) {
        frames.delete(id);
        callback();
      }
    },
  };
}

test("opening drawer waits for a visible commit and then confirms close-control focus", () => {
  const f = fixture();
  assert.equal(f.content.inert, true);
  assert.equal(f.document.body.style.overflow, "hidden");
  assert.deepEqual(f.calls, [], "never focus a hidden control synchronously");
  f.tick();
  f.tick();
  assert.deepEqual(f.calls, [], "hidden opening frames do not accept focus");
  f.setVisible(true);
  f.tick();
  assert.equal(f.document.activeElement, f.close);
  assert.deepEqual(f.calls, [["focus", "close sidebar", { preventScroll: true }]]);
  assert.equal(f.frames.size, 0);
});

test("failed focus attempts remain bounded by frame and elapsed-time limits", () => {
  const f = fixture({ visible: true, acceptsFocus: false });
  for (let index = 0; index < 80; index++) f.tick(0);
  assert.equal(f.calls.length, 60);
  assert.equal(f.frames.size, 0);
  const timed = fixture({ acceptsFocus: false });
  timed.tick(501);
  assert.equal(timed.frames.size, 0);
});

test("fast close cancels pending opening focus, including an already dequeued stale callback", () => {
  const f = fixture();
  const stale = [...f.frames.values()][0];
  f.drawer.dataset.state = "closed";
  f.cleanup();
  assert.equal(f.content.inert, false);
  f.setVisible(true);
  stale();
  assert.deepEqual(f.calls, []);
  f.tick();
  assert.equal(
    f.document.activeElement,
    f.menu,
    "existing close restoration still returns to the trigger",
  );
  assert.ok(!f.calls.some((call) => call[1] === "close sidebar"));
});

for (const eventName of ["pointerdown", "focusin", "keydown"]) {
  test(`later ${eventName} cancels opening focus instead of stealing the user's next action`, () => {
    const f = fixture();
    const stale = [...f.frames.values()][0];
    f.dispatch(eventName, { target: f.search, key: "x" });
    f.setVisible(true);
    stale();
    f.tick();
    assert.ok(!f.calls.some((call) => call[1] === "close sidebar"));
  });
}

test("Tab during opening enters the drawer and keeps focus cycling inside it", () => {
  const f = fixture();
  f.setVisible(true);
  const key = (shiftKey = false) => ({
    target: f.document.activeElement,
    key: "Tab",
    shiftKey,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  });
  const first = key();
  f.dispatch("keydown", first);
  assert.equal(first.defaultPrevented, true);
  assert.equal(f.document.activeElement, f.search);
  const backwards = key(true);
  f.dispatch("keydown", backwards);
  assert.equal(f.document.activeElement, f.last);
  f.dispatch("keydown", key());
  assert.equal(f.document.activeElement, f.search);
  f.tick();
  assert.ok(!f.calls.some((call) => call[1] === "close sidebar"));
});

test("closed and desktop sidebars never schedule mobile opening focus", () => {
  for (const options of [{ open: false }, { mobile: false }]) {
    const f = fixture(options);
    assert.equal(f.cleanup, undefined);
    assert.equal(f.frames.size, 0);
    assert.equal(f.calls.length, 0);
  }
});
