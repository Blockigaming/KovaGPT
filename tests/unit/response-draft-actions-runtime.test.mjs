import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { appendFollowupToDraft } from "../../src/lib/response-followups.mjs";

function parse(path) {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
const route = parse("src/routes/index.tsx");
const message = parse("src/components/ChatMessage.tsx");
const store = parse("src/lib/chat-store.ts");
function find(root, predicate) {
  let found;
  const visit = (node) => {
    if (!found && predicate(node)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(found, "Expected source implementation");
  return found;
}
const initializer = (root, name) =>
  find(root, (node) => ts.isVariableDeclaration(node) && node.name.getText(root) === name)
    .initializer;
const attribute = (root, name, includes) =>
  find(
    root,
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(root) === name &&
      node.getText(root).includes(includes),
  ).initializer.expression.getText(root);
const arrow = (name) => initializer(route, name).arguments[0].getText(route);
const stopMarker = find(
  store,
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "markAssistantStopped",
)
  .getText(store)
  .replace(/^export /, "");
const helpers = readFileSync("src/lib/chat-send-next.ts", "utf8")
  .replace(/^import type.*;$/gm, "")
  .replace(/^export /gm, "");
const restore = readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace(/^export /gm, "");
const compiled = ts.transpileModule(
  `
${helpers}
${restore}
${stopMarker}
${find(route, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "pendingMessageAttachments").getText(route)}
globalThis.setInput = ${arrow("setInput")};
globalThis.prepare = ${initializer(route, "prepareResponseDraft").getText(route)};
globalThis.readDraft = () => ${attribute(route, "onDraftPrompt", "prepareResponseDraft")};
globalThis.readSuggestion = () => ${attribute(route, "onSelectSuggestion", "prepareResponseDraft")};
globalThis.readExecution = () => ${attribute(route, "onFollowUp", "send(prompt")};
globalThis.readRetry = () => ${attribute(route, "onRetry", "retryableFailedResponsesRef")};
globalThis.stop = ${arrow("stop")};
globalThis.continueResponse = ${attribute(message, "onSelect", "Continue from here without")};
globalThis.askSelection = ${attribute(message, "onClick", "Selected passage:")};
globalThis.closeMenu = ${attribute(message, "onCloseAutoFocus", "studyOpeningRef")};
globalThis.closeAsk = ${attribute(message, "onCloseAutoFocus", "if (!focusDraft) return")};
`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

// Source-executed callbacks and synthetic elements, not browser/Radix focus proof.
function fixture(draft = "keep draft") {
  const requests = [],
    focused = [];
  const document = { body: {}, activeElement: {} };
  const textarea = {
    isConnected: true,
    visible: true,
    hidden: false,
    disabled: false,
    getClientRects() {
      return this.visible ? [1] : [];
    },
    closest() {
      return this.hidden ? {} : null;
    },
    matches() {
      return this.disabled;
    },
    focus(options) {
      focused.push(options);
      document.activeElement = this;
    },
  };
  const scope = {
    principal: "owner-a",
    conversationId: "chat-a",
    temporary: false,
    temporaryContext: "clean",
    lifetime: 1,
  };
  const priorUser = { id: "user-a", role: "user", content: "Explain this", attachments: [] };
  const partial = {
    id: "assistant-a",
    role: "assistant",
    content: "This partial answer",
    generationStatus: "stopped",
  };
  const files = [{ name: "keep.txt", kind: "text_file", status: "complete" }];
  const context = {
    document,
    window: { location: { href: "https://local.invalid/?chat=chat-a" } },
    responseDraftUrl: "https://local.invalid/?chat=chat-a",
    responseDraftGeneration: 1,
    storageGenerationRef: { current: 1 },
    principalReady: true,
    storagePrincipal: "owner-a",
    storagePrincipalRef: { current: "owner-a" },
    nextPromptMountedRef: { current: true },
    nextPromptScope: scope,
    nextPromptScopeRef: { current: scope },
    nextPromptRef: { current: null },
    inFlightRef: { current: false },
    inFlightTargetRef: { current: null },
    abortRef: { current: null },
    retryGenerationRef: { current: 0 },
    retryTimerRef: { current: null },
    retryableFailedResponsesRef: { current: new Set() },
    workspaceRef: { current: { querySelector: () => textarea } },
    composerRevisionRef: { current: 0 },
    composerDraftRef: { current: { text: draft, attachments: files, tool: "web_search" } },
    input: draft,
    setInputState(value) {
      context.input = value;
    },
    appendFollowupToDraft,
    prepareResponseDraft: (...args) => context.prepare(...args),
    send: (...args) => requests.push(args),
    responseDraftFocusRef: { current: null },
    studyOpeningRef: { current: false },
    memoryReviewOpeningRef: { current: false },
    selectionQuestion: "  What does this mean? ",
    lastSelectionRef: { current: "exact selected passage" },
    selectionAskPassage: "exact selected passage",
    setSelectionAskOpen(value) {
      context.selectionAskOpen = value;
    },
    selectionAskOpen: true,
    isLastAssistant: true,
    isStreaming: false,
    priorUser,
    m: partial,
    active: { id: "chat-a", messages: [priorUser, partial] },
    conversations: [{ id: "chat-a", messages: [priorUser, partial] }],
    updateRequestNotice() {},
    updateNextPrompt(value) {
      context.nextPromptRef.current = value;
    },
    clearRetryTimer(ref) {
      ref.current = null;
    },
    setIsStreaming(value) {
      context.isStreaming = value;
    },
    setSelectedTool() {
      throw new Error("A draft action must preserve its selected tool");
    },
    setConversations(update) {
      context.conversations = update(context.conversations);
    },
    DOMException,
    USER_STOP_REASON: "kova_user_stopped_generation",
  };
  vm.runInNewContext(compiled, context);
  context.onDraftPrompt = context.readDraft();
  const close = (kind = "menu") => {
    document.activeElement = document.body;
    let prevented = 0;
    context[kind === "menu" ? "closeMenu" : "closeAsk"]({
      preventDefault() {
        prevented++;
      },
    });
    return prevented;
  };
  return { context, textarea, document, requests, focused, files, partial, close };
}
const continuation = "Continue from here without repeating what you have already written.";

for (const draft of ["keep draft", "Keep this\n draft \t", " \n\t", ""]) {
  test(`Continue preserves the exact ${JSON.stringify(draft)} draft, files, tool, and partial response without sending`, () => {
    const f = fixture(draft);
    f.context.continueResponse();
    assert.equal(f.context.input, draft ? `${draft}\n\n${continuation}` : continuation);
    assert.equal(f.context.composerDraftRef.current.attachments, f.files);
    assert.equal(f.context.composerDraftRef.current.tool, "web_search");
    assert.equal(f.context.conversations[0].messages[1], f.partial);
    assert.equal(f.partial.content, "This partial answer");
    assert.equal(f.partial.generationStatus, "stopped");
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.focused, []);
    assert.equal(f.close(), 1);
    assert.equal(f.focused.length, 1);
    assert.equal(f.focused[0].preventScroll, true);
    f.close();
    assert.equal(f.focused.length, 1, "Focus intent is consumed only once");
  });
}

test("Stop flushes and retains partial prose; Continue drafts; Retry remains a distinct explicit request", () => {
  const f = fixture();
  const controller = new AbortController();
  f.context.inFlightRef.current = true;
  f.context.isStreaming = true;
  delete f.partial.generationStatus;
  f.context.inFlightTargetRef.current = {
    controller,
    conversationId: "chat-a",
    assistantMessageId: f.partial.id,
    flushPendingContent() {
      f.partial.content += " and pending words";
    },
  };
  f.context.stop();
  assert.equal(controller.signal.aborted, true);
  assert.equal(
    f.context.conversations[0].messages[1].content,
    "This partial answer and pending words",
  );
  assert.equal(f.context.conversations[0].messages[1].generationStatus, "stopped");
  f.context.continueResponse();
  assert.equal(f.context.input, `keep draft\n\n${continuation}`);
  assert.equal(f.requests.length, 0);
  f.context.readRetry()();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0][0], "Explain this");
  assert.equal(f.requests[0][4], "chat-a");
});

test("selection Ask adds the exact passage to the draft and focuses only after closing", () => {
  const f = fixture();
  f.context.lastSelectionRef.current = ""; // Dialog focus may collapse the original range.
  f.context.askSelection();
  assert.equal(
    f.context.input,
    "keep draft\n\nWhat does this mean?\n\nSelected passage:\nexact selected passage",
  );
  assert.equal(f.context.selectionAskOpen, false);
  assert.deepEqual(f.requests, []);
  assert.equal(f.close("ask"), 1);
  assert.equal(f.focused.length, 1);
});

test("supplied suggestions share draft preparation while editor improvements retain execution intent", () => {
  const f = fixture();
  f.context.readSuggestion()("Explain more");
  assert.equal(f.context.input, "keep draft\n\nExplain more");
  assert.equal(f.focused.length, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(attribute(message, "onImprove", "onFollowUp"), "onFollowUp");
  f.context.readExecution()("Improve this artifact");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0][0], "Improve this artifact");
});

const boundaries = {
  account: (f) => {
    f.context.storagePrincipalRef.current = "owner-b";
  },
  chat: (f) => {
    f.context.nextPromptScopeRef.current = {
      ...f.context.nextPromptScope,
      conversationId: "chat-b",
    };
  },
  "account ABA": (f) => {
    f.context.nextPromptScopeRef.current = { ...f.context.nextPromptScope, lifetime: 3 };
  },
  "account clear": (f) => {
    f.context.storageGenerationRef.current++;
  },
  temporary: (f) => {
    f.context.nextPromptScopeRef.current = { ...f.context.nextPromptScope, temporary: true };
  },
  route: (f) => {
    f.context.window.location.href = "https://local.invalid/projects";
  },
  unresolved: (f) => {
    f.context.principalReady = false;
  },
  unmount: (f) => {
    f.context.nextPromptMountedRef.current = false;
  },
  "new stream": (f) => {
    f.context.inFlightRef.current = true;
  },
};
for (const [name, change] of Object.entries(boundaries)) {
  test(`${name} invalidates a stale draft action before insertion or focus`, () => {
    const stale = fixture();
    change(stale);
    stale.context.continueResponse();
    assert.equal(stale.context.input, "keep draft");
    assert.equal(stale.context.responseDraftFocusRef.current, null);
    assert.deepEqual(stale.requests, []);
    const pending = fixture();
    pending.context.continueResponse();
    change(pending);
    pending.close();
    assert.equal(pending.focused.length, 0);
    assert.deepEqual(pending.requests, []);
  });
}
for (const [name, change] of Object.entries({
  detached: (f) => {
    f.textarea.isConnected = false;
  },
  hidden: (f) => {
    f.textarea.hidden = true;
  },
  invisible: (f) => {
    f.textarea.visible = false;
  },
  disabled: (f) => {
    f.textarea.disabled = true;
  },
  "new draft": (f) => {
    f.context.setInput("a later edit");
  },
  "new focus": (f) => {
    f.document.activeElement = {};
  },
})) {
  test(`${name} prevents a late popup from stealing composer focus`, () => {
    const f = fixture();
    f.context.continueResponse();
    change(f);
    f.context.closeMenu({ preventDefault() {} });
    assert.equal(f.focused.length, 0);
  });
}

test("draft actions are unavailable while streaming or on earlier replies and explain the deliberate send", () => {
  const f = fixture();
  f.context.isStreaming = true;
  assert.equal(f.context.readDraft(), undefined);
  f.context.isStreaming = false;
  f.context.isLastAssistant = false;
  assert.equal(f.context.readDraft(), undefined);
  assert.match(message.text, /Adds to your draft\. Send when ready\./);
  assert.match(
    message.text,
    /Your question and selected text will be added to your draft\. Send when ready\./,
  );
  assert.match(message.text, /<DropdownMenuItem onSelect=\{onRetry\}>/);
});
