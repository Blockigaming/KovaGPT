import assert from "node:assert/strict";
import test from "node:test";
import * as focus from "../../src/lib/drawer-navigation-focus.ts";
import { createHookHarness, elements, loadUiModule, text } from "../helpers/ui-state-harness.mjs";

// Execute the actual public click handler, root coordinator, and focus helper.
// Router lifecycle and DOM visibility are explicit fixtures, not browser proof.
function fixture(pathname = "/features") {
  let headerHooks = createHookHarness();
  const rootHooks = createHookHarness();
  const subscriptions = new Map(),
    listeners = new Map(),
    tasks = [],
    focused = [],
    requests = [];
  const router = {
    state: { location: { pathname, href: pathname }, status: "idle" },
    subscribe(name, callback) {
      subscriptions.set(name, callback);
      return () => subscriptions.delete(name);
    },
  };
  const dispatch = (name, event) => {
    for (const callback of [...(listeners.get(name) ?? [])]) callback(event);
  };
  class Element {
    constructor(name, parent = null) {
      this.name = name;
      this.parent = parent;
      this.isConnected = true;
      this.attrs = new Map();
      this.target = "";
    }
    contains(node) {
      for (; node; node = node.parent) if (node === this) return true;
      return false;
    }
    closest(selector) {
      if (selector === "#public-mobile-navigation") return panel.contains(this) ? panel : null;
      return null;
    }
    getClientRects() {
      return this.isConnected ? [{}] : [];
    }
    getBoundingClientRect() {
      return { width: 300, height: 40 };
    }
    hasAttribute(name) {
      return this.attrs.has(name);
    }
    setAttribute(name, value) {
      this.attrs.set(name, value);
    }
    removeAttribute(name) {
      this.attrs.delete(name);
    }
    matches() {
      return false;
    }
    addEventListener() {}
    focus(options) {
      document.activeElement = this;
      focused.push([this.name, options]);
      dispatch("focusin", { target: this });
    }
  }
  const body = new Element("body"),
    documentElement = new Element("html");
  const panel = new Element("mobile panel"),
    linkTarget = new Element("mobile link", panel);
  const toggle = new Element("toggle"),
    main = new Element("main"),
    heading = new Element("heading", main);
  let hasHeading = true;
  main.querySelectorAll = () => (hasHeading ? [heading] : []);
  const document = {
    body,
    documentElement,
    activeElement: body,
    querySelector: () => main,
    querySelectorAll: () => [],
    defaultView: { getComputedStyle: () => ({ visibility: "visible", clipPath: "none" }) },
    addEventListener(name, callback) {
      const entries = listeners.get(name) ?? new Set();
      entries.add(callback);
      listeners.set(name, entries);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
  };
  const window = {
    queueMicrotask(callback) {
      assert.equal(this, window);
      tasks.push(callback);
    },
  };
  const globals = {
    document,
    window,
    Element,
    requestAnimationFrame: (callback) => tasks.push(callback),
  };
  const routeHooks = {
    Link: "Link",
    useRouter: () => router,
    useRouterState: ({ select }) => select(router.state),
  };
  const { DrawerNavigationFocus } = loadUiModule(
    "src/components/DrawerNavigationFocus.tsx",
    {
      react: rootHooks.react,
      "@tanstack/react-router": routeHooks,
      "@/components/auth/ClerkSafe": { useUser: () => ({ user: null, isLoaded: true }) },
      "@/lib/drawer-navigation-focus": focus,
    },
    globals,
  );
  const { PublicHeader } = loadUiModule(
    "src/components/public/PublicShell.tsx",
    {
      react: new Proxy({}, { get: (_target, key) => headerHooks.react[key] }),
      "@tanstack/react-router": routeHooks,
      "lucide-react": { Menu: "Menu", X: "X" },
      "@/components/NovaLogo": { NovaLogo: "NovaLogo" },
      "@/components/PublicFooter": { PublicFooter: "PublicFooter" },
      "@/lib/drawer-navigation-focus": {
        requestDrawerNavigationFocus: (request) => {
          requests.push(request);
          return focus.requestDrawerNavigationFocus(request);
        },
      },
      "./public-foundation.css": {},
      "./spec400-public.css": {},
    },
    globals,
  );
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object" || !node.props) return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const commit = () => rootHooks.render(DrawerNavigationFocus);
  const render = () => {
    const tree = expand(headerHooks.render(PublicHeader));
    elements(tree, (node) => node.type === "button")[0].props.ref.current = toggle;
    return tree;
  };
  const flush = () => {
    while (tasks.length) tasks.shift()();
  };
  const emit = (name, to) => subscriptions.get(name)?.({ toLocation: { pathname: to } });
  const open = () => {
    elements(render(), (node) => node.type === "button")[0].props.onClick();
    return render();
  };
  const click = (label = "Learn", overrides = {}) => {
    const menu = elements(render(), (node) => node.props.id === "public-mobile-navigation")[0];
    const link = elements(menu, (node) => node.type === "Link" && text(node) === label)[0];
    assert.ok(link, label);
    document.activeElement = linkTarget;
    const event = {
      button: 0,
      currentTarget: linkTarget,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...overrides,
    };
    link.props.onClick(event);
    render();
    return event;
  };
  const begin = (to) => {
    emit("onBeforeNavigate", to);
    router.state = { location: { pathname: to, href: to }, status: "pending" };
    commit();
  };
  const resolve = () => {
    router.state.status = "idle";
    commit();
  };
  const rendered = () => {
    emit("onRendered", router.state.location.pathname);
    commit();
  };
  commit();
  return {
    open,
    click,
    render,
    commit,
    begin,
    resolve,
    rendered,
    flush,
    emit,
    focused,
    requests,
    document,
    dispatch,
    linkTarget,
    panel,
    main,
    heading,
    withoutHeading: () => {
      hasHeading = false;
    },
    remountHeader: () => {
      headerHooks.unmount();
      panel.isConnected = false;
      linkTarget.isConnected = false;
      headerHooks = createHookHarness();
      return render();
    },
    unmountRoot: () => rootHooks.unmount(),
    cleanup: () => {
      headerHooks.unmount();
      rootHooks.unmount();
    },
  };
}

test("Learn requests the destination heading after route render and idle, surviving header remount", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.open();
  const event = f.click();
  assert.equal(event.defaultPrevented, false, "TanStack Link still owns navigation");
  assert.equal(
    elements(f.render(), (node) => node.props.id === "public-mobile-navigation").length,
    0,
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].destination, "/use-cases");
  assert.equal(f.requests[0].source, f.panel);
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, []);
  f.begin("/use-cases");
  f.remountHeader();
  f.document.activeElement = f.document.body;
  f.resolve();
  f.flush();
  assert.deepEqual(f.focused, [], "Resolved alone does not identify the committed destination");
  f.rendered();
  assert.deepEqual(f.focused, []);
  f.flush();
  assert.deepEqual(f.focused, [["heading", { preventScroll: true }]]);
  f.rendered();
  f.flush();
  assert.equal(f.focused.length, 1);
});

test("same-route menu selection hands off after its commit without requiring a route event", (t) => {
  const f = fixture("/use-cases");
  t.after(f.cleanup);
  f.open();
  f.click();
  f.commit();
  assert.deepEqual(f.focused, []);
  f.flush();
  assert.deepEqual(f.focused, [["heading", { preventScroll: true }]]);
});

test("same-route Link flush before navigation starts does not discard focus during the reload", (t) => {
  const f = fixture("/use-cases");
  t.after(f.cleanup);
  f.open();
  f.click();
  f.commit(); // Link's flushSync can run this before navigate().
  f.begin("/use-cases");
  f.flush();
  assert.deepEqual(f.focused, []);
  f.resolve();
  f.rendered();
  f.flush();
  assert.deepEqual(f.focused, [["heading", { preventScroll: true }]]);
});

test("mobile Open KovaGPT hands off to main when the destination has no visible heading", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.withoutHeading();
  f.open();
  f.click("Open KovaGPT");
  f.begin("/");
  f.resolve();
  f.rendered();
  f.flush();
  assert.equal(f.requests[0].destination, "/");
  assert.deepEqual(f.focused, [["main", { preventScroll: true }]]);
});

test("modified, non-primary, prevented, new-window, and download activations leave menu/focus alone", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.open();
  for (const overrides of [
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { button: 2 },
    { defaultPrevented: true },
  ]) {
    f.click("Learn", overrides);
    assert.equal(
      elements(f.render(), (node) => node.props.id === "public-mobile-navigation").length,
      1,
    );
  }
  for (const target of ["_blank", "another-window", "_parent", "_top"]) {
    f.linkTarget.target = target;
    f.click();
  }
  f.linkTarget.target = "";
  f.linkTarget.setAttribute("download", "");
  f.click();
  f.commit();
  f.flush();
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.focused, []);
  assert.equal(
    elements(f.render(), (node) => node.props.id === "public-mobile-navigation").length,
    1,
  );
  f.linkTarget.removeAttribute("download");
  f.linkTarget.target = "_self";
  f.click();
  assert.equal(f.requests.length, 1);
});

test("Escape preserves opener restoration and desktop/ordinary route changes create no handoff", (t) => {
  const f = fixture();
  t.after(f.cleanup);
  for (const link of elements(f.render(), (node) => node.type === "Link"))
    assert.equal(link.props.onClick, undefined);
  f.open();
  let prevented = false;
  f.dispatch("keydown", {
    key: "Escape",
    preventDefault: () => {
      prevented = true;
    },
  });
  f.render();
  f.flush();
  assert.equal(prevented, true);
  assert.deepEqual(f.focused, [["toggle", undefined]]);
  assert.deepEqual(f.requests, []);
  f.begin("/pricing");
  f.resolve();
  f.rendered();
  f.flush();
  assert.equal(f.focused.length, 1);
});

test("newer navigation, later input/focus, and root teardown cancel queued public handoffs", () => {
  for (const invalidate of [
    (f) => f.emit("onBeforeNavigate", "/pricing"),
    (f) => f.dispatch("pointerdown", {}),
    (f) => f.dispatch("keydown", { key: "Tab" }),
    (f) => f.main.focus({ preventScroll: true }),
    (f) => f.unmountRoot(),
  ]) {
    const f = fixture("/use-cases");
    try {
      f.open();
      f.click();
      f.commit();
      invalidate(f);
      const before = f.focused.length;
      f.flush();
      assert.equal(f.focused.length, before);
    } finally {
      f.cleanup();
    }
  }
});
