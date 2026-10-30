import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function actualEffect(path, marker) {
  const parsed = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(parsed) === "useEffect" &&
      node.arguments[0]?.getText(parsed).includes(marker)
    )
      found = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(found, "Expected actual registered keyboard effect");
  return ts.transpileModule(`globalThis.runEffect = ${found.getText(parsed)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const routeEffect = actualEffect(
  "src/routes/index.tsx",
  'window.addEventListener("keydown", onKeyDown)',
);
const sidebarEffect = actualEffect("src/components/Sidebar.tsx", "const escape =");

// Execute the real registered effects in native event-phase order. The fixture
// supplies event delivery and DOM focus only, not copies of their handler logic.
function fixture(commandOpen) {
  const windowListeners = [],
    documentListeners = [];
  const state = {
    closed: 0,
    opened: 0,
    newChats: 0,
    sidebarToggles: 0,
    sidebarFocus: 0,
    overlayKeys: 0,
  };
  class Element {
    constructor(overlay = false) {
      this.overlay = overlay;
    }
    closest(selector) {
      const matches =
        this.overlay === "native-dialog"
          ? selector.split(",").some((item) => item.trim() === "dialog")
          : this.overlay && selector.includes(`[role="${this.overlay}"]`);
      return matches ? this : null;
    }
  }
  const composer = new Element();
  const document = {
    activeElement: composer,
    addEventListener(_type, handler) {
      documentListeners.push(handler);
    },
    removeEventListener(_type, handler) {
      documentListeners.splice(documentListeners.indexOf(handler), 1);
    },
  };
  const window = {
    addEventListener(_type, handler, capture = false) {
      windowListeners.push({ handler, capture });
    },
    removeEventListener(_type, handler, capture = false) {
      const index = windowListeners.findIndex(
        (item) => item.handler === handler && item.capture === capture,
      );
      windowListeners.splice(index, 1);
    },
  };
  const context = {
    Element,
    document,
    window,
    commandOpen,
    open: true,
    mobileViewport: false,
    signedIn: true,
    setCommandOpen(value) {
      assert.equal(value, false);
      state.closed++;
    },
    openCommandPalette() {
      state.opened++;
    },
    startNewChat() {
      state.newChats++;
    },
    swipeToggleRef: {
      current() {
        state.sidebarToggles++;
      },
    },
    expandButtonRef: {
      current: {
        focus() {
          state.sidebarFocus++;
          document.activeElement = "Expand sidebar";
        },
      },
    },
    requestAnimationFrame(callback) {
      callback();
    },
  };
  vm.runInNewContext(routeEffect, context);
  const routeCleanup = context.runEffect();
  vm.runInNewContext(sidebarEffect, context);
  const sidebarCleanup = context.runEffect();
  return {
    state,
    composer,
    document,
    windowListeners,
    documentListeners,
    key(options = {}) {
      const event = {
        key: "Escape",
        keyCode: 27,
        isComposing: false,
        defaultPrevented: false,
        target: composer,
        stopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.stopped = true;
        },
        ...options,
      };
      for (const { handler } of windowListeners.filter((item) => item.capture)) handler(event);
      // Real menu/dialog primitives consume their own Escape at the target.
      if (!event.stopped && event.target.overlay) {
        state.overlayKeys++;
        event.preventDefault();
      }
      if (!event.stopped) for (const handler of documentListeners) handler(event);
      if (!event.stopped)
        for (const { handler } of windowListeners.filter((item) => !item.capture)) handler(event);
      return event;
    },
    overlay(role) {
      return new Element(role);
    },
    cleanup() {
      routeCleanup();
      sidebarCleanup();
    },
  };
}

test("pending palette Escape cancels before the real Sidebar listener and retains composer focus", () => {
  const f = fixture(true);
  const event = f.key();
  assert.equal(f.state.closed, 1);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
  assert.equal(f.state.sidebarToggles, 0);
  assert.equal(f.state.sidebarFocus, 0);
  assert.equal(f.document.activeElement, f.composer);
});
test("ordinary Sidebar Escape retains its original close and focus behavior", () => {
  const f = fixture(false);
  f.key();
  assert.equal(f.state.closed, 0);
  assert.equal(f.state.sidebarToggles, 1);
  assert.equal(f.state.sidebarFocus, 1);
});
for (const role of ["menu", "dialog", "alertdialog", "native-dialog"]) {
  test(`mounted ${role} handling retains ownership of Escape`, () => {
    const f = fixture(true);
    const event = f.key({ target: f.overlay(role) });
    assert.equal(f.state.closed, 0);
    assert.equal(f.state.sidebarToggles, 0);
    assert.equal(f.state.overlayKeys, 1);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, false);
  });
}
for (const options of [
  { defaultPrevented: true },
  { isComposing: true },
  { keyCode: 229 },
  { key: "Enter" },
]) {
  test(`pending palette cancellation respects ${JSON.stringify(options)}`, () => {
    const f = fixture(true);
    const event = f.key(options);
    assert.equal(f.state.closed, 0);
    assert.equal(event.stopped, false);
  });
}
test("public Ctrl+K remains available and both registered phases clean up", () => {
  const f = fixture(false);
  f.key({ key: "k", ctrlKey: true });
  assert.equal(f.state.opened, 1);
  f.cleanup();
  assert.equal(f.windowListeners.length, 0);
  assert.equal(f.documentListeners.length, 0);
});

test("New chat keyboard shortcuts invoke the navigation-aware user action once", () => {
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const f = fixture(false);
    const event = f.key({ key: "o", shiftKey: true, [modifier]: true });
    assert.equal(f.state.newChats, 1);
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.state.sidebarToggles, 0);
  }
});
