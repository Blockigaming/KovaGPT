import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const routeSource = readFileSync("src/routes/index.tsx", "utf8");
const route = ts.createSourceFile(
  "index.tsx",
  routeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let close;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(route) === "changeComposerVoiceMode")
    close = node.initializer.getText(route);
  ts.forEachChild(node, visit);
}
visit(route);
assert.ok(close);
const compile = ts.transpileModule(
  readFileSync("src/lib/chat-send-next.ts", "utf8")
    .replace(/^import type.*;$/gm, "")
    .replace(/^export /gm, "") +
    readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(/^export /gm, "") +
    `\nglobalThis.change = ${close};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

function fixture() {
  const focused = [],
    frames = [],
    listeners = new Map();
  const body = {};
  let destination;
  const target = (name) => ({
    isConnected: true,
    visible: true,
    inert: false,
    disabled: false,
    getClientRects() {
      return this.visible ? [1] : [];
    },
    closest() {
      return this.inert ? {} : null;
    },
    matches() {
      return this.disabled;
    },
    focus(options) {
      focused.push([name, options]);
      context.document.activeElement = this;
    },
  });
  const oldInvoker = target("old-invoker");
  const replacement = target("replacement-voice");
  const input = target("draft-input");
  destination = replacement;
  const context = {
    window: {
      location: { href: "https://local.invalid/" },
      requestAnimationFrame(callback) {
        frames.push(callback);
      },
      addEventListener(type, callback) {
        listeners.set(type, callback);
      },
      removeEventListener(type, callback) {
        if (listeners.get(type) === callback) listeners.delete(type);
      },
    },
    document: {
      body,
      activeElement: oldInvoker,
      addEventListener(type, callback) {
        listeners.set(type, callback);
      },
      removeEventListener(type, callback) {
        if (listeners.get(type) === callback) listeners.delete(type);
      },
    },
    active: { id: "chat-a", messages: [] },
    composerVoiceSessionRef: {
      current: {
        mode: "voice",
        ownerId: "owner-a",
        generation: 1,
        openedUrl: "https://local.invalid/",
        scope: {
          principal: "user:owner-a",
          conversationId: "chat-a",
          temporary: false,
          temporaryContext: "clean",
          lifetime: 2,
        },
      },
    },
    storagePrincipalRef: { current: "user:owner-a" },
    storageGenerationRef: { current: 1 },
    nextPromptScopeRef: {
      current: {
        principal: "user:owner-a",
        conversationId: "chat-a",
        temporary: false,
        temporaryContext: "clean",
        lifetime: 2,
      },
    },
    nextPromptMountedRef: { current: true },
    workspaceRef: {
      current: {
        querySelector(selector) {
          return selector.includes("voice-button") ? destination : input;
        },
      },
    },
    setComposerVoiceMode(value) {
      context.mode = value;
    },
  };
  vm.runInNewContext(compile, context);
  return {
    context,
    focused,
    frames,
    listeners,
    replacement,
    input,
    oldInvoker,
    close() {
      context.change(null);
    },
    commit() {
      oldInvoker.isConnected = false;
      context.document.activeElement = body;
    },
    flush() {
      frames.splice(0).forEach((callback) => callback());
    },
    draft() {
      destination = null;
    },
  };
}

test("empty Voice close resolves the replacement opener after commit, without focusing the removed invoker", () => {
  const f = fixture();
  f.close();
  assert.equal(f.context.mode, null);
  assert.equal(f.context.composerVoiceSessionRef.current, null);
  assert.equal(f.focused.length, 0);
  f.commit();
  f.flush();
  assert.equal(f.focused.length, 1);
  assert.equal(f.focused[0][0], "replacement-voice");
  assert.equal(f.focused[0][1].preventScroll, true);
  assert.equal(f.listeners.size, 0);
});

test("a draft returns to the replacement textarea when its primary Voice action is hidden", () => {
  const f = fixture();
  f.draft();
  f.close();
  f.commit();
  f.flush();
  assert.equal(f.focused[0][0], "draft-input");
});

for (const boundary of [
  "account",
  "generation",
  "context",
  "context-roundtrip",
  "unmount",
  "reopen",
  "navigate",
  "other-focus",
  "pointerdown",
  "keydown",
  "blur",
  "hidden",
  "inert",
  "disabled",
  "detached",
]) {
  test(`empty Voice close does not take focus after ${boundary}`, () => {
    const f = fixture();
    f.close();
    f.commit();
    if (boundary === "account") f.context.storagePrincipalRef.current = "user:owner-b";
    if (boundary === "generation") f.context.storageGenerationRef.current++;
    if (boundary === "context") f.context.nextPromptScopeRef.current.conversationId = "chat-b";
    if (boundary === "context-roundtrip") f.context.nextPromptScopeRef.current.lifetime += 2;
    if (boundary === "unmount") f.context.nextPromptMountedRef.current = false;
    if (boundary === "reopen") f.context.composerVoiceSessionRef.current = {};
    if (boundary === "navigate") f.context.window.location.href += "library";
    if (boundary === "other-focus") f.context.document.activeElement = {};
    if (["pointerdown", "keydown", "blur"].includes(boundary)) f.listeners.get(boundary)();
    if (boundary === "hidden") f.replacement.visible = false;
    if (boundary === "inert") f.replacement.inert = true;
    if (boundary === "disabled") f.replacement.disabled = true;
    if (boundary === "detached") f.replacement.isConnected = false;
    f.flush();
    assert.equal(f.focused.length, 0);
    assert.equal(f.listeners.size, 0);
  });
}

test("completed conversations retain the existing dialog focus path instead of scheduling a replacement", () => {
  const f = fixture();
  f.context.active.messages.push({ role: "assistant" });
  f.close();
  assert.equal(f.frames.length, 0);
  assert.equal(f.listeners.size, 0);
});
