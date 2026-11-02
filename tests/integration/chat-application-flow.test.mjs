import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { consumeChatSse, chatResponseError } from "../../src/lib/chat-sse-client.mjs";
import { withResponsePresentation } from "../../src/lib/spec400-response-preferences.mjs";
import {
  createAcceptanceFixture,
  liveAcceptanceFixtureTime,
} from "../helpers/generation-acceptance.mjs";
import {
  ACCEPTANCE_PROMPT,
  acceptanceDigest,
} from "../../src/lib/generation-acceptance.server.mjs";

// Execute the actual route, provider request adapter, Responses stream adapter,
// transport deadline and client SSE consumer. Only external authority/storage
// and provider HTTP are fixtures. No network or real credentials are available.
const mocks = {
  "@tanstack/react-router": ["createFileRoute"],
  "@/lib/api-auth.server": [
    "optionalUser",
    "assertNotBanned",
    "getCallerTier",
    "assertFeatureEnabled",
    "enforceQuota",
  ],
  "@/lib/account-identity.server.mjs": ["readAccountIdentity"],
  "@/lib/google-tools.server": [
    "getGoogleToolContext",
    "TOOL_ACTIVITY",
    "WRITE_TOOL_NAMES",
    "runGoogleTool",
    "stagePendingAction",
  ],
  "@/lib/ai/accounting.server": [
    "acquireGeneration",
    "finalizeGeneration",
    "getGenerationTokenHeadroom",
    "hashGuestIp",
  ],
  "@/lib/pricing/developer-billing.server": ["meterProviderRequest"],
  "@/lib/runtime-env.server": ["runtimeEnv"],
  "@/lib/distributed-rate-limit.server": ["consumeApplicationRateLimit"],
  "@/lib/chat-workspace-context.server": ["buildChatWorkspaceBlock"],
  "@/integrations/supabase/client.server": ["supabaseAdmin"],
  "@/lib/generation-acceptance-runtime.server": ["generationAcceptance"],
};
const output = await build({
  entryPoints: ["src/routes/api/chat.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [
    {
      name: "external-authority-fixtures",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) =>
          args.path in mocks ? { path: args.path, namespace: "authority-fixture" } : undefined,
        );
        b.onLoad({ filter: /.*/, namespace: "authority-fixture" }, ({ path }) => ({
          contents: mocks[path]
            .map(
              (name) =>
                `export const ${name}=globalThis.fixture[${JSON.stringify(path)}][${JSON.stringify(name)}];`,
            )
            .join("\n"),
        }));
      },
    },
  ],
});

function fixture({
  mode = "success",
  denied = false,
  disabled = false,
  acceptance = null,
  prompt = "Say hello.",
  now = Date.now,
} = {}) {
  const ownerId = acceptance?.plan.ownerId ?? "owner-a";
  const chatId = acceptance?.plan.chatId ?? "123e4567-e89b-42d3-a456-426614174000";
  const calls = [],
    finalizations = [],
    logs = [];
  let controller,
    cancelled = false,
    providerSignal,
    providerBody,
    applicationBody;
  const encoder = new TextEncoder();
  const env = {
    KOVA_TEXT_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-key-only",
    KOVA_IP_HASH_SECRET: "fixture-hash-secret-not-live-0000000000",
    KOVA_AI_TIMEOUT_MS: "1000",
    KOVA_GENERATION_DISABLED: String(disabled),
    KOVA_GENERATION_ACCEPTANCE_ENABLED: acceptance ? "true" : undefined,
  };
  const auth = {
    userId: ownerId,
    emailVerified: true,
    supabaseAdmin: {
      rpc(name, args) {
        assert.equal(name, "try_consume_daily_message");
        assert.equal(args._user_id, ownerId);
        const query = {
          abortSignal: () => query,
          then: (yes, no) => Promise.resolve({ data: true, error: null }).then(yes, no),
        };
        return query;
      },
      from() {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return q;
      },
    },
  };
  const noop = async () => null;
  const fixture = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "@/lib/api-auth.server": {
      optionalUser: async () => {
        calls.push("session");
        return denied ? Response.json({ error: "Authentication required" }, { status: 401 }) : auth;
      },
      assertNotBanned: noop,
      getCallerTier: async () => "free",
      assertFeatureEnabled: noop,
      enforceQuota: noop,
    },
    "@/lib/account-identity.server.mjs": { readAccountIdentity: async () => null },
    "@/lib/google-tools.server": {
      getGoogleToolContext: noop,
      TOOL_ACTIVITY: {},
      WRITE_TOOL_NAMES: new Set(),
      runGoogleTool: () => {
        throw Error("Unexpected tool");
      },
      stagePendingAction: noop,
    },
    "@/lib/ai/accounting.server": {
      getGenerationTokenHeadroom: async () => {
        throw new Error("Headroom must not be read without connected tools");
      },
      acquireGeneration: async (input) => {
        assert.equal(input.userId, ownerId);
        calls.push("usage");
        return { eventId: "fixture-event" };
      },
      finalizeGeneration: async (input) => {
        finalizations.push(input);
      },
      hashGuestIp: () => {
        throw Error("Unexpected guest");
      },
    },
    "@/lib/pricing/developer-billing.server": { meterProviderRequest: ({ send }) => send() },
    "@/lib/runtime-env.server": { runtimeEnv: (name) => env[name] },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/chat-workspace-context.server": {
      buildChatWorkspaceBlock: async (_db, input) => {
        assert.equal(input.userId, ownerId);
        return { block: "" };
      },
    },
    "@/integrations/supabase/client.server": { supabaseAdmin: null },
    "@/lib/generation-acceptance-runtime.server": { generationAcceptance: acceptance?.build() },
  };
  const context = {
    fixture,
    module: { exports: {} },
    require: createRequire(import.meta.url),
    Request,
    Response,
    Headers,
    URL,
    AbortController,
    AbortSignal,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Error,
    DOMException,
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [now()]));
      }
      static now() {
        return now();
      }
    },
    crypto,
    setTimeout,
    clearTimeout,
    process: { env: {} },
    console: Object.fromEntries(
      ["info", "warn", "error", "log"].map((key) => [key, (...args) => logs.push(args)]),
    ),
    fetch: async (url, init) => {
      calls.push("provider");
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init.redirect, "error");
      const body = JSON.parse(init.body);
      providerBody = body;
      assert.equal(body.stream, true);
      assert.ok(
        Array.isArray(body.input),
        "real request adapter must convert messages to Responses input",
      );
      assert.equal(body.messages, undefined);
      providerSignal = init.signal;
      if (mode === "provider-error")
        return Response.json({ error: "private upstream detail" }, { status: 429 });
      if (mode === "headers-timeout") return new Promise(() => {});
      return new Response(
        new ReadableStream({
          start(c) {
            controller = c;
            c.enqueue(
              encoder.encode(
                'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Visible "}\n\n',
              ),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  };
  vm.runInNewContext(output.outputFiles[0].text, context);
  const requestAbort = new AbortController();
  const request = new Request("https://kova.test/api/chat", {
    method: "POST",
    signal: requestAbort.signal,
    headers: { "Content-Type": "application/json", "Idempotency-Key": "fixture-message-123" },
    body: JSON.stringify({
      mode: "instant",
      chatId,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  return {
    ownerId,
    chatId,
    prompt,
    operationId: acceptance?.plan.operationId,
    get providerBody() {
      return providerBody;
    },
    get applicationBody() {
      return applicationBody;
    },
    post: async (override) => {
      const selected = override ?? request;
      applicationBody = await selected.clone().text();
      return context.module.exports.Route.server.handlers.POST({ request: selected });
    },
    calls,
    finalizations,
    logs,
    requestAbort,
    get cancelled() {
      return cancelled;
    },
    get providerSignal() {
      return providerSignal;
    },
    fail() {
      controller.error(new Error("fixture upstream disconnect"));
    },
    finish() {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"response.output_text.delta","delta":"completion."}\n\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":4,"output_tokens":2}}}\n\n',
        ),
      );
      controller.close();
    },
  };
}

async function waitFor(predicate, message) {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("application route → actual repaired adapter → incremental client completion", async () => {
  const f = fixture();
  const response = await f.post();
  assert.equal(response.status, 200, response.status !== 200 ? await response.text() : "");
  assert.deepEqual(f.calls, ["session", "usage", "provider"]);
  let visible = "";
  const consuming = consumeChatSse(response.body, {
    onEvent: (event) => {
      visible += event.choices?.[0]?.delta?.content ?? "";
    },
  });
  await waitFor(
    () => visible === "Visible ",
    "first content must arrive before upstream completion",
  );
  assert.equal(visible, "Visible ", "first content must arrive before upstream completion");
  f.finish();
  await consuming;
  assert.equal(visible, "Visible completion.");
  assert.equal(f.finalizations[0].status, "completed");
  assert.doesNotMatch(JSON.stringify(f.logs), /fixture-key-only/);
});

test("session rejection stops the application before usage/provider work", async () => {
  const f = fixture({ denied: true });
  assert.equal((await f.post()).status, 401);
  assert.deepEqual(f.calls, ["session"]);
});

test("generation kill switch blocks provider HTTP", async () => {
  const f = fixture({ disabled: true });
  assert.equal((await f.post()).status, 503);
  assert.deepEqual(f.calls, ["session"]);
});

test("provider rejection reaches the existing client error contract without private details/retry", async () => {
  const f = fixture({ mode: "provider-error" });
  const response = await f.post();
  assert.equal(response.status, 429);
  const error = await chatResponseError(response);
  assert.equal(error.status, 429);
  assert.doesNotMatch(error.message, /private upstream/);
  assert.equal(f.calls.filter((x) => x === "provider").length, 1);
});

test("provider header timeout terminates the application request without retry", async () => {
  const f = fixture({ mode: "headers-timeout" });
  const response = await f.post();
  assert.ok(response.status >= 400);
  assert.equal(f.calls.filter((x) => x === "provider").length, 1);
  assert.equal(f.providerSignal.aborted, true);
});

test("client Stop cancels the actual application stream and provider body", async () => {
  const f = fixture();
  const response = await f.post();
  const consuming = consumeChatSse(response.body, { signal: f.requestAbort.signal });
  f.requestAbort.abort();
  await assert.rejects(consuming, (error) => error.name === "AbortError");
  await waitFor(
    () => f.cancelled && f.providerSignal.aborted && f.finalizations.length > 0,
    "Stop must cancel the provider and settle the application stream",
  );
  assert.equal(f.cancelled, true);
  assert.equal(f.providerSignal.aborted, true);
  assert.ok(["aborted", "client_disconnected"].includes(f.finalizations[0].status));
});

// Execute the unmodified send callback extracted from the current index.tsx.
// React state setters and persistence are isolated fixtures; application request
// construction, event handling, failure/retry decisions and finally are real.
const indexSource = ts.createSourceFile(
  "index.tsx",
  readFileSync("src/routes/index.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let sendSource;
function findSend(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(indexSource) === "send" &&
    ts.isCallExpression(node.initializer)
  ) {
    sendSource = node.initializer.arguments[0].getText(indexSource);
  }
  ts.forEachChild(node, findSend);
}
findSend(indexSource);
assert.ok(sendSource, "actual composer callback must be found");
const compiledSend = ts.transpileModule(`globalThis.composerSend = ${sendSource};`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const nextPromptHelpers = {};
new Function(
  "exports",
  ts.transpileModule(readFileSync("src/lib/chat-send-next.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
)(nextPromptHelpers);

function composer(f) {
  const ownerId = f.ownerId;
  let items = [],
    streaming = false,
    announcement = "",
    httpCalls = 0;
  const retryTimers = [],
    errors = [];
  const ref = (current) => ({ current });
  const no = () => {};
  const context = {
    principalReady: true,
    userKey: ownerId,
    isSignedIn: true,
    isLoaded: true,
    storagePrincipal: ownerId,
    storagePrincipalRef: ref(ownerId),
    storageGenerationRef: ref(0),
    retryGenerationRef: ref(0),
    inFlightRef: ref(false),
    retryTimerRef: ref(null),
    guestPromptTurnsRef: ref(0),
    activeIdRef: ref(null),
    abortRef: ref(null),
    inFlightTargetRef: ref(null),
    retryActionEpochRef: ref(new Map()),
    // Current mounted Home callback also owns the next-message/quota recovery
    // scope. Keep these fixture state bindings in step with its real closure.
    ...nextPromptHelpers,
    nextPromptScopeRef: ref({
      principal: ownerId,
      conversationId: f.chatId,
      temporary: false,
      temporaryContext: "clean",
      lifetime: 0,
    }),
    nextPromptMountedRef: ref(true),
    nextPromptRef: ref(null),
    quotaRejectedDraftsRef: ref([]),
    composerDraftRef: ref({ text: "", attachments: [], tool: null }),
    composerRevisionRef: ref(0),
    retryableFailedResponsesRef: ref(new Set()),
    stopComposerVoiceRequestRef: ref(no),
    updateNextPrompt: (value) => {
      context.nextPromptRef.current = value;
    },
    updateQuotaRejectedDrafts: (value) => {
      context.quotaRejectedDraftsRef.current = value;
    },
    updateRequestNotice: no,
    activeId: f.chatId,
    conversations: [],
    editingMessage: null,
    pendingWorkflowSkill: null,
    mode: "instant",
    tempChat: false,
    tempChatContext: "clean",
    settings: { rememberAcross: false },
    canWriteChatHistory: () => true,
    canSendChatHistory: () => true,
    clearRetryTimer: no,
    newId: () => crypto.randomUUID(),
    setConversations: (updater) => {
      items = typeof updater === "function" ? updater(items) : updater;
    },
    setActiveId: (id) => {
      context.activeIdRef.current = id;
    },
    setPendingWorkflowSkill: no,
    setInput: no,
    setAttachments: no,
    setEditingMessage: no,
    setIsStreaming: (value) => {
      streaming = value;
    },
    setSelectedTool: no,
    setStreamAnnouncement: (value) => {
      announcement = value;
    },
    autoTitle: no,
    setLimitDialog: no,
    toast: { error: (...args) => errors.push(args) },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    window: {
      setTimeout: (fn, ms) => {
        retryTimers.push({ fn, ms });
        return 1;
      },
    },
    chatRequestMessages: (prior, user) => [...prior, user],
    createMemorySourceUpdater: () => no,
    normalizeResponseSources: () => [],
    safeLocale: () => "en-US",
    personalityToInstruction: () => "",
    loadPersonality: no,
    USER_STOP_REASON: "kova_user_stopped_generation",
    consumeChatSse,
    chatResponseError,
    withResponsePresentation,
    AbortController,
    DOMException,
    Error,
    TypeError,
    require: (name) => {
      assert.equal(name, "@/lib/chat-summary-snapshot.mjs");
      return {
        withResponsePresentation,
        createChatHistoryPayload: async (messages) => ({ messages }),
        chatRequestProfile: () => ({}),
        fetchForPrincipal: async (owner, url, init) => {
          assert.equal(owner, ownerId);
          assert.equal(url, "/api/chat");
          httpCalls++;
          if (f.operationId) {
            init = {
              ...init,
              headers: { ...init.headers, "x-kova-acceptance-operation": f.operationId },
            };
          }
          return f.post(new Request("https://kova.test" + url, init));
        },
      };
    },
  };
  vm.runInNewContext(compiledSend, context);
  return {
    context,
    send: () => context.composerSend(f.prompt, []),
    errors,
    retryTimers,
    get items() {
      return items;
    },
    get streaming() {
      return streaming;
    },
    get announcement() {
      return announcement;
    },
    get httpCalls() {
      return httpCalls;
    },
  };
}

const waitForPartialOutput = (ui) =>
  waitFor(
    () => ui.streaming && ui.items[0]?.messages[1]?.content === "Visible ",
    "the composer must expose partial output before upstream completion",
  );

test("actual composer callback → route → adapter → visible completion clears loading", async () => {
  const f = fixture(),
    ui = composer(f);
  const sending = ui.send();
  await waitForPartialOutput(ui);
  assert.equal(ui.streaming, true);
  assert.equal(ui.items[0].messages[1].content, "Visible ");
  f.finish();
  await sending;
  assert.equal(ui.items[0].messages[1].content, "Visible completion.");
  assert.equal(ui.announcement, "KovaGPT response complete");
  assert.equal(ui.streaming, false);
  assert.equal(ui.context.inFlightRef.current, false);
  assert.equal(ui.httpCalls, 1);
  assert.equal(ui.retryTimers.length, 0);
});

for (const mode of ["provider-error", "headers-timeout"]) {
  test(`actual composer ${mode} clears loading and never silently replays generation`, async () => {
    const ui = composer(fixture({ mode }));
    await ui.send();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(ui.streaming, false);
    assert.equal(ui.context.inFlightRef.current, false);
    assert.equal(ui.items[0].messages[1].generationStatus, "failed");
    assert.equal(ui.httpCalls, 1);
    assert.equal(ui.retryTimers.length, 0);
    assert.equal(ui.errors.length, 1);
  });
}

test("actual composer cancellation clears loading and aborts downstream provider", async () => {
  const f = fixture(),
    ui = composer(f);
  const sending = ui.send();
  await waitForPartialOutput(ui);
  ui.context.abortRef.current.abort(new DOMException("kova_user_stopped_generation", "AbortError"));
  await sending;
  await waitFor(
    () => f.cancelled && f.providerSignal.aborted,
    "composer Stop must cancel the downstream provider",
  );
  assert.equal(ui.streaming, false);
  assert.equal(ui.context.inFlightRef.current, false);
  assert.equal(f.cancelled, true);
  assert.equal(f.providerSignal.aborted, true);
  assert.equal(ui.retryTimers.length, 0);
});

test("partial provider failure retains visible output, exits loading and requires explicit Retry", async () => {
  const f = fixture(),
    ui = composer(f);
  const sending = ui.send();
  await waitForPartialOutput(ui);
  assert.equal(ui.items[0].messages[1].content, "Visible ");
  f.fail();
  await sending;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ui.streaming, false);
  assert.equal(ui.items[0].messages[1].generationStatus, "failed");
  assert.ok(ui.items[0].messages[1].content.startsWith("Visible "));
  assert.equal(ui.retryTimers.length, 0);
  assert.equal(ui.httpCalls, 1);
});

test("actual application guard clamps final output and permits only one quoted OpenAI request", async () => {
  // The guard and provider adapter must share a fixed clock away from the bucket edge.
  const now = () => Date.UTC(2026, 9, 20, 0, 10);
  const capture = fixture({ prompt: ACCEPTANCE_PROMPT, now }),
    captureUi = composer(capture);
  const capturing = captureUi.send();
  await waitForPartialOutput(captureUi);
  capture.finish();
  await capturing;
  const a = createAcceptanceFixture({
    now: now(),
    providerBody: capture.providerBody,
    maximumInputUtf8Bytes: 32768,
  });
  const f = fixture({ acceptance: a, prompt: ACCEPTANCE_PROMPT, now }),
    ui = composer(f);
  const sending = ui.send();
  await waitForPartialOutput(ui);
  assert.equal(f.providerBody.max_output_tokens, 64);
  assert.equal(acceptanceDigest(f.providerBody), a.plan.openAI.bodySha256);
  f.finish();
  await sending;
  assert.equal(ui.streaming, false);
  const blocked = await f.post(
    new Request("https://kova.test/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "new-attempt-123",
        "x-kova-acceptance-operation": a.plan.operationId,
      },
      body: f.applicationBody,
    }),
  );
  assert.equal(blocked.status, 502);
  assert.equal(f.calls.filter((c) => c === "provider").length, 1);
  assert.equal(a.calls.length, 2);
});
