import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const hook = source.slice(
  source.indexOf("function useProjectChatMoveFocus("),
  source.indexOf("function ChatsTab("),
);
const restore = readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(
  /^export function/gm,
  "function",
);
const compiled = ts.transpileModule(`${restore}\n${hook}\nreturn useProjectChatMoveFocus;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const slots = [],
    effects = [],
    frames = new Map(),
    focused = [];
  let cursor = 0,
    frameId = 0;
  const same = (a, b) =>
    a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef(value) {
      const index = cursor++;
      return (slots[index] ??= { current: value });
    },
    useState(value) {
      const index = cursor++;
      slots[index] ??= value;
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === "function" ? next(slots[index]) : next;
        },
      ];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useCallback(callback, deps) {
      return hooks.useMemo(() => callback, deps);
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps))
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: callback() };
        });
    },
  };
  function emitter() {
    const listeners = new Map();
    return {
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      fire(type, event = {}) {
        for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
      },
      count() {
        return [...listeners.values()].reduce((count, set) => count + set.size, 0);
      },
    };
  }
  const document = {
    ...emitter(),
    body: {},
    documentElement: {},
    visibilityState: "visible",
    activeElement: null,
    querySelector: () => target,
    querySelectorAll: () => modals,
  };
  const window = {
    ...emitter(),
    location: { href: "https://example.invalid/projects/project-a" },
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  const routerEvents = emitter();
  const router = {
    state: { status: "idle" },
    subscribe(type, callback) {
      routerEvents.addEventListener(type, callback);
      return () => routerEvents.removeEventListener(type, callback);
    },
  };
  const region = (name) => ({
    isConnected: true,
    hidden: false,
    blocked: false,
    getClientRects() {
      return this.hidden ? [] : [1];
    },
    closest() {
      return this.blocked ? {} : null;
    },
    matches: () => false,
    focus(options) {
      focused.push({ name, options });
      document.activeElement = this;
      document.fire("focusin", { target: this });
    },
  });
  let target = region("initial chats"),
    modals = [];
  const sourceButton = { closest: () => dialog };
  const dialog = { contains: (node) => node === sourceButton, isConnected: true };
  document.activeElement = sourceButton;
  const deps = { ...hooks, window, document, useRouter: () => router };
  const useFocus = new Function(...Object.keys(deps), compiled)(...Object.values(deps));
  const props = { key: "owner-a:project-a", refreshing: false, eligible: true };
  let begin;
  const flush = () => {
    while (effects.length) effects.shift()();
  };
  const render = (runEffects = true) => {
    cursor = 0;
    begin = useFocus(props.key, props.refreshing, props.eligible);
    if (runEffects) flush();
  };
  render();
  return {
    props,
    document,
    window,
    router,
    routerEvents,
    sourceButton,
    dialog,
    focused,
    frames,
    render,
    flush,
    start() {
      return begin(sourceButton);
    },
    loading() {
      props.refreshing = true;
      target.isConnected = false;
      target = null;
      dialog.isConnected = false;
      document.activeElement = document.body;
      render();
    },
    ready() {
      props.refreshing = false;
      target = region("refreshed chats");
      render();
    },
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    },
    target: () => target,
    modal() {
      modals = [region("other modal")];
    },
    listeners: () => document.count() + window.count() + routerEvents.count(),
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

test("successful Move survives the refresh unmount and focuses the new chats region once", () => {
  const f = fixture();
  const intent = f.start();
  f.loading();
  intent.complete();
  f.render();
  assert.equal(f.frames.size, 0);
  assert.equal(f.focused.length, 0);
  f.ready();
  f.frame();
  assert.deepEqual(f.focused, [{ name: "refreshed chats", options: { preventScroll: true } }]);
  assert.equal(f.listeners(), 0);
  intent.complete();
  f.render();
  f.frame();
  assert.equal(f.focused.length, 1);
});

for (const event of [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "focusin",
  "visibilitychange",
  "blur",
  "popstate",
  "hashchange",
  "onBeforeNavigate",
]) {
  for (const stage of ["moving", "before focus"]) {
    test(`later ${event} ${stage} abandons the successful Move focus intent`, () => {
      const f = fixture();
      const intent = f.start();
      f.loading();
      if (stage === "before focus") {
        f.ready();
        intent.complete();
        f.render();
      }
      const emitter =
        event === "onBeforeNavigate"
          ? f.routerEvents
          : ["blur", "popstate", "hashchange"].includes(event)
            ? f.window
            : f.document;
      emitter.fire(event, { target: {} });
      f.ready();
      intent.complete();
      f.render();
      f.frame();
      assert.equal(f.focused.length, 0);
      assert.equal(f.listeners(), 0);
    });
  }
}

for (const boundary of [
  "account",
  "project",
  "sign-out",
  "unmount",
  "route",
  "busy router",
  "new focus",
  "hidden document",
  "hidden region",
  "removed region",
  "inert region",
  "modal",
  "other tab",
  "new refresh",
]) {
  test(`${boundary} blocks a pending refreshed-region focus`, () => {
    const f = fixture();
    const intent = f.start();
    f.loading();
    f.ready();
    intent.complete();
    f.render();
    if (boundary === "account") {
      f.props.key = "owner-b:project-a";
      f.render(false);
    }
    if (boundary === "project") {
      f.props.key = "owner-a:project-b";
      f.render(false);
    }
    if (boundary === "sign-out") {
      f.props.key = null;
      f.render(false);
    }
    if (boundary === "unmount") f.unmount();
    if (boundary === "route") f.window.location.href += "/other";
    if (boundary === "busy router") f.router.state.status = "pending";
    if (boundary === "new focus") f.document.activeElement = {};
    if (boundary === "hidden document") f.document.visibilityState = "hidden";
    if (boundary === "hidden region") f.target().hidden = true;
    if (boundary === "removed region") f.target().isConnected = false;
    if (boundary === "inert region") f.target().blocked = true;
    if (boundary === "modal") f.modal();
    if (boundary === "other tab") {
      f.props.eligible = false;
      f.render(false);
    }
    if (boundary === "new refresh") {
      f.props.refreshing = true;
      f.render(false);
    }
    f.frame();
    assert.equal(f.focused.length, 0);
  });
}

for (const boundary of ["account", "project"]) {
  test(`${boundary} A to B to A before passive effects cannot revive the old intent`, () => {
    const f = fixture();
    const intent = f.start();
    f.loading();
    f.ready();
    intent.complete();
    f.render();
    const key = f.props.key;
    f.props.key = boundary === "account" ? "owner-b:project-a" : "owner-a:project-b";
    f.render(false);
    f.props.key = key;
    f.render(false);
    f.frame();
    assert.equal(f.focused.length, 0);
  });
}

test("failed refresh consumes the intent so a later Retry does not resurrect focus", () => {
  const f = fixture();
  const intent = f.start();
  f.loading();
  f.props.eligible = false;
  f.ready();
  intent.complete();
  f.render();
  assert.equal(f.listeners(), 0);
  f.props.eligible = true;
  f.ready();
  f.frame();
  assert.equal(f.focused.length, 0);
});

test("Move failure and stale completion cannot overwrite a newer intent", () => {
  const f = fixture();
  const old = f.start();
  old.cancel();
  assert.equal(f.listeners(), 0);
  const current = f.start();
  old.complete();
  old.cancel();
  assert.ok(f.listeners() > 0);
  f.loading();
  f.ready();
  current.complete();
  f.render();
  f.frame();
  assert.equal(f.focused.length, 1);
  assert.equal(f.listeners(), 0);
});

test("page and chat consumer wire explicit success only to the labelled refreshed-region target", () => {
  assert.match(source, /onMoveFocusRequest=\{beginChatMoveFocus\}/);
  assert.match(
    source,
    /data-project-chats-region[\s\S]*?tabIndex=\{-1\}[\s\S]*?aria-label="Project chats"/,
  );
  const handle = source.slice(
    source.indexOf("async function handleMove("),
    source.indexOf("async function handleCreate()", source.indexOf("async function handleMove(")),
  );
  assert.match(handle, /onMoveFocusRequest\?\.\(event\?\.currentTarget \?\? null\)/);
  assert.ok(handle.indexOf("moveOriginRef.current = null") > handle.indexOf("await fnMoveChat("));
  assert.match(handle, /await onRefresh\(\);\s*focusReturn\?\.complete\(\)/);
  assert.match(handle, /catch \{\s*focusReturn\?\.cancel\(\)/);
});
