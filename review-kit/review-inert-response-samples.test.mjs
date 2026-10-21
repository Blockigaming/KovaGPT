import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";
import { toJSON } from "seroval";
import {
  REVIEW_CHAT_IMAGE_SAMPLES,
  REVIEW_CHAT_ACTION_A,
  REVIEW_CHAT_ACTION_B,
  REVIEW_CHAT_ACTION_RECONNECT,
  REVIEW_CHAT_ACTION_SUCCESS,
  REVIEW_CHAT_QUOTA_HOLD_MS,
  REVIEW_CHAT_STREAM_MAX_REQUESTS,
  REVIEW_CHAT_INSPECTION_OPTIONS,
  createReviewChatResponse,
  createReviewChatAction,
  reviewChatActionConfirmations,
  reviewChatOpeningEvent,
  reviewChatCompletionEvent,
} from "./chat-stream-review-fixture.mjs";
import {
  FIXTURE_ORIGIN,
  BACKEND_PREFIX,
  REVIEW_OWNER,
  FixtureRegistry,
  PATHS,
  SIZES,
  createFixtureSession,
  createPrivateReviewServer,
  loadReviewPackage,
  initialStorage,
  reviewConversations,
  reviewNavigationScript,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import { consumeChatSse, chatResponseError } from "../src/lib/chat-sse-client.mjs";
import { normalizeChatHistory } from "../src/lib/chat-history-policy.mjs";
import { normalizeResponseSources } from "../src/lib/response-sources.ts";
import {
  detectArtifactKind,
  extractCodeBlocks,
  buildPreviewDoc,
} from "../src/components/artifact-utils.ts";

// Existing packaged base fixtures only. No application build, browser, provider,
// remote service, deployment or write outside the disposable local HTTP session.
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const selection = {
  account: "free",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario: "chat-message-quota-rejected",
};
const chatBody = {
  chatId: "review-response-chat",
  mode: "instant",
  messages: [{ role: "user", content: "  Fictional draft\n\nKeep spacing.  ", attachments: [] }],
};
const quotaBody = {
  error: "Synthetic message limit reached. Check Usage for account status.",
  category: "quota_exceeded",
  retryable: false,
};
const asStream = (text) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
function fakeClock() {
  const timers = new Map();
  let next = 0;
  return {
    timers,
    setTimeout(fn, ms) {
      const id = ++next;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    expire() {
      for (const { fn } of [...timers.values()]) fn();
    },
  };
}

test("new scenarios are explicit HTTP-only; both quota samples require Free", async () => {
  for (const scenario of [
    "chat-message-quota-rejected",
    "chat-message-quota-pending",
    ...REVIEW_CHAT_INSPECTION_OPTIONS.map(({ id }) => id),
  ]) {
    assert.ok(catalog.REVIEW_STATE_SCENARIOS.includes(scenario));
    await assert.rejects(catalog.installReviewState({}, scenario, "free"), /private HTTP/);
    await assert.rejects(
      createFixtureSession(pkg, { ...selection, scenario, account: "guest" }),
      /requires/,
    );
    const session = await createFixtureSession(pkg, { ...selection, scenario });
    session.dispose();
    if (scenario.startsWith("chat-message-quota-")) {
      assert.deepEqual(catalog.REVIEW_STATE_OPTIONS.find(({ id }) => id === scenario).accounts, [
        "free",
      ]);
      for (const account of ["plus", "pro"])
        await assert.rejects(
          createFixtureSession(pkg, { ...selection, scenario, account }),
          /requires/,
        );
    }
  }
});

test("quota responses have exact nonretryable DTO, no reset guess, one bounded delayed request and complete cleanup", async () => {
  let active = true;
  const immediate = createReviewChatResponse({
    scenario: "chat-message-quota-rejected",
    isActive: () => active,
  });
  assert.deepEqual(immediate.respond().json, quotaBody);
  const clock = fakeClock();
  const delayed = createReviewChatResponse({
    scenario: "chat-message-quota-pending",
    isActive: () => active,
    clock,
  });
  const controller = new AbortController();
  const pending = delayed.respond(controller.signal);
  assert.equal(delayed.status.pending, true);
  assert.equal(delayed.respond().status, 409);
  assert.equal(delayed.status.requestCount, 1);
  assert.equal([...clock.timers.values()][0].ms, REVIEW_CHAT_QUOTA_HOLD_MS);
  assert.equal(REVIEW_CHAT_QUOTA_HOLD_MS, 10000);
  clock.expire();
  const result = await pending;
  assert.equal(result.status, 429);
  assert.deepEqual(result.json, quotaBody);
  assert.equal(result.headers["Retry-After"], undefined);
  assert.equal(clock.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  const parsed = await chatResponseError(
    new Response(JSON.stringify(result.json), { status: result.status, headers: result.headers }),
  );
  assert.equal(parsed.category, "quota_exceeded");
  assert.equal(parsed.retryable, false);
  assert.equal(parsed.retryAfter, undefined);
  const aborted = delayed.respond(controller.signal);
  controller.abort();
  assert.equal((await aborted).status, 499);
  assert.equal(clock.timers.size, 0);
  const reset = delayed.respond();
  delayed.dispose();
  assert.equal((await reset).status, 499);
  assert.equal(clock.timers.size, 0);
  assert.equal(delayed.respond().status, 401);
  active = false;
  assert.equal(immediate.respond().status, 401);
  const bounded = createReviewChatResponse({
    scenario: "chat-message-quota-rejected",
    isActive: () => true,
  });
  for (let i = 0; i < REVIEW_CHAT_STREAM_MAX_REQUESTS; i++)
    assert.deepEqual(bounded.respond().json, quotaBody);
  assert.match(bounded.respond().json.error, /Synthetic response limit/);
  assert.equal(bounded.status.requestCount, REVIEW_CHAT_STREAM_MAX_REQUESTS);
});

test("image fixtures are real bounded PNGs with distinct natural ratios and only actual image SSE envelopes", async () => {
  for (const sample of Object.values(REVIEW_CHAT_IMAGE_SAMPLES)) {
    assert.match(sample.dataUrl, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    const png = Buffer.from(sample.dataUrl.split(",")[1], "base64");
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), sample.width);
    assert.equal(png.readUInt32BE(20), sample.height);
    let offset = 8;
    const chunks = [];
    while (offset < png.length) {
      const size = png.readUInt32BE(offset),
        type = png.toString("ascii", offset + 4, offset + 8);
      chunks.push(type);
      if (type === "IDAT")
        assert.equal(
          inflateSync(png.subarray(offset + 8, offset + 8 + size)).length,
          sample.height * (sample.width * 3 + 1),
        );
      offset += size + 12;
    }
    assert.deepEqual(chunks, ["IHDR", "IDAT", "IEND"]);
    assert.ok(png.length < 10000);
  }
  assert.equal(
    REVIEW_CHAT_IMAGE_SAMPLES.landscape.width / REVIEW_CHAT_IMAGE_SAMPLES.landscape.height,
    16 / 9,
  );
  assert.equal(
    REVIEW_CHAT_IMAGE_SAMPLES.portrait.width / REVIEW_CHAT_IMAGE_SAMPLES.portrait.height,
    9 / 16,
  );
  const opening = reviewChatOpeningEvent("chat-response-image-review");
  assert.deepEqual(JSON.parse(opening.slice(6).trim()), {
    choices: [{ delta: { kind: "image_pending" } }],
  });
  const events = [];
  await consumeChatSse(
    asStream(opening + reviewChatCompletionEvent("released", "chat-response-image-review")),
    { onEvent: (event) => events.push(event.choices[0].delta) },
  );
  assert.equal(events.length, 2);
  assert.equal(
    events[1].content,
    `![Synthetic local landscape sample](${REVIEW_CHAT_IMAGE_SAMPLES.landscape.dataUrl})`,
  );
  for (const outcome of ["failed", "timeout"]) {
    const deltas = [];
    await consumeChatSse(
      asStream(opening + reviewChatCompletionEvent(outcome, "chat-response-image-review")),
      { onEvent: (event) => deltas.push(event.choices[0].delta) },
    );
    assert.equal(deltas.length, 2);
    assert.deepEqual(Object.keys(deltas[1]), ["content"]);
    assert.match(deltas[1].content, /^Sorry - /);
    assert.doesNotMatch(JSON.stringify(deltas), /generationStatus|image_failed|https?:/);
  }
  const seeded = reviewConversations("chat-response-image-review")[0];
  assert.match(seeded.messages[1].content, /Synthetic local portrait/);
  assert.ok(seeded.messages[1].content.includes(REVIEW_CHAT_IMAGE_SAMPLES.portrait.dataUrl));
});

async function actionFixture() {
  let active = true;
  const registry = new FixtureRegistry();
  const fixture = createReviewChatAction({ isActive: () => active });
  await registry.route("**/*", fixture.handler);
  const request = (body = { action_id: REVIEW_CHAT_ACTION_B, decision: "confirm" }, options = {}) =>
    registry.dispatch({
      url: FIXTURE_ORIGIN + "/api/chat/confirm" + (options.query ?? ""),
      method: options.method ?? "POST",
      headers: {
        "x-kova-owner": REVIEW_OWNER,
        "content-type": "application/json",
        ...options.headers,
      },
      body: Buffer.from(options.raw ?? JSON.stringify(body)),
      signal: options.signal,
    });
  return {
    fixture,
    request,
    registry,
    deactivate() {
      active = false;
    },
  };
}

test("actual PendingConfirm DTOs keep A unchanged; only explicit B retry succeeds locally", async () => {
  const f = await actionFixture();
  const original = reviewChatActionConfirmations();
  const conversation = reviewConversations("chat-action-partial-review")[0];
  const normalized = normalizeChatHistory(conversation, REVIEW_OWNER);
  assert.deepEqual(normalized.messages[1].pendingConfirms, original);
  assert.equal(original[0].status, "confirmed");
  assert.equal(original[1].status, "pending");
  for (const action of original) {
    assert.equal(action.tool, "gmail_create_draft");
    assert.match(action.argsPreview.google_account, /@example\.invalid$/);
    assert.match(action.argsPreview.to, /@example\.invalid$/);
    assert.deepEqual(Object.keys(action.argsPreview).sort(), [
      "body_preview",
      "connection_id",
      "google_account",
      "subject",
      "to",
    ]);
  }
  const failed = await f.request();
  assert.equal(failed.status, 400);
  assert.deepEqual(failed.json, { ok: false, error: REVIEW_CHAT_ACTION_RECONNECT });
  assert.equal(f.fixture.status.status, "failed");
  const retried = await f.request();
  assert.equal(retried.status, 200);
  assert.deepEqual(retried.json, { ok: true, result_text: REVIEW_CHAT_ACTION_SUCCESS });
  assert.deepEqual((await f.request()).json, retried.json);
  assert.equal(
    (await f.request({ action_id: REVIEW_CHAT_ACTION_B, decision: "cancel" })).status,
    409,
  );
  assert.deepEqual(reviewChatActionConfirmations(), original);
  assert.deepEqual(
    reviewConversations("chat-action-partial-review")[0].messages[1].pendingConfirms[0],
    original[0],
  );
  const reset = await actionFixture();
  assert.equal((await reset.request()).status, 400);
  assert.equal(
    (await reset.request({ action_id: REVIEW_CHAT_ACTION_B, decision: "cancel" })).json.ok,
    true,
  );
  assert.equal((await reset.request()).status, 409);
  assert.equal(reset.fixture.status.status, "cancelled");
  f.fixture.dispose();
  assert.equal((await f.request()).status, 401);
  reset.deactivate();
  assert.equal((await reset.request()).status, 401);
});

test("action adapter rejects arbitrary IDs, unknown fields, methods, oversize, owner mismatch and cancellation without mutation", async () => {
  const f = await actionFixture();
  for (const [body, options, status] of [
    [{ action_id: REVIEW_CHAT_ACTION_A, decision: "confirm" }, {}, 404],
    [{ action_id: "other", decision: "confirm" }, {}, 404],
    [{ action_id: REVIEW_CHAT_ACTION_B, decision: "send" }, {}, 400],
    [{ action_id: REVIEW_CHAT_ACTION_B, decision: "confirm", args: {} }, {}, 400],
    [[], {}, 400],
    [null, {}, 400],
    [undefined, { raw: "{" }, 400],
    [undefined, { raw: "x".repeat(4097) }, 400],
    [undefined, { query: "?action_id=" + REVIEW_CHAT_ACTION_B }, 400],
    [undefined, { method: "GET" }, 405],
    [undefined, { method: "DELETE" }, 405],
    [undefined, { headers: { "x-kova-owner": "foreign" } }, 401],
    [undefined, { headers: { "x-kova-owner": undefined } }, 401],
    [undefined, { headers: { "content-type": "text/plain" } }, 400],
    [undefined, { signal: AbortSignal.abort() }, 499],
  ])
    assert.equal((await f.request(body, options)).status, status);
  assert.deepEqual(f.fixture.status, {
    syntheticOnly: true,
    actionId: REVIEW_CHAT_ACTION_B,
    status: "pending",
    requestCount: 0,
  });
  for (const url of [
    "https://outside.invalid/api/chat/confirm",
    FIXTURE_ORIGIN + "/api/gmail/send",
    FIXTURE_ORIGIN + "/api/chat/confirm/other",
  ]) {
    assert.equal(
      (await f.registry.dispatch({ url, method: "POST", body: Buffer.from("{}") })).status,
      503,
    );
  }
  for (let i = 0; i < REVIEW_CHAT_STREAM_MAX_REQUESTS; i++) await f.request();
  assert.equal((await f.request()).status, 429);
  assert.equal(f.fixture.status.requestCount, REVIEW_CHAT_STREAM_MAX_REQUESTS);
});

test("source fixture has a real claim-local anchor, distinct publication/retrieval metadata and an honest missing-date counterpart", () => {
  const chat = reviewConversations("chat-sources-used").at(-1);
  const answer = chat.messages[1];
  assert.match(answer.content, /\[1\]\(#sample-source\)/);
  assert.equal(answer.sources[0].id, "sample-source");
  assert.equal(answer.sources[0].publishedAt, "2020-01-01");
  assert.equal(answer.sources[0].retrievedAt, "2026-10-17T19:05:00.000Z");
  assert.equal(answer.sources.length, 2);
  assert.equal(answer.sources[1].snippet, undefined);
  assert.equal(answer.sources[1].publishedAt, undefined);
  assert.equal(answer.sources[1].retrievedAt, undefined);
  for (const source of answer.sources) assert.equal(source.kind, undefined);
  assert.deepEqual(normalizeResponseSources(answer.sources), answer.sources);
  assert.deepEqual(normalizeChatHistory(chat, REVIEW_OWNER).messages[1].sources, answer.sources);
});

test("writing and sandbox HTML are separate actual artifact kinds with no automatic script, resource or export", () => {
  const chat = reviewConversations("chat-writing-result-review")[0];
  const writing = chat.messages[1],
    html = chat.messages[3];
  assert.ok(writing.content.length > 600);
  assert.equal(detectArtifactKind(writing.content), "writing");
  assert.equal(detectArtifactKind(html.content), "website");
  assert.match(writing.content, /^# Fictional/m);
  assert.match(writing.content, /^## /m);
  assert.match(writing.content, /^1\. /m);
  assert.match(writing.content, /^   - /m);
  assert.match(writing.content, /\| Routine \|/);
  assert.match(writing.content, /`sample-only`/);
  assert.match(writing.content, /\[1\]\(#writing-sample-source\)/);
  assert.equal(extractCodeBlocks(writing.content).length, 0);
  const blocks = extractCodeBlocks(html.content);
  assert.equal(blocks.length, 1);
  assert.doesNotMatch(blocks[0], /<script|<form|https?:|\bsrc=|\bhref=|\bon\w+=|url\s*\(/i);
  const preview = buildPreviewDoc(blocks[0]);
  assert.equal(preview.hadScripts, false);
  assert.match(preview.doc, /default-src 'none'/);
  assert.match(preview.doc, /Fictional local studio/);
  const storage = initialStorage({ ...selection, scenario: "chat-writing-result-review" });
  assert.equal(storage[`nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`], chat.id);
});

test("Navigate selected path only assigns an allowlisted iframe path, never reads changed account/scenario or resets storage", () => {
  const product = { src: "/audit-log" },
    path = { value: "/settings/profile" },
    status = { textContent: "" },
    button = {};
  const allowedNodes = {
    product,
    "review-path": path,
    "review-navigation-status": status,
    "navigate-selected-path": button,
  };
  const script = reviewNavigationScript();
  assert.doesNotMatch(
    script,
    /fetch\(|localStorage|sessionStorage|indexedDB|submit\(|review-account|review-scenario|location\s*=/,
  );
  runInNewContext(script, {
    document: {
      getElementById(id) {
        assert.ok(Object.hasOwn(allowedNodes, id), `Unexpected node ${id}`);
        return allowedNodes[id];
      },
    },
  });
  button.onclick();
  assert.equal(product.src, "/settings/profile");
  assert.match(status.textContent, /Active account, scenario and local data preserved/);
  for (const value of [
    "https://outside.invalid/",
    "//outside.invalid/",
    "javascript:alert(1)",
    "/not-listed",
    "/settings?account=other",
    "settings",
  ]) {
    path.value = value;
    button.onclick();
    assert.equal(product.src, "/settings/profile");
    assert.match(status.textContent, /Choose a listed relative path/);
  }
});

// Each lifecycle has its own origin, so the global fetch pool cannot reuse a
// just-closed connection when the next test starts. These ports are test-only.
let nextHttpFixturePort = 6286;
async function httpFixture({
  missingPage = false,
  port = nextHttpFixturePort++,
  readControls = fetch,
} = {}) {
  const upstream = [];
  const review = createPrivateReviewServer({
    pkg,
    port,
    fetchImpl: async (url) => {
      upstream.push(url);
      if (missingPage && url === FIXTURE_ORIGIN + "/synthetic-missing-review-page")
        return new Response(
          "<!doctype html><title>Synthetic application 404</title><h1>Page not found</h1>",
          { status: 404, headers: { "Content-Type": "text/html" } },
        );
      throw new Error("No test may reach upstream");
    },
  });
  let closing;
  const close = () => {
    review.dispose();
    if (closing) return closing;
    if (!review.server.listening) return Promise.resolve();
    // Stop accepting connections before closing active ones. This also runs if
    // initial controller fetch/decoding fails before a fixture reaches a test.
    closing = new Promise((resolve) => review.server.close(resolve));
    review.server.closeAllConnections();
    return closing;
  };
  const origin = review.origin;
  let csrf, csrfCookie;
  try {
    await review.listen();
    const controls = await readControls(origin + "/__local-review");
    csrf = /name="csrf" value="([^"]+)"/.exec(await controls.text())[1];
    csrfCookie = controls.headers.get("set-cookie").split(";")[0];
  } catch (reason) {
    await close();
    throw reason;
  }
  let cookie = "",
    sessionId;
  const headers = (extra = {}) => ({
    Origin: origin,
    Cookie: [csrfCookie, cookie].filter(Boolean).join("; "),
    ...extra,
  });
  const open = async (scenario, overrides = {}) => {
    const response = await fetch(origin + "/__local-review/start", {
      method: "POST",
      headers: headers(),
      body: new URLSearchParams({ ...selection, scenario, ...overrides, csrf }),
    });
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
    sessionId = cookie.split("=")[1];
    return response.text();
  };
  const post = (path, value, options = {}) =>
    fetch(origin + path, {
      method: "POST",
      ...options,
      headers: headers({
        "Content-Type": "application/json",
        "X-Kova-Owner": REVIEW_OWNER,
        ...options.headers,
      }),
      body: options.raw ?? JSON.stringify(value),
    });
  const state = async () =>
    (await fetch(origin + "/__local-review/chat-stream-status", { headers: headers() })).json();
  const release = (streamId, outcome) =>
    fetch(origin + "/__local-review/chat-stream-action", {
      method: "POST",
      headers: headers(),
      body: new URLSearchParams({ csrf, sessionId, streamId, outcome }),
    });
  return {
    review,
    origin,
    headers,
    open,
    post,
    state,
    release,
    upstream,
    get session() {
      return review.sessions.get(sessionId);
    },
    close,
  };
}

test("ordinary HTTP enforces quota guards, holds actual image SSE until Release/Fail, handles real abort/reset, and keeps mutations disconnected", async () => {
  const f = await httpFixture();
  try {
    const html = await f.open("chat-message-quota-rejected");
    assert.match(html, /Navigate selected path/);
    assert.match(html, /type="button"[^>]*>Navigate selected path/);
    assert.match(html, /no quota-reset time/);
    assert.deepEqual(await (await f.post("/api/chat", chatBody)).json(), quotaBody);
    for (const [path, body, options, status] of [
      ["/api/chat", { ...chatBody, clientTool: "image" }, {}, 400],
      [
        "/api/chat",
        {
          ...chatBody,
          messages: [
            {
              role: "user",
              content: "x",
              attachments: [{ kind: "image", dataUrl: "data:image/png;base64,AA==" }],
            },
          ],
        },
        {},
        400,
      ],
      ["/api/chat", chatBody, { headers: { "X-Kova-Owner": "wrong" } }, 401],
      ["/api/chat", chatBody, { headers: { Origin: "https://outside.invalid" } }, 403],
      ["/api/chat", chatBody, { headers: { "Content-Type": "text/plain" } }, 400],
      ["/api/chat?extra=1", chatBody, {}, 400],
      ["/api/chat", chatBody, { raw: "{" }, 400],
    ])
      assert.equal((await f.post(path, body, options)).status, status);
    assert.equal(f.session.chatResponse.status.requestCount, 1);
    const identity = await fetch(f.origin + BACKEND_PREFIX + "/auth/v1/user", {
      headers: f.headers(),
    });
    assert.equal((await identity.json()).id, REVIEW_OWNER);
    await f.open("chat-response-image-review");
    const first = await f.post("/api/chat", chatBody);
    const reader = first.body.getReader();
    const opening = new TextDecoder().decode((await reader.read()).value);
    assert.equal(opening, reviewChatOpeningEvent("chat-response-image-review"));
    let ended = false;
    const end = reader.read().then((value) => {
      ended = true;
      return value;
    });
    await new Promise(setImmediate);
    assert.equal(ended, false);
    const firstId = (await f.state()).active.id;
    assert.equal((await f.release(firstId, "released")).status, 200);
    assert.equal(
      new TextDecoder().decode((await end).value),
      reviewChatCompletionEvent("released", "chat-response-image-review"),
    );
    assert.equal((await reader.read()).done, true);
    const failure = await f.post("/api/chat", chatBody);
    await f.release((await f.state()).active.id, "failed");
    const deltas = [];
    await consumeChatSse(failure.body, { onEvent: (event) => deltas.push(event.choices[0].delta) });
    assert.equal(
      deltas[1].content,
      "Sorry - Image generation failed. Please try a different prompt or try again later.",
    );
    const abort = new AbortController();
    const stopped = await f.post("/api/chat", chatBody, { signal: abort.signal });
    abort.abort();
    await stopped.body.cancel().catch(() => {});
    for (let i = 0; i < 30 && (await f.state()).active; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await f.state()).last.outcome, "aborted");
    const saveId = [...pkg.base.functionNames].find(
      ([, name]) => name.split("_")[0] === "saveImageToLibrary",
    )[0];
    const save = await f.post(
      "/_serverFn/" + saveId,
      toJSON({
        data: {
          expectedOwnerId: REVIEW_OWNER,
          idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          imageUrl: REVIEW_CHAT_IMAGE_SAMPLES.landscape.dataUrl,
          title: "Synthetic local sample",
        },
        context: {},
      }),
    );
    assert.equal(save.status, 503);
    assert.match((await save.json()).error, /No Library item was created/);
    const resetStream = await f.post("/api/chat", chatBody);
    const resetReader = resetStream.body.getReader();
    await resetReader.read();
    const canceled = assert.rejects(resetReader.read());
    const old = f.session;
    await f.open("chat-action-partial-review");
    await canceled;
    assert.equal(old.chatStream.status.last.outcome, "disposed");
    const b = { action_id: REVIEW_CHAT_ACTION_B, decision: "confirm" };
    assert.equal(
      (await f.post("/api/chat/confirm", b, { headers: { Origin: "https://outside.invalid" } }))
        .status,
      403,
    );
    assert.equal(
      (await f.post("/api/chat/confirm", { ...b, action_id: REVIEW_CHAT_ACTION_A })).status,
      404,
    );
    assert.deepEqual(await (await f.post("/api/chat/confirm", b)).json(), {
      ok: false,
      error: REVIEW_CHAT_ACTION_RECONNECT,
    });
    assert.deepEqual(await (await f.post("/api/chat/confirm", b)).json(), {
      ok: true,
      result_text: REVIEW_CHAT_ACTION_SUCCESS,
    });
    assert.equal((await f.post("/api/gmail/send", b)).status, 503);
    await f.open("chat-action-partial-review");
    assert.equal((await f.post("/api/chat/confirm", b)).status, 400);
    await f.post(BACKEND_PREFIX + "/auth/v1/logout", {});
    assert.equal((await f.post("/api/chat/confirm", b)).status, 401);
    assert.deepEqual(f.upstream, []);
  } finally {
    await f.close();
  }
});

test("delayed quota HTTP returns the same rejection and reset/sign-out cancel rather than waiting or claiming success", async () => {
  const f = await httpFixture();
  try {
    const html = await f.open("chat-message-quota-pending");
    assert.match(html, /fixed 10-second local inspection hold/);
    let settled = false;
    const start = Date.now();
    const pending = f.post("/api/chat", chatBody).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(settled, false);
    assert.equal((await f.post("/api/chat", chatBody)).status, 409);
    const response = await pending;
    assert.ok(Date.now() - start >= REVIEW_CHAT_QUOTA_HOLD_MS - 50);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), null);
    assert.deepEqual(await response.json(), quotaBody);
    const old = f.session;
    const reset = f.post("/api/chat", chatBody);
    for (let i = 0; i < 30 && !old.chatResponse.status.pending; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await f.open("chat-message-quota-pending");
    assert.equal((await reset).status, 499);
    assert.equal(old.chatResponse.status.pending, false);
    const logout = f.post("/api/chat", chatBody);
    for (let i = 0; i < 30 && !f.session.chatResponse.status.pending; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await f.post(BACKEND_PREFIX + "/auth/v1/logout", {});
    assert.equal((await logout).status, 499);
    assert.equal((await f.post("/api/chat", chatBody)).status, 401);
    assert.deepEqual(f.upstream, []);
  } finally {
    await f.close();
  }
});

test("nativeDesktop exposes 1180 × 768 and the ordinary missing-page sentinel reaches app rendering while private paths remain blocked", async () => {
  assert.deepEqual(SIZES.nativeDesktop, { width: 1180, height: 768 });
  assert.deepEqual(SIZES.desktop, { width: 1440, height: 900 });
  assert.ok(PATHS.includes("/synthetic-missing-review-page"));
  assert.equal(PATHS.includes("/__synthetic-missing-page"), false);
  const f = await httpFixture({ missingPage: true });
  try {
    const html = await f.open("default", {
      size: "nativeDesktop",
      path: "/synthetic-missing-review-page",
    });
    assert.match(html, /value="nativeDesktop" selected>nativeDesktop · 1180 × 768/);
    assert.match(html, /iframe\{display:block;width:1180px;height:768px/);
    assert.equal(f.session.selection.size, "nativeDesktop");
    const missing = await fetch(f.origin + "/synthetic-missing-review-page", {
      headers: f.headers(),
    });
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type"), /text\/html/);
    assert.match(await missing.text(), /Synthetic application 404/);
    for (const path of ["/__synthetic-missing-page", "/__private-resource-missing"]) {
      const blocked = await fetch(f.origin + path, { headers: f.headers() });
      assert.equal(blocked.status, 404);
      assert.deepEqual(await blocked.json(), { error: "Private review resource not found." });
    }
    assert.deepEqual(f.upstream, [FIXTURE_ORIGIN + "/synthetic-missing-review-page"]);
  } finally {
    await f.close();
  }
});

test("HTTP fixture setup failure closes its listener before another lifecycle can reuse the port", async () => {
  const port = 6290;
  const cause = new Error("Synthetic setup read failure");
  await assert.rejects(
    httpFixture({
      port,
      readControls: async () => {
        throw cause;
      },
    }),
    (reason) => reason === cause,
  );
  // An exact rebind proves the failure did not leave a listening server behind.
  const recovered = await httpFixture({ port });
  try {
    assert.equal(recovered.review.server.listening, true);
    assert.match(await recovered.open("default"), /Kova private synthetic review/);
  } finally {
    await recovered.close();
    await recovered.close();
  }
  assert.equal(recovered.review.server.listening, false);
});
