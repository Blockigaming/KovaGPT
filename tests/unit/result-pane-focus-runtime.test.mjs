import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

// Execute the actual route's Result open/close/focus callbacks, with explicit
// commit and animation-frame steps. This is synthetic, not browser evidence.
const source = readFileSync("src/routes/index.tsx", "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const expressions = {};
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    ["scheduleResultFocus", "openResult", "closeResult"].includes(node.name.getText(ast))
  )
    expressions[node.name.getText(ast)] = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
};
visit(ast);
assert.equal(Object.keys(expressions).length, 3);
const compiled = ts.transpileModule(
  `globalThis.renderCallbacks = (result, resultReturnOrigin, nextPromptScope) => {
  ${Object.entries(expressions)
    .map(([name, expression]) => `const ${name} = ${expression};`)
    .join("\n")}
  return { openResult, closeResult };
};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture({ wide = false } = {}) {
  const focused = [],
    frames = [],
    listeners = new Map(),
    calls = [];
  class Element {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
      this.children = new Set();
    }
    contains(target) {
      return target === this || this.children.has(target);
    }
    getClientRects() {
      return this.hidden || this.parent?.hidden ? [] : [1];
    }
    closest() {
      return this.inert || this.ariaHidden ? {} : null;
    }
    matches() {
      return Boolean(this.disabled || this.ariaDisabled);
    }
    focus(options) {
      focused.push({ name: this.name, preventScroll: options.preventScroll });
      document.activeElement = this;
    }
  }
  const opener = new Element("Open code result"),
    conversation = new Element("Conversation"),
    resultPane = new Element("Result pane"),
    resultTab = new Element("Result tab"),
    close = new Element("Close result");
  conversation.children.add(opener);
  opener.parent = conversation;
  resultPane.children.add(close);
  const document = {
    body: new Element("body"),
    activeElement: opener,
    getElementById(id) {
      if (id === "conversation-pane") return conversation;
      if (id === "result-tab") return !wide && context.resultRef.current ? resultTab : null;
      if (id === "result-pane") return context.resultRef.current ? resultPane : null;
      return null;
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
  };
  const window = {
    location: { href: "https://kova.test/" },
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {}, // Deliberately retain callbacks to test invalidation too.
    addEventListener: document.addEventListener,
    removeEventListener: document.removeEventListener,
  };
  const { sameNextPromptScope } = loadUiModule("src/lib/chat-send-next.ts", {});
  const { restoreDialogFocus } = loadUiModule("src/lib/dialog-return-focus.ts", {}, { window });
  const scope = {
    principal: "owner-a",
    conversationId: "chat-a",
    temporary: false,
    temporaryContext: "clean",
    lifetime: 1,
  };
  const context = {
    document,
    window,
    HTMLElement: Element,
    sameNextPromptScope,
    restoreDialogFocus,
    storagePrincipal: "owner-a",
    activeId: "chat-a",
    storageGenerationRef: { current: 3 },
    nextPromptMountedRef: { current: true },
    nextPromptScopeRef: { current: scope },
    resultRef: { current: null },
    resultReturnRef: { current: null },
    resultFocusCleanupRef: { current: null },
    resultDraftsRef: { current: new Map() },
    resultScopeRef: { current: null },
    setResult(next) {
      calls.push(["result", next]);
    },
    setResultTab(next) {
      context.tab = next;
    },
    tab: "conversation",
  };
  vm.runInNewContext(compiled, context);
  const descriptor = {
    title: "Code result",
    initialContent: "const exact = true;",
    kind: "code",
    chatId: "chat-a",
    messageId: "message-a",
  };
  const render = () =>
    context.renderCallbacks(
      context.resultRef.current,
      context.resultReturnRef.current,
      context.nextPromptScopeRef.current,
    );
  const commit = () => {
    conversation.hidden = Boolean(
      context.resultRef.current && !wide && context.tab !== "conversation",
    );
    close.isConnected = Boolean(context.resultRef.current);
    if (!document.activeElement?.isConnected) document.activeElement = document.body;
  };
  const flush = () => {
    commit();
    const pending = frames.splice(0);
    for (const frame of pending) frame();
  };
  const open = () => {
    render().openResult(descriptor, opener);
    flush();
    document.activeElement = close;
  };
  const dispatch = (type) => {
    for (const handler of [...(listeners.get(type) ?? [])]) handler();
  };
  return {
    context,
    document,
    window,
    focused,
    frames,
    calls,
    listeners,
    Element,
    opener,
    conversation,
    resultPane,
    resultTab,
    close,
    descriptor,
    render,
    commit,
    flush,
    open,
    dispatch,
  };
}

for (const wide of [false, true]) {
  test(`Result opening still focuses ${wide ? "the split pane" : "the mobile tab"}; close returns its exact opener after commit`, () => {
    const f = fixture({ wide });
    f.document.activeElement = f.document.body; // Pointer opening need not focus the button.
    f.render().openResult(f.descriptor, f.opener);
    f.flush();
    assert.equal(f.document.activeElement, wide ? f.resultPane : f.resultTab);
    f.document.activeElement = f.close;
    f.focused.length = 0;
    f.render().closeResult();
    assert.deepEqual(f.focused, [], "wait until Conversation is revealed");
    assert.equal(f.context.resultRef.current, null);
    assert.equal(f.context.resultDraftsRef.current.size, 0);
    f.flush();
    assert.equal(f.document.activeElement, f.opener);
    assert.deepEqual(f.focused, [{ name: "Open code result", preventScroll: true }]);
  });
}

for (const unavailable of [
  "detached",
  "hidden",
  "disabled",
  "ariaDisabled",
  "inert",
  "ariaHidden",
  "unrelated",
]) {
  test(`Result close uses stable Conversation when its opener is ${unavailable}`, () => {
    const f = fixture();
    f.open();
    if (unavailable === "detached") f.opener.isConnected = false;
    else if (unavailable === "unrelated") f.conversation.children.delete(f.opener);
    else f.opener[unavailable] = true;
    f.render().closeResult();
    f.flush();
    assert.equal(f.document.activeElement, f.conversation);
  });
}

test("a restored session draft without a mounted original opener closes to Conversation", () => {
  const f = fixture();
  f.context.resultRef.current = f.descriptor;
  f.context.resultScopeRef.current = "owner-a:chat-a";
  f.context.resultDraftsRef.current.set("owner-a:chat-a", f.descriptor);
  f.document.activeElement = f.close;
  f.render().closeResult();
  f.flush();
  assert.equal(f.document.activeElement, f.conversation);
});

for (const event of ["pointerdown", "keydown", "focusin", "blur"]) {
  test(`later ${event} cancels Result close focus without reopening its discarded session`, () => {
    const f = fixture();
    f.open();
    f.focused.length = 0;
    f.render().closeResult();
    f.dispatch(event);
    f.flush();
    assert.deepEqual(f.focused, []);
    assert.equal(f.context.resultRef.current, null);
    assert.equal(f.context.resultDraftsRef.current.size, 0);
    assert.equal(
      [...f.listeners.values()].reduce((sum, set) => sum + set.size, 0),
      0,
    );
  });
}

for (const boundary of [
  "account",
  "conversation",
  "temporary",
  "lifetime",
  "reset",
  "navigation",
  "unmount",
  "later-focus",
  "new-result",
]) {
  test(`Result return cannot steal focus across ${boundary}`, () => {
    const f = fixture();
    f.open();
    f.focused.length = 0;
    f.render().closeResult();
    const scope = f.context.nextPromptScopeRef.current;
    if (boundary === "account")
      f.context.nextPromptScopeRef.current = { ...scope, principal: "owner-b" };
    if (boundary === "conversation")
      f.context.nextPromptScopeRef.current = { ...scope, conversationId: "chat-b" };
    if (boundary === "temporary")
      f.context.nextPromptScopeRef.current = { ...scope, temporary: true };
    if (boundary === "lifetime") f.context.nextPromptScopeRef.current = { ...scope, lifetime: 2 };
    if (boundary === "reset") f.context.storageGenerationRef.current++;
    if (boundary === "navigation") f.window.location.href += "?next";
    if (boundary === "unmount") f.context.nextPromptMountedRef.current = false;
    if (boundary === "later-focus") f.document.activeElement = new f.Element("later field");
    if (boundary === "new-result")
      f.context.resultRef.current = { ...f.descriptor, messageId: "message-b" };
    f.flush();
    assert.deepEqual(f.focused, []);
  });
}

test("an old Result close callback cannot close a newer opening of the same cached descriptor", () => {
  const f = fixture();
  f.open();
  const oldClose = f.render().closeResult;
  f.render().openResult(f.descriptor, f.opener);
  const count = f.calls.length;
  oldClose();
  assert.equal(f.calls.length, count);
  assert.equal(f.context.resultRef.current, f.descriptor);
  f.flush();
  assert.equal(f.document.activeElement, f.resultTab);
});

test("rapid open then close cancels the old Result reveal and restores the opener once", () => {
  const f = fixture();
  f.render().openResult(f.descriptor, f.opener);
  f.document.activeElement = f.close;
  f.render().closeResult();
  f.flush();
  assert.deepEqual(f.focused, [{ name: "Open code result", preventScroll: true }]);
});

for (const boundary of ["account", "conversation", "lifetime", "reset", "navigation", "unmount"]) {
  test(`stale Result close is inert after ${boundary}`, () => {
    const f = fixture();
    f.open();
    const close = f.render().closeResult,
      scope = f.context.nextPromptScopeRef.current;
    if (boundary === "account")
      f.context.nextPromptScopeRef.current = { ...scope, principal: "owner-b" };
    if (boundary === "conversation")
      f.context.nextPromptScopeRef.current = { ...scope, conversationId: "chat-b" };
    if (boundary === "lifetime") f.context.nextPromptScopeRef.current = { ...scope, lifetime: 2 };
    if (boundary === "reset") f.context.storageGenerationRef.current++;
    if (boundary === "navigation") f.window.location.href += "?next";
    if (boundary === "unmount") f.context.nextPromptMountedRef.current = false;
    const count = f.calls.length;
    close();
    assert.equal(f.calls.length, count);
    assert.equal(f.context.resultRef.current, f.descriptor);
  });
}

test("Result opener wiring carries the exact button; Conversation is a stable named focus fallback", () => {
  const message = readFileSync("src/components/ChatMessage.tsx", "utf8");
  assert.match(message, /openResult\("edit", event\.currentTarget\)/);
  assert.match(message, /onOpenResult\([\s\S]{0,750}trigger,\s*\)/);
  assert.match(source, /id="conversation-pane"\s+tabIndex=\{-1\}\s+aria-label="Conversation"/);
  assert.match(source, /onClose=\{closeResult\}/);
  assert.match(source, /useEffect\(\(\) => \(\) => resultFocusCleanupRef\.current\?\.\(\), \[\]\)/);
});
