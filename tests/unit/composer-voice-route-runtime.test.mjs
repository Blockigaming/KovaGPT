import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deferred, settle } from "../helpers/ui-state-harness.mjs";

const parse = (path) =>
  ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
const route = parse("src/routes/index.tsx");
function find(root, predicate) {
  let result;
  const visit = (node) => {
    if (!result && predicate(node)) result = node;
    else if (!result) ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(result, "Expected actual route implementation");
  return result;
}
const initializer = (name) =>
  find(route, (node) => ts.isVariableDeclaration(node) && node.name.getText(route) === name)
    .initializer;
const arrow = (name) => initializer(name).arguments[0].getText(route);
const js = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
const helperJs = js(readFileSync("src/lib/chat-send-next.ts", "utf8"));
const helpers = await import(
  `data:text/javascript;base64,${Buffer.from(helperJs).toString("base64")}`
);

const editHelperJs = js(readFileSync("src/lib/chat-edit-draft.ts", "utf8"));
const editHelpers = await import(
  `data:text/javascript;base64,${Buffer.from(editHelperJs).toString("base64")}`
);

// Reuse the existing isolated send fixture's constructor without executing or
// re-registering its other tests. The send/Stop callbacks come from current source.
const oldHarness = parse("tests/unit/chat-send-next-runtime.test.mjs");
const fixtureSource = find(
  oldHarness,
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "fixture",
).getText(oldHarness);
const scope = () => ({
  principal: "owner-a",
  conversationId: "chat-a",
  temporary: false,
  temporaryContext: "clean",
});
const compiled =
  js(`globalThis.send = ${arrow("send").replace('await import("@/lib/chat-summary-snapshot.mjs")', "await summaryModule")};
globalThis.stop = ${arrow("stop")};
globalThis.setInput = ${arrow("setInput")};
globalThis.setAttachments = ${arrow("setAttachments")};
globalThis.setSelectedTool = ${arrow("setSelectedTool")};
globalThis.startLifetime = () => () => undefined;`);
const sendFixtureFactory = vm.runInNewContext(`(${fixtureSource})`, {
  helpers,
  React,
  renderToStaticMarkup,
  deferred,
  settle,
  vm,
  compiled,
  scope,
  AbortController,
  DOMException,
});
const sendFixture = () => {
  const f = sendFixtureFactory();
  f.context.stopComposerVoiceRequestRef = { current: f.context.stop };
  return f;
};

test("voice uses actual chat submission and returns only its exact successful assistant identity while preserving typed draft and attachments", async () => {
  const f = sendFixture();
  const audio = new AbortController();
  const attachment = {
    name: "keep.txt",
    kind: "text_file",
    textContent: "keep",
    status: "complete",
  };
  f.type("typed draft remains", [attachment]);
  const pending = f.context.send(
    "spoken turn",
    [],
    null,
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    { signal: audio.signal },
  );
  await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/chat");
  // This UI fixture does not sign receipts: it simulates the authenticated
  // chat route emitting a receipt alongside the streamed assistant answer.
  const receipt = `${"a".repeat(16)}.${"b".repeat(43)}`;
  f.requests[0].resolve({ ok: true, body: { cancel: async () => {} } });
  await settle();
  const stream = f.streams.at(-1);
  stream.args.onEvent({ choices: [{ delta: { content: "Synthetic answer" } }] });
  stream.args.onEvent({
    choices: [{ delta: { kind: "voice_model_receipt", receipt } }],
  });
  stream.resolve();
  await settle();
  const turn = await pending;
  assert.equal(turn.ownerId, "owner-a");
  assert.equal(turn.chatId, "chat-a");
  assert.equal(turn.content, "Synthetic answer");
  assert.equal(turn.voiceModelReceipt, receipt);
  const assistant = f.context.conversations[0].messages.find(
    (message) => message.id === turn.messageId,
  );
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content, turn.content);
  assert.equal(f.context.input, "typed draft remains");
  assert.equal(f.context.attachments[0], attachment);
  assert.equal(f.requests.length, 1, "voice never duplicates the existing chat request");
});

for (const outcome of ["failure", "confirmation", "empty", "aborted"]) {
  test(`actual ${outcome} chat result cannot become a spoken success receipt`, async () => {
    const f = sendFixture();
    const audio = new AbortController();
    const pending = f.context.send(
      "spoken turn",
      [],
      null,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      { signal: audio.signal },
    );
    await settle();
    if (outcome === "aborted") {
      audio.abort();
      f.requests[0].reject(new DOMException("cancelled", "AbortError"));
    } else if (outcome === "empty") {
      f.requests[0].resolve({ ok: true, body: { cancel: async () => {} } });
      await settle();
      f.streams.at(-1).resolve();
    } else
      await f.respond(0, { fail: outcome === "failure", confirmation: outcome === "confirmation" });
    assert.equal(await pending, undefined);
    assert.equal(f.requests.length, 1);
  });
}

test("late voice cancellation cannot stop a replacement generation", async () => {
  const f = sendFixture();
  const audio = new AbortController();
  const pending = f.context.send(
    "spoken turn",
    [],
    null,
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    { signal: audio.signal },
  );
  await settle();
  const replacement = new AbortController();
  f.context.inFlightTargetRef.current = { controller: replacement };
  audio.abort();
  assert.equal(replacement.signal.aborted, false);
  f.requests[0].reject(new DOMException("cancelled", "AbortError"));
  await pending;
});

function bridgeFixture({ active = null } = {}) {
  const state = {
    mode: null,
    items: active ? [active] : [],
    sends: [],
    saves: [],
    waits: [],
    errors: [],
    nextId: 0,
  };
  const context = {
    ...helpers,
    ...editHelpers,
    tempChat: false,
    editingMessage: null,
    attachments: [],
    canWriteChatHistory: () => true,
    principalReady: true,
    isSignedIn: true,
    userKey: "owner-a",
    storagePrincipalRef: { current: "user:owner-a" },
    storageGenerationRef: { current: 1 },
    retryGenerationRef: { current: 0 },
    composerVoiceEligible: true,
    active,
    mode: "instant",
    pendingWorkflowSkill: { installationId: "skill-a" },
    composerVoiceSessionRef: { current: null },
    nextPromptScopeRef: {
      current: {
        ...scope(),
        principal: "user:owner-a",
        conversationId: active?.id ?? null,
        lifetime: 2,
      },
    },
    inFlightRef: { current: false },
    nextPromptRef: { current: null },
    nextPromptMountedRef: { current: true },
    composerDraftRef: {
      current: { text: "existing typed draft", attachments: [{ id: "file-a" }], tool: null },
    },
    lastLoadedDraftRef: { current: null },
    pendingDraftLoadRef: { current: null },
    attachmentDraftsRef: { current: new Map() },
    voiceConversationsRef: { current: [] },
    newId: () => `new-chat-${++state.nextId}`,
    Date,
    DOMException,
    draftStorageKey: (owner, id) => `${owner}:${id}`,
    setConversations: (update) => {
      state.items = update(state.items);
    },
    setActiveId: (id) => {
      state.activeId = id;
    },
    setComposerVoiceMode: (mode) => {
      state.mode = mode;
    },
    toast: { error: (message) => state.errors.push(message) },
    send: async (...args) => {
      state.sends.push(args);
      return state.turn;
    },
    awaitSavedComposerVoiceTurn: async (options) => {
      state.waits.push(options);
      return { ...options.turn, contentSha256: "a".repeat(64) };
    },
    saveConversations: async (...args) => {
      state.saves.push(args);
      return true;
    },
    loadChatHistoryDevice: async (owner) => ({ ownerId: owner }),
    CHAT_HISTORY_CHANGED_EVENT: "history-changed",
    window: { addEventListener() {}, removeEventListener() {} },
  };
  context.voiceTurnModule = Promise.resolve({
    awaitSavedComposerVoiceTurn: context.awaitSavedComposerVoiceTurn,
  });
  vm.runInNewContext(
    js(
      `globalThis.change = ${initializer("changeComposerVoiceMode").getText(route)}; globalThis.submit = ${initializer("submitComposerVoiceTurn").getText(route).replace('await import("@/lib/composer-voice-turn")', "await voiceTurnModule")}; globalThis.readEligible = () => ${initializer("composerVoiceEligible").getText(route)};`,
    ),
    context,
  );
  return { state, context };
}

test("opening voice precreates the stable conversation and carries the existing draft before microphone Start", () => {
  const f = bridgeFixture();
  f.context.change("voice");
  assert.equal(f.state.mode, "voice");
  assert.equal(f.state.items.length, 1);
  assert.equal(f.state.activeId, f.state.items[0].id);
  assert.equal(f.state.items[0].messages.length, 0);
  assert.equal(f.state.items[0].skill.installationId, "skill-a");
  assert.equal(f.context.lastLoadedDraftRef.current, "owner-a:new-chat-1");
  assert.equal(
    f.context.attachmentDraftsRef.current.get("owner-a:new-chat-1"),
    f.context.composerDraftRef.current.attachments,
  );
  assert.equal(f.context.composerDraftRef.current.text, "existing typed draft");
  assert.equal(f.state.sends.length, 0);
  assert.equal(f.context.composerVoiceSessionRef.current.scope.conversationId, f.state.activeId);
});

test("Dictate and an existing voice chat do not create or submit another conversation", () => {
  const dictate = bridgeFixture();
  dictate.context.change("dictate");
  assert.equal(dictate.state.items.length, 0);
  assert.equal(dictate.state.sends.length, 0);
  const voice = bridgeFixture({ active: { id: "chat-a", messages: [] } });
  voice.context.change("voice");
  assert.equal(voice.state.items.length, 1);
  assert.equal(voice.state.nextId, 0);
  assert.equal(voice.state.sends.length, 0);
});

for (const boundary of ["ineligible", "busy", "queued", "signed out"]) {
  test(`voice opening is inert when ${boundary}`, () => {
    const f = bridgeFixture();
    if (boundary === "ineligible") f.context.composerVoiceEligible = false;
    if (boundary === "busy") f.context.inFlightRef.current = true;
    if (boundary === "queued") f.context.nextPromptRef.current = {};
    if (boundary === "signed out") f.context.isSignedIn = false;
    f.context.change("voice");
    assert.equal(f.state.mode, null);
    assert.equal(f.state.items.length, 0);
    assert.equal(f.state.sends.length, 0);
  });
}

test("route submission passes the captured signal and exact turn to the existing save/ack bridge", async () => {
  const f = bridgeFixture({ active: { id: "chat-a", messages: [] } });
  f.context.change("voice");
  f.state.turn = {
    ownerId: "owner-a",
    chatId: "chat-a",
    messageId: "new-assistant",
    content: "exact completed answer",
  };
  const abort = new AbortController();
  const receipt = await f.context.submit("spoken words", abort.signal);
  assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.sends[0][0], "spoken words");
  assert.equal(f.state.sends[0][1].length, 0);
  assert.equal(f.state.sends[0][8].signal, abort.signal);
  assert.equal(receipt.messageId, "new-assistant");
  const options = f.state.waits[0];
  assert.equal(options.turn, f.state.turn);
  assert.equal(options.signal, abort.signal);
  await options.saveConversations([]);
  assert.equal(f.state.saves[0][0], "owner-a");
  assert.equal(options.isCurrent(), true);
  f.context.change(null);
  assert.equal(options.isCurrent(), false);
});

test("a resolved void send cannot trigger history confirmation or speech", async () => {
  const f = bridgeFixture({ active: { id: "chat-a", messages: [] } });
  f.context.change("voice");
  await assert.rejects(
    f.context.submit("spoken words", new AbortController().signal),
    /voice_chat_failed/,
  );
  assert.equal(f.state.waits.length, 0);
});

for (const boundary of [
  "owner",
  "chat",
  "close and reopen",
  "unmount",
  "abort",
  "replacement generation",
]) {
  test(`late chat completion cannot start speech after ${boundary}`, async () => {
    const f = bridgeFixture({ active: { id: "chat-a", messages: [] } });
    f.context.change("voice");
    const completed = deferred();
    f.context.send = () => completed.promise;
    const abort = new AbortController();
    const pending = f.context.submit("spoken words", abort.signal);
    if (boundary === "owner") f.context.storagePrincipalRef.current = "user:owner-b";
    if (boundary === "chat")
      f.context.nextPromptScopeRef.current = {
        ...f.context.nextPromptScopeRef.current,
        conversationId: "chat-b",
      };
    if (boundary === "close and reopen") {
      f.context.change(null);
      f.context.change("voice");
    }
    if (boundary === "unmount") f.context.nextPromptMountedRef.current = false;
    if (boundary === "abort") abort.abort();
    if (boundary === "replacement generation") f.context.retryGenerationRef.current++;
    completed.resolve({
      ownerId: "owner-a",
      chatId: "chat-a",
      messageId: "reply-a",
      content: "late answer",
    });
    await assert.rejects(pending, (error) => error.name === "AbortError");
    assert.equal(f.state.waits.length, 0);
  });
}

test("guest Dictate opens the honest signed-out dialog without creating or submitting a voice chat", () => {
  const f = bridgeFixture();
  f.context.isSignedIn = false;
  f.context.userKey = null;
  f.context.change("dictate");
  assert.equal(f.state.mode, "dictate");
  assert.equal(f.state.items.length, 0);
  assert.equal(f.state.sends.length, 0);
  assert.equal(f.context.composerVoiceSessionRef.current, null);
});

test("the actual route eligibility refuses pending attachments and retains completed files", () => {
  const f = bridgeFixture();
  f.context.attachments = [{ status: "uploading" }];
  assert.equal(f.context.readEligible(), false);
  f.context.composerVoiceEligible = f.context.readEligible();
  f.context.change("voice");
  assert.equal(f.state.mode, null);
  assert.equal(f.state.items.length, 0);
  f.context.attachments = [{ status: "complete" }];
  assert.equal(f.context.readEligible(), true);
});

test("stale chat voice cancellation disposes its own request without clearing destination tool, queue or notice", async () => {
  const f = sendFixture();
  const audio = new AbortController();
  const pending = f.context.send(
    "spoken turn",
    [],
    null,
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    { signal: audio.signal },
  );
  await settle();
  f.type("", [], "image");
  f.context.nextPromptScopeRef.current = {
    ...f.context.nextPromptScopeRef.current,
    conversationId: "chat-b",
    lifetime: 99,
  };
  const next = { scope: f.context.nextPromptScopeRef.current, status: "queued" };
  f.context.nextPromptRef.current = next;
  f.context.requestNotice = "destination notice";
  audio.abort();
  assert.equal(f.context.selectedTool, "image");
  assert.equal(f.context.nextPromptRef.current, next);
  assert.equal(f.context.requestNotice, "destination notice");
  assert.equal(f.context.inFlightRef.current, false);
  f.requests[0].reject(new DOMException("cancelled", "AbortError"));
  assert.equal(await pending, undefined);
});

for (const change of ["owner", "chat", "abort"]) {
  test(`late voice helper loading cannot authorize speech after ${change} cancellation`, async () => {
    const f = bridgeFixture();
    f.context.change("voice");
    f.state.turn = {
      ownerId: "owner-a",
      chatId: "chat-a",
      messageId: "reply-a",
      content: "exact completed answer",
    };
    const loading = deferred();
    f.context.voiceTurnModule = loading.promise;
    const controller = new AbortController();
    const pending = f.context.submit("spoken turn", controller.signal);
    await settle();
    assert.equal(f.state.sends.length, 1);
    assert.equal(f.state.waits.length, 0);
    if (change === "owner") f.context.storageGenerationRef.current += 1;
    else if (change === "chat") {
      f.context.nextPromptScopeRef.current = {
        ...f.context.nextPromptScopeRef.current,
        conversationId: "chat-b",
      };
    } else controller.abort();
    loading.resolve({ awaitSavedComposerVoiceTurn: f.context.awaitSavedComposerVoiceTurn });
    await assert.rejects(pending, (error) => error.name === "AbortError");
    assert.equal(f.state.waits.length, 0);
    assert.equal(f.state.saves.length, 0);
  });
}
