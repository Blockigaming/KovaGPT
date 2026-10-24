import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/Sidebar.tsx", "utf8");
const file = ts.createSourceFile(
  "Sidebar.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const pieces = {};
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "restoreChatActionFocus")
    pieces.restore = node.getText(file);
  if (
    ts.isVariableDeclaration(node) &&
    ["closeRename", "beginRename", "requestCloseRename", "keepRename", "chatOptionsRefs"].includes(
      node.name.getText(file),
    )
  )
    pieces[node.name.getText(file)] = node.initializer.getText(file);
  if (ts.isJsxAttribute(node) && node.name.getText(file) === "onCloseAutoFocus")
    pieces.archiveClose = node.initializer.expression.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
function compile(code, deps = {}) {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(deps), js)(...Object.values(deps));
}
const restore = compile(`${pieces.restore}; return restoreChatActionFocus;`);
function target(name, calls, properties = {}) {
  return {
    isConnected: true,
    offsetParent: {},
    closest: () => null,
    focus: () => calls.push(name),
    ...properties,
  };
}
function sidebar(rows, newChat) {
  return {
    querySelectorAll: (selector) => (selector === ".kova-chat-row-main" ? rows : [newChat]),
  };
}

test("rename closes the native dialog before restoring focus to the retained chat trigger", () => {
  const calls = [];
  const button = target("focus", calls);
  const returnFocus = { current: { target: button, context: "owner:/chat:true" } };
  const close = compile(`return (${pieces.closeRename});`, {
    renameReturnFocusRef: returnFocus,
    renameDialogRef: { current: { close: () => calls.push("close") } },
    setRenameChat: (value) => calls.push(["rename", value]),
    chatActionContextRef: { current: "owner:/chat:true" },
    drawerRef: { current: null },
    restoreChatActionFocus: restore,
  });
  close();
  assert.deepEqual(calls, ["close", ["rename", null], "focus"]);
  assert.equal(returnFocus.current, null);
});

test("rename completion never restores focus across account, route, or sidebar-state changes", () => {
  for (const context of ["other:/chat:true", "owner:/settings:true", "owner:/chat:false"]) {
    const calls = [];
    const close = compile(`return (${pieces.closeRename});`, {
      renameReturnFocusRef: {
        current: { target: target("wrong-focus", calls), context: "owner:/chat:true" },
      },
      renameDialogRef: { current: { close() {} } },
      setRenameChat() {},
      chatActionContextRef: { current: context },
      drawerRef: { current: null },
      restoreChatActionFocus: restore,
    });
    close();
    assert.deepEqual(calls, []);
  }
});

test("rename remembers the options trigger or the directly double-clicked chat row", () => {
  for (const direct of [false, true]) {
    const options = {},
      row = {},
      saved = { current: null };
    const begin = compile(`return (${pieces.beginRename});`, {
      renamePending: false,
      cancelPendingSelection() {},
      renameReturnFocusRef: saved,
      chatOptionsRefs: { current: new Map([["chat", options]]) },
      chatActionContextRef: { current: "current" },
      setRenameChat() {},
      setRenameTitle() {},
      setRenameDiscard() {},
      setRenameError() {},
    });
    begin({ id: "chat", title: "Name" }, direct ? row : undefined);
    assert.equal(saved.current.target, direct ? row : options);
  }
});

test("archive dropdown closure restores to a remaining chat, then New chat, avoiding hidden/detached controls", () => {
  for (const hasRemaining of [false, true]) {
    const calls = [];
    const remaining = target("remaining", calls),
      newChat = target("new-chat", calls);
    const pending = { current: { id: "removed", context: "current" } };
    const close = compile(`return (${pieces.archiveClose});`, {
      closePinMenu: () => false,
      archiveReturnFocusRef: pending,
      conversation: { id: "removed" },
      chatActionContextRef: { current: "current" },
      chatOptionsRefs: { current: new Map() },
      drawerRef: {
        current: sidebar(
          [target("hidden", calls, { offsetParent: null }), ...(hasRemaining ? [remaining] : [])],
          newChat,
        ),
      },
      restoreChatActionFocus: restore,
    });
    close({ preventDefault: () => calls.push("prevent") });
    assert.deepEqual(calls, ["prevent", hasRemaining ? "remaining" : "new-chat"]);
    assert.equal(pending.current, null);
  }
  const calls = [];
  restore(target("detached", calls, { isConnected: false }), null);
  restore(target("inert", calls, { closest: () => ({}) }), null);
  assert.deepEqual(calls, []);
});

test("ordinary dropdown closes and obsolete archive contexts do not trigger fallback focus", () => {
  for (const pending of [
    null,
    { id: "other", context: "current" },
    { id: "chat", context: "old" },
  ]) {
    let focused = false;
    const close = compile(`return (${pieces.archiveClose});`, {
      closePinMenu: () => false,
      archiveReturnFocusRef: { current: pending },
      conversation: { id: "chat" },
      chatActionContextRef: { current: "current" },
      chatOptionsRefs: { current: new Map() },
      drawerRef: { current: null },
      restoreChatActionFocus: () => {
        focused = true;
      },
    });
    close({ preventDefault() {} });
    assert.equal(focused, false);
  }
});

test("rename save, cancel, Escape, and backdrop share the same focus-aware close path", () => {
  assert.match(source, /else closeRename\(\)/);
  assert.match(source, /onClick=\{closeRename\}/);
  assert.match(source, /if \(renameDiscard\) keepRename\(\)/);
  assert.match(source, /event.clientY > bounds.bottom\s*\)\s*requestCloseRename\(\)/);
});

test("chat option registry uses the built-in Map when a navigation icon shares its name", () => {
  const registry = compile(`return (${pieces.chatOptionsRefs});`, {
    useRef: (value) => ({ current: value }),
    Map: () => {
      throw new Error("Navigation icon cannot construct a registry");
    },
  });
  assert.ok(registry.current instanceof globalThis.Map);
  registry.current.set("chat", "trigger");
  assert.equal(registry.current.get("chat"), "trigger");
});

test("dirty rename dismissal stays open, while clean and pending paths are bounded", () => {
  for (const [title, pending, expected] of [
    ["Changed", false, "confirm"],
    ["Original", false, "close"],
    ["Changed", true, null],
  ]) {
    const calls = [];
    const request = compile(`return (${pieces.requestCloseRename});`, {
      renamePending: pending,
      renameTitle: title,
      renameChat: { title: "Original" },
      setRenameDiscard: (value) => calls.push(value ? "confirm" : "clear"),
      closeRename: () => calls.push("close"),
    });
    request();
    assert.deepEqual(calls, expected ? [expected] : []);
  }
  assert.match(source, /ref=\{keepRenameRef\}/);
  assert.match(source, /hidden=\{renameDiscard\}/);
  assert.match(source, /aria-describedby=\{renameError \? "rename-chat-error"/);
});
