import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("src/routes/index.tsx", "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let schedule;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "scheduleNextPromptFocus")
    schedule = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(schedule);
const helpers = readFileSync("src/lib/chat-send-next.ts", "utf8")
  .replace(/^import type.*;$/gm, "")
  .replace(/^export /gm, "");
const restore = readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(/^export /gm, "");
const compiled = ts.transpileModule(`${helpers}\n${restore}\nglobalThis.schedule = ${schedule};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const focused = [],
    frames = [],
    listeners = new Map();
  const scope = {
    principal: "a",
    conversationId: "chat-a",
    temporary: false,
    temporaryContext: "clean",
    lifetime: 0,
  };
  const document = {
    body: {},
    activeElement: null,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  const target = (name) => ({
    isConnected: true,
    getClientRects: () => [1],
    closest: () => null,
    matches: () => false,
    focus(options) {
      focused.push({ name, options });
      document.activeElement = this;
    },
  });
  const cancel = target("Cancel next message"),
    input = target("Message KovaGPT");
  const composer = {
    isConnected: true,
    querySelector(selector) {
      return selector === "[data-next-prompt-cancel]" ? cancel : input;
    },
  };
  const trigger = { closest: () => composer };
  document.activeElement = trigger;
  const next = { id: "next-a", scope };
  const context = {
    document,
    window: {
      location: { href: "https://example.invalid/" },
      requestAnimationFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame() {},
      addEventListener: document.addEventListener,
      removeEventListener: document.removeEventListener,
    },
    nextPromptMountedRef: { current: true },
    nextPromptFocusCleanupRef: { current: null },
    nextPromptScopeRef: { current: scope },
    nextPromptRef: { current: next },
  };
  vm.runInNewContext(compiled, context);
  return { context, document, trigger, composer, cancel, input, next, focused, frames, listeners };
}

test("explicit queue moves focus from a disabled trigger/body to its local Cancel action", () => {
  const f = fixture();
  f.context.schedule(f.trigger, "queued", f.next);
  assert.equal(f.focused.length, 0);
  f.document.activeElement = f.document.body;
  f.frames[0]();
  assert.equal(f.focused[0].name, "Cancel next message");
  assert.equal(f.focused[0].options.preventScroll, true);
  assert.equal(f.listeners.size, 0);
});

test("explicit Cancel returns focus to the same composer's textarea after the button disappears", () => {
  const f = fixture();
  f.context.nextPromptRef.current = null;
  f.context.schedule(f.trigger, "composer", null);
  f.document.activeElement = f.document.body;
  f.frames[0]();
  assert.equal(f.focused[0].name, "Message KovaGPT");
});

for (const event of ["pointerdown", "keydown", "focusin", "blur"]) {
  test(`later ${event} prevents a queued focus handoff`, () => {
    const f = fixture();
    f.context.schedule(f.trigger, "queued", f.next);
    f.listeners.get(event)();
    f.document.activeElement = f.document.body;
    f.frames[0]();
    assert.equal(f.focused.length, 0);
    assert.equal(f.listeners.size, 0);
  });
}

for (const boundary of [
  "scope",
  "account ABA",
  "background hold",
  "dispatch",
  "unmount",
  "navigation",
  "removed composer",
  "new focus",
]) {
  test(`${boundary} cannot receive stale queue focus`, () => {
    const f = fixture();
    f.context.schedule(f.trigger, "queued", f.next);
    if (boundary === "scope")
      f.context.nextPromptScopeRef.current = { ...f.next.scope, conversationId: "chat-b" };
    if (boundary === "account ABA")
      f.context.nextPromptScopeRef.current = { ...f.next.scope, lifetime: 2 };
    if (boundary === "background hold")
      f.context.nextPromptRef.current = { ...f.next, status: "held" };
    if (boundary === "dispatch") f.context.nextPromptRef.current = null;
    if (boundary === "unmount") {
      f.context.nextPromptMountedRef.current = false;
      f.context.nextPromptFocusCleanupRef.current();
    }
    if (boundary === "navigation") f.context.window.location.href += "other";
    if (boundary === "removed composer") f.composer.isConnected = false;
    if (boundary === "new focus") f.document.activeElement = {};
    f.frames[0]();
    assert.equal(f.focused.length, 0);
  });
}

test("replacement focus intent cancels the older frame and background state changes never schedule focus", () => {
  const f = fixture();
  f.context.schedule(f.trigger, "queued", f.next);
  f.context.nextPromptRef.current = null;
  f.context.schedule(f.trigger, "composer", null);
  f.frames[0]();
  assert.equal(f.focused.length, 0);
  f.frames[1]();
  assert.equal(f.focused[0].name, "Message KovaGPT");
  assert.equal((source.match(/scheduleNextPromptFocus\(/g) ?? []).length, 4);
  assert.match(source, /scheduleNextPromptFocus\(trigger, "queued", next\)/);
  assert.match(source, /scheduleNextPromptFocus\(event\?\.currentTarget, "composer", null\)/);
  assert.match(
    source,
    /scheduleNextPromptFocus\(event\.currentTarget, "composer", nextPromptRef\.current\)/,
  );
  const composer = readFileSync("src/components/ChatInput.tsx", "utf8");
  assert.match(composer, /onSendNext\(selectedToolRef.current, event\?\.currentTarget\)/);
});

test("explicit quota recovery returns focus to the composer without disturbing a held next message", () => {
  const f = fixture();
  f.context.schedule(f.trigger, "composer", f.next);
  f.document.activeElement = f.document.body;
  f.frames[0]();
  assert.equal(f.focused[0].name, "Message KovaGPT");
  assert.equal(f.context.nextPromptRef.current, f.next);
});
