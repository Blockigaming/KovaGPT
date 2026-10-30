import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const parsed = ts.createSourceFile(
  "settings.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
function handler(attribute, marker) {
  const matches = nodes.filter(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === attribute &&
      node.getText(parsed).includes(marker),
  );
  assert.equal(matches.length, 1);
  return matches[0].initializer.expression.getText(parsed);
}
function compile(code, dependencies) {
  return new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(dependencies));
}

function fixture() {
  const focused = [];
  const attempts = [];
  const document = { activeElement: null };
  class HTMLElement {
    constructor(name, parent = null) {
      this.name = name;
      this.parent = parent;
      this.isConnected = true;
      this.hasLayout = true;
      this.disabled = false;
      this.inert = false;
      this.ariaHidden = false;
      this.hidden = false;
      this.visibility = "visible";
      this.acceptsFocus = true;
    }
    getClientRects() {
      return this.hasLayout ? [{}] : [];
    }
    closest() {
      for (let node = this; node; node = node.parent)
        if (node.inert || node.ariaHidden || node.hidden) return node;
      return null;
    }
    contains(target) {
      for (let node = target; node; node = node.parent) if (node === this) return true;
      return false;
    }
    matches(selector) {
      assert.equal(selector, ":disabled");
      return this.disabled;
    }
    focus(options) {
      attempts.push(this.name);
      if (
        !this.isConnected ||
        !this.hasLayout ||
        this.closest() ||
        this.disabled ||
        this.visibility !== "visible" ||
        !this.acceptsFocus
      )
        return;
      document.activeElement = this;
      focused.push([this.name, options]);
    }
  }
  const target = (name, parent) => new HTMLElement(name, parent);
  document.body = target("body");
  document.documentElement = target("html");
  const drawer = target("drawer");
  const opener = target("Settings", drawer);
  const menu = target("Open menu");
  const surface = target("Settings dialog");
  const state = {
    activeModal: null,
    account: null,
    menu,
    toggleSidebar: null,
    openSidebar: null,
    mobileHome: false,
    tab: "general",
    focusRequest: 0,
  };
  document.activeElement = opener;
  document.querySelector = (selector) => {
    if (selector === '[aria-label="Open menu"]') return state.menu;
    if (selector === '[aria-label="Account menu"]') return state.account;
    if (selector === '[aria-label="Toggle sidebar"]') return state.toggleSidebar;
    if (selector === '[aria-label="Open sidebar"]') return state.openSidebar;
    assert.equal(selector, '[aria-modal="true"]:not([data-state="closed"]), dialog[open]');
    return state.activeModal;
  };
  const window = {
    location: { href: "https://local.invalid/scheduled-tasks" },
    getComputedStyle: (element) => ({ visibility: element.visibility }),
  };
  const returnFocusRef = { current: null };
  const returnFocusContextRef = { current: null };
  const currentAuthUserKeyRef = { current: "free-account" };
  const pendingMobileFocusRef = { current: null };
  const dependencies = {
    page: false,
    document,
    window,
    HTMLElement,
    returnFocusRef,
    returnFocusContextRef,
    currentAuthUserKeyRef,
    pendingMobileFocusRef,
    setMobileHome: (value) => (state.mobileHome = value),
    setTab: (value) => (state.tab = value),
    setSettingsQuery() {},
    setMobileFocusRequest: (fn) => (state.focusRequest = fn(state.focusRequest)),
  };
  const closeHandler = compile(
    `return (${handler("onCloseAutoFocus", "returnFocusContextRef")});`,
    dependencies,
  );
  const selectTab = nodes.find(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === "selectTab",
  );
  assert.ok(selectTab);
  return {
    ...dependencies,
    target,
    drawer,
    opener,
    menu,
    surface,
    state,
    focused,
    attempts,
    open(returnFocusTarget = opener) {
      compile(`return (${handler("onOpenAutoFocus", "returnFocusContextRef")});`, {
        ...dependencies,
        returnFocusTarget,
      })();
      document.activeElement = target("Settings heading", surface);
    },
    back: compile(
      `return (${handler("onClick", 'pendingMobileFocusRef.current = "navigation"')});`,
      dependencies,
    ),
    selectTab: compile(`return (${selectTab.initializer.getText(parsed)});`, dependencies),
    close() {
      let prevented = false;
      closeHandler({
        target: surface,
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true, "Radix must not restore an inaccessible drawer button");
    },
    dismiss() {
      surface.isConnected = false;
      document.activeElement = document.body;
      this.close();
    },
  };
}

test("mobile Settings → Back → Subscriptions dismissal restores Open menu after the drawer closes", () => {
  const f = fixture();
  f.open();
  f.drawer.inert = true;
  f.drawer.ariaHidden = true;
  assert.equal(f.opener.isConnected, true);
  assert.equal(f.opener.getClientRects().length, 1, "offscreen drawer buttons retain rectangles");
  f.back();
  assert.equal(f.state.mobileHome, true);
  f.selectTab("billing");
  assert.equal(f.state.tab, "billing");
  assert.equal(f.state.mobileHome, false);
  assert.equal(f.returnFocusRef.current, f.opener, "section navigation preserves the opener");
  f.dismiss();
  assert.equal(f.document.activeElement, f.menu);
  assert.deepEqual(f.attempts, ["Open menu"]);
  assert.deepEqual(f.focused, [["Open menu", { preventScroll: true }]]);
});

test("desktop and other still-visible Settings invokers regain focus exactly", () => {
  for (const name of ["Settings", "Thinking upgrade", "Account menu"])
    for (const removed of [false, true]) {
      const f = fixture();
      const opener = f.target(name);
      f.open(opener);
      if (removed) f.dismiss();
      else f.close();
      assert.equal(f.document.activeElement, opener);
      assert.deepEqual(f.focused, [[name, { preventScroll: true }]]);
      assert.equal(f.returnFocusRef.current, null);
      assert.equal(f.returnFocusContextRef.current, null);
      f.close();
      assert.equal(f.focused.length, 1, "a stale duplicate callback cannot restore focus again");
    }
});

test("invalid original invokers fall back to a visible, enabled mobile menu button", () => {
  const changes = [
    (f) => (f.opener.isConnected = false),
    (f) => (f.opener.hasLayout = false),
    (f) => (f.drawer.inert = true),
    (f) => (f.drawer.ariaHidden = true),
    (f) => (f.drawer.hidden = true),
    (f) => (f.opener.disabled = true),
    (f) => (f.opener.visibility = "hidden"),
    (f) => (f.opener.visibility = "collapse"),
    (f) => (f.opener.acceptsFocus = false),
    (f) => (f.returnFocusRef.current = f.document.body),
    (f) => (f.returnFocusRef.current = f.document.documentElement),
  ];
  for (const change of changes) {
    const f = fixture();
    f.open();
    change(f);
    f.dismiss();
    assert.equal(f.document.activeElement, f.menu);
    assert.deepEqual(f.focused, [["Open menu", { preventScroll: true }]]);
  }
});

test("Settings never forces focus onto an unavailable mobile fallback", () => {
  const changes = [
    (f) => (f.state.menu = null),
    (f) => (f.menu.isConnected = false),
    (f) => (f.menu.hasLayout = false),
    (f) => (f.menu.inert = true),
    (f) => (f.menu.ariaHidden = true),
    (f) => (f.menu.hidden = true),
    (f) => (f.menu.disabled = true),
    (f) => (f.menu.visibility = "hidden"),
  ];
  for (const change of changes) {
    const f = fixture();
    f.open();
    f.drawer.inert = true;
    change(f);
    f.dismiss();
    assert.deepEqual(f.attempts, []);
    assert.deepEqual(f.focused, []);
  }
});

test("navigation, account changes, other modals, and later interaction retain their own focus", () => {
  const changes = [
    (f) => (f.window.location.href = "https://local.invalid/library"),
    (f) => (f.window.location.href += "#support"),
    (f) => (f.currentAuthUserKeyRef.current = "another-account"),
    (f) => (f.currentAuthUserKeyRef.current = undefined),
    (f) => (f.state.activeModal = f.target("Other dialog")),
    (f) => (f.document.activeElement = f.target("Later interaction")),
    (f) => (f.document.activeElement = f.target("Other modal input", f.target("Other dialog"))),
  ];
  for (const change of changes) {
    const f = fixture();
    f.open();
    f.drawer.inert = true;
    f.document.activeElement = f.document.body;
    change(f);
    const active = f.document.activeElement;
    f.close();
    assert.equal(f.document.activeElement, active);
    assert.deepEqual(f.attempts, []);
    assert.deepEqual(f.focused, []);
  }
});

test("each opening captures its current invoker and URL, including callers without an explicit target", () => {
  const f = fixture();
  f.open();
  f.dismiss();
  const next = f.target("Next Settings invoker");
  f.window.location.href = "https://local.invalid/images";
  f.document.activeElement = next;
  f.open(null);
  assert.equal(f.returnFocusRef.current, next);
  assert.equal(f.returnFocusContextRef.current.url, f.window.location.href);
  f.dismiss();
  assert.deepEqual(f.focused, [
    ["Settings", { preventScroll: true }],
    ["Next Settings invoker", { preventScroll: true }],
  ]);
});

test("desktop Settings restores the Account menu after its opening item unmounts", () => {
  const f = fixture();
  const account = f.target("Account menu");
  f.state.account = account;
  f.state.menu = null;
  f.open();
  f.opener.isConnected = false;
  f.dismiss();
  assert.equal(f.document.activeElement, account);
  assert.deepEqual(f.focused, [["Account menu", { preventScroll: true }]]);
});

test("an unavailable desktop Account menu obeys the existing mobile fallback guards", () => {
  for (const property of ["isConnected", "hasLayout", "acceptsFocus"]) {
    const f = fixture();
    const account = f.target("Account menu");
    f.state.account = account;
    account[property] = false;
    f.open();
    f.opener.isConnected = false;
    f.dismiss();
    assert.equal(f.document.activeElement, f.menu);
    assert.deepEqual(f.focused, [["Open menu", { preventScroll: true }]]);
  }
});

test("Images Settings restores its visible Toggle sidebar after the mobile drawer closes", () => {
  const f = fixture();
  f.window.location.href = "https://local.invalid/images";
  f.state.menu = null;
  f.state.toggleSidebar = f.target("Toggle sidebar");
  f.open();
  f.drawer.inert = true;
  f.drawer.ariaHidden = true;
  f.dismiss();
  assert.equal(f.document.activeElement, f.state.toggleSidebar);
  assert.deepEqual(f.focused, [["Toggle sidebar", { preventScroll: true }]]);
});

test("known sidebar fallbacks retain Account, Open menu, Toggle sidebar, Open sidebar order", () => {
  for (const expected of ["Account menu", "Open menu", "Toggle sidebar", "Open sidebar"]) {
    const f = fixture();
    f.state.account = f.target("Account menu");
    f.state.toggleSidebar = f.target("Toggle sidebar");
    f.state.openSidebar = f.target("Open sidebar");
    const fallbacks = [f.state.account, f.state.menu, f.state.toggleSidebar, f.state.openSidebar];
    for (const target of fallbacks.slice(
      0,
      fallbacks.findIndex((item) => item.name === expected),
    ))
      target.hasLayout = false;
    f.open();
    f.opener.isConnected = false;
    f.dismiss();
    assert.deepEqual(f.focused, [[expected, { preventScroll: true }]]);
    assert.deepEqual(f.attempts, [expected]);
  }
});

test("Images sidebar fallbacks keep all visibility, ownership and later-focus guards", () => {
  for (const name of ["toggleSidebar", "openSidebar"]) {
    for (const change of [
      (f, target) => (target.isConnected = false),
      (f, target) => (target.hasLayout = false),
      (f, target) => (target.inert = true),
      (f, target) => (target.ariaHidden = true),
      (f, target) => (target.hidden = true),
      (f, target) => (target.disabled = true),
      (f, target) => (target.visibility = "hidden"),
      (f) => (f.window.location.href = "https://local.invalid/library"),
      (f) => (f.currentAuthUserKeyRef.current = "another-account"),
      (f) => (f.state.activeModal = f.target("Another dialog")),
      (f) => (f.document.activeElement = f.target("Later interaction")),
    ]) {
      const f = fixture();
      f.window.location.href = "https://local.invalid/images";
      f.state.menu = null;
      const target = f.target(name === "toggleSidebar" ? "Toggle sidebar" : "Open sidebar");
      f.state[name] = target;
      f.open();
      f.opener.isConnected = false;
      f.surface.isConnected = false;
      f.document.activeElement = f.document.body;
      change(f, target);
      const active = f.document.activeElement;
      f.close();
      assert.equal(f.document.activeElement, active);
      assert.deepEqual(f.focused, []);
    }
  }
});
