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
function handler(attribute, marker) {
  const matches = [];
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === attribute &&
      node.getText(parsed).includes(marker)
    )
      matches.push(node.initializer.expression.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1);
  return matches[0];
}
function compile(code, dependencies) {
  const javascript = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}
function fixture(overrides = {}) {
  const focused = [];
  const changes = [];
  const confirmations = [];
  const requests = [];
  const target = {
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: (options) => focused.push(options),
  };
  const window = { location: { href: "https://local.invalid/settings" } };
  const deleteAccountReturnRef = { current: null };
  const currentAuthUserKeyRef = { current: "owner-a" };
  const restoreSource = readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(
    "export function",
    "function",
  );
  const restoreDialogFocus = compile(`${restoreSource}; return restoreDialogFocus;`, { window });
  const launch = compile(`return (${handler("onAction", "deleteAccountReturnRef")});`, {
    deleteAccountReturnRef,
    window,
    userKey: "owner-a",
    open: true,
    tab: "data",
    isLoaded: true,
    currentAuthUserKeyRef,
    deleteAccountBusy: false,
    setDeleteConfirmation: (value) => confirmations.push(value),
    requestAccountDeletion: (...args) => requests.push(args),
    ...overrides,
    setDeleteAccountOpen: (value) => changes.push(["open", value]),
  });
  const dismiss = compile(`return (${handler("onOpenChange", "deleteAccountBusy")});`, {
    deleteAccountBusy: false,
    ...overrides,
    setDeleteAccountOpen: (value) => changes.push(["open", value]),
    setDeleteConfirmation: (value) => confirmations.push(value),
    requestAccountDeletion: (...args) => requests.push(args),
  });
  const close = compile(`return (${handler("onCloseAutoFocus", "deleteAccountReturnRef")});`, {
    deleteAccountReturnRef,
    currentAuthUserKeyRef,
    restoreDialogFocus,
    open: true,
    tab: "data",
    ...overrides,
  });
  return {
    target,
    window,
    focused,
    changes,
    confirmations,
    requests,
    dismiss: () => dismiss(false),
    currentAuthUserKeyRef,
    deleteAccountReturnRef,
    launch: () => launch({ currentTarget: target, target: { nested: true } }),
    close: () => {
      let prevented = false;
      close({
        preventDefault: () => {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
    },
  };
}

test("cancel returns focus to the exact deletion trigger without authorizing deletion", () => {
  const f = fixture();
  f.launch();
  assert.deepEqual(f.changes, [["open", true]]);
  assert.deepEqual(f.confirmations, [""]);
  f.dismiss();
  assert.deepEqual(f.changes, [
    ["open", true],
    ["open", false],
  ]);
  assert.deepEqual(f.confirmations, ["", ""]);
  assert.deepEqual(f.requests, []);
  f.close();
  assert.deepEqual(f.focused, [{ preventScroll: true }]);
  assert.equal(f.deleteAccountReturnRef.current, null);
  assert.match(source, /requestAccountDeletion\(deletionUserKey, "DELETE"\)/);
  assert.match(source, /deleteConfirmation !== "DELETE" \|\| deleteAccountBusy/);
  assert.doesNotMatch(source, /<AccountDeletionGraceView/);
});

test("closing deletion cannot focus a stale, hidden, disabled, or departed account trigger", () => {
  const cases = [
    (f) => {
      f.target.isConnected = false;
    },
    (f) => {
      f.target.getClientRects = () => [];
    },
    (f) => {
      f.target.closest = () => ({});
    },
    (f) => {
      f.target.matches = () => true;
    },
    (f) => {
      f.window.location.href += "/elsewhere";
    },
    (f) => {
      f.currentAuthUserKeyRef.current = "owner-b";
    },
  ];
  for (const change of cases) {
    const f = fixture();
    f.launch();
    change(f);
    f.close();
    assert.deepEqual(f.focused, []);
  }
  for (const overrides of [{ open: false }, { tab: "storage" }]) {
    const f = fixture(overrides);
    f.launch();
    f.close();
    assert.deepEqual(f.focused, []);
  }
});

test("unresolved or changed account cannot open the production deletion dialog", () => {
  for (const overrides of [
    { isLoaded: false },
    { open: false },
    { tab: "storage" },
    { userKey: null },
    { deleteAccountBusy: true },
  ]) {
    const f = fixture(overrides);
    f.launch();
    assert.deepEqual(f.changes, []);
  }
  const changed = fixture();
  changed.currentAuthUserKeyRef.current = "owner-b";
  changed.launch();
  assert.deepEqual(changed.changes, []);
});

test("a pending deletion request keeps its dialog and confirmation until completion", () => {
  const f = fixture({ deleteAccountBusy: true });
  f.dismiss();
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.confirmations, []);
  assert.deepEqual(f.requests, []);
});
