import assert from "node:assert/strict";
import test from "node:test";
import * as principal from "../../src/lib/principal-browser-storage.mjs";
import * as policy from "../../src/lib/account-export-policy.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import {
  createHookHarness,
  deferred,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

// Source-component unit evidence with simulated DOM refs and focus events.
// This does not execute a browser, React DOM, live export, or private-file download.
const owner = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const id = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-10-19T00:00:00Z");
const job = (status = "queued") => ({
  id,
  status,
  requestedAt: new Date(now).toISOString(),
  completedAt: status === "complete" ? new Date(now).toISOString() : null,
  expiresAt: status === "complete" ? new Date(now + 3600000).toISOString() : null,
  sizeBytes: null,
  failureCode: null,
  downloadable: status === "complete",
  cleanupPending: false,
});
const download = () => ({
  url: "https://kova.invalid/fixture-only-export",
  expiresAt: now + 300000,
  requiresSession: true,
});

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
      if (!listeners.get(type)?.size) listeners.delete(type);
    },
    dispatch(type, target, extra = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, target, ...extra });
    },
  };
}

function fixture(operation = "request", handler) {
  let hooks = createHookHarness();
  const effects = [],
    requests = [],
    focusCalls = [],
    timers = new Map(),
    storage = new Map();
  const body = { type: "body" };
  const document = { ...eventTarget(), body, activeElement: body };
  const window = { ...eventTarget(), location: { href: "https://kova.invalid/?settings=data" } };
  const clock = { now, writeDenied: false };
  class FakeDate extends Date {
    static now() {
      return clock.now;
    }
  }
  const ui = loadUiModule(
    "src/lib/account-export-ui.ts",
    {
      "@/lib/principal-browser-storage.mjs": {
        ...principal,
        safeBrowserStorage: () => ({
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => {
            if (clock.writeDenied) throw Error("fixture storage denied");
            storage.set(key, value);
          },
          removeItem: (key) => storage.delete(key),
        }),
      },
      "@/lib/account-export-policy.mjs": policy,
    },
    { Date: FakeDate, URL },
  );
  const client = loadUiModule("src/lib/account-export-client.ts", {
    "@/integrations/supabase/client": { supabase: {} },
    "@/integrations/supabase/config": { SUPABASE_BROWSER_CONFIG: {} },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/account-export-policy.mjs": policy,
    "./account-export-ui": ui,
  });
  const react = Object.fromEntries(
    Object.keys(hooks.react).map((name) => [name, (...args) => hooks.react[name](...args)]),
  );
  react.useEffect = (effect, deps) =>
    hooks.react.useEffect(() => {
      let cleanup;
      effects.push(() => {
        cleanup = effect();
      });
      return () => cleanup?.();
    }, deps);
  const pending = deferred();
  const latest = { job: operation === "download" ? job("complete") : null };
  const module = loadUiModule(
    "src/components/AccountExportPanel.tsx",
    {
      react,
      "@/components/ui/button": { Button: "button" },
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "ConfirmActionDialog" },
      "@/lib/account-export-ui": ui,
      "@/lib/account-export-client": {
        ...client,
        requestAccountExport: (...args) => {
          requests.push(args);
          if (handler) return handler(...args);
          return args[1] === "status" ? Promise.resolve({ job: latest.job }) : pending.promise;
        },
      },
      "@/lib/storage-display": { formatStorageBytes: (value) => `${value} B` },
      "@/lib/principal-browser-storage.mjs": {
        ...principal,
        isPrincipalBrowserStorageClearedEvent: (event, currentOwner) =>
          event.owner === currentOwner,
      },
    },
    {
      document,
      window,
      AbortController,
      AbortSignal,
      Date: FakeDate,
      setTimeout: (fn, delay) => {
        const timer = {};
        timers.set(timer, { fn, delay });
        return timer;
      },
      clearTimeout: (timer) => timers.delete(timer),
    },
  );
  const props = { ownerId: owner, enabled: true };
  let nodes = new Map(),
    key = owner;
  function render(beforeEffects) {
    const root = module.AccountExportPanel(props);
    if (root.key !== key) {
      hooks.unmount();
      hooks = createHookHarness();
      key = root.key;
    }
    const tree = hooks.render(root.type, props);
    const next = new Map();
    for (const node of nodes.values()) {
      node.isConnected = false;
      if (node.props.ref) node.props.ref.current = null;
    }
    function commit(element, path = "root") {
      if (Array.isArray(element)) {
        element.forEach((child, index) => commit(child, `${path}.${index}`));
        return;
      }
      if (!element || typeof element !== "object") return;
      const address = `${path}:${String(element.type)}`;
      const node = nodes.get(address) ?? {
        type: element.type,
        getClientRects() {
          return this.hidden ? [] : [{}];
        },
        closest() {
          return this.inert ? {} : null;
        },
        matches() {
          return Boolean(this.props.disabled);
        },
        focus(options) {
          if (!this.isConnected || this.props.disabled) return;
          assert.ok(this.type === "button" || this.type === "a" || this.props.tabIndex === -1);
          focusCalls.push({ node: this, options });
          document.activeElement = this;
          document.dispatch("focusin", this);
        },
      };
      node.props = element.props;
      node.isConnected = true;
      next.set(address, node);
      if (node.props.ref) node.props.ref.current = node;
      commit(element.props.children, `${address}.children`);
    }
    commit(tree);
    nodes = next;
    if (!document.activeElement.isConnected || document.activeElement.props?.disabled)
      document.activeElement = body;
    beforeEffects?.([...nodes.values()]);
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  const find = (label) =>
    [...nodes.values()].find(
      (node) =>
        node.props["aria-label"] === label ||
        (["button", "a"].includes(node.type) && text(node) === label),
    );
  return {
    props,
    render,
    pending,
    requests,
    document,
    window,
    focusCalls,
    clock,
    latest,
    client,
    ui,
    timers,
    find,
    async ready() {
      render();
      await settle();
      render();
    },
    start({ focus = true, renderPending = true } = {}) {
      const trigger = find(
        operation === "request" ? "Request account export" : "Prepare account download",
      );
      assert.ok(trigger && !trigger.props.disabled);
      if (focus) trigger.focus();
      focusCalls.length = 0;
      trigger.props.onClick();
      if (renderPending) render();
      return trigger;
    },
    async finish(
      result = {
        job: job(operation === "request" ? "queued" : "complete"),
        ...(operation === "download" ? { download: download() } : {}),
      },
      beforeEffects,
    ) {
      pending.resolve(result);
      await settle();
      return render(beforeEffects);
    },
    async fail(error) {
      pending.reject(error);
      await settle();
      return render();
    },
    unmount() {
      hooks.unmount();
    },
  };
}

for (const operation of ["request", "download"]) {
  test(`${operation} hands replaced focus to its named successor once, including batched completion`, async () => {
    for (const renderPending of [true, false]) {
      const f = fixture(operation);
      await f.ready();
      assert.equal(f.focusCalls.length, 0, "initial status never takes focus");
      const trigger = f.start({ renderPending });
      await f.finish();
      const target = f.find(
        operation === "request" ? "Account export status" : "Download account export",
      );
      assert.ok(target && target !== trigger);
      assert.equal(f.document.activeElement, target);
      assert.equal(f.focusCalls.length, 1);
      assert.equal(f.focusCalls[0].options.preventScroll, true);
      assert.equal(f.document.listeners.size, 0);
      if (operation === "request") {
        assert.equal(target.props.role, "status");
        assert.equal(target.props.tabIndex, -1);
        assert.match(text(target), /Requested/);
        f.latest.job = job("processing");
        const timer = [...f.timers.values()][0];
        timer.fn();
        await settle();
        f.render();
        assert.equal(f.find("Account export status"), target);
        assert.match(text(target), /Preparing/);
      } else {
        assert.equal(target.props.target, "_blank");
        assert.equal(target.props.rel, "noopener noreferrer");
        assert.equal(target.props.href, download().url);
      }
      f.render();
      assert.equal(f.focusCalls.length, 1, "polls and ordinary rerenders never refocus");
      assert.deepEqual(
        f.requests.filter(([, op]) => op !== "status").map(([, op]) => op),
        [operation],
      );
      f.unmount();
    }
  });

  test(`${operation} completion respects later interaction, navigation, account, and panel lifetime`, async () => {
    const changes = {
      focus: (f) => {
        f.document.dispatch("focusin", {});
        f.document.activeElement = f.document.body;
      },
      pointer: (f) => f.document.dispatch("pointerdown", f.document.body),
      keyboard: (f) => f.document.dispatch("keydown", f.document.body),
      focusedControl: (f) => {
        f.document.activeElement = { isConnected: true };
      },
      url: (f) => {
        f.window.location.href += "&newer=1";
      },
      history: (f) => f.window.dispatch("popstate", f.window),
      hash: (f) => f.window.dispatch("hashchange", f.window),
      pagehide: (f) => f.window.dispatch("pagehide", f.window),
      windowBlur: (f) => f.window.dispatch("blur", f.window),
      close: (f) => {
        f.props.enabled = false;
        f.render();
      },
      closeReopen: (f) => {
        f.props.enabled = false;
        f.render();
        f.props.enabled = true;
        f.render();
      },
      account: (f) => {
        f.props.ownerId = other;
        f.render();
      },
      clear: (f) =>
        f.window.dispatch(principal.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, f.window, { owner }),
    };
    for (const [name, change] of Object.entries(changes)) {
      const f = fixture(operation);
      await f.ready();
      f.start();
      change(f);
      await f.finish();
      assert.equal(f.focusCalls.length, 0, `${name} must cancel focus handoff`);
      assert.equal(f.document.listeners.size, 0, `${name} cleans focus listeners`);
      f.unmount();
    }
    const unmounted = fixture(operation);
    await unmounted.ready();
    unmounted.start();
    unmounted.unmount();
    unmounted.pending.resolve({ job: job("complete"), download: download() });
    await settle();
    assert.equal(unmounted.focusCalls.length, 0);
    assert.equal(unmounted.document.listeners.size, 0);
    assert.equal(unmounted.window.listeners.size, 0);
  });

  test(`${operation} ignores unfocused activation and hidden, inert or disconnected successors`, async () => {
    const unfocused = fixture(operation);
    await unfocused.ready();
    unfocused.start({ focus: false });
    await unfocused.finish();
    assert.equal(unfocused.focusCalls.length, 0);
    unfocused.unmount();
    for (const invalid of ["hidden", "inert", "detached"]) {
      const f = fixture(operation);
      await f.ready();
      f.start();
      await f.finish(undefined, (nodes) => {
        const target = nodes.find((node) =>
          operation === "request"
            ? node.props["aria-label"] === "Account export status"
            : node.type === "a",
        );
        if (invalid === "detached") target.isConnected = false;
        else target[invalid] = true;
      });
      assert.equal(f.focusCalls.length, 0, invalid);
      f.unmount();
    }
  });
}

test("failed request focuses actionable feedback and keeps the pending marker without replay", async () => {
  for (const code of ["unknown", "denied"]) {
    const f = fixture();
    await f.ready();
    f.start();
    const tree = await f.fail(
      new f.client.AccountExportRequestError(code, true, code === "denied" ? 403 : null),
    );
    assert.equal(f.document.activeElement.props.role, "alert");
    assert.equal(f.document.activeElement.props.tabIndex, -1);
    assert.equal(f.find("Refresh export status").props.disabled, false);
    assert.equal(f.find("Request account export").props.disabled, true);
    assert.equal(f.ui.readExportRequestMarker(owner).kind, code === "denied" ? "none" : "pending");
    if (code === "unknown") assert.match(text(tree), /previous request has not been confirmed/);
    assert.equal(f.requests.filter(([, op]) => op === "request").length, 1);
    f.unmount();
  }
});

test("failed download retains its enabled prepare action and never exposes a link", async () => {
  const f = fixture("download");
  await f.ready();
  const trigger = f.start();
  const tree = await f.fail(
    new f.client.AccountExportRequestError("account_export_download_unavailable", true, 409),
  );
  assert.equal(f.document.activeElement, trigger);
  assert.equal(trigger.props.disabled, false);
  assert.match(text(tree), /download is unavailable/);
  assert.equal(f.find("Download account export"), undefined);
  assert.equal(f.focusCalls.length, 1);
  f.unmount();
});

test("storage tracking failure focuses feedback before any request is dispatched", async () => {
  const f = fixture();
  await f.ready();
  f.clock.writeDenied = true;
  f.start();
  assert.equal(f.document.activeElement.props.role, "alert");
  assert.match(text(f.document.activeElement), /could not safely track/);
  assert.deepEqual(
    f.requests.map(([, op]) => op),
    ["status"],
  );
  f.unmount();
});

test("later interaction suppresses error focus, and expired download responses never receive focus", async () => {
  const failed = fixture();
  await failed.ready();
  failed.start();
  failed.document.dispatch("pointerdown", failed.document.body);
  await failed.fail(Error("fixture rejection"));
  assert.equal(failed.focusCalls.length, 0);
  failed.unmount();
  const expired = fixture("download");
  await expired.ready();
  expired.start();
  expired.clock.now = now + 300001;
  await expired.finish();
  assert.equal(expired.find("Download account export"), undefined);
  assert.equal(expired.focusCalls.length, 0);
  expired.unmount();
});

test("a newer status read cancels an uncommitted completion handoff", async () => {
  const f = fixture("download");
  await f.ready();
  f.start();
  f.pending.resolve({ job: job("complete"), download: download() });
  await settle();
  f.find("Refresh export status").props.onClick();
  await settle();
  f.render();
  assert.equal(f.focusCalls.length, 0);
  assert.equal(f.find("Download account export"), undefined);
  assert.equal(f.document.listeners.size, 0);
  f.unmount();
});

for (const moved of [false, true]) {
  test(`manual status refresh restores its status region only while focus remains owned: moved=${moved}`, async () => {
    const read = deferred();
    let reads = 0;
    const f = fixture("request", () =>
      ++reads === 1 ? Promise.resolve({ job: null }) : read.promise,
    );
    await f.ready();
    const refresh = f.find("Refresh export status");
    refresh.focus();
    f.focusCalls.length = 0;
    refresh.props.onClick();
    f.render();
    assert.equal(f.document.activeElement, f.document.body);
    assert.equal(f.focusCalls.length, 0);
    if (moved) f.document.dispatch("pointerdown", f.document.body);
    read.resolve({ job: null });
    await settle();
    f.render();
    assert.equal(f.focusCalls.length, moved ? 0 : 1);
    if (!moved) assert.equal(f.document.activeElement, f.find("Account export status"));
    f.unmount();
  });
}

test("failed manual status refresh returns its now-enabled Refresh control", async () => {
  const read = deferred();
  let reads = 0;
  const f = fixture("request", () =>
    ++reads === 1 ? Promise.resolve({ job: null }) : read.promise,
  );
  await f.ready();
  const refresh = f.find("Refresh export status");
  refresh.focus();
  f.focusCalls.length = 0;
  refresh.props.onClick();
  f.render();
  read.reject(new Error("fixture read failure"));
  await settle();
  f.render();
  assert.equal(f.document.activeElement, f.find("Refresh export status"));
  assert.equal(f.focusCalls.length, 1);
  f.unmount();
});
