import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDrawerNavigationFocusController,
  focusDrawerDestination,
  registerDrawerNavigationFocus,
  requestDrawerNavigationFocus,
} from "../../src/lib/drawer-navigation-focus.ts";

function fixture() {
  const scope = { principal: "a", pathname: "/", href: "/", idle: true };
  const frames = [];
  const focused = [];
  const sourceFocus = {};
  const source = { contains: (node) => node === sourceFocus };
  let changes = 0;
  const controller = createDrawerNavigationFocusController({
    scope: () => scope,
    activeElement: () => sourceFocus,
    changed: () => changes++,
    afterEffects: (callback) => frames.push(callback),
    focus: (intent) => focused.push(intent.destination),
  });
  return {
    scope,
    focused,
    source,
    sourceFocus,
    controller,
    request: (destination = "/projects") => controller.request({ destination, source }),
    commit: () => controller.afterCommit(),
    flush: () => {
      while (frames.length) frames.shift()();
    },
    changes: () => changes,
  };
}

test("slow route waits for actual onRendered, idle state and the commit effect flush", () => {
  const f = fixture();
  f.request();
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, []);
  f.controller.beforeNavigate("/projects");
  Object.assign(f.scope, { pathname: "/projects", href: "/projects", idle: false });
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, []);
  f.scope.idle = true;
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, [], "resolved alone is insufficient");
  f.controller.rendered("/projects");
  f.commit();
  assert.deepEqual(f.focused, [], "waits until sibling destination effects can own focus");
  f.flush();
  assert.deepEqual(f.focused, ["/projects"]);
  f.controller.rendered("/projects");
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, ["/projects"], "one use only");
});

test("same-route New chat/selection focuses after React commit without waiting for a nonexistent route event", () => {
  const f = fixture();
  f.request("/");
  assert.deepEqual(f.focused, []);
  f.commit();
  assert.deepEqual(f.focused, []);
  f.flush();
  assert.deepEqual(f.focused, ["/"]);
});

test("a pre-navigation commit waits through transient same-route loading and retries only on a later commit", () => {
  const f = fixture();
  f.request("/");
  f.commit();
  f.controller.beforeNavigate("/");
  f.scope.idle = false;
  const changes = f.changes();
  f.flush();
  assert.deepEqual(f.focused, []);
  f.commit();
  f.flush();
  assert.equal(f.changes(), changes, "Waiting does not poll or schedule its own renders");
  f.scope.idle = true;
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, ["/"]);
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, ["/"], "The retained intent remains single use");
});

test("query-changing navigation started after a queued same-path commit still waits for onRendered", () => {
  const f = fixture();
  f.request("/");
  f.commit();
  f.controller.beforeNavigate("/");
  f.scope.href = "/?chat=next";
  f.flush();
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, []);
  f.controller.rendered("/");
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, ["/"]);
});

test("a waiting same-route intent still cancels on later navigation, interaction, identity change, or disposal", () => {
  for (const invalidate of [
    (f) => f.controller.beforeNavigate("/"),
    (f) => f.controller.beforeNavigate("/library"),
    (f) => f.controller.cancel(),
    (f) => f.controller.focusMoved({}),
    (f) => {
      f.scope.principal = "b";
    },
    (f) => {
      f.scope.principal = undefined;
    },
    (f) => f.controller.dispose(),
  ]) {
    const f = fixture();
    f.request("/");
    f.commit();
    f.controller.beforeNavigate("/");
    f.scope.idle = false;
    f.flush();
    invalidate(f);
    f.scope.idle = true;
    f.commit();
    f.flush();
    assert.deepEqual(f.focused, []);
  }
});

test("same-path changing search still waits for actual render", () => {
  const f = fixture();
  f.request("/");
  f.scope.href = "/?chat=next";
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, []);
  f.controller.rendered("/");
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, ["/"]);
});

test("newer navigation, account changes, later interaction and moved focus invalidate queued work", () => {
  for (const invalidate of [
    (f) => f.controller.beforeNavigate("/library"),
    (f) => {
      f.scope.principal = "b";
    },
    (f) => {
      f.scope.principal = undefined;
    },
    (f) => f.controller.cancel(),
    (f) => f.controller.focusMoved({}),
    (f) => f.controller.rendered("/library"),
  ]) {
    const f = fixture();
    f.request("/");
    f.commit();
    invalidate(f);
    f.flush();
    assert.deepEqual(f.focused, []);
  }
  const f = fixture();
  f.request("/");
  f.commit();
  f.controller.cancel();
  f.scope.principal = "b";
  f.scope.principal = "a";
  f.flush();
  assert.deepEqual(f.focused, [], "returning to owner cannot revive cancelled intent");
});

test("a second navigation supersedes an old intent even when the destination matches", () => {
  const f = fixture();
  f.request();
  f.controller.beforeNavigate("/projects");
  f.controller.beforeNavigate("/projects");
  Object.assign(f.scope, { pathname: "/projects", href: "/projects" });
  f.controller.rendered("/projects");
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, []);
});

test("stale queued callbacks cannot consume a newer navigation intent", () => {
  const f = fixture();
  f.request("/");
  f.commit();
  f.request("/library");
  f.flush();
  assert.deepEqual(f.focused, []);
  Object.assign(f.scope, { pathname: "/library", href: "/library" });
  f.controller.rendered("/library");
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, ["/library"]);
});

test("a detached source Sidebar does not cancel the root-owned destination handoff", () => {
  const f = fixture();
  f.request();
  f.source.contains = () => false;
  Object.assign(f.scope, { pathname: "/projects", href: "/projects" });
  f.controller.rendered("/projects");
  f.commit();
  f.flush();
  assert.deepEqual(f.focused, ["/projects"]);
});

test("root unmount disposes pending callbacks and registration", () => {
  const f = fixture();
  const unregister = registerDrawerNavigationFocus(f.controller);
  assert.equal(requestDrawerNavigationFocus({ destination: "/", source: f.source }), true);
  f.commit();
  unregister();
  f.flush();
  assert.deepEqual(f.focused, []);
  assert.equal(requestDrawerNavigationFocus({ destination: "/", source: f.source }), false);
  assert.equal(f.request(), false);
  const g = fixture();
  g.scope.principal = undefined;
  assert.equal(g.request(), false);
});

function domFixture() {
  const focused = [];
  function element(name) {
    const attrs = new Map();
    return {
      name,
      isConnected: true,
      attrs,
      hidden: false,
      getClientRects: () => [{}],
      getBoundingClientRect: () => ({ width: 200, height: 32 }),
      closest: () => null,
      contains: (node) => node === this,
      hasAttribute: (key) => attrs.has(key),
      setAttribute: (key, value) => attrs.set(key, value),
      removeAttribute: (key) => attrs.delete(key),
      matches: () => false,
      focus: (options) => {
        document.activeElement = nodeByName[name];
        focused.push([name, options]);
      },
      addEventListener: (_event, callback) => {
        blur[name] = callback;
      },
    };
  }
  const blur = {};
  const body = {};
  const documentElement = {};
  const sourceFocus = {};
  const heading = element("heading");
  const input = element("input");
  const main = element("main");
  const mobileTitle = element("mobileTitle");
  input.matches = () => true;
  const nodeByName = { heading, input, main, mobileTitle };
  let headings = [heading];
  let inputs = [input];
  let modals = [];
  let mobileTitles = [];
  main.querySelectorAll = (selector) => (selector === "h1" ? headings : inputs);
  main.contains = (node) => Object.values(nodeByName).includes(node);
  const document = {
    body,
    documentElement,
    activeElement: body,
    querySelector: () => main,
    querySelectorAll: (selector) =>
      selector === "[data-kova-navigation-heading]" ? mobileTitles : modals,
    defaultView: {
      getComputedStyle: (node) => ({
        visibility: node.hidden ? "hidden" : "visible",
        clipPath: node.clipped ? "inset(50%)" : "none",
      }),
    },
  };
  const intent = {
    destination: "/projects",
    sourceFocus,
    source: { contains: (node) => node === sourceFocus },
  };
  return {
    document,
    intent,
    main,
    heading,
    input,
    mobileTitle,
    setMobileTitle: () => {
      mobileTitles = [mobileTitle];
    },
    focused,
    blur,
    setModals: (value) => {
      modals = value;
    },
    noHeading: () => {
      headings = [];
    },
    noInputs: () => {
      inputs = [];
    },
  };
}

test("focuses visible destination heading without scrolling; temporary tabindex is removed on blur", () => {
  const f = domFixture();
  focusDrawerDestination(f.document, f.intent);
  assert.deepEqual(f.focused, [["heading", { preventScroll: true }]]);
  assert.equal(f.heading.attrs.get("tabindex"), "-1");
  f.blur.heading();
  assert.equal(f.heading.attrs.has("tabindex"), false);
});

test("new modal, destination-owned Settings focus and later external focus are never overridden", () => {
  for (const prepare of [
    (f) => f.setModals([f.heading]),
    (f) => {
      f.document.activeElement = f.input;
    },
    (f) => {
      f.document.activeElement = {};
    },
    (f) => {
      f.main.closest = () => ({});
    },
  ]) {
    const f = domFixture();
    prepare(f);
    focusDrawerDestination(f.document, f.intent);
    assert.deepEqual(f.focused, []);
  }
});

test("headingless active chat focuses main, never a text input or mobile keyboard", () => {
  const f = domFixture();
  f.noHeading();
  focusDrawerDestination(f.document, f.intent);
  assert.deepEqual(f.focused, [["main", { preventScroll: true }]]);
});

test("1px or clipped duplicate headings yield to the visible mobile title", () => {
  for (const hide of [
    (heading) => {
      heading.getBoundingClientRect = () => ({ width: 1, height: 1 });
    },
    (heading) => {
      heading.clipped = true;
    },
    (heading) => {
      heading.hidden = true;
    },
  ]) {
    const f = domFixture();
    f.setMobileTitle();
    hide(f.heading);
    focusDrawerDestination(f.document, f.intent);
    assert.deepEqual(f.focused, [["mobileTitle", { preventScroll: true }]]);
  }
});

test("root integration subscribes to rendered events and ordinary drawer dismissal retains restoration", () => {
  const root = readFileSync("src/routes/__root.tsx", "utf8");
  const coordinator = readFileSync("src/components/DrawerNavigationFocus.tsx", "utf8");
  const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
  assert.match(root, /<DrawerNavigationFocus \/>/);
  assert.match(coordinator, /router\.subscribe\("onRendered"/);
  assert.match(
    coordinator,
    /if \(principalRef\.current !== principal\) controllerRef\.current\?\.cancel\(\)/,
  );
  assert.match(coordinator, /controllerRef\.current\?\.afterCommit\(\)/);
  assert.match(coordinator, /document\.removeEventListener\("focusin", focusMoved\)/);
  assert.match(sidebar, /if \(navigationOwnsFocusRef\.current\) return;\s*requestAnimationFrame/);
  assert.match(
    sidebar,
    /if \(previous\?\.isConnected && previous\.offsetParent !== null\) previous\.focus\(\)/,
  );
  assert.match(sidebar, /closeAfterMobileNavigation\("\/"\);\s*onSelect\(conversation.id\)/);
  assert.doesNotMatch(coordinator, /setTimeout|requestAnimationFrame|scrollTo/);
});

test("browser microtask scheduling retains its Window receiver", () => {
  const source = readFileSync("src/components/DrawerNavigationFocus.tsx", "utf8");
  const scheduler = source.match(
    /afterEffects: (\(callback\) => window\.queueMicrotask\(callback\)),/,
  );
  assert.ok(scheduler, "native scheduler must be wrapped instead of copied as an options method");
  const callbacks = [];
  const window = {
    queueMicrotask(callback) {
      assert.equal(this, window, "browser WebIDL method requires Window receiver");
      callbacks.push(callback);
    },
  };
  const options = { afterEffects: new Function("window", `return ${scheduler[1]}`)(window) };
  const callback = () => {};
  options.afterEffects(callback);
  assert.deepEqual(callbacks, [callback]);
});
