import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/components/Sidebar.tsx", "utf8");
const file = ts.createSourceFile(
  "Sidebar.tsx",
  source,
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
const variable = (name) =>
  nodes
    .find((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name)
    .initializer.getText(file);
const effect = nodes
  .find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("const cancelPinFocus"),
  )
  .arguments[0].getText(file);
function compile(source, deps) {
  return new Function(
    ...Object.keys(deps),
    ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(deps));
}
function fixture() {
  const calls = [],
    frames = new Map(),
    listeners = new Map();
  let nextFrame = 0;
  const document = {
    body: null,
    activeElement: null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  class Node {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
      this.offsetParent = {};
      this.children = new Set();
    }
    contains(node) {
      return node === this || this.children.has(node);
    }
    closest(selector) {
      return selector === '[role="menu"]' ? this.menu : this.inert ? {} : null;
    }
    matches() {
      return !!this.disabled;
    }
    focus(options) {
      calls.push(["focus", this.name, options]);
      document.activeElement = this;
    }
  }
  document.body = new Node("body");
  document.activeElement = document.body;
  const menu = new Node("old menu"),
    item = new Node("Pin item"),
    old = new Node("old Actions"),
    moved = new Node("moved Actions"),
    pinned = new Node("Pinned heading"),
    recent = new Node("Recent heading");
  item.menu = menu;
  menu.children.add(item);
  const headings = new Map([
    ["#sidebar-pinned-heading", pinned],
    ["#sidebar-chats-heading", recent],
  ]);
  const registry = new Map([["chat", old]]),
    pending = { current: null },
    context = { current: "owner:loaded:signed-in:/chat:true" };
  const window = {
    location: { href: "https://fixture.invalid/chat" },
    requestAnimationFrame: (fn) => {
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  const deps = {
    window,
    document,
    Node,
    pinReturnFocusRef: pending,
    chatActionContext: context.current,
    chatActionContextRef: context,
    chatOptionsRefs: { current: registry },
    drawerRef: {
      current: {
        querySelector: (selector) =>
          headings.get(selector) ?? (selector.includes(",") ? recent : null),
      },
    },
    onTogglePin: (id) => calls.push(["toggle", id]),
  };
  const begin = compile(`return (${variable("beginPin")});`, deps),
    close = compile(`return (${variable("closePinMenu")});`, deps);
  const cleanup = compile(`return (${effect});`, deps)();
  return {
    Node,
    calls,
    frames,
    listeners,
    document,
    window,
    menu,
    item,
    old,
    moved,
    pinned,
    recent,
    headings,
    registry,
    pending,
    context,
    begin,
    close,
    cleanup,
    event() {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      return event;
    },
    flush() {
      for (const [id, fn] of [...frames]) {
        frames.delete(id);
        fn();
      }
    },
  };
}

for (const alreadyPinned of [false, true]) {
  test(`${alreadyPinned ? "Unpin" : "Pin"} resolves the remounted Actions trigger after menu closure`, () => {
    const f = fixture();
    f.document.activeElement = f.item;
    f.begin({ id: "chat", pinned: alreadyPinned }, f.item);
    assert.deepEqual(f.calls, [["toggle", "chat"]]);
    const event = f.event();
    assert.equal(f.close("chat", event), true);
    assert.equal(event.prevented, true);
    assert.equal(f.calls.length, 1, "do not focus before the menu closes and the moved row mounts");
    f.old.isConnected = false;
    f.registry.delete("chat");
    f.registry.set("chat", f.moved);
    f.document.activeElement = f.document.body;
    f.flush();
    assert.deepEqual(f.calls.at(-1), ["focus", "moved Actions", { preventScroll: true }]);
    assert.equal(f.pending.current, null);
    f.flush();
    assert.equal(f.calls.length, 2);
  });
  test(`${alreadyPinned ? "Unpin" : "Pin"} falls back to its list heading when the row is outside the visible eight`, () => {
    const f = fixture();
    f.begin({ id: "chat", pinned: alreadyPinned }, f.item);
    f.close("chat", f.event());
    f.registry.delete("chat");
    f.flush();
    assert.equal(f.calls.at(-1)[1], alreadyPinned ? "Recent heading" : "Pinned heading");
  });
}

for (const interruption of [
  "account",
  "route",
  "sidebar closed",
  "auth unresolved",
  "URL query",
  "unmount",
  "later focus",
  "pointer interaction",
]) {
  test(`queued pin restoration is suppressed after ${interruption}`, () => {
    const f = fixture();
    f.begin({ id: "chat", pinned: false }, f.item);
    f.close("chat", f.event());
    f.registry.set("chat", f.moved);
    if (["account", "route", "sidebar closed", "auth unresolved"].includes(interruption))
      f.context.current = interruption;
    if (interruption === "URL query") f.window.location.href += "?new";
    if (interruption === "unmount") f.cleanup();
    if (interruption === "later focus") f.document.activeElement = new f.Node("Other input");
    if (interruption === "pointer interaction") {
      f.listeners.get("pointerdown")({ type: "pointerdown", target: new f.Node("Other item") });
      f.document.activeElement = f.document.body;
    }
    f.flush();
    assert.deepEqual(f.calls, [["toggle", "chat"]]);
  });
}

test("ordinary and other-row menu closures keep their existing focus behavior", () => {
  const f = fixture();
  const ordinary = f.event();
  assert.equal(f.close("chat", ordinary), false);
  assert.equal(ordinary.prevented, false);
  f.begin({ id: "chat", pinned: false }, f.item);
  const other = f.event();
  assert.equal(f.close("other", other), false);
  assert.equal(other.prevented, false);
  assert.equal(f.frames.size, 0);
});

test("stale pin callbacks do not change another account and newer pin requests invalidate an older frame", () => {
  const f = fixture();
  f.context.current = "other account";
  f.begin({ id: "chat" }, f.item);
  assert.deepEqual(f.calls, []);
  f.context.current = "owner:loaded:signed-in:/chat:true";
  f.begin({ id: "chat" }, f.item);
  f.close("chat", f.event());
  f.begin({ id: "new-chat", pinned: true }, f.item);
  f.flush();
  assert.equal(f.calls.filter(([action]) => action === "focus").length, 0);
  assert.equal(f.pending.current.id, "new-chat");
});

test("hidden, inert, disabled or detached Actions use a visible heading; unavailable headings never receive focus", () => {
  for (const makeUnavailable of [
    (node) => (node.isConnected = false),
    (node) => (node.offsetParent = null),
    (node) => (node.inert = true),
    (node) => (node.disabled = true),
  ]) {
    const f = fixture();
    f.begin({ id: "chat" }, f.item);
    f.close("chat", f.event());
    makeUnavailable(f.old);
    f.flush();
    assert.equal(f.calls.at(-1)[1], "Pinned heading");
  }
  const f = fixture();
  f.begin({ id: "chat" }, f.item);
  f.close("chat", f.event());
  f.registry.delete("chat");
  f.pinned.offsetParent = null;
  f.flush();
  assert.deepEqual(f.calls, [["toggle", "chat"]]);
});

test("same-menu focus does not cancel restoration, but later focus stays authoritative even after returning to body", () => {
  const f = fixture();
  f.begin({ id: "chat" }, f.item);
  f.close("chat", f.event());
  f.listeners.get("focusin")({ type: "focusin", target: f.item });
  assert.notEqual(f.pending.current, null);
  f.listeners.get("focusin")({ type: "focusin", target: new f.Node("Later input") });
  f.document.activeElement = f.document.body;
  f.flush();
  assert.deepEqual(f.calls, [["toggle", "chat"]]);
});

test("pin recovery preserves row limits and gives both fallback headings a programmatic focus target", () => {
  assert.match(source, /pinned\.slice\(0, 8\)\.map\(chatRow\)/);
  assert.match(source, /recents\.slice\(0, 8\)\.map\(chatRow\)/);
  assert.match(source, /id="sidebar-pinned-heading" tabIndex=\{-1\}/);
  assert.match(source, /id="sidebar-chats-heading"\s+tabIndex=\{-1\}/);
  assert.match(source, /onClick=\{\(event\) => beginPin\(conversation, event.currentTarget\)\}/);
});
