import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { formatDisplayDateTime } from "../../src/lib/time-format.ts";
import { deferred, settle } from "../helpers/ui-state-harness.mjs";

const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const file = ts.createSourceFile(
  "SettingsDialog.tsx",
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
const readEffect = nodes
  .find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("getMyDailyUsage()"),
  )
  .arguments[0].getText(file);
const unmountEffect = nodes
  .find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("billingScopeRef.current.epoch += 1"),
  )
  .arguments[0].getText(file);
const summary = nodes
  .find(
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(file) === "className" &&
          attr.initializer?.text === "kova-settings-usage-summary",
      ),
  )
  .getText(file);
function compile(text, deps) {
  return new Function(
    ...Object.keys(deps),
    ts.transpileModule(text, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
  )(...Object.values(deps));
}
const all = (tree) =>
  !tree || typeof tree !== "object" ? [] : [tree, ...(tree.children ?? []).flatMap(all)];
const text = (tree) =>
  typeof tree === "string" ? tree : (tree?.children ?? []).map(text).join(" ");
function fixture() {
  const calls = [],
    pending = [];
  const state = { usage: null, usageLoading: false, usageLoaded: false, usageRetry: 0 };
  const document = { body: {}, activeElement: null };
  const element = (name) => ({
    name,
    isConnected: true,
    hidden: false,
    inert: false,
    getClientRects() {
      return this.hidden ? [] : [{}];
    },
    closest() {
      return this.inert ? {} : null;
    },
    focus(options) {
      calls.push(["focus", name, options]);
      document.activeElement = this;
    },
  });
  const status = element("Usage status"),
    trigger = element("Retry usage"),
    later = element("later action");
  document.activeElement = trigger;
  const deps = {
    formatDisplayDateTime,
    settings: { timeFormat: "system" },
    document,
    window: { location: { href: "https://local.invalid/settings/usage" } },
    usageStatusRef: { current: status },
    billingScopeRef: {
      current: { epoch: 0, open: true, tab: "usage", loggedIn: true, userKey: "owner-a" },
    },
    currentAuthUserKeyRef: { current: "owner-a" },
    userKey: "owner-a",
    open: true,
    tab: "usage",
    loggedIn: true,
    usageRetryEpoch: 0,
    usageRetryUrl: "https://local.invalid/settings/usage",
    setUsageRetry: (update) => {
      calls.push(["retry"]);
      state.usageRetry = update(state.usageRetry);
    },
    setUsage: (value) => {
      state.usage = value;
    },
    setUsageLoaded: (value) => {
      state.usageLoaded = value;
    },
    setUsageLoading: (value) => {
      state.usageLoading = value;
    },
    getMyDailyUsage: () => {
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
    React: {
      createElement: (type, props, ...children) => ({
        type,
        props: props ?? {},
        children: children.flat(Infinity).filter(Boolean),
      }),
    },
    PlanUsageBars: "PlanUsageBars",
    subSummary: null,
    tier: "plus",
    DAILY_IMAGE_LIMIT: 1,
    DAILY_UPLOAD_LIMIT: 1,
  };
  deps.billingIsCurrent = compile(`return (${variable("billingIsCurrent")});`, deps);
  deps.retryUsage = compile(`return (${variable("retryUsage")});`, deps);
  const unmount = compile(`return (${unmountEffect});`, deps)();
  return {
    deps,
    calls,
    state,
    status,
    trigger,
    later,
    document,
    pending,
    unmount,
    retry: () => deps.retryUsage({ currentTarget: trigger }),
    request: () => compile(`return (${readEffect});`, deps)(),
    render: () => compile(`return (${summary});`, { ...deps, ...state }),
  };
}

test("Usage status remains named and focusable across loading, unavailable and successful states", () => {
  const f = fixture();
  const loading = f.render();
  assert.match(text(loading), /Loading usage/);
  f.state.usageLoaded = true;
  const unavailable = f.render();
  assert.match(text(unavailable), /Usage data isn't available/);
  assert.equal(
    all(unavailable).find(({ type }) => type === "button").props.onClick,
    f.deps.retryUsage,
  );
  f.state.usage = { chats: 2, images: 1, uploads: 0, resetsAt: "2026-10-20T00:00:00Z" };
  const ready = f.render();
  for (const view of [loading, unavailable, ready]) {
    assert.equal(view.type, "div");
    assert.equal(view.props.ref, f.deps.usageStatusRef);
    assert.equal(view.props.role, "region");
    assert.equal(view.props["aria-label"], "Usage status");
    assert.equal(view.props.tabIndex, -1);
  }
});

test("explicit Retry transfers focus before its button disappears and keeps it during loading", async () => {
  const f = fixture();
  f.state.usageLoaded = true;
  f.retry();
  assert.deepEqual(f.calls, [["focus", "Usage status", { preventScroll: true }], ["retry"]]);
  assert.equal(f.state.usageRetry, 1);
  f.request();
  const loading = f.render();
  assert.equal(loading.props["aria-busy"], true);
  assert.equal(
    all(loading).some(({ type }) => type === "button"),
    false,
  );
  assert.equal(f.document.activeElement, f.status);
  f.pending[0].reject(new Error("Synthetic unavailable"));
  await settle();
  assert.match(text(f.render()), /Usage data isn't available/);
  assert.equal(f.document.activeElement, f.status);
  assert.equal(f.calls.filter(([type]) => type === "focus").length, 1);
});

for (const success of [true, false]) {
  test(`request ${success ? "success" : "failure"} does not steal focus after a later user interaction`, async () => {
    const f = fixture();
    f.retry();
    f.request();
    f.document.activeElement = f.later;
    if (success)
      f.pending[0].resolve({ chats: 3, images: 0, uploads: 0, resetsAt: "2026-10-20T00:00:00Z" });
    else f.pending[0].reject(new Error("Synthetic failure"));
    await settle();
    assert.equal(f.document.activeElement, f.later);
    assert.equal(f.calls.filter(([type]) => type === "focus").length, 1);
  });
}

test("initial loading and failure do not move focus without an explicit Retry", async () => {
  const f = fixture();
  f.document.activeElement = f.later;
  f.request();
  f.pending[0].reject(new Error("Synthetic failure"));
  await settle();
  assert.deepEqual(f.calls, []);
  assert.equal(f.document.activeElement, f.later);
});

for (const [name, change] of [
  [
    "account change",
    (f) => {
      f.deps.currentAuthUserKeyRef.current = "owner-b";
      f.deps.billingScopeRef.current.epoch++;
    },
  ],
  [
    "unresolved auth",
    (f) => {
      f.deps.currentAuthUserKeyRef.current = undefined;
    },
  ],
  [
    "sign-out",
    (f) => {
      f.deps.billingScopeRef.current.loggedIn = false;
    },
  ],
  [
    "section change",
    (f) => {
      f.deps.billingScopeRef.current.tab = "billing";
    },
  ],
  [
    "closed settings",
    (f) => {
      f.deps.billingScopeRef.current.open = false;
    },
  ],
  [
    "close and reopen",
    (f) => {
      f.deps.billingScopeRef.current.epoch += 2;
    },
  ],
  [
    "route change",
    (f) => {
      f.deps.window.location.href = "https://local.invalid/settings/privacy";
    },
  ],
  ["unmount", (f) => f.unmount()],
  [
    "detached button",
    (f) => {
      f.trigger.isConnected = false;
    },
  ],
  [
    "hidden section",
    (f) => {
      f.trigger.inert = true;
    },
  ],
]) {
  test(`obsolete Retry cannot refocus or restart usage after ${name}`, () => {
    const f = fixture();
    change(f);
    f.retry();
    assert.deepEqual(f.calls, []);
    assert.equal(f.state.usageRetry, 0);
  });
}

test("retry does not override focus already moved to another control", () => {
  const f = fixture();
  f.document.activeElement = f.later;
  f.retry();
  assert.deepEqual(f.calls, [["retry"]]);
  assert.equal(f.document.activeElement, f.later);
});

test("explicit pointer Retry from body transfers to the stable status", () => {
  const f = fixture();
  f.document.activeElement = f.document.body;
  f.retry();
  assert.equal(f.document.activeElement, f.status);
});

for (const invalid of ["detached", "hidden", "inert", "missing"]) {
  test(`an unavailable ${invalid} status target is not focused`, () => {
    const f = fixture();
    if (invalid === "missing") f.deps.usageStatusRef.current = null;
    else if (invalid === "detached") f.status.isConnected = false;
    else f.status[invalid] = true;
    f.retry();
    assert.deepEqual(f.calls, [["retry"]]);
  });
}

test("the existing usage-read cleanup still ignores a late response after section disposal", async () => {
  const f = fixture();
  const cleanup = f.request();
  cleanup();
  f.pending[0].resolve({ chats: 99 });
  await settle();
  assert.equal(f.state.usage, null);
  assert.equal(f.state.usageLoaded, false);
  assert.deepEqual(f.calls, []);
});
