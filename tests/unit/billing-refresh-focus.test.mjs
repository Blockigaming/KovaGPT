import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const handler = source.slice(
  source.indexOf("  const handleRestore = async"),
  source.indexOf("\n  const familyTierUpgrade"),
);
const button = source.match(/<Button\s[^>]*onClick=\{handleRestore\}[\s\S]*?<\/Button>/)?.[0];
assert.ok(button, "Refresh action remains a stable Button");
const compile = (code, dependencies, result) =>
  new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText + `; return ${result};`,
  )(...Object.values(dependencies));

function fixture(overrides = {}) {
  const requests = [];
  const events = [];
  const state = { subscriptionLoading: false, portalLoading: false };
  const dependencies = {
    open: true,
    loggedIn: true,
    ...state,
    billingPendingRef: { current: false },
    portalPendingRef: { current: false },
    billingScopeRef: { current: { epoch: 1 } },
    billingIsCurrent: (epoch) => epoch === 1,
    getStripeEnvironment: () => "test",
    getSubscriptionSummary: () =>
      new Promise((resolve, reject) => requests.push({ resolve, reject })),
    setSubscriptionLoading: (value) => {
      state.subscriptionLoading = value;
    },
    setSubscriptionError: (value) => events.push(["error", value]),
    setSubSummary: (value) => events.push(["summary", value]),
    toast: {
      error: (value) => events.push(["toast", value]),
      success: (value) => events.push(["toast", value]),
      message: (value) => events.push(["toast", value]),
    },
    ...overrides,
  };
  const run = compile(handler, dependencies, "handleRestore");
  const render = () =>
    compile(
      `const rendered = (${button});`,
      {
        React: { createElement: (type, props, ...children) => ({ type, props, children }) },
        Button: "button",
        RefreshCw: "icon",
        handleRestore: run,
        ...state,
      },
      "rendered",
    );
  return { run, render, state, requests, events, dependencies };
}

test("refresh stays focusable while pending and becomes available after failure", async () => {
  const f = fixture();
  const ready = f.render();
  assert.equal(ready.props.disabled, undefined);
  assert.equal(ready.props["aria-disabled"], false);
  const pending = f.run();
  const checking = f.render();
  assert.equal(checking.type, ready.type);
  assert.equal(checking.props.disabled, undefined);
  assert.equal(checking.props.tabIndex, undefined);
  assert.equal(checking.props["aria-disabled"], true);
  assert.equal(checking.props["aria-busy"], true);
  await checking.props.onClick();
  assert.equal(f.requests.length, 1, "duplicate activation is blocked before re-render");
  f.requests[0].reject(new Error("billing unavailable"));
  await pending;
  assert.equal(f.render().props["aria-disabled"], false);
  assert.equal(f.render().props["aria-busy"], false);
  assert.equal(f.dependencies.billingPendingRef.current, false);
  assert.ok(f.events.some(([kind, value]) => kind === "toast" && value.includes("Couldn't check")));
  const retry = f.run();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve({ effectiveTier: "plus" });
  await retry;
});

test("refresh cannot bypass portal or account guards through keyboard activation", async () => {
  for (const overrides of [
    { open: false },
    { loggedIn: false },
    { subscriptionLoading: true },
    { billingPendingRef: { current: true } },
    { portalLoading: true },
    { portalPendingRef: { current: true } },
  ]) {
    const f = fixture(overrides);
    await f.run();
    assert.equal(f.requests.length, 0);
  }
  const f = fixture();
  f.state.portalLoading = true;
  assert.equal(f.render().props["aria-disabled"], true);
  assert.equal(f.render().props.disabled, undefined);
});
