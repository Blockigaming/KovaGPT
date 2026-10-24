import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deferred, settle } from "../helpers/ui-state-harness.mjs";

const helperSource = readFileSync("src/lib/chat-send-next.ts", "utf8");
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helpers = await import(
  `data:text/javascript;base64,${Buffer.from(helperJs).toString("base64")}`
);
const source = readFileSync("src/routes/index.tsx", "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function find(predicate) {
  let result;
  function visit(node) {
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, "Expected source declaration");
  return result;
}
const initializer = (name) =>
  find((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name).initializer;
const arrow = (name) => initializer(name).arguments[0].getText(ast);
const effects = [];
function collect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect")
    effects.push(node.arguments[0].getText(ast));
  ts.forEachChild(node, collect);
}
collect(ast);
const dispatch = effects.find((effect) => effect.includes('next.status !== "ready"'));
const scopeEffect = effects.find((effect) =>
  effect.includes("next.scope.principal !== storagePrincipal"),
);
const unmountEffect = effects.find((effect) =>
  effect.includes("nextPromptMountedRef.current = true"),
);
const cancel = find(
  (node) =>
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(ast) === "button" &&
    node.children.some(
      (child) => ts.isJsxText(child) && child.text.includes("Cancel next message"),
    ),
)
  .openingElement.attributes.properties.find((prop) => prop.name?.getText(ast) === "onClick")
  .initializer.expression.getText(ast);
const sendSource = arrow("send").replace(
  'await import("@/lib/chat-summary-snapshot.mjs")',
  "await summaryModule",
);
const noticeScopeEffect = effects.find((effect) =>
  effect.includes("requestNotice === requestNoticeRef.current"),
);
const retryResponse = find(
  (node) =>
    ts.isJsxAttribute(node) &&
    node.name.getText(ast) === "onRetry" &&
    node.initializer?.getText(ast).includes("retryableFailedResponsesRef"),
);
const quotaScopeEffect = effects.find(
  (effect) => effect.includes("quotaRejectedDraftsRef.current") && effect.includes("retained"),
);
const keptPreviewAst = ts.createSourceFile(
  "QuotaRejectedDraftPreview.tsx",
  readFileSync("src/components/QuotaRejectedDraftPreview.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const keptPreviewDefinition = keptPreviewAst.statements
  .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "QuotaRejectedDraftPreview")
  .getText(keptPreviewAst)
  .replace(/^export /u, "");
const compiled = ts.transpileModule(
  `${keptPreviewDefinition}
  globalThis.pendingMessageAttachments = ${find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "pendingMessageAttachments").getText(ast)};
  globalThis.send = ${sendSource};\nglobalThis.queue = ${initializer("queueNextPrompt").getText(ast)};\nglobalThis.dispatch = ${dispatch};\nglobalThis.reconcileScope = ${scopeEffect};\nglobalThis.stop = ${arrow("stop")};\nglobalThis.cancel = ${cancel};\nglobalThis.startLifetime = ${unmountEffect};
  globalThis.reconcileNotice = ${noticeScopeEffect};
  globalThis.readVisibleNotice = () => ${initializer("visibleRequestNotice").getText(ast)};
  globalThis.renderNotice = (pending = false) => (${initializer("requestStatusPanel").getText(ast)})(pending);
  globalThis.readResponseRetry = () => ${retryResponse.initializer.expression.getText(ast)};
  globalThis.setInput = ${arrow("setInput")};
  globalThis.setAttachments = ${arrow("setAttachments")};
  globalThis.setSelectedTool = ${arrow("setSelectedTool")};
  globalThis.reconcileQuotaDrafts = ${quotaScopeEffect};
  globalThis.readQuotaDrafts = () => ${initializer("visibleQuotaRejectedDrafts").getText(ast)};
  globalThis.renderQuotaDrafts = () => ${initializer("quotaRejectedDraftPanel").getText(ast)};
  globalThis.readComposerPromptPanel = () => ${initializer("composerPromptPanel").getText(ast)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } },
).outputText;
const scope = () => ({
  principal: "owner-a",
  conversationId: "chat-a",
  temporary: false,
  temporaryContext: "clean",
});
function fixture() {
  const requests = [],
    streams = [],
    errors = [],
    timers = [],
    delays = [];
  let sequence = 0;
  const context = {
    ...helpers,
    React,
    Suspense: React.Suspense,
    SignInButton: ({ children }) => React.cloneElement(children, { "data-auth-dialog": "sign-in" }),
    composerRevisionRef: { current: 0 },
    quotaRejectedDrafts: [],
    quotaRejectedDraftsRef: { current: [] },
    visibleQuotaRejectedDrafts: [],
    limitDialogs: [],
    focusRequests: [],
    updateQuotaRejectedDrafts(drafts) {
      context.quotaRejectedDrafts = drafts;
      context.quotaRejectedDraftsRef.current = drafts;
    },
    requestNotice: null,
    visibleRequestNotice: null,
    requestNoticeRef: { current: null },
    updateRequestNotice(value) {
      context.requestNotice = value;
      context.requestNoticeRef.current = value;
    },
    retryableFailedResponsesRef: { current: new Set() },
    principalReady: true,
    userKey: "owner-a",
    isSignedIn: true,
    isLoaded: true,
    storagePrincipal: "owner-a",
    storagePrincipalRef: { current: "owner-a" },
    storageGenerationRef: { current: 1 },
    retryGenerationRef: { current: 0 },
    nextPrompt: null,
    nextPromptRef: { current: null },
    nextPromptMountedRef: { current: true },
    nextPromptFocusCleanupRef: { current: null },
    scheduleNextPromptFocus(...args) {
      context.focusRequests.push(args);
    },
    nextPromptScope: scope(),
    nextPromptScopeRef: { current: scope() },
    inFlightRef: { current: false },
    inFlightTargetRef: { current: null },
    abortRef: { current: null },
    retryTimerRef: { current: null },
    retryActionEpochRef: { current: new Map() },
    guestPromptTurnsRef: { current: 0 },
    activeId: "chat-a",
    activeIdRef: { current: "chat-a" },
    conversations: [{ id: "chat-a", messages: [], mode: "instant" }],
    input: "First message",
    attachments: [],
    selectedTool: null,
    composerDraftRef: { current: { text: "First message", attachments: [], tool: null } },
    editingMessage: null,
    mode: "instant",
    pendingWorkflowSkill: null,
    tempChat: false,
    tempChatContext: "clean",
    settings: { rememberAcross: false },
    isStreaming: false,
    canWriteChatHistory: () => true,
    chatHistoryView: () => ({ ready: true, writable: true }),
    hasPendingChatAttachments: (attachments) =>
      attachments.some((file) => file.status === "uploading" || file.status === "selected"),
    newId: () => `id-${++sequence}`,
    updateNextPrompt(next) {
      context.nextPromptRef.current = next;
      context.nextPrompt = next;
      context.visibleNextPrompt = next;
    },
    setConversations(next) {
      context.conversations = typeof next === "function" ? next(context.conversations) : next;
    },
    setActiveId(value) {
      context.activeId = value;
      context.activeIdRef.current = value;
    },
    setPendingWorkflowSkill() {},
    setInputState(value) {
      context.input = value;
    },
    setAttachmentsState(value) {
      context.attachments = value;
    },
    setEditingMessage(value) {
      context.editingMessage = value;
    },
    setSelectedToolState(value) {
      context.selectedTool = value;
    },
    setIsStreaming(value) {
      context.isStreaming = value;
    },
    setStreamAnnouncement() {},
    setLimitDialog(value) {
      context.limitDialogs.push(value);
    },
    autoTitle() {},
    clearRetryTimer(ref) {
      ref.current = null;
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    AbortController,
    DOMException,
    Date,
    Intl,
    TypeError,
    safeLocale: () => "en-US",
    personalityToInstruction: () => "",
    loadPersonality: () => null,
    withResponsePresentation: (profile) => profile,
    createMemorySourceUpdater: () => () => {},
    normalizeResponseSources: (value) => value,
    chatRequestMessages: (prior, user) => [...prior, user],
    chatResponseError: async (response) => response.error,
    summaryModule: Promise.resolve({
      withResponsePresentation: (profile) => profile,
      createChatHistoryPayload: async (messages) => ({ messages }),
      chatRequestProfile: () => ({}),
      fetchForPrincipal: (principal, url, args) => {
        const d = deferred();
        requests.push({ ...d, principal, url, args });
        return d.promise;
      },
    }),
    consumeChatSse: (body, args) => {
      const d = deferred();
      streams.push({ ...d, args });
      return d.promise;
    },
    toast: { error: (...value) => errors.push(value) },
    window: {
      setTimeout: (callback, delay) => {
        timers.push(callback);
        delays.push(delay);
        return timers.length;
      },
    },
    USER_STOP_REASON: "user-stop",
    markAssistantStopped: (messages) => messages,
  };
  vm.runInNewContext(compiled, context);
  const cleanup = context.startLifetime();
  function type(value, files = [], tool = null) {
    context.setInput(value);
    context.setAttachments(files);
    context.setSelectedTool(tool);
  }
  async function respond(index = requests.length - 1, { fail = false, confirmation = false } = {}) {
    requests[index].resolve({ ok: true, body: { cancel: async () => {} } });
    await settle();
    const stream = streams.at(-1);
    if (!stream) return;
    if (fail) {
      const error = new Error("Synthetic rejected response");
      error.retryable = false;
      error.category = "model_provider_failure";
      stream.reject(error);
    } else {
      stream.args.onEvent({ choices: [{ delta: { content: "Synthetic answer" } }] });
      if (confirmation)
        stream.args.onEvent({
          choices: [{ delta: { kind: "tool_confirm", action_id: "action-a" } }],
        });
      stream.resolve();
    }
    await settle();
  }
  return {
    context,
    requests,
    streams,
    errors,
    timers,
    delays,
    quotaPanels() {
      context.nextPromptScope = context.nextPromptScopeRef.current;
      context.visibleQuotaRejectedDrafts = context.readQuotaDrafts();
      return context.renderQuotaDrafts();
    },
    renderNotice(pending = false) {
      context.nextPromptScope = context.nextPromptScopeRef.current;
      context.visibleRequestNotice = context.readVisibleNotice();
      return renderToStaticMarkup(context.renderNotice(pending));
    },
    async fail(error, index = requests.length - 1) {
      requests[index].resolve({ ok: false, error });
      await settle();
    },
    type,
    respond,
    cleanup,
    async start() {
      const pending = context.send("First message", [], null);
      await settle();
      return { pending };
    },
  };
}

test("a signed-in first send keeps its draft until lazy history initialization completes", async () => {
  const f = fixture();
  for (const view of [undefined, { ready: false, writable: false }]) {
    f.context.chatHistoryView = () => view;
    await f.context.send(f.context.input, f.context.attachments, null);
    assert.equal(f.requests.length, 0);
    assert.equal(f.context.input, "First message");
    assert.equal(f.context.conversations[0].messages.length, 0);
    assert.match(f.errors.at(-1)[0], /history is not ready/u);
  }
  f.context.chatHistoryView = () => ({ ready: true, writable: true });
  const pending = f.context.send(f.context.input, f.context.attachments, null);
  await settle();
  assert.equal(f.requests.length, 1);
  await f.respond();
  await pending;
  assert.equal(f.context.conversations[0].messages.length, 2);
});

test("incidental typing never queues; explicit Send next snapshots one bounded message and blocks double click", async () => {
  const f = fixture();
  const { pending } = await f.start();
  const file = {
    kind: "text_file",
    name: "draft.txt",
    textContent: "original",
    dataUrl: "",
    status: "complete",
    pasteOrigin: { original: "original", start: 0, end: 0 },
  };
  f.type("Queued text", [file], "web_search");
  assert.equal(f.context.nextPromptRef.current, null);
  assert.equal(f.context.queue("web_search"), true);
  assert.equal(f.context.queue("web_search"), false);
  file.textContent = "changed";
  file.pasteOrigin.original = "changed";
  const next = f.context.nextPromptRef.current;
  assert.equal(next.text, "Queued text");
  assert.equal(next.attachments[0].textContent, "original");
  assert.equal(next.attachments[0].pasteOrigin.original, "original");
  assert.equal(next.tool, "web_search");
  assert.equal(f.requests.length, 1);
  await f.respond();
  await pending;
});

test("successful response dispatches exactly one snapshot through existing send and keeps a later draft", async () => {
  const f = fixture();
  const { pending } = await f.start();
  f.type("Queued version", [], "web_search");
  f.context.queue("web_search");
  f.type(
    "Newer draft",
    [
      {
        kind: "text_file",
        name: "later.txt",
        textContent: "later",
        dataUrl: "",
        status: "complete",
      },
    ],
    "image",
  );
  await f.respond();
  await pending;
  assert.equal(f.context.nextPromptRef.current.status, "ready");
  f.context.dispatch();
  f.context.dispatch();
  await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.context.nextPromptRef.current, null);
  const payload = JSON.parse(f.requests[1].args.body);
  assert.equal(payload.clientTool, "web_search");
  assert.equal(payload.messages.at(-1).content, "Queued version");
  assert.ok(payload.messages.some((message) => message.content === "Synthetic answer"));
  assert.equal(f.context.input, "Newer draft");
  assert.equal(f.context.attachments[0].name, "later.txt");
  assert.equal(f.context.selectedTool, "image");
  await f.respond(1);
  assert.equal(f.context.input, "Newer draft");
  assert.equal(f.context.selectedTool, "image");
});

test("unchanged queued composer clears only after accepted dispatch", async () => {
  const f = fixture();
  const { pending } = await f.start();
  f.type("Queued version");
  f.context.queue(null);
  assert.equal(f.context.input, "Queued version");
  await f.respond();
  await pending;
  f.context.dispatch();
  await settle();
  assert.equal(f.context.input, "");
  assert.equal(f.requests.length, 2);
  await f.respond(1);
});

test("Cancel next message keeps the current draft and prevents later dispatch", async () => {
  const f = fixture();
  const { pending } = await f.start();
  f.type("Cancel this send");
  f.context.queue(null);
  f.context.cancel();
  assert.equal(f.context.input, "Cancel this send");
  await f.respond();
  await pending;
  f.context.dispatch();
  assert.equal(f.requests.length, 1);
});

for (const outcome of ["failure", "stop", "confirmation"]) {
  test(`${outcome} holds the next message and cannot dispatch on later success`, async () => {
    const f = fixture();
    const { pending } = await f.start();
    f.type("Kept next text", [], "web_search");
    f.context.queue("web_search");
    if (outcome === "stop") {
      f.context.stop();
      f.requests[0].reject(new DOMException("Stopped", "AbortError"));
      await settle();
    } else
      await f.respond(0, { fail: outcome === "failure", confirmation: outcome === "confirmation" });
    await pending;
    assert.equal(f.context.nextPromptRef.current.status, "held");
    assert.equal(f.context.input, "Kept next text");
    assert.equal(f.context.selectedTool, "web_search");
    f.context.dispatch();
    assert.equal(f.requests.length, 1);
    f.context.updateNextPrompt(
      helpers.settleNextPrompt(
        f.context.nextPromptRef.current,
        f.context.nextPromptRef.current.waitingFor,
        true,
      ),
    );
    f.context.dispatch();
    assert.equal(f.requests.length, 1);
  });
}

for (const boundary of ["account", "chat", "temporary", "editing", "unmount"]) {
  test(`a queued message never auto-sends after ${boundary}`, async () => {
    const f = fixture();
    const { pending } = await f.start();
    f.type("Private next text");
    f.context.queue(null);
    if (boundary === "account") {
      f.context.storagePrincipal = "owner-b";
      f.context.storagePrincipalRef.current = "owner-b";
      f.context.nextPromptScopeRef.current = { ...scope(), principal: "owner-b" };
    }
    if (boundary === "chat") {
      f.context.activeId = "chat-b";
      f.context.nextPromptScopeRef.current = { ...scope(), conversationId: "chat-b" };
    }
    if (boundary === "temporary")
      f.context.nextPromptScopeRef.current = { ...scope(), temporary: true };
    if (boundary === "editing") f.context.editingMessage = { messageId: "previous" };
    if (boundary === "unmount") f.cleanup();
    else f.context.reconcileScope();
    await f.respond();
    await pending;
    f.context.dispatch();
    assert.equal(f.requests.length, 1);
    if (["account", "unmount"].includes(boundary))
      assert.equal(f.context.nextPromptRef.current, null);
    else assert.equal(f.context.nextPromptRef.current.status, "held");
  });
}

test("stale queue and cancel callbacks cannot capture or clear another account's draft", async () => {
  const f = fixture();
  await f.start();
  f.type("Owner A text");
  f.context.nextPromptScopeRef.current = { ...scope(), principal: "owner-b" };
  assert.equal(f.context.queue(null), false);
  const other = helpers.snapshotNextPrompt({
    id: "new",
    scope: { ...scope(), principal: "owner-b" },
    waitingFor: "new-request",
    text: "Owner B",
    attachments: [],
    tool: null,
    mode: "instant",
  });
  f.context.updateNextPrompt(other);
  f.context.visibleNextPrompt = { ...other, scope: scope() };
  f.context.storagePrincipalRef.current = "owner-b";
  f.context.cancel();
  assert.equal(f.context.nextPromptRef.current, other);
});

test("guest file/image gates, incomplete attachments, and old-prompt editing reject enqueue", async () => {
  const f = fixture();
  await f.start();
  f.context.isSignedIn = false;
  f.type("Guest text");
  assert.equal(f.context.queue("image"), false);
  f.type("Guest file", [
    { kind: "image", name: "image.png", dataUrl: "data:fixture", status: "complete" },
  ]);
  assert.equal(f.context.queue(null), false);
  f.context.isSignedIn = true;
  for (const status of ["uploading", "selected", "failed"]) {
    f.type("File", [{ kind: "image", name: "pending", dataUrl: "", status }]);
    assert.equal(f.context.queue(null), false);
  }
  f.type("Edit draft");
  f.context.editingMessage = { messageId: "older" };
  assert.equal(f.context.queue(null), false);
  f.context.editingMessage = null;
  f.context.isSignedIn = false;
  assert.equal(f.context.queue(null), true);
});

test("queue binding preserves temporary privacy and never enters browser storage", () => {
  assert.doesNotMatch(helperSource, /localStorage|sessionStorage|saveDraft|saveConversations/);
  const a = scope();
  assert.equal(helpers.sameNextPromptScope(a, { ...a, temporaryContext: "personalized" }), false);
  assert.equal(helpers.sameNextPromptScope(a, { ...a, temporary: true }), false);
  assert.equal(helpers.settleNextPrompt(null, "request", true), null);
});

test("a deliberate regeneration holds any ready next message instead of chaining it later", async () => {
  const f = fixture();
  const { pending } = await f.start();
  f.type("Queued version");
  f.context.queue(null);
  await f.respond();
  await pending;
  const regeneration = f.context.send("First message", [], null, 0, "chat-a", []);
  await settle();
  assert.equal(f.context.nextPromptRef.current.status, "held");
  await f.respond(1);
  await regeneration;
  f.context.dispatch();
  assert.equal(f.requests.length, 2);
});

for (const boundary of [
  "principal",
  "conversationId",
  "temporaryContext",
  "unresolved principal",
]) {
  test(`A → B → A ${boundary} transition before effects cannot re-arm Send next`, async () => {
    const f = fixture();
    const { pending } = await f.start();
    f.type("Private queued version");
    f.context.queue(null);
    const original = f.context.nextPromptScopeRef.current;
    const changed =
      boundary === "unresolved principal"
        ? { ...original, principal: "unresolved:owner-a" }
        : { ...original, [boundary]: "different" };
    f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(original, changed);
    f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(
      f.context.nextPromptScopeRef.current,
      original,
    );
    assert.equal(
      helpers.sameNextPromptContext(original, f.context.nextPromptScopeRef.current),
      true,
    );
    assert.equal(
      helpers.sameNextPromptScope(original, f.context.nextPromptScopeRef.current),
      false,
    );
    assert.equal(f.context.queue(null), false, "even a stale enqueue callback is rejected");
    await f.respond();
    await pending;
    // No scope effect runs here: the dispatch-time lifetime guard must be sufficient.
    f.context.dispatch();
    assert.equal(f.requests.length, 1);
    assert.equal(f.context.nextPromptRef.current.status, "held");
  });
}

for (const errorFields of [
  { status: 503, retryable: false, category: "model_provider_failure" },
  { status: 401, retryable: true, category: "model_provider_failure" },
  { status: 403, retryable: true, category: "model_provider_failure" },
  { status: 400, retryable: false, category: "streaming_interruption" },
]) {
  test(`authoritative ${errorFields.status}/${errorFields.retryable} failure has no manual or automatic Retry`, async () => {
    const f = fixture();
    const { pending } = await f.start();
    f.type("Later draft", [], "web_search");
    await f.fail(Object.assign(new Error("Synthetic failure"), errorFields));
    await pending;
    assert.equal(f.errors.length, 1);
    assert.equal(f.errors[0][1].action, undefined);
    assert.equal(f.timers.length, 0);
    assert.equal(f.context.retryableFailedResponsesRef.current.size, 0);
    assert.equal(f.context.input, "Later draft");
    assert.equal(f.context.selectedTool, "web_search");
    const html = f.renderNotice();
    if (errorFields.status === 401) {
      assert.match(html, /session could not be verified/);
      assert.match(html, /data-auth-dialog="sign-in"/);
      assert.match(html, /Signing in does not resend a message/);
      assert.doesNotMatch(html, /Retry/);
      assert.equal(f.context.requestNotice.kind, "session-expired");
    } else assert.equal(html, "");
  });
}

test("transient failure keeps partial output and a newer draft until one explicit Retry reuses the original intent", async () => {
  const f = fixture();
  const { pending } = await f.start();
  const firstRequestId = f.requests[0].args.headers["Idempotency-Key"];
  const originalPayload = JSON.parse(f.requests[0].args.body);
  const failedAssistantId = f.context.conversations[0].messages[1].id;
  assert.ok(firstRequestId);
  f.requests[0].resolve({ ok: true, body: { cancel: async () => {} } });
  await settle();
  f.streams[0].args.onEvent({ choices: [{ delta: { content: "Partial answer kept." } }] });
  f.context.inFlightTargetRef.current.flushPendingContent();
  const laterFiles = [
    {
      kind: "text_file",
      name: "later.txt",
      textContent: "Newer attachment",
      dataUrl: "",
      status: "complete",
    },
  ];
  f.type("Later draft", laterFiles, "web_search");
  f.streams[0].reject(
    Object.assign(new Error("Transient failure"), {
      status: 503,
      retryable: true,
      category: "streaming_interruption",
      retryAfter: 3,
    }),
  );
  await settle();
  await pending;
  assert.equal(f.requests.length, 1, "a transient stream failure never resends itself");
  assert.equal(f.timers.length, 0, "Retry-After cannot schedule an automatic replay");
  assert.equal(f.context.retryTimerRef.current, null);
  assert.equal(f.renderNotice(), "");
  const failedTurn = f.context.conversations[0].messages;
  assert.equal(failedTurn.length, 2);
  assert.equal(failedTurn[0].id, firstRequestId);
  assert.equal(failedTurn[0].content, "First message");
  assert.equal(failedTurn[1].id, failedAssistantId);
  assert.equal(failedTurn[1].content, "Partial answer kept.");
  assert.equal(failedTurn[1].generationStatus, "failed");
  assert.equal(f.context.input, "Later draft");
  assert.equal(f.context.attachments, laterFiles);
  assert.equal(f.context.selectedTool, "web_search");

  const retry = f.errors.at(-1)[1].action;
  assert.equal(retry.label, "Retry");
  retry.onClick();
  retry.onClick();
  assert.equal(f.requests.length, 1, "clicking Retry waits for its guarded dispatch");
  assert.equal(f.timers.length, 1, "the toast action is single-use");
  assert.equal(f.delays[0], 100);
  assert.equal(f.context.conversations[0].messages, failedTurn);
  f.timers[0]();
  await settle();
  assert.equal(f.context.requestNotice, null);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].args.headers["Idempotency-Key"], firstRequestId);
  assert.deepEqual(JSON.parse(f.requests[1].args.body), originalPayload);
  const resentTurn = f.context.conversations[0].messages;
  assert.equal(
    resentTurn.length,
    2,
    "resending replaces the failed turn instead of duplicating it",
  );
  assert.equal(resentTurn.filter((message) => message.id === firstRequestId).length, 1);
  assert.equal(resentTurn[0].content, "First message");
  assert.equal(
    resentTurn.some((message) => message.id === failedAssistantId),
    false,
  );
  assert.notEqual(resentTurn[1].id, failedAssistantId);
  retry.onClick();
  assert.equal(f.timers.length, 1, "a stale toast cannot schedule another replay");
  await f.respond(1);
  assert.equal(f.context.conversations[0].messages.length, 2);
  assert.equal(f.context.conversations[0].messages[1].content, "Synthetic answer");
  assert.equal(f.requests.length, 2);
  assert.equal(f.timers.length, 1);
  assert.equal(f.context.input, "Later draft");
  assert.equal(f.context.attachments, laterFiles);
  assert.equal(f.context.selectedTool, "web_search");
});

for (const boundary of ["chat", "principal", "temporaryContext", "unmount", "stop", "new send"]) {
  test(`retry timer and status cannot revive after ${boundary}`, async () => {
    const f = fixture();
    const { pending } = await f.start();
    await f.fail(
      Object.assign(new Error("Transient failure"), {
        status: 503,
        retryable: true,
        category: "model_provider_failure",
      }),
    );
    await pending;
    assert.equal(f.timers.length, 0);
    const retry = f.errors.at(-1)[1].action;
    assert.equal(retry.label, "Retry");
    retry.onClick();
    assert.equal(f.timers.length, 1);
    assert.equal(f.delays[0], 100);
    const oldTimer = f.timers[0];
    f.type("Kept draft");
    if (boundary === "unmount") f.cleanup();
    else if (boundary === "stop") f.context.stop();
    else if (boundary === "new send") {
      void f.context.send("Replacement", [], null);
      await settle();
      await f.respond();
    } else {
      const key = boundary === "chat" ? "conversationId" : boundary;
      const original = f.context.nextPromptScopeRef.current;
      f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(original, {
        ...original,
        [key]: "other",
      });
      f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(
        f.context.nextPromptScopeRef.current,
        original,
      );
      assert.equal(f.renderNotice(), "");
      f.context.reconcileNotice();
      assert.equal(f.context.requestNotice, null);
    }
    const before = f.requests.length;
    retry.onClick();
    assert.equal(f.timers.length, 1, "a stale Retry action cannot schedule another timer");
    oldTimer();
    await settle();
    assert.equal(f.requests.length, before);
    if (boundary !== "new send") assert.equal(f.context.input, "Kept draft");
    if (boundary === "stop")
      assert.equal(f.context.conversations[0].messages[0].content, "First message");
  });
}

test("session notice hides immediately on scope change and clears on a valid new send without sending on sign-in", async () => {
  const f = fixture();
  const { pending } = await f.start();
  await f.fail(Object.assign(new Error("Unauthorized"), { status: 401, retryable: false }));
  await pending;
  f.type("Newer draft");
  assert.match(f.renderNotice(), /session could not be verified/);
  assert.equal(f.requests.length, 1);
  await f.context.send(" ", [], null);
  assert.equal(f.context.requestNotice.kind, "session-expired");
  void f.context.send("Newer draft", [], null);
  await settle();
  assert.equal(f.context.requestNotice, null);
  await f.respond();
});

test("failed response control fails closed without retry authority, while regeneration and stopped retry remain", () => {
  const f = fixture();
  Object.assign(f.context, {
    isLastAssistant: true,
    priorUser: { content: "First message" },
    active: { id: "chat-a" },
    m: { id: "response-a", generationStatus: "failed" },
  });
  assert.equal(f.context.readResponseRetry(), undefined);
  f.context.retryableFailedResponsesRef.current.add(
    JSON.stringify(["owner-a", "chat-a", "response-a"]),
  );
  assert.equal(typeof f.context.readResponseRetry(), "function");
  f.context.storagePrincipal = "owner-b";
  assert.equal(f.context.readResponseRetry(), undefined);
  f.context.m.generationStatus = "stopped";
  assert.equal(typeof f.context.readResponseRetry(), "function");
  delete f.context.m.generationStatus;
  assert.equal(typeof f.context.readResponseRetry(), "function");
});

test("manual Retry is single use, reuses the original ID and rejects an A to B to A callback", async () => {
  const f = fixture();
  const pending = f.context.send("Retry me", [], null, 0, "chat-a", []);
  await settle();
  await f.fail(Object.assign(new Error("Temporary error"), { status: 503, retryable: true }));
  await pending;
  const action = f.errors.at(-1)[1].action;
  const requestId = f.requests[0].args.headers["Idempotency-Key"];
  action.onClick();
  action.onClick();
  assert.equal(f.timers.length, 1);
  assert.equal(f.context.conversations[0].messages[0].content, "Retry me");
  f.timers[0]();
  await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].args.headers["Idempotency-Key"], requestId);
  await f.fail(Object.assign(new Error("Temporary error"), { status: 503, retryable: true }));
  const currentAction = f.errors.at(-1)[1].action;
  const original = f.context.nextPromptScopeRef.current;
  f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(original, {
    ...original,
    principal: "owner-b",
  });
  f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(
    f.context.nextPromptScopeRef.current,
    original,
  );
  currentAction.onClick();
  assert.equal(f.timers.length, 1);
});

test("late authentication failure cannot expose a session notice in another chat", async () => {
  const f = fixture();
  const { pending } = await f.start();
  const original = f.context.nextPromptScopeRef.current;
  f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(original, {
    ...original,
    conversationId: "chat-b",
  });
  await f.fail(Object.assign(new Error("Unauthorized"), { status: 401, retryable: false }));
  await pending;
  assert.equal(f.context.requestNotice, null);
  assert.equal(f.errors.length, 0);
});

test("new-chat creation is an authorized retry scope transition", async () => {
  const f = fixture();
  f.context.activeId = null;
  f.context.activeIdRef.current = null;
  f.context.conversations = [];
  f.context.nextPromptScope = { ...scope(), conversationId: null };
  f.context.nextPromptScopeRef.current = f.context.nextPromptScope;
  const { pending } = await f.start();
  await f.fail(
    Object.assign(new Error("Temporary error"), {
      status: 503,
      category: "model_provider_failure",
      retryable: true,
    }),
  );
  await pending;
  assert.equal(f.renderNotice(), "");
  assert.equal(f.timers.length, 0);
  const retry = f.errors.at(-1)[1].action;
  assert.equal(retry.label, "Retry");
  retry.onClick();
  assert.equal(f.timers.length, 1);
  assert.equal(f.delays[0], 100);
  f.timers[0]();
  await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(
    f.requests[1].args.headers["Idempotency-Key"],
    f.requests[0].args.headers["Idempotency-Key"],
  );
  await f.respond();
});

test("old explicit Retry and session actions cannot operate on a new request or unmounted composer", async () => {
  const f = fixture();
  const { pending } = await f.start();
  await f.fail(
    Object.assign(new Error("Temporary error"), {
      status: 503,
      category: "model_provider_failure",
      retryable: true,
    }),
  );
  await pending;
  assert.equal(f.renderNotice(), "");
  const oldRetry = f.errors.at(-1)[1].action.onClick;
  void f.context.send("Replacement", [], null);
  await settle();
  oldRetry();
  assert.equal(f.timers.length, 0);
  assert.equal(f.requests.length, 2);
  assert.equal(f.context.inFlightRef.current, true);
  await f.fail(Object.assign(new Error("Unauthorized"), { status: 401, retryable: false }));
  f.renderNotice();
  const sessionPanel = f.context.renderNotice();
  const signIn = sessionPanel.props.children.props.children[2].props.children.props.onClick;
  f.cleanup();
  let prevented = false;
  signIn({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
});

test("session recovery blocks sign-in while a draft, attachment, pasted text or next message needs protection", async () => {
  const f = fixture();
  const { pending } = await f.start();
  await f.fail(Object.assign(new Error("Unauthorized"), { status: 401, retryable: false }));
  await pending;
  f.type("Private unsent draft");
  assert.match(f.renderNotice(true), /Drafts are not transferred between accounts/);
  const panel = f.context.renderNotice(true);
  const signIn = panel.props.children.props.children[2].props.children;
  assert.equal(signIn.props.disabled, true);
  let prevented = false;
  signIn.props.onClick({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(f.context.input, "Private unsent draft");
  f.type("");
  assert.equal(
    f.context.renderNotice(false).props.children.props.children[2].props.children.props.disabled,
    false,
  );
  f.context.nextPromptRef.current = { text: "Held next message" };
  assert.equal(
    f.context.renderNotice(false).props.children.props.children[2].props.children.props.disabled,
    true,
  );
  assert.match(source, /requestStatusPanel=\{requestStatusPanel\}/);
  const composer = readFileSync("src/components/ChatInput.tsx", "utf8");
  assert.match(
    composer,
    /requestStatusPanel\(Boolean\(value.length \|\| attachments.length \|\| pasteOffer\)\)/,
  );
});

const quotaError = (fields = {}) =>
  Object.assign(new Error("Synthetic message limit reached"), {
    status: 429,
    category: "quota_exceeded",
    retryable: false,
    ...fields,
  });
const quotaFiles = () => [
  {
    kind: "text_file",
    name: "exact notes.txt",
    textContent: "  original attachment\n\n",
    dataUrl: "",
    status: "complete",
    pasteOrigin: { original: "  original attachment\n\n", start: 2, end: 9 },
  },
  {
    kind: "image",
    name: "picture.png",
    dataUrl: "data:image/png;base64,synthetic",
    status: "complete",
  },
  {
    kind: "library_file",
    name: "reference.pdf",
    libraryItemId: "file-a",
    dataUrl: "",
    status: "complete",
  },
];
const panelButton = (panel, label) =>
  panel.props.children.find((child) => child?.type === "button" && child.props.children === label);
const restoreButton = (panel) => panelButton(panel, "Restore message");
const discardButton = (panel) => panelButton(panel, "Discard kept version");

for (const fields of [
  {},
  { category: "model_provider_failure", retryable: true },
  { message: "Allowance exhausted", category: "quota_exceeded", retryable: true },
]) {
  test(`quota rejection restores exact text and attachment references, with no automatic retry (${JSON.stringify(fields)})`, async () => {
    const f = fixture();
    const original = " \tOriginal unsent draft\n\n  ";
    const files = quotaFiles();
    f.type(original, files, "web_search");
    const pending = f.context.send(original, files, "web_search");
    // Exercise the synchronous composer setters, before any React render could refresh a ref.
    assert.equal(f.context.input, "");
    assert.equal(f.context.composerDraftRef.current.text, "");
    assert.equal(f.context.attachments.length, 0);
    await settle();
    await f.fail(quotaError(fields));
    await pending;
    assert.equal(f.context.input, original);
    assert.equal(f.context.attachments, files);
    assert.equal(f.context.attachments[0].pasteOrigin.original, "  original attachment\n\n");
    assert.equal(f.context.selectedTool, "web_search");
    assert.equal(f.context.limitDialogs.length, 1);
    assert.equal(f.context.quotaRejectedDrafts.length, 0);
    assert.equal(f.context.retryableFailedResponsesRef.current.size, 0);
    assert.equal(f.errors.at(-1)[1].action, undefined);
    assert.equal(f.timers.length, 0);
    f.context.dispatch();
    assert.equal(f.requests.length, 1);
    // Closing the usage dialog only closes it. A new request needs deliberate Send.
    f.context.setLimitDialog({ open: false });
    assert.equal(f.requests.length, 1);
    const retry = f.context.send(f.context.input, f.context.attachments, f.context.selectedTool);
    await settle();
    assert.equal(f.requests.length, 2);
    assert.equal(JSON.parse(f.requests[1].args.body).messages.at(-1).content, original.trim());
    await f.respond(1);
    await retry;
  });
}

for (const laterEdit of ["text", "attachments", "typed then cleared", "tool"]) {
  test(`quota rejection keeps ${laterEdit} and exposes the exact rejected draft for explicit recovery`, async () => {
    const f = fixture();
    const original = "  Kept rejected version\n ";
    const files = quotaFiles();
    f.type(original, files);
    const pending = f.context.send(original, files, null);
    await settle();
    const laterFiles = laterEdit === "attachments" ? [quotaFiles()[0]] : [];
    f.type(
      laterEdit === "text" ? "Later draft" : "",
      laterFiles,
      laterEdit === "tool" ? "image" : null,
    );
    if (laterEdit === "typed then cleared") {
      f.type("Intervening edit");
      f.type("");
    }
    const expectedText = f.context.input;
    const expectedAttachments = f.context.attachments;
    const expectedTool = f.context.selectedTool;
    await f.fail(quotaError());
    await pending;
    assert.equal(f.context.input, expectedText);
    assert.equal(f.context.attachments, expectedAttachments);
    assert.equal(f.context.selectedTool, expectedTool);
    const [panel] = f.quotaPanels();
    assert.ok(panel);
    const html = renderToStaticMarkup(panel);
    assert.match(html, /role="status"/);
    assert.match(html, /Kept rejected version/);
    assert.match(html, /exact notes.txt, picture.png, reference.pdf/);
    assert.match(html, /Restoring does not send it/);
    assert.equal(f.context.quotaRejectedDrafts[0].text, original);
    assert.equal(f.context.quotaRejectedDrafts[0].attachments, files);
    if (laterEdit !== "typed then cleared") {
      assert.equal(restoreButton(panel).props.disabled, true);
      restoreButton(panel).props.onClick({ currentTarget: "restore-trigger" });
      assert.equal(f.context.input, expectedText);
    }
    f.type("");
    restoreButton(f.quotaPanels()[0]).props.onClick({ currentTarget: "restore-trigger" });
    assert.equal(f.context.input, original);
    assert.equal(f.context.attachments, files);
    assert.equal(f.context.quotaRejectedDrafts.length, 0);
    assert.deepEqual(f.context.focusRequests.at(-1), ["restore-trigger", "composer", null]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.timers.length, 0);
  });
}

test("quota recovery preserves an explicitly queued next message and never dispatches either version", async () => {
  const f = fixture();
  const { pending } = await f.start();
  f.type("Queued next version");
  assert.equal(f.context.queue(null), true);
  const queuedId = f.context.nextPromptRef.current.id;
  await f.fail(quotaError());
  await pending;
  assert.equal(f.context.input, "Queued next version");
  assert.equal(f.context.nextPromptRef.current.id, queuedId);
  assert.equal(f.context.nextPromptRef.current.status, "held");
  assert.equal(f.context.quotaRejectedDrafts[0].text, "First message");
  f.context.dispatch();
  assert.equal(f.requests.length, 1);
  f.type("");
  restoreButton(f.quotaPanels()[0]).props.onClick({ currentTarget: "restore-trigger" });
  assert.equal(f.context.input, "First message");
  assert.equal(f.context.nextPromptRef.current.id, queuedId);
  assert.equal(f.context.nextPromptRef.current.status, "held");
  assert.equal(f.requests.length, 1);
});

for (const boundary of ["principal", "conversationId", "temporary", "unmount", "A to B to A"]) {
  test(`late quota rejection cannot overwrite a draft or show recovery after ${boundary}`, async () => {
    const f = fixture();
    const { pending } = await f.start();
    f.type("Unrelated draft", quotaFiles(), "image");
    const original = f.context.nextPromptScopeRef.current;
    if (boundary === "unmount") f.cleanup();
    else {
      const key = boundary === "A to B to A" ? "conversationId" : boundary;
      f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(original, {
        ...original,
        [key]: key === "temporary" ? true : "other",
      });
      if (boundary === "principal") {
        f.context.storagePrincipalRef.current = "other";
        f.context.storagePrincipal = "other";
        f.context.storageGenerationRef.current += 1;
      }
      if (boundary === "A to B to A")
        f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(
          f.context.nextPromptScopeRef.current,
          original,
        );
    }
    await f.fail(quotaError());
    await pending;
    assert.equal(f.context.input, "Unrelated draft");
    assert.equal(f.context.attachments.length, 3);
    assert.equal(f.context.selectedTool, "image");
    assert.equal(f.context.quotaRejectedDraftsRef.current.length, 0);
    assert.equal(f.context.limitDialogs.length, 0);
    assert.equal(f.requests.length, 1);
  });
}

for (const boundary of [
  "principal",
  "conversationId",
  "temporaryContext",
  "unmount",
  "A to B to A",
]) {
  test(`retained quota snapshot is hidden/cleared and its old Restore control is inert after ${boundary}`, async () => {
    const f = fixture();
    const { pending } = await f.start();
    f.type("Later draft");
    await f.fail(quotaError());
    await pending;
    f.type("");
    const restore = restoreButton(f.quotaPanels()[0]).props.onClick;
    const original = f.context.nextPromptScopeRef.current;
    if (boundary === "unmount") f.cleanup();
    else {
      const key = boundary === "A to B to A" ? "conversationId" : boundary;
      f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(original, {
        ...original,
        [key]: "other",
      });
      if (boundary === "principal") f.context.storagePrincipalRef.current = "other";
      if (boundary === "A to B to A")
        f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(
          f.context.nextPromptScopeRef.current,
          original,
        );
      assert.equal(f.quotaPanels().length, 0, "hidden even before passive cleanup");
      f.context.reconcileQuotaDrafts();
    }
    assert.equal(f.context.quotaRejectedDraftsRef.current.length, 0);
    restore({ currentTarget: "old-trigger" });
    assert.equal(f.context.input, "");
    assert.equal(f.requests.length, 1);
  });
}

test("stale recovery clicks cannot overwrite typing that occurred after the panel rendered", async () => {
  const f = fixture();
  const { pending } = await f.start();
  f.type("Intervening edit");
  await f.fail(quotaError());
  await pending;
  f.type("");
  const restore = restoreButton(f.quotaPanels()[0]).props.onClick;
  f.context.setInput("Typed before React rerender");
  restore({ currentTarget: "old-trigger" });
  assert.equal(f.context.input, "Typed before React rerender");
  assert.equal(f.context.quotaRejectedDraftsRef.current.length, 1);
  assert.equal(f.requests.length, 1);
});

test("new-chat quota restoration ignores empty hydration updates and preserves whitespace and attachments", async () => {
  const f = fixture();
  f.context.activeId = null;
  f.context.activeIdRef.current = null;
  f.context.conversations = [];
  f.context.nextPromptScope = { ...scope(), conversationId: null };
  f.context.nextPromptScopeRef.current = f.context.nextPromptScope;
  const original = "  New chat draft\n";
  const files = quotaFiles();
  f.type(original, files);
  const pending = f.context.send(original, files, null);
  await settle();
  f.context.setInput("");
  f.context.setAttachments([]);
  await f.fail(quotaError());
  await pending;
  assert.equal(f.context.input, original);
  assert.equal(f.context.attachments, files);
  assert.equal(f.requests.length, 1);
});

test("no rejected or queued draft leaves the ordinary streaming composer hint available", () => {
  const f = fixture();
  f.context.quotaRejectedDraftPanel = f.quotaPanels();
  f.context.nextPromptPanel = undefined;
  assert.equal(f.context.readComposerPromptPanel(), undefined);
  const nextPanel = React.createElement("section", null, "Queued next message");
  f.context.nextPromptPanel = nextPanel;
  assert.equal(f.context.readComposerPromptPanel(), nextPanel);
  assert.equal((source.match(/nextPromptPanel=\{composerPromptPanel\}/g) ?? []).length, 2);
});

test("kept-version previews are bounded while Restore retains exact full text and all attachment references", async () => {
  const f = fixture();
  const original = "  " + "Long private draft\n".repeat(100) + " EXACT-END  ";
  const files = [...quotaFiles(), ...quotaFiles()];
  files[0] = { ...files[0], name: "Long".repeat(30) + "FILENAME-END" };
  f.type(original, files);
  const pending = f.context.send(original, files, null);
  await settle();
  f.type("Newer draft");
  await f.fail(quotaError());
  await pending;
  const [panel] = f.quotaPanels();
  const html = renderToStaticMarkup(panel);
  assert.match(html, /Preview shortened to 400 characters/);
  assert.match(html, /Restore keeps all 6 attachments/);
  assert.doesNotMatch(html, /EXACT-END|FILENAME-END/);
  assert.equal(f.context.quotaRejectedDrafts[0].text, original);
  assert.equal(f.context.quotaRejectedDrafts[0].attachments, files);
  f.type("");
  restoreButton(f.quotaPanels()[0]).props.onClick({ currentTarget: "restore-trigger" });
  assert.equal(f.context.input, original);
  assert.equal(f.context.attachments, files);
  assert.equal(f.requests.length, 1);
});

test("three kept versions block a new request without clearing input or evicting anything; explicit discard resumes Send", async () => {
  const f = fixture();
  for (let index = 0; index < 3; index += 1) {
    f.type(`Original ${index}`, quotaFiles());
    const pending = f.context.send(f.context.input, f.context.attachments, null);
    await settle();
    f.type(`Newer ${index}`);
    await f.fail(quotaError());
    await pending;
  }
  const kept = f.context.quotaRejectedDraftsRef.current;
  assert.equal(kept.length, 3);
  const files = quotaFiles();
  f.type("Keep this current draft", files, "web_search");
  await f.context.send(f.context.input, f.context.attachments, "web_search");
  assert.equal(f.requests.length, 3);
  assert.equal(f.context.input, "Keep this current draft");
  assert.equal(f.context.attachments, files);
  assert.equal(f.context.selectedTool, "web_search");
  assert.equal(f.context.quotaRejectedDraftsRef.current, kept);
  assert.match(f.errors.at(-1)[0], /Three messages are kept/);
  const discard = discardButton(f.quotaPanels()[0]).props.onClick;
  discard({ currentTarget: "discard-trigger" });
  assert.equal(f.context.quotaRejectedDraftsRef.current.length, 2);
  assert.equal(f.context.quotaRejectedDraftsRef.current[0], kept[1]);
  assert.equal(f.context.quotaRejectedDraftsRef.current[1], kept[2]);
  assert.equal(f.context.input, "Keep this current draft");
  assert.equal(f.context.attachments, files);
  assert.deepEqual(f.context.focusRequests.at(-1), ["discard-trigger", "composer", null]);
  discard({ currentTarget: "old-discard-trigger" });
  assert.equal(f.context.quotaRejectedDraftsRef.current.length, 2);
  const pending = f.context.send(f.context.input, f.context.attachments, "web_search");
  await settle();
  assert.equal(f.requests.length, 4);
  await f.respond(3);
  await pending;
});

for (const boundary of ["principal", "chat", "unmount"]) {
  test(`old discard-kept-version control is inert after ${boundary}`, async () => {
    const f = fixture();
    const { pending } = await f.start();
    f.type("Keep this newer draft");
    await f.fail(quotaError());
    await pending;
    const discard = discardButton(f.quotaPanels()[0]).props.onClick;
    if (boundary === "unmount") f.cleanup();
    else {
      const original = f.context.nextPromptScopeRef.current;
      f.context.nextPromptScopeRef.current = helpers.advanceNextPromptScope(original, {
        ...original,
        [boundary === "principal" ? "principal" : "conversationId"]: "other",
      });
    }
    const kept = f.context.quotaRejectedDraftsRef.current;
    discard({ currentTarget: "stale-discard" });
    assert.equal(f.context.quotaRejectedDraftsRef.current, kept);
    assert.equal(f.context.input, "Keep this newer draft");
    assert.equal(f.context.focusRequests.length, 0);
  });
}

test("kept-version capacity holds a valid queued send, while a stale queue callback cannot replace the current queue", async () => {
  const f = fixture();
  const snapshots = Array.from({ length: 3 }, (_, index) => ({
    id: `kept-${index}`,
    scope: scope(),
    waitingFor: "old-response",
    text: `Kept ${index}`,
    attachments: [],
    tool: null,
    mode: "instant",
    status: "held",
  }));
  f.context.updateQuotaRejectedDrafts(snapshots);
  const queued = { ...snapshots[0], id: "queued", status: "ready", text: "Queued next" };
  f.context.updateNextPrompt(queued);
  f.type("Newer current draft");
  const stale = { ...queued, id: "stale" };
  await f.context.send(stale.text, [], null, 0, "chat-a", undefined, undefined, stale);
  assert.equal(f.context.nextPromptRef.current, queued);
  await f.context.send(queued.text, [], null, 0, "chat-a", undefined, undefined, queued);
  assert.equal(f.context.nextPromptRef.current.id, "queued");
  assert.equal(f.context.nextPromptRef.current.status, "held");
  assert.match(f.context.nextPromptRef.current.reason, /Restore or discard/);
  assert.equal(f.context.input, "Newer current draft");
  assert.equal(f.context.quotaRejectedDraftsRef.current, snapshots);
  assert.equal(f.requests.length, 0);
});

test("a tool edited away and back during a quota rejection remains a newer draft selection", async () => {
  const f = fixture();
  f.type("Original", [], "web_search");
  const pending = f.context.send("Original", [], "web_search");
  await settle();
  f.context.setSelectedTool("image");
  f.context.setSelectedTool("web_search");
  await f.fail(quotaError());
  await pending;
  assert.equal(f.context.input, "");
  assert.equal(f.context.selectedTool, "web_search");
  assert.equal(f.context.quotaRejectedDraftsRef.current[0].text, "Original");
});
