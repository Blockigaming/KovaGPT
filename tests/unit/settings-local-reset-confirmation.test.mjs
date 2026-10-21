import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/SettingsDialog.tsx", "utf8");
const parsed = ts.createSourceFile(
  "SettingsDialog.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function expression(name) {
  let match;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name)
      match = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(match, name);
  return match;
}
function attribute(name, marker) {
  const matches = [];
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === name &&
      node.getText(parsed).includes(marker)
    )
      matches.push(node.initializer.expression.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1, marker);
  return matches[0];
}
function compile(code, dependencies) {
  const js = ts.transpileModule(`return (${code});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
}
function result(failures = []) {
  return {
    resolved: true,
    ...Object.fromEntries(
      ["local", "session", "imageHistory", "chatHistory", "pwa"].map((name) => [
        name,
        { failures: name === "local" ? failures : [] },
      ]),
    ),
  };
}
function fixture(options = {}) {
  const changes = [];
  const calls = [];
  const focus = [];
  const target = { focus: () => focus.push("trigger") };
  const deps = {
    localResetScopeRef: { current: { open: true, tab: "storage", ownerId: "a", generation: 0 } },
    currentAuthUserKeyRef: { current: "a" },
    localResetBusyRef: { current: false },
    localResetConfirmationRef: { current: null },
    localResetReturnRef: { current: null },
    localResetCancelRef: { current: { focus: () => focus.push("cancel") } },
    deleteAccountOpen: false,
    window: { location: { href: "https://local.invalid/settings/storage" } },
    setLocalResetConfirmOpen: (value) => changes.push(["dialog", value]),
    setLocalResetBusy: (value) => changes.push(["busy", value]),
    clearLocalBrowserData: async (owner) => {
      calls.push(owner);
      return result();
    },
    onChange: () => changes.push(["settings"]),
    onClearAll: () => changes.push(["clear"]),
    DEFAULT_SETTINGS: {},
    toast: Object.fromEntries(
      ["error", "warning", "success"].map((kind) => [
        kind,
        (message) => changes.push([kind, message]),
      ]),
    ),
    restoreDialogFocus: (node, url, blocked) => {
      if (!blocked && url === deps.window.location.href) node?.focus();
    },
    ...options,
  };
  return {
    deps,
    changes,
    calls,
    focus,
    launch: () =>
      compile(expression("openLocalResetConfirmation"), deps)({ currentTarget: target }),
    confirm: () => compile(expression("confirmLocalReset"), deps)(),
    cancel: () => compile(attribute("onOpenChange", "localResetConfirmationRef"), deps)(false),
    autofocus: () =>
      compile(attribute("onOpenAutoFocus", "localResetCancelRef"), deps)({ preventDefault() {} }),
    closeFocus: () =>
      compile(attribute("onCloseAutoFocus", "localResetReturnRef"), deps)({ preventDefault() {} }),
  };
}

test("opening and cancelling reset never deletes; Cancel receives initial focus and trigger is restored", async () => {
  const f = fixture();
  f.launch();
  f.autofocus();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.changes, [["dialog", true]]);
  assert.deepEqual(f.focus, ["cancel"]);
  f.cancel();
  f.closeFocus();
  await f.confirm();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.focus, ["cancel", "trigger"]);
  assert.equal(f.deps.localResetConfirmationRef.current, null);
  assert.match(source, /chats, drafts, local handoffs, work data/);
  assert.match(source, /This cannot be undone\./);
});

test("confirmation consumes one captured-owner decision before async work and cannot replay", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const calls = [];
  const f = fixture({
    clearLocalBrowserData: async (owner) => {
      calls.push(owner);
      return pending;
    },
  });
  f.launch();
  const first = f.confirm();
  await f.confirm();
  assert.deepEqual(calls, ["a"]);
  assert.equal(f.deps.localResetConfirmationRef.current, null);
  finish(result());
  await first;
  await f.confirm();
  assert.deepEqual(calls, ["a"]);
  assert.ok(f.changes.some(([kind]) => kind === "success"));
  assert.deepEqual(
    f.changes.filter(([kind]) => kind === "busy"),
    [
      ["busy", true],
      ["busy", false],
    ],
  );
});

test("stale accounts, unresolved auth, closed/departed views and old generations cannot confirm or steal focus", async () => {
  const mutations = [
    (d) => {
      d.currentAuthUserKeyRef.current = "b";
    },
    (d) => {
      d.currentAuthUserKeyRef.current = undefined;
    },
    (d) => {
      d.localResetScopeRef.current = {
        ...d.localResetScopeRef.current,
        open: false,
        generation: 1,
      };
    },
    (d) => {
      d.localResetScopeRef.current = {
        ...d.localResetScopeRef.current,
        tab: "data",
        generation: 1,
      };
    },
    (d) => {
      d.localResetScopeRef.current.generation += 2;
    },
    (d) => {
      d.window.location.href += "?elsewhere";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    f.launch();
    mutate(f.deps);
    await f.confirm();
    f.closeFocus();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.focus, []);
  }
});

test("opening is gated while identity is unresolved, another reset is pending, or the account-deletion dialog is open", () => {
  for (const options of [
    { currentAuthUserKeyRef: { current: undefined } },
    { localResetBusyRef: { current: true } },
    { deleteAccountOpen: true },
  ]) {
    const f = fixture(options);
    f.launch();
    assert.deepEqual(f.changes, []);
  }
});

test("late success never clears another account's mounted settings; cleanup failures remain truthful", async () => {
  let finish;
  const f = fixture({
    clearLocalBrowserData: async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  f.launch();
  const pending = f.confirm();
  f.deps.currentAuthUserKeyRef.current = "b";
  finish(result());
  await pending;
  assert.equal(
    f.changes.some(([kind]) => kind === "settings" || kind === "clear"),
    false,
  );
  for (const response of [result(["failed"]), { resolved: false }]) {
    const g = fixture({ clearLocalBrowserData: async () => response });
    g.launch();
    await g.confirm();
    assert.equal(
      g.changes.some(([kind]) => kind === "success"),
      false,
    );
    assert.ok(g.changes.some(([kind]) => kind === "warning" || kind === "error"));
  }
  const g = fixture({
    clearLocalBrowserData: async () => {
      throw new Error("synthetic failure");
    },
  });
  g.launch();
  await g.confirm();
  assert.ok(g.changes.some(([kind]) => kind === "warning"));
  assert.equal(g.deps.localResetBusyRef.current, false);
});

test("resolved guest confirmation remains scoped to guest, never an unresolved owner", async () => {
  const f = fixture({ currentAuthUserKeyRef: { current: null } });
  f.deps.localResetScopeRef.current.ownerId = null;
  f.launch();
  await f.confirm();
  assert.deepEqual(f.calls, [null]);
});

test("the actual render guard invalidates confirmation across account, auth-readiness and view transitions", () => {
  let guard;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(parsed).includes("resetScope.open"))
      guard = node.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(guard);
  const run = (f, open, tab, owner) => {
    f.deps.currentAuthUserKeyRef.current = owner;
    const js = ts.transpileModule(guard, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const dependencies = {
      ...f.deps,
      open,
      tab,
      resetScope: f.deps.localResetScopeRef.current,
    };
    new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
  };
  for (const transition of [
    [true, "storage", "b"],
    [true, "storage", undefined],
    [false, "storage", "a"],
    [true, "data", "a"],
  ]) {
    const f = fixture();
    f.launch();
    run(f, ...transition);
    assert.equal(f.deps.localResetConfirmationRef.current, null);
    assert.equal(f.deps.localResetScopeRef.current.generation, 1);
    run(f, true, "storage", "a");
    assert.equal(f.deps.localResetConfirmationRef.current, null);
    assert.equal(f.deps.localResetScopeRef.current.generation, 2);
  }
});
