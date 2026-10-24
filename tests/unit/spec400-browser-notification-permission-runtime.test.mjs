import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const pwaSource = compile("src/components/PwaSettings.tsx");
const timersSource = compile("src/components/TimersWidget.tsx");
const text = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "object") return text(node.props?.children);
  return String(node);
};
const nodes = (node) => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
};
function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    emit(name, event = {}) {
      for (const callback of listeners.get(name) ?? []) callback(event);
    },
    listenerCount: (name) => listeners.get(name)?.size ?? 0,
  };
}

// Run actual component callbacks with controlled hooks, browser APIs, and
// transport. No browser, permission prompt, notification, or network is used.
function harness(source, component, dependencies, globals, initialProps) {
  let hooks = [];
  let cursor = 0;
  let dirty = true;
  let mounted = true;
  let tree;
  let props = initialProps;
  const effects = [];
  let staleWrites = 0;
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const memo = (getValue, dependencies) => {
    const index = cursor++;
    if (
      !hooks[index] ||
      dependencies.some((value, i) => !Object.is(value, hooks[index].dependencies[i]))
    )
      hooks[index] = { value: getValue(), dependencies };
    return hooks[index].value;
  };
  const effect = (run, dependencies) => {
    const index = cursor++;
    const prior = hooks[index];
    if (!prior || dependencies.some((value, i) => !Object.is(value, prior.dependencies[i]))) {
      const slot = { dependencies, cleanup: prior?.cleanup };
      hooks[index] = slot;
      effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = run();
      });
    }
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      const slot = (hooks[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      });
      return [
        slot.value,
        (next) => {
          if (!mounted || hooks[index] !== slot) staleWrites++;
          const value = typeof next === "function" ? next(slot.value) : next;
          if (!Object.is(value, slot.value)) {
            slot.value = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (hooks[index] ??= { current: initial });
    },
    useCallback: (run, dependencies) => memo(() => run, dependencies),
    useMemo: memo,
    useEffect: effect,
    useLayoutEffect: effect,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/components/ui/button": { Button: "button" },
    "@/lib/principal-browser-storage.mjs": {
      browserStoragePrincipal: (owner) => owner ?? "guest",
      isPrincipalBrowserStorageClearedEvent: (event, owner) => event.ownerId === owner,
      PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "principal-cleared",
    },
    ...dependencies,
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      assert.ok(name in modules, `Unexpected import ${name}`);
      return modules[name];
    },
    Error,
    AbortController,
    ...globals,
  });
  function render() {
    cursor = 0;
    dirty = false;
    tree = exports[component](props);
    // PwaSettings deliberately keys its private DeviceSettings by account.
    if (typeof tree.type === "function") tree = tree.type(tree.props);
    while (effects.length) effects.shift()();
  }
  async function flush() {
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (mounted && dirty) render();
    }
  }
  function button(label) {
    const node = nodes(tree).find(
      (node) =>
        node.type === "button" &&
        (text(node).trim() === label || node.props["aria-label"] === label),
    );
    assert.ok(node, `Expected button ${label}`);
    return node.props;
  }
  function unmount() {
    mounted = false;
    for (const hook of hooks) hook?.cleanup?.();
  }
  render();
  return {
    flush,
    button,
    async click(label) {
      const control = button(label);
      assert.ok(!control.disabled, `${label} should be enabled`);
      control.onClick();
      await flush();
    },
    unmount,
    async remount(nextProps) {
      unmount();
      hooks = [];
      mounted = true;
      props = nextProps;
      render();
      await flush();
    },
    text: () => text(tree),
    nodes: () => nodes(tree),
    staleWrites: () => staleWrites,
  };
}

function pwaFixture(options = {}) {
  const calls = [];
  const notification = { permission: options.permission ?? "default" };
  let binding = options.binding ?? null;
  const window = eventTarget(
    options.supported === false ? {} : { Notification: notification, PushManager: {} },
  );
  const document = eventTarget({ visibilityState: "visible" });
  const f = harness(
    pwaSource,
    "PwaSettings",
    {
      "@/lib/pwa/install": {
        subscribeInstallPrompt: () => () => {},
        canPromptInstall: () => false,
        noServerPrompt: () => false,
        promptPwaInstall: async () => calls.push(["install"]),
      },
      "@/lib/pwa/client": {
        async setPwaOwner(owner) {
          calls.push(["owner", owner]);
        },
        async pushApi(owner, _signal, body) {
          calls.push([body ? "write" : "read", owner, body]);
          if (options.loadError) throw Error("unavailable");
          return {
            ready: options.ready !== false,
            publicKey: "fixture-key",
            preferenceRevision: 0,
            quietHours: null,
            devices: [],
          };
        },
        async pwaMessage({ ownerId }) {
          calls.push(["binding", ownerId]);
          return { binding };
        },
        async enableDevicePush(owner, _key, signal) {
          calls.push(["enable", owner, signal]);
          if (options.enableGate) await options.enableGate;
          signal.throwIfAborted();
          notification.permission = options.result ?? "granted";
          if (notification.permission !== "granted") throw Error("Permission was not granted.");
          binding = { id: "device", ownerId: owner, revision: 1 };
        },
        async disableDevicePush(owner) {
          calls.push(["disable", owner]);
          binding = null;
        },
      },
    },
    { window, document, navigator: { serviceWorker: {} }, Notification: notification },
    { ownerId: options.ownerId === undefined ? "owner-a" : options.ownerId },
  );
  return { ...f, calls, notification, window, document };
}

const enable = "Enable browser notifications";
test("denied permission explains browser settings immediately, even when delivery status fails", async () => {
  for (const loadError of [false, true]) {
    const f = pwaFixture({ permission: "denied", loadError });
    await f.flush();
    assert.match(f.text(), /Browser notifications are blocked/);
    assert.match(f.text(), /site settings for KovaGPT/);
    assert.match(f.text(), /Notifications to Allow/);
    assert.match(f.text(), /cannot change this permission for you/);
    assert.equal(f.button(enable).disabled, true);
    assert.equal(f.calls.filter(([kind]) => kind === "enable").length, 0);
    await f.click("Refresh");
    assert.match(f.text(), /Browser notifications are blocked/);
    f.unmount();
  }
});

test("mount, focus, visibility, and Refresh never opt in; only the named action enables once", async () => {
  let release;
  const f = pwaFixture({ enableGate: new Promise((resolve) => (release = resolve)) });
  await f.flush();
  assert.match(f.text(), /ask this browser for permission/);
  f.window.emit("focus");
  f.document.emit("visibilitychange");
  await f.click("Refresh");
  assert.equal(f.calls.filter(([kind]) => kind === "enable").length, 0);
  const click = f.button(enable).onClick;
  click();
  click();
  await f.flush();
  assert.equal(f.calls.filter(([kind]) => kind === "enable").length, 1);
  assert.equal(f.button(enable).disabled, true);
  release();
  await f.flush();
  assert.match(f.text(), /This browser is subscribed\./);
  assert.equal(f.button(enable).disabled, true);
  f.unmount();
});

test("a denied or dismissed permission result refreshes without needing another visit", async () => {
  for (const result of ["denied", "default"]) {
    const f = pwaFixture({ result });
    await f.flush();
    await f.click(enable);
    assert.match(f.text(), /Permission was not granted/);
    assert.equal(f.button(enable).disabled, result === "denied");
    assert.match(
      f.text(),
      result === "denied" ? /Browser notifications are blocked/ : /ask this browser for permission/,
    );
    f.unmount();
  }
});

test("returning from site settings reads permission without network writes or replacing quiet-hour edits", async () => {
  const f = pwaFixture({
    permission: "granted",
    binding: { id: "existing", ownerId: "owner-a", revision: 1 },
  });
  await f.flush();
  const checkbox = f.nodes().find((node) => node.props.type === "checkbox");
  checkbox.props.onChange({ target: { checked: true } });
  await f.flush();
  const start = () => f.nodes().find((node) => node.props["aria-label"] === "Quiet hours start");
  start().props.onChange({ target: { value: "21:30" } });
  await f.flush();
  const callsBefore = f.calls.length;
  f.notification.permission = "denied";
  f.document.visibilityState = "hidden";
  f.document.emit("visibilitychange");
  await f.flush();
  assert.doesNotMatch(f.text(), /Browser notifications are blocked/);
  f.document.visibilityState = "visible";
  f.document.emit("visibilitychange");
  await f.flush();
  assert.match(f.text(), /Browser notifications are blocked/);
  assert.match(f.text(), /saved subscription, but browser notification permission is not granted/);
  assert.doesNotMatch(f.text(), /This browser is subscribed\./);
  assert.equal(f.calls.length, callsBefore);
  assert.equal(start().props.value, "21:30");
  assert.equal(f.button("Turn off on this browser").disabled, false);
  f.notification.permission = "default";
  f.window.emit("focus");
  await f.flush();
  assert.equal(f.button(enable).disabled, false);
  f.notification.permission = "granted";
  f.window.emit("focus");
  await f.flush();
  assert.match(f.text(), /This browser is subscribed\./);
  assert.equal(f.calls.length, callsBefore);
  f.unmount();
  assert.equal(f.window.listenerCount("focus"), 0);
  assert.equal(f.document.listenerCount("visibilitychange"), 0);
});

test("granted permission alone does not subscribe, and unavailable backend cannot enable", async () => {
  const allowed = pwaFixture({ permission: "granted" });
  await allowed.flush();
  assert.match(allowed.text(), /Your browser allows notifications/);
  assert.doesNotMatch(allowed.text(), /This browser is subscribed\./);
  assert.equal(allowed.calls.filter(([kind]) => kind === "enable").length, 0);
  allowed.unmount();
  const unavailable = pwaFixture({ ready: false });
  await unavailable.flush();
  assert.equal(unavailable.button(enable).disabled, true);
  // Even an obsolete callback must retain the backend readiness fence.
  unavailable.button(enable).onClick();
  await unavailable.flush();
  assert.equal(unavailable.calls.filter(([kind]) => kind === "enable").length, 0);
  unavailable.unmount();
});

test("unsupported and signed-out settings never read account delivery status", async () => {
  for (const options of [{ supported: false }, { ownerId: null }]) {
    const f = pwaFixture(options);
    await f.flush();
    assert.equal(f.calls.length, 0);
    assert.ok(!f.nodes().some((node) => node.type === "button" && text(node) === enable));
    f.unmount();
  }
});

test("account replacement aborts a pending enable and removes old permission listeners", async () => {
  let release;
  const f = pwaFixture({ enableGate: new Promise((resolve) => (release = resolve)) });
  await f.flush();
  await f.click(enable);
  const signal = f.calls.find(([kind]) => kind === "enable")[2];
  await f.remount({ ownerId: "owner-b" });
  assert.equal(signal.aborted, true);
  assert.equal(f.window.listenerCount("focus"), 1);
  assert.equal(f.document.listenerCount("visibilitychange"), 1);
  release();
  await f.flush();
  assert.equal(f.staleWrites(), 0);
  assert.equal(f.calls.filter(([kind]) => kind === "enable").length, 1);
  assert.doesNotMatch(f.text(), /This browser is subscribed\./);
  f.unmount();
  assert.equal(f.window.listenerCount("focus"), 0);
  assert.equal(f.window.listenerCount("principal-cleared"), 0);
});

function timersFixture(permission, { due = false } = {}) {
  const calls = [];
  const notification = function (title, settings) {
    calls.push(["notification", title, settings]);
  };
  notification.permission = permission;
  notification.requestPermission = async () => {
    calls.push(["permission"]);
    return "granted";
  };
  let items = due
    ? [{ id: "due-timer", kind: "timer", label: "Timer", fireAt: Date.now() - 1000 }]
    : [];
  const subscriptions = new Set();
  const window = eventTarget({
    Notification: notification,
    AudioContext: function () {
      calls.push(["audio"]);
    },
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const f = harness(
    timersSource,
    "TimersWidget",
    {
      "lucide-react": {},
      sonner: {
        toast: {
          success: (message) => calls.push(["toast", message]),
          error: (message) => calls.push(["error", message]),
        },
      },
      "@/lib/timers": {
        addTimer: (owner, duration, label) => {
          calls.push(["add", owner, duration]);
          const timer = { id: "new-timer", label, fireAt: Date.now() + duration };
          items = [...items, timer];
          for (const callback of subscriptions) callback();
          return timer;
        },
        listTimers: () => items,
        subscribeTimers: (_owner, callback) => {
          subscriptions.add(callback);
          return () => subscriptions.delete(callback);
        },
        markFired: (owner, id) => calls.push(["fired", owner, id]),
        removeTimer: () => true,
        formatRemaining: () => "5:00",
      },
    },
    { window, Notification: notification },
    { userKey: "owner-a", principalResolved: true },
  );
  return { ...f, calls, refresh: () => subscriptions.forEach((callback) => callback()) };
}

test("starting a timer never requests browser permission or starts audio", async () => {
  for (const permission of ["default", "denied", "granted"]) {
    const f = timersFixture(permission);
    await f.flush();
    await f.click("Timers");
    await f.click("Start");
    assert.equal(f.calls.filter(([kind]) => kind === "add").length, 1);
    assert.ok(!f.calls.some(([kind]) => ["permission", "notification", "audio"].includes(kind)));
    f.unmount();
  }
});

test("due timers use only previously granted permission, stay silent, and fire once", async () => {
  for (const permission of ["default", "denied", "granted"]) {
    const f = timersFixture(permission, { due: true });
    await f.flush();
    f.refresh();
    await f.flush();
    const notifications = f.calls.filter(([kind]) => kind === "notification");
    assert.equal(notifications.length, permission === "granted" ? 1 : 0);
    if (permission === "granted") assert.equal(notifications[0][2].silent, true);
    assert.equal(f.calls.filter(([kind]) => kind === "toast").length, 1);
    assert.equal(f.calls.filter(([kind]) => kind === "fired").length, 1);
    assert.ok(!f.calls.some(([kind]) => ["permission", "audio"].includes(kind)));
    f.unmount();
  }
});

function pushWorkerFixture({ owner = "owner-a", bindingOwner = owner } = {}) {
  const handlers = new Map();
  const shown = [];
  const meta = new Map([
    ["owner", owner],
    ["binding", { ownerId: bindingOwner, id: "subscription-a" }],
  ]);
  vm.runInNewContext(readFileSync("public/kova-sw.js", "utf8"), {
    self: {
      addEventListener: (name, callback) => handlers.set(name, callback),
      registration: {
        async showNotification(title, options) {
          assert.equal(meta.get("delivered")?.length, 1, "Receipt precedes display");
          shown.push({ title, options });
        },
      },
    },
    // This local map models only the metadata transaction interface exercised
    // by the actual worker's push callback. No worker is installed or activated.
    indexedDB: {
      open() {
        const request = {
          result: {
            close() {},
            transaction(store) {
              assert.equal(store, "meta");
              const tx = {};
              const operation = (value) => {
                const result = { result: structuredClone(value) };
                queueMicrotask(() => {
                  result.onsuccess?.();
                  tx.oncomplete?.();
                });
                return result;
              };
              tx.objectStore = () => ({
                get: (key) => operation(meta.get(key)),
                put: (value, key) => {
                  meta.set(key, structuredClone(value));
                  return operation(key);
                },
              });
              return tx;
            },
          },
        };
        queueMicrotask(() => request.onsuccess());
        return request;
      },
    },
  });
  return {
    shown,
    async deliver(overrides = {}) {
      let pending;
      handlers.get("push")({
        data: {
          json: () => ({
            version: 1,
            subscriptionId: "subscription-a",
            eventId: "11111111-1111-4111-8111-111111111111",
            eventSource: "application",
            eventAt: new Date().toISOString(),
            ...overrides,
          }),
        },
        waitUntil: (promise) => (pending = promise),
      });
      await pending;
    },
  };
}

test("service-worker push delivery is silent and retains durable once-only display", async () => {
  const f = pushWorkerFixture();
  await f.deliver();
  await f.deliver();
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].options.silent, true);
  assert.equal(f.shown[0].options.renotify, false);
  assert.equal(f.shown[0].options.data.subscriptionId, "subscription-a");
  assert.equal(f.shown[0].options.body, "You have a new update. Open KovaGPT to view it.");
});

test("silent push delivery still rejects mismatched owners, subscriptions, and invalid payloads", async () => {
  const otherOwner = pushWorkerFixture({ bindingOwner: "owner-b" });
  await otherOwner.deliver();
  assert.equal(otherOwner.shown.length, 0);
  for (const payload of [
    { version: 2 },
    { subscriptionId: "subscription-b" },
    { eventSource: "untrusted" },
    { eventId: "invalid" },
    { eventAt: new Date(Date.now() - 86400001).toISOString() },
    { eventAt: new Date(Date.now() + 60000).toISOString() },
  ]) {
    const f = pushWorkerFixture();
    await f.deliver(payload);
    assert.equal(f.shown.length, 0);
  }
});
