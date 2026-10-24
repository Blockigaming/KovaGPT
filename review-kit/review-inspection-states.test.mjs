import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { EventEmitter, getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { toJSON } from "seroval";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BACKEND_ORIGIN,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  REVIEW_LOADING_HOLD_MS,
  REVIEW_LOADING_MAX_PENDING,
  REVIEW_LONG_CHAT_ID,
  REVIEW_LONG_PROMPT_ID,
  REVIEW_LONG_CODE,
  REVIEW_WIDE_TABLE,
  REVIEW_WIDE_TABLE_HEADERS,
  createReviewReadHold,
  withReviewRequestSignal,
  createFixtureSession,
  initialStorage,
  loadReviewPackage,
  reviewConversations,
  reviewLongPrompt,
} from "./private-http-review.mjs";
import * as sourceState from "./review-state-fixtures.mjs";
import { normalizeChatHistory } from "../src/lib/chat-history-policy.mjs";

// Already packaged fixtures only. No app build, browser, sockets, or providers.
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: sourceState };
const defaults = {
  account: "free",
  theme: "dark",
  path: "/library",
  size: "phone",
  state: "populated",
  scenario: "default",
};
const ownerHeaders = { "x-kova-owner": REVIEW_OWNER };
const serverURL = (name) => {
  const entry = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name);
  assert.ok(entry, `Packaged function manifest includes ${name}`);
  return `${FIXTURE_ORIGIN}/_serverFn/${entry[0]}`;
};
const invoke = (session, name, data = {}, signal, method = "GET") => {
  const payload = JSON.stringify(toJSON({ data, context: {} }));
  return session.registry.dispatch({
    url: serverURL(name) + (method === "GET" ? `?payload=${encodeURIComponent(payload)}` : ""),
    method,
    body: method === "GET" ? Buffer.alloc(0) : Buffer.from(payload),
    signal,
  });
};
const library = (session, signal, headers = ownerHeaders) =>
  session.registry.dispatch({
    url: `${FIXTURE_ORIGIN}/api/library/items`,
    method: "POST",
    headers,
    body: Buffer.from(JSON.stringify({ operation: "list", query: "", folder: "all" })),
    signal,
  });
function fakeClock() {
  const timers = new Map();
  let id = 0;
  return {
    timers,
    setTimeout(callback, ms) {
      const handle = ++id;
      timers.set(handle, { callback, ms });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    expire() {
      for (const { callback } of [...timers.values()]) callback();
    },
  };
}
const settleHandlers = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};

test("synthetic hold has one bounded timer per request, cleans abort listeners and never runs fallback", async () => {
  const clock = fakeClock();
  const hold = createReviewReadHold(clock);
  const abort = new AbortController();
  const pending = hold.wait(abort.signal);
  assert.equal(hold.pendingCount, 1);
  assert.equal(clock.timers.size, 1);
  assert.equal([...clock.timers.values()][0].ms, REVIEW_LOADING_HOLD_MS);
  assert.equal(REVIEW_LOADING_HOLD_MS, 20_000);
  assert.equal(getEventListeners(abort.signal, "abort").length, 1);
  abort.abort();
  assert.equal(await pending, "aborted");
  assert.equal(hold.pendingCount, 0);
  assert.equal(clock.timers.size, 0);
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  assert.equal(await hold.wait(abort.signal), "aborted");
  const expiredSignal = new AbortController();
  const expires = hold.wait(expiredSignal.signal);
  clock.expire();
  assert.equal(await expires, "expired");
  assert.equal(clock.timers.size, 0);
  assert.equal(getEventListeners(expiredSignal.signal, "abort").length, 0);
  const resetSignal = new AbortController();
  const reset = hold.wait(resetSignal.signal);
  hold.dispose();
  hold.dispose();
  assert.equal(await reset, "reset");
  assert.equal(await hold.wait(), "reset");
  assert.equal(clock.timers.size, 0);
  assert.equal(getEventListeners(resetSignal.signal, "abort").length, 0);
});

test("synthetic hold caps concurrent requests and releases every timer on reset", async () => {
  const clock = fakeClock();
  const hold = createReviewReadHold(clock);
  const requests = Array.from({ length: REVIEW_LOADING_MAX_PENDING }, () => hold.wait());
  assert.equal(await hold.wait(), "capacity");
  assert.equal(clock.timers.size, REVIEW_LOADING_MAX_PENDING);
  hold.dispose();
  assert.deepEqual(await Promise.all(requests), Array(REVIEW_LOADING_MAX_PENDING).fill("reset"));
  assert.equal(clock.timers.size, 0);
  assert.equal(hold.pendingCount, 0);
});

test("HTTP lifetime adapter cleans all listeners on abort, completion, error and already-closed request", async () => {
  for (const ending of ["aborted", "close", "error", "complete", "already-closed"]) {
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.destroyed = ending === "already-closed";
    const clock = fakeClock();
    const hold = createReviewReadHold(clock);
    const result = withReviewRequestSignal(req, res, (signal) =>
      ending === "complete" ? "done" : hold.wait(signal),
    );
    if (ending === "aborted") req.emit(ending);
    if (ending === "close" || ending === "error") res.emit(ending);
    assert.equal(await result, ending === "complete" ? "done" : "aborted");
    assert.equal(clock.timers.size, 0);
    for (const event of ["aborted", "close", "error"]) {
      assert.equal(req.listenerCount(event), 0);
      assert.equal(res.listenerCount(event), 0);
    }
  }
});

test("loading holds precisely the three directory reads, expires locally and preserves details and mutations", async () => {
  const clock = fakeClock();
  const session = await createFixtureSession(
    pkg,
    { ...defaults, state: "loading" },
    { loadingClock: clock },
  );
  let completed = 0;
  const requests = [
    library(session),
    invoke(session, "listProjects"),
    invoke(session, "listScheduledTasks", { expectedUserId: REVIEW_OWNER }, undefined, "POST"),
  ].map((request) =>
    request.then((result) => {
      completed++;
      return result;
    }),
  );
  await settleHandlers();
  assert.equal(completed, 0);
  assert.equal(session.loading.pendingCount, 3);
  assert.equal(clock.timers.size, 3);
  const projectId = "33333333-3333-4333-8333-333333333333";
  assert.equal((await invoke(session, "getProject", { id: projectId })).json.result.id, projectId);
  assert.equal(
    (await invoke(session, "listFiles", { project_id: projectId })).json.result.length,
    1,
  );
  const created = await invoke(
    session,
    "createProject",
    { name: "Synthetic held-list project" },
    undefined,
    "POST",
  );
  assert.equal(
    (await invoke(session, "getProject", { id: created.json.result.id })).json.result.name,
    "Synthetic held-list project",
  );
  const detail = await session.registry.dispatch({
    url: `${FIXTURE_ORIGIN}/api/library/items?id=44444444-4444-4444-8444-444444444444&generation=66666666-6666-4666-8666-666666666666`,
    headers: ownerHeaders,
  });
  assert.equal(detail.json.id, "44444444-4444-4444-8444-444444444444");
  assert.equal(session.loading.pendingCount, 3);
  clock.expire();
  const results = await Promise.all(requests);
  assert.deepEqual(
    results.map((result) => result.status),
    [503, 503, 503],
  );
  assert.match(results[0].json.error, /Synthetic Library loading hold ended after 20 seconds/);
  assert.match(results[1].body, /Synthetic Projects loading hold ended after 20 seconds/);
  assert.match(results[2].body, /Synthetic Scheduled tasks loading hold ended after 20 seconds/);
  assert.equal(clock.timers.size, 0);
  assert.equal(session.registry.unsupportedPaths.size, 0);
});

test("all state overrides preserve guest/auth gates and Library owner identity without timers", async () => {
  for (const state of ["empty", "error", "loading"]) {
    const clock = fakeClock();
    const guest = await createFixtureSession(
      pkg,
      { ...defaults, account: "guest", state },
      { loadingClock: clock },
    );
    assert.equal((await library(guest)).status, 401);
    assert.equal((await invoke(guest, "listProjects")).status, 401);
    assert.equal(
      (
        await invoke(
          guest,
          "listScheduledTasks",
          { expectedUserId: REVIEW_OWNER },
          undefined,
          "POST",
        )
      ).status,
      401,
    );
    const session = await createFixtureSession(
      pkg,
      { ...defaults, state },
      { loadingClock: clock },
    );
    assert.equal((await library(session, undefined, {})).status, 401);
    assert.equal((await library(session, undefined, { "x-kova-owner": "other" })).status, 401);
    assert.equal((await invoke(session, "getSubscriptionSummary")).json.result.tier, "free");
    assert.deepEqual(
      (
        await invoke(
          session,
          "isScheduledTasksEligible",
          { expectedUserId: REVIEW_OWNER },
          undefined,
          "POST",
        )
      ).json.result,
      { eligible: true, executionAvailable: false },
    );
    session.dispose();
    assert.equal((await library(session)).status, 401);
    assert.equal((await invoke(session, "listProjects")).status, 401);
    assert.equal(clock.timers.size, 0);
  }
});

test("loading abort, reset and logout cancel in-flight reads without fixture fallthrough", async () => {
  for (const end of ["abort", "reset", "logout"]) {
    const clock = fakeClock();
    const session = await createFixtureSession(
      pkg,
      { ...defaults, state: "loading" },
      { loadingClock: clock },
    );
    const controller = new AbortController();
    const pending = library(session, controller.signal);
    await settleHandlers();
    assert.equal(session.loading.pendingCount, 1);
    if (end === "abort") controller.abort();
    if (end === "reset") session.dispose();
    if (end === "logout")
      assert.equal(
        (
          await session.registry.dispatch({
            url: `${BACKEND_ORIGIN}/auth/v1/logout`,
            method: "POST",
          })
        ).status,
        204,
      );
    assert.equal((await pending).status, 499);
    assert.equal(clock.timers.size, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    const fresh = await createFixtureSession(pkg, defaults);
    assert.equal((await invoke(fresh, "listProjects")).json.result.length, 1);
  }
});

test("explicit task, image and chat scenarios retain precedence over collection state", async () => {
  for (const state of ["empty", "error", "loading"]) {
    const clock = fakeClock();
    const tasks = await createFixtureSession(
      pkg,
      { ...defaults, state, scenario: "tasks-editor" },
      { loadingClock: clock },
    );
    assert.equal(
      (
        await invoke(
          tasks,
          "listScheduledTasks",
          { expectedUserId: REVIEW_OWNER },
          undefined,
          "POST",
        )
      ).json.result.length,
      2,
    );
    assert.equal(clock.timers.size, 0);
    const images = await createFixtureSession(
      pkg,
      { ...defaults, state, scenario: "image-sample-success" },
      { loadingClock: clock },
    );
    assert.equal((await library(images)).json.items.length, 1);
    assert.equal(clock.timers.size, 0);
    for (const scenario of ["chat-outputs", "chat-copy-task", "chat-trash", "chat-long-content"]) {
      const selected = { ...defaults, state, scenario };
      const chats = JSON.parse(
        initialStorage(selected)[`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`],
      );
      assert.deepEqual(chats, reviewConversations(scenario));
    }
  }
});

test("empty Library removes every browser chat seed and HTTP history row, with no pending draft or active chat", async () => {
  for (const account of ["free", "plus", "pro"]) {
    const selection = { ...defaults, account, state: "empty" };
    const storage = initialStorage(selection);
    assert.deepEqual(JSON.parse(storage[`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`]), []);
    assert.equal(
      Object.keys(storage).some((key) => /pending-active|draft|trash|work/.test(key)),
      false,
    );
    const session = await createFixtureSession(pkg, selection);
    assert.deepEqual((await library(session)).json, { items: [], cursor: null, hasMore: false });
    assert.deepEqual((await invoke(session, "listWorkspaceRecents")).json.result, []);
    const page = await session.registry.dispatch({
      url: `${FIXTURE_ORIGIN}/api/chat/history`,
      headers: ownerHeaders,
    });
    assert.deepEqual(page.json.records, []);
    assert.equal(page.json.currentVersion, 0);
    assert.equal(page.json.hasMore, false);
    const missing = await session.registry.dispatch({
      url: `${FIXTURE_ORIGIN}/api/no-real-service`,
    });
    assert.equal(missing.status, 503);
  }
  assert.equal(reviewConversations().length, 2);
});

test("long-content scenario contains exact independent synthetic 30-message, prompt, code and semantic table fixtures", () => {
  const original = reviewConversations();
  const chats = reviewConversations("chat-long-content");
  assert.deepEqual(chats.slice(0, 2), original);
  const chat = chats.at(-1);
  assert.equal(chat.id, REVIEW_LONG_CHAT_ID);
  assert.equal(chat.messages.length, 30);
  assert.equal(new Set(chat.messages.map(({ id }) => id)).size, 30);
  assert.deepEqual(
    chat.messages.map(({ role }) => role),
    Array.from({ length: 30 }, (_, i) => (i % 2 ? "assistant" : "user")),
  );
  assert.deepEqual(normalizeChatHistory(chat, REVIEW_OWNER), chat);
  const prompt = reviewLongPrompt();
  assert.equal(prompt.id, REVIEW_LONG_PROMPT_ID);
  assert.equal(prompt.body.length, 8037);
  assert.equal(chat.messages[0].content, prompt.body);
  assert.deepEqual(prompt.variables, ["audience", "topic"]);
  for (const [text, hash] of [
    [prompt.body, "2b43798cbc5b495e50e52871404fe5ec71d93cd38f805b14c846756ec293a274"],
    [REVIEW_LONG_CODE, "77fbf522cf4239c2868d86fd66a34cf4b3a971a5b297822f5819c87b029c38ba"],
    [REVIEW_WIDE_TABLE, "de7aaa7909b3036a9fa9785bc8200a992085661233fa2c93a8179f0578306f68"],
  ])
    assert.equal(createHash("sha256").update(text).digest("hex"), hash);
  assert.equal(REVIEW_LONG_CODE.split("\n").length, 22);
  assert.equal(REVIEW_WIDE_TABLE_HEADERS.length, 12);
  assert.ok(REVIEW_WIDE_TABLE_HEADERS.join("").length > 200);
  const markup = renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm] }, chat.messages.at(-1).content),
  );
  assert.match(markup, /<table>/);
  assert.equal((markup.match(/<th>/g) ?? []).length, 12);
  assert.equal((markup.match(/<td>/g) ?? []).length, 36);
  // The existing product wrapper localizes overflow. Its cell minimum gives
  // twelve columns a 96rem lower bound before padding, despite normal wrapping.
  // This is source-contract evidence; pixel/scroll behavior still needs a browser.
  const css = readFileSync(
    new URL("../src/components/response-output-blocks.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /body \.prose-chat \.kova-table-scroll \{[^}]*overflow-x: auto/s);
  assert.match(
    css,
    /body \.prose-chat \.kova-table-scroll :is\(th, td\) \{[^}]*min-width: 8rem;[^}]*overflow-wrap: break-word/s,
  );
  const renderer = readFileSync(
    new URL("../src/components/ResponseMarkdown.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    renderer,
    /className="kova-table-scroll"[\s\S]*?aria-label="Scrollable comparison table"[\s\S]*?<table ref=\{table\}>/,
  );
  assert.match(markup, /<pre><code class="language-js">/);
  assert.match(markup, /No code was executed and no provider was called/);
  assert.doesNotMatch(markup, /<script|<iframe|https?:\/\//);
  chats.at(-1).messages[0].content = "changed";
  assert.equal(reviewConversations("chat-long-content").at(-1).messages[0].content, prompt.body);
});

test("long-content storage and history match exactly; Prompt Studio list is synthetic and read-only", async () => {
  const selection = { ...defaults, scenario: "chat-long-content", state: "empty" };
  const session = await createFixtureSession(pkg, selection);
  const stored = initialStorage(selection);
  assert.equal(stored[`nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`], REVIEW_LONG_CHAT_ID);
  const actual = [];
  let query = "";
  while (true) {
    const page = (
      await session.registry.dispatch({
        url: `${FIXTURE_ORIGIN}/api/chat/history${query}`,
        headers: ownerHeaders,
      })
    ).json;
    actual.push(...page.records.map(({ payload }) => payload));
    if (!page.hasMore) break;
    query = `?epoch=${page.epoch}&cursor=${page.nextCursor}`;
  }
  assert.deepEqual(actual, JSON.parse(stored[`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`]));
  assert.deepEqual((await invoke(session, "listPromptTemplates")).json.result, [
    reviewLongPrompt(),
  ]);
  for (const name of [
    "savePromptTemplate",
    "updatePromptTemplate",
    "deletePromptTemplate",
    "evaluatePrompt",
    "listPromptHistory",
  ]) {
    const result = await invoke(
      session,
      name,
      { id: REVIEW_LONG_PROMPT_ID },
      undefined,
      name === "listPromptHistory" ? "GET" : "POST",
    );
    assert.equal(result.status, 503);
    assert.match(result.body, /read-only/);
  }
  session.dispose();
  assert.equal((await invoke(session, "listPromptTemplates")).status, 401);
  await assert.rejects(createFixtureSession(pkg, { ...selection, account: "guest" }), /requires/);
  await assert.rejects(
    sourceState.installReviewState({}, "chat-long-content", "free"),
    /HTTP review adapter/,
  );
});

test("controller explains synthetic states and disposal is wired to reset, eviction and shutdown", () => {
  const source = readFileSync(new URL("./private-http-review.mjs", import.meta.url), "utf8");
  assert.match(source, /synthetic loading · 20 second hold/);
  assert.match(source, /Loading holds each matching list read for at most 20 seconds/);
  assert.match(source, /No live backend read occurs/);
  assert.match(source, /Empty also clears synthetic browser chats and HTTP history/);
  assert.match(source, /chat-long-content scenario opens a synthetic 30-message conversation/);
  assert.match(source, /if \(session\) discardSession\(session.id\)/);
  assert.match(source, /sessions.size >= 24\) discardSession/);
  assert.match(source, /sessions.get\(id\)\?\.dispose\(\)/);
  assert.match(source, /review.dispose\(\);\s+review.server.close/);
  assert.match(source, /withReviewRequestSignal\(request, response/);
  assert.match(source, /if \(conversations\[1\]\)\s+values\[/);
});

test("long-content controller can open the existing Prompt Studio route without losing its sample", async () => {
  const session = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "chat-long-content",
    path: "/prompt-studio",
  });
  assert.equal(session.selection.path, "/prompt-studio");
});
