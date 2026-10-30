import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { deferred, settle } from "../helpers/ui-state-harness.mjs";
import {
  CONNECTION_FLOWS,
  canReadConnection,
  connectionAccounts,
  hasConnectionScopes,
} from "../../src/integrations/connection-flows.mjs";

const source = readFileSync("src/routes/apps.tsx", "utf8");
const file = ts.createSourceFile(
  "apps.tsx",
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
  nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(file) === name)
    .initializer;
const contextGuard = nodes
  .find(
    (node) =>
      ts.isIfStatement(node) &&
      node.expression.getText(file) ===
        "googleRefreshScopeRef.current.context !== googleRefreshContext",
  )
  .getText(file);
const cleanup = nodes
  .find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]?.getText(file).includes("googleRefreshScopeRef.current.epoch += 1"),
  )
  .arguments[0].getText(file);
const elementWith = (attribute, value) =>
  nodes.find(
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(file) === attribute &&
          attr.initializer?.text === value,
      ),
  );
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
const textOf = (tree) =>
  typeof tree === "string" || typeof tree === "number"
    ? String(tree)
    : (tree?.children ?? []).map(textOf).join(" ");
const React = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((child) => child !== false && child != null),
  }),
};
function focusFixture() {
  const calls = [],
    pending = [];
  const document = { body: {}, activeElement: null };
  const element = (name) => ({
    name,
    isConnected: true,
    hidden: false,
    inert: false,
    disabled: false,
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
  const target = element("Google connection status"),
    trigger = element("Refresh status"),
    later = element("Close details");
  document.activeElement = trigger;
  const state = {
    googleLoading: false,
    googleStatus: { connected: false, state: "temporarily_unavailable" },
  };
  const deps = {
    React,
    document,
    window: { location: { href: "https://local.invalid/apps" } },
    isLoaded: true,
    isSignedIn: true,
    activityReady: true,
    principal: "user:owner-a",
    userKey: "owner-a",
    principalRef: { current: "user:owner-a" },
    generationRef: { current: 0 },
    googleRequestRef: { current: 0 },
    googleBusyRef: { current: false },
    googleStatusRef: { current: target },
    googleRefreshScopeRef: { current: { context: "user:owner-a:gmail:0", epoch: 0 } },
    googleRefreshContext: "user:owner-a:gmail:0",
    googleRefreshEpoch: 0,
    googleRefreshGeneration: 0,
    googleRefreshRequest: 0,
    googleRefreshUrl: "https://local.invalid/apps",
    visibleSelectedApp: { id: "gmail" },
    visibleGoogleLoading: false,
    isGoogleId: (id) => ["google", "gmail", "google-drive", "google-calendar"].includes(id),
    setGoogleLoading(value) {
      calls.push(["loading", value]);
      state.googleLoading = value;
    },
    setGoogleStatus(value) {
      state.googleStatus = value;
    },
    getGoogleStatus() {
      calls.push(["request"]);
      const request = deferred();
      pending.push(request);
      return request.promise;
    },
  };
  deps.refreshGoogle = compile(
    `return (${variable("refreshGoogle").arguments[0].getText(file)});`,
    deps,
  );
  const refresh = () =>
    compile(
      `return (${variable("refreshGoogleStatus").getText(file)});`,
      deps,
    )({ currentTarget: trigger });
  const unmount = compile(`return (${cleanup});`, deps)();
  return {
    calls,
    pending,
    document,
    target,
    trigger,
    later,
    state,
    deps,
    refresh,
    unmount,
    context(next) {
      compile(contextGuard, { ...deps, googleRefreshContext: next });
    },
    render() {
      return compile(
        `return (${elementWith("aria-label", "Google connection status").getText(file)});`,
        {
          ...deps,
          visibleGoogleLoading: state.googleLoading,
          visibleGoogleStatus: state.googleStatus,
          googleBusy: false,
          Button: "button",
          handleConnect() {},
          handleUseInChat() {},
          stateOf: () => "temporarily_unavailable",
          refreshGoogleStatus: refresh,
        },
      );
    },
  };
}

test("explicit Google Refresh focuses a stable named region before disabling its button", async () => {
  const f = focusFixture();
  const unavailable = f.render();
  f.refresh();
  assert.deepEqual(f.calls.slice(0, 3), [
    ["focus", "Google connection status", { preventScroll: true }],
    ["loading", true],
    ["request"],
  ]);
  const pending = f.render();
  assert.equal(pending.props["aria-busy"], true);
  assert.match(textOf(pending), /Updating Google accounts/);
  assert.equal(
    all(pending).find((node) => node.type === "button" && textOf(node).includes("Refresh status"))
      .props.disabled,
    true,
  );
  f.pending[0].reject(new Error("Synthetic unavailable"));
  await settle();
  const failed = f.render();
  assert.match(textOf(failed), /Google account status is unavailable/);
  assert.equal(
    all(failed).find((node) => node.type === "button" && textOf(node) === "Connect").props.disabled,
    true,
  );
  for (const view of [unavailable, pending, failed]) {
    assert.equal(view.type, "section");
    assert.equal(view.props.ref, f.deps.googleStatusRef);
    assert.equal(view.props.role, "region");
    assert.equal(view.props["aria-label"], "Google connection status");
    assert.equal(view.props.tabIndex, -1);
  }
  assert.equal(f.document.activeElement, f.target);
  assert.equal(f.calls.filter(([kind]) => kind === "focus").length, 1);
});

for (const outcome of ["success", "failure"]) {
  test(`Google ${outcome} preserves focus after later user interaction`, async () => {
    const f = focusFixture();
    f.refresh();
    f.document.activeElement = f.later;
    if (outcome === "success") f.pending[0].resolve({ connected: false, state: "disconnected" });
    else f.pending[0].reject(new Error("Synthetic unavailable"));
    await settle();
    assert.equal(f.document.activeElement, f.later);
    assert.equal(f.calls.filter(([kind]) => kind === "focus").length, 1);
  });
}

test("initial status reads never take focus and repeated explicit clicks do not duplicate reads", async () => {
  const initial = focusFixture();
  const request = initial.deps.refreshGoogle();
  initial.pending[0].resolve({ connected: false, state: "disconnected" });
  await request;
  assert.equal(initial.calls.filter(([kind]) => kind === "focus").length, 0);
  const explicit = focusFixture();
  explicit.refresh();
  explicit.refresh();
  assert.equal(explicit.pending.length, 1);
  assert.equal(explicit.calls.filter(([kind]) => kind === "focus").length, 1);
});

for (const change of [
  "account",
  "provider",
  "closed",
  "closed-reopened",
  "route",
  "cleared",
  "unmounted",
  "busy",
  "loading",
  "disabled",
  "detached-trigger",
  "signed-out",
]) {
  test(`stale Google Refresh is inert after ${change}`, () => {
    const f = focusFixture();
    if (change === "account") f.deps.principalRef.current = "user:owner-b";
    if (change === "provider") f.context("user:owner-a:google-drive:0");
    if (change === "closed" || change === "closed-reopened") f.context("user:owner-a:closed:0");
    if (change === "closed-reopened") f.context("user:owner-a:gmail:0");
    if (change === "route") f.deps.window.location.href = "https://local.invalid/library";
    if (change === "cleared") f.deps.generationRef.current += 1;
    if (change === "unmounted") f.unmount();
    if (change === "busy") f.deps.googleBusyRef.current = true;
    if (change === "loading") f.deps.visibleGoogleLoading = true;
    if (change === "disabled") f.trigger.disabled = true;
    if (change === "detached-trigger") f.trigger.isConnected = false;
    if (change === "signed-out") f.deps.isSignedIn = false;
    f.refresh();
    assert.deepEqual(f.calls, []);
  });
}

for (const invalid of ["hidden", "inert", "detached", "missing", "later-focus"]) {
  test(`Google Refresh does not take focus for ${invalid}`, () => {
    const f = focusFixture();
    if (invalid === "hidden") f.target.hidden = true;
    if (invalid === "inert") f.target.inert = true;
    if (invalid === "detached") f.target.isConnected = false;
    if (invalid === "missing") f.deps.googleStatusRef.current = null;
    if (invalid === "later-focus") f.document.activeElement = f.later;
    f.refresh();
    assert.equal(f.calls.filter(([kind]) => kind === "focus").length, 0);
    assert.equal(f.pending.length, 1);
  });
}

test("pointer activation starting from body moves focus to Google status", () => {
  const f = focusFixture();
  f.document.activeElement = f.document.body;
  f.refresh();
  assert.equal(f.document.activeElement, f.target);
});

function countFixture(overrides = {}) {
  const ids = ["google", "gmail", "google-drive", "google-calendar", "github"];
  const deps = {
    React,
    CONNECTION_FLOWS,
    canReadConnection,
    connectionAccounts,
    hasConnectionScopes,
    configuredOf: () => false,
    otherConnections: {
      data: { accounts: [], configuredProviders: [] },
      loading: false,
      error: false,
    },
    WORKING_IDS: new Set(ids),
    isLoaded: true,
    isSignedIn: true,
    activityReady: true,
    visibleGoogleLoading: false,
    googleBusy: false,
    githubLoading: false,
    githubLoadError: false,
    visibleGoogleStatus: { connected: false, state: "disconnected", accounts: [] },
    visibleGithubData: { configured: true, health: "healthy", accounts: [] },
    connecting: {},
    failed: {},
    isGoogleId: (id) => id !== "github" && ids.includes(id),
    connectionFilter: "connected",
    query: "",
    category: "all",
    filtered: [],
    ...overrides,
  };
  for (const name of ["isGoogleConnected", "stateOf", "hasConnection"])
    deps[name] = compile(`return (${variable(name).getText(file)});`, deps);
  deps.catalog = [...ids, "slack"].map((id) => ({ id }));
  for (const name of [
    "connectedCount",
    "connectionCountState",
    "connectedCountLabel",
    "connectedStatusMessage",
    "connectedStatusUnverified",
  ]) {
    deps[name] = compile(`return (${variable(name).getText(file)});`, deps);
  }
  return {
    ...deps,
    summary: () =>
      compile(
        `return (${elementWith("className", "spec400-plugin-result-count").getText(file)});`,
        deps,
      ),
    empty: () =>
      compile(`return (${elementWith("className", "spec400-plugin-empty").getText(file)});`, {
        ...deps,
        Search: "icon",
        Button: "button",
        setQuery() {},
        setCategory() {},
        setConnectionFilter() {},
      }),
  };
}

test("verified disconnected providers alone produce a zero count and disconnected empty state", () => {
  const f = countFixture();
  assert.equal(f.connectionCountState, "ready");
  assert.equal(f.connectedCountLabel, 0);
  assert.match(textOf(f.summary()), /0 connections/);
  assert.match(textOf(f.empty()), /No connections yet/);
});

for (const [name, overrides, expected] of [
  ["unresolved auth", { isLoaded: false }, "Unknown"],
  ["principal transition", { activityReady: false }, "Checking…"],
  ["Google pending", { visibleGoogleLoading: true }, "Checking…"],
  ["GitHub pending", { githubLoading: true }, "Checking…"],
  ["Google busy", { googleBusy: true }, "Checking…"],
  [
    "Google failed",
    { visibleGoogleStatus: { connected: false, state: "temporarily_unavailable" } },
    "Unavailable",
  ],
  ["GitHub failed", { githubLoadError: true, visibleGithubData: null }, "Unavailable"],
  ["missing Google status", { visibleGoogleStatus: null }, "Unknown"],
  [
    "unconfigured GitHub",
    { visibleGithubData: { configured: false, accounts: [] } },
    "Unavailable",
  ],
]) {
  test(`${name} does not claim Connected 0 or No connections yet`, () => {
    const f = countFixture(overrides);
    assert.equal(f.connectedCountLabel, expected);
    assert.equal(f.connectedStatusUnverified, true);
    assert.doesNotMatch(textOf(f.summary()), /0 connections/);
    assert.doesNotMatch(textOf(f.empty()), /No connections yet|connect an account/);
  });
}

test("pending/error counts never re-label stale retained records as current totals", () => {
  const accounts = [{ id: "account-a", state: "reauthorization_required" }];
  const ready = countFixture({
    visibleGoogleStatus: { connected: false, state: "reauthorization_required", accounts },
  });
  assert.equal(ready.connectedCountLabel, 4);
  assert.equal(ready.hasConnection("gmail"), true);
  const pending = countFixture({
    visibleGoogleStatus: ready.visibleGoogleStatus,
    visibleGoogleLoading: true,
  });
  assert.equal(pending.connectedCountLabel, "Checking…");
  const failed = countFixture({
    visibleGoogleStatus: { ...ready.visibleGoogleStatus, state: "temporarily_unavailable" },
  });
  assert.equal(failed.connectedCountLabel, "Unavailable");
  assert.equal(failed.hasConnection("gmail"), true);
});

test("All retains its catalog result count while Connected is unverified", () => {
  const f = countFixture({
    connectionFilter: "all",
    visibleGoogleLoading: true,
    filtered: [{}, {}],
  });
  assert.equal(f.connectedStatusUnverified, false);
  assert.match(textOf(f.summary()), /2 connections/);
});

test("verified connected providers report their real total without planned plugins affecting availability", () => {
  const f = countFixture({
    visibleGoogleStatus: {
      connected: true,
      state: "connected",
      has: { gmail: true, calendar: true, drive: true },
      accounts: [{ id: "google-a", state: "connected" }],
    },
    visibleGithubData: {
      configured: true,
      health: "healthy",
      accounts: [{ id: "github-a", status: "connected" }],
    },
  });
  assert.equal(f.connectionCountState, "ready");
  assert.equal(f.connectedCountLabel, 5);
  assert.equal(f.stateOf("slack"), "temporarily_unavailable");
  assert.equal(f.hasConnection("slack"), false);
});

test("a successful Google refresh retains the same focus region and enables Connect only after verification", async () => {
  const f = focusFixture();
  f.refresh();
  f.pending[0].resolve({ connected: false, state: "disconnected", accounts: [] });
  await settle();
  const ready = f.render();
  assert.equal(ready.props.ref, f.deps.googleStatusRef);
  assert.equal(ready.props["aria-label"], "Google connection status");
  assert.equal(ready.props["aria-busy"], false);
  assert.equal(f.document.activeElement, f.target);
  assert.match(textOf(ready), /No Google accounts are connected/);
  assert.equal(
    all(ready).find((node) => node.type === "button" && textOf(node) === "Connect").props.disabled,
    false,
  );
});
