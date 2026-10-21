import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { toJSON } from "seroval";
import { consumeChatSse } from "../src/lib/chat-sse-client.mjs";
import { resultRevisionDiff, applyReviewedDiff } from "../src/lib/result-revision-diff.mjs";
import { createChatHistoryPayload } from "../src/lib/chat-summary-snapshot.mjs";
import {
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  createFixtureSession,
  loadReviewPackage,
  reviewConversations,
} from "./private-http-review.mjs";
import * as sourceState from "./review-state-fixtures.mjs";
import {
  MANAGEMENT_REVIEW_OPTIONS,
  MANAGEMENT_REVIEW_PROJECT_ID as projectId,
  MANAGEMENT_REVIEW_CHAT_ID as chatId,
  WRITING_REVIEW_SELECTION,
  WRITING_REVIEW_REPLACEMENT,
  createManagementReviewHandler,
} from "./management-review-fixture.mjs";
import {
  buildRewriteInstruction,
  selectionContext,
  applySelectionEdit,
} from "../src/lib/selection-edit.mjs";

// Existing compiled function map only. No build, browser, listener or network.
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: sourceState };
const defaults = { account: "free", theme: "dark", path: "/", size: "phone", state: "populated" };
const pausedId = sourceState.REVIEW_TASK_ID;
const activeId = "88888888-8888-4888-8888-888888888888";
const createdId = "abababab-abab-4bab-8bab-abababababab";
const mutationId = "bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc";
const createDraft = {
  expectedUserId: REVIEW_OWNER,
  id: createdId,
  mutationId,
  title: "Synthetic new task",
  prompt: "Sample only; never executes",
  repeat: "weekly",
  timezone: "UTC",
  localTime: "2099-01-01T12:00",
  triggerMode: "time",
  contextRefs: [],
  eventTriggers: [],
};
function clock() {
  const timers = new Set();
  return {
    timers,
    setTimeout(fn, ms) {
      const t = { fn, ms };
      timers.add(t);
      return t;
    },
    clearTimeout(t) {
      timers.delete(t);
    },
    expire() {
      for (const t of [...timers]) {
        timers.delete(t);
        t.fn();
      }
    },
  };
}
async function setup(scenario = "tasks-management-recovery", options = {}) {
  const fake = clock();
  const session = await createFixtureSession(
    pkg,
    { ...defaults, scenario, ...options },
    { loadingClock: fake },
  );
  session.registry.diagnostic = null;
  return { session, fake };
}
function invoke(session, name, data = {}, options = {}) {
  const entry = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name);
  assert.ok(entry, name);
  const method =
    options.method ??
    (name.startsWith("listProject") || name.startsWith("getProject") ? "GET" : "POST");
  const raw = options.raw ?? JSON.stringify(toJSON({ data, context: {} }));
  return session.registry.dispatch({
    url:
      `${FIXTURE_ORIGIN}/_serverFn/${entry[0]}` +
      (method === "GET"
        ? `?payload=${encodeURIComponent(raw)}${options.query ?? ""}`
        : (options.query ?? "")),
    method,
    headers: options.headers,
    body: method === "GET" ? Buffer.alloc(0) : Buffer.from(raw),
    signal: options.signal,
  });
}
const listTasks = async (session) =>
  (await invoke(session, "listScheduledTasks", { expectedUserId: REVIEW_OWNER })).json.result;
async function failPending(fixture, name, data) {
  const pending = invoke(fixture.session, name, data);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.session.loading.pendingCount, 1);
  assert.equal(fixture.fake.timers.size, 1);
  assert.equal([...fixture.fake.timers][0].ms, 20000);
  fixture.fake.expire();
  assert.equal((await pending).status, 503);
  assert.equal(fixture.session.loading.pendingCount, 0);
}

test("two explicit signed-in HTTP options enforce packaged methods and controller disclosure", async () => {
  assert.equal(MANAGEMENT_REVIEW_OPTIONS.length, 2);
  for (const option of MANAGEMENT_REVIEW_OPTIONS) {
    assert.match(option.label, /retry/i);
    assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
    await assert.rejects(
      sourceState.installReviewState({}, option.id, "free"),
      /ordinary private HTTP/,
    );
    await assert.rejects(setup(option.id, { account: "guest" }), /requires/);
    for (const account of option.accounts) {
      const f = await setup(option.id, { account });
      assert.equal(f.session.selection.path, option.path);
      f.session.dispose();
    }
  }
  const adapter = readFileSync(new URL("./private-http-review.mjs", import.meta.url), "utf8");
  assert.match(adapter, /htmlEscape\(MANAGEMENT_REVIEW_DISCLOSURE\)/);
  assert.match(adapter, /htmlEscape\(WRITING_REVIEW_DIFF_DISCLOSURE\)/);
  assert.match(
    readFileSync(new URL("./package.mjs", import.meta.url), "utf8"),
    /"management-review-fixture.mjs"/,
  );
  assert.throws(
    () =>
      createManagementReviewHandler("tasks-management-recovery", new Map(), {
        isActive: () => true,
        wait() {},
        taskState() {},
      }),
    /missing/,
  );
});

test("Pause and Resume each retain their exact record and revision while pending/failing; explicit retry is idempotent", async () => {
  const f = await setup();
  for (const [id, status] of [
    [activeId, "paused"],
    [pausedId, "scheduled"],
  ]) {
    const original = await listTasks(f.session);
    const data = { expectedUserId: REVIEW_OWNER, id, mutationId, expectedRevision: 1, status };
    const pending = invoke(f.session, "updateScheduledTask", data);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await listTasks(f.session), original);
    assert.equal((await invoke(f.session, "updateScheduledTask", data)).status, 409);
    f.fake.expire();
    assert.equal((await pending).status, 503);
    assert.deepEqual(await listTasks(f.session), original);
    assert.equal(
      (await invoke(f.session, "updateScheduledTask", { ...data, mutationId: createdId })).status,
      409,
    );
    const saved = (await invoke(f.session, "updateScheduledTask", data)).json.result;
    assert.equal(saved.id, id);
    assert.equal(saved.status, status);
    assert.equal(saved.revision, 2);
    assert.deepEqual((await invoke(f.session, "updateScheduledTask", data)).json.result, saved);
    assert.equal((await listTasks(f.session)).find((row) => row.id === id).revision, 2);
  }
  assert.equal(f.session.loading.pendingCount, 0);
});

test("Create first holds and fails with no added record; exact explicit Retry creates once with existing DTO", async () => {
  const f = await setup();
  const original = await listTasks(f.session);
  await failPending(f, "createScheduledTask", createDraft);
  assert.deepEqual(await listTasks(f.session), original);
  assert.equal(
    (await invoke(f.session, "createScheduledTask", { ...createDraft, prompt: "Changed" })).status,
    409,
  );
  const saved = (await invoke(f.session, "createScheduledTask", createDraft)).json.result;
  assert.equal(saved.id, createdId);
  assert.equal(saved.revision, 1);
  assert.equal(saved.status, "scheduled");
  assert.equal(saved.title, createDraft.title);
  assert.deepEqual(saved.context_refs, []);
  assert.equal(saved.last_run_at, null);
  assert.equal(saved.last_result, null);
  assert.deepEqual(
    (await invoke(f.session, "createScheduledTask", createDraft)).json.result,
    saved,
  );
  assert.equal((await listTasks(f.session)).length, 3);
  assert.equal(
    (await invoke(f.session, "createScheduledTask", { ...createDraft, id: activeId })).status,
    409,
  );
  const fresh = await setup();
  assert.equal((await listTasks(fresh.session)).length, 2);
  await failPending(fresh, "createScheduledTask", createDraft);
});

test("task method, owner, identity, data and unsupported actions fail before consuming finite operation", async () => {
  const f = await setup();
  for (const [data, opts, status] of [
    [createDraft, { method: "GET" }, 405],
    [{ ...createDraft, expectedUserId: activeId }, {}, 401],
    [createDraft, { headers: { "x-kova-owner": activeId } }, 401],
    [{ ...createDraft, mutationId: "invalid" }, {}, 400],
    [{ ...createDraft, contextRefs: [{ kind: "library", id: activeId }] }, {}, 409],
    [createDraft, { raw: "{" }, 400],
    [createDraft, { raw: "x".repeat(32769) }, 400],
    [createDraft, { query: "?payload=ambiguous" }, 400],
  ])
    assert.equal((await invoke(f.session, "createScheduledTask", data, opts)).status, status);
  assert.equal(
    (await invoke(f.session, "updateScheduledTask", { ...createDraft, expectedRevision: 1 }))
      .status,
    405,
  );
  assert.equal(
    (
      await invoke(f.session, "deleteScheduledTask", {
        expectedUserId: REVIEW_OWNER,
        id: activeId,
        mutationId,
        expectedRevision: 1,
      })
    ).status,
    405,
  );
  assert.equal(f.fake.timers.size, 0);
  await failPending(f, "createScheduledTask", createDraft);
});

test("abort, sign-out and dispose settle pending tasks without records, timers or delayed commit", async () => {
  for (const end of ["abort", "sign-out", "dispose"]) {
    const f = await setup();
    const controller = new AbortController();
    const pending = invoke(f.session, "createScheduledTask", createDraft, {
      signal: controller.signal,
    });
    await new Promise((resolve) => setImmediate(resolve));
    if (end === "abort") controller.abort();
    else if (end === "sign-out") {
      f.session.authActive = false;
      f.session.loading.dispose();
    } else f.session.dispose();
    assert.equal((await pending).status, end === "abort" ? 499 : 401);
    assert.equal(f.session.loading.pendingCount, 0);
    assert.equal(f.fake.timers.size, 0);
    if (end === "abort") assert.equal((await listTasks(f.session)).length, 2);
    else assert.equal((await invoke(f.session, "createScheduledTask", createDraft)).status, 401);
  }
});

test("explicit task scenario overrides list empty/error/loading without starting unrequested holds", async () => {
  for (const state of ["empty", "error", "loading"]) {
    const f = await setup("tasks-management-recovery", { state });
    assert.equal((await listTasks(f.session)).length, 2);
    assert.equal(f.fake.timers.size, 0);
    f.session.dispose();
  }
});

test("Context first failure leaves original instructions; Retry trims, preserves owner and readbacks through get/list", async () => {
  const f = await setup("project-management-recovery");
  const get = async () => (await invoke(f.session, "getProject", { id: projectId })).json.result;
  const original = await get();
  const listEntry = [...pkg.base.functionNames].find(
    ([, value]) => value.split("_")[0] === "listProjects",
  );
  assert.deepEqual(
    (
      await f.session.registry.dispatch({
        url: `${FIXTURE_ORIGIN}/_serverFn/${listEntry[0]}`,
        method: "GET",
      })
    ).json.result,
    [original],
  );
  assert.deepEqual(
    (await invoke(f.session, "listProjects", {}, { raw: JSON.stringify(toJSON({ context: {} })) }))
      .json.result,
    [original],
  );
  const draft = "  Synthetic instructions kept for retry.  ";
  const data = { id: projectId, system_prompt: draft };
  assert.equal((await invoke(f.session, "updateProject", { ...data, id: activeId })).status, 400);
  assert.equal(
    (await invoke(f.session, "updateProject", data, { headers: { "x-kova-owner": activeId } }))
      .status,
    401,
  );
  assert.equal((await invoke(f.session, "updateProject", data)).status, 503);
  assert.deepEqual(await get(), original);
  assert.equal(data.system_prompt, draft);
  assert.deepEqual((await invoke(f.session, "updateProject", data)).json.result, { ok: true });
  assert.equal((await get()).system_prompt, draft.trim());
  assert.equal((await get()).owner_id, REVIEW_OWNER);
  assert.equal(
    (await invoke(f.session, "listProjects")).json.result[0].system_prompt,
    draft.trim(),
  );
  assert.equal(
    (await invoke(f.session, "updateProject", { ...data, system_prompt: "x".repeat(4001) })).status,
    400,
  );
  assert.deepEqual(
    (await invoke(f.session, "updateProject", { ...data, system_prompt: null })).json.result,
    { ok: true },
  );
  assert.equal((await get()).system_prompt, null);
  const fresh = await setup("project-management-recovery");
  assert.deepEqual(
    (await invoke(fresh.session, "getProject", { id: projectId })).json.result,
    original,
  );
  assert.equal((await invoke(fresh.session, "updateProject", data)).status, 503);
});

test("New chat uses actual create response and project-bound detail/list with one empty record and no durable save", async () => {
  const f = await setup("project-management-recovery");
  const data = { project_id: projectId, title: "New chat", messages: [] };
  assert.deepEqual(
    (await invoke(f.session, "listProjectChats", { project_id: projectId })).json.result,
    [],
  );
  assert.equal(
    (await invoke(f.session, "createProjectChat", { ...data, project_id: activeId })).status,
    400,
  );
  assert.equal(
    (
      await invoke(f.session, "createProjectChat", {
        ...data,
        messages: [{ role: "user", content: "AI request" }],
      })
    ).status,
    400,
  );
  assert.deepEqual((await invoke(f.session, "createProjectChat", data)).json.result, {
    id: chatId,
  });
  const detail = (await invoke(f.session, "getProjectChat", { id: chatId })).json.result;
  assert.deepEqual(detail, {
    id: chatId,
    project_id: projectId,
    title: "New chat",
    snapshot: { messages: [] },
    updated_at: "2026-10-19T00:00:00.000Z",
    created_by: REVIEW_OWNER,
  });
  const { project_id, snapshot, ...summary } = detail;
  assert.deepEqual(
    (await invoke(f.session, "listProjectChats", { project_id: projectId })).json.result,
    [summary],
  );
  assert.deepEqual((await invoke(f.session, "getProjectChat", { id: chatId })).json.result, detail);
  assert.equal(
    (await invoke(f.session, "getProject", { id: projectId })).json.result.chat_count,
    1,
  );
  assert.equal((await invoke(f.session, "createProjectChat", data)).status, 409);
  assert.equal((await invoke(f.session, "listProjectChats", { project_id: activeId })).status, 404);
  assert.equal((await invoke(f.session, "getProjectChat", { id: activeId })).json.result, null);
  for (const name of [
    "saveProjectChat",
    "deleteProjectChat",
    "moveChatToProject",
    "createProject",
    "deleteProject",
  ])
    assert.equal((await invoke(f.session, name, { id: chatId })).status, 405);
  f.session.dispose();
  assert.equal((await invoke(f.session, "getProjectChat", { id: chatId })).status, 401);
  const fresh = await setup("project-management-recovery");
  assert.equal((await invoke(fresh.session, "getProjectChat", { id: chatId })).json.result, null);
});

function rewrite(session, body, options = {}) {
  return session.registry.dispatch({
    url: FIXTURE_ORIGIN + (options.path ?? "/api/write"),
    method: options.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-kova-owner": REVIEW_OWNER,
      ...options.headers,
    },
    body: Buffer.from(options.raw ?? JSON.stringify(body)),
    signal: options.signal,
  });
}
const rewriteBody = () => ({
  text: WRITING_REVIEW_SELECTION,
  action: "custom",
  instructions: buildRewriteInstruction("Make two small wording changes", WRITING_REVIEW_SELECTION),
});

test("writing exact custom request returns two separated line edits and leaves the original sample unchanged", async () => {
  const f = await setup("chat-writing-result-review");
  const source = reviewConversations("chat-writing-result-review")[0].messages[1].content;
  const start = source.indexOf(WRITING_REVIEW_SELECTION);
  assert.ok(start >= 0);
  const body = rewriteBody();
  body.instructions = buildRewriteInstruction(
    "Make two small wording changes",
    body.text,
    selectionContext(source, start, start + body.text.length),
  );
  const result = await rewrite(f.session, body);
  assert.deepEqual(result.json, { text: WRITING_REVIEW_REPLACEMENT });
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(Object.keys(result.json).length, 1);
  const original = body.text.split("\n"),
    replacement = result.json.text.split("\n");
  assert.equal(original.length, 5);
  assert.equal(replacement.length, 5);
  assert.deepEqual(
    original
      .map((line, index) => (line !== replacement[index] ? index : -1))
      .filter((index) => index >= 0),
    [0, 4],
  );
  const chunks = resultRevisionDiff(body.text, result.json.text);
  assert.deepEqual(
    chunks.map((chunk) => chunk.kind),
    ["change", "unchanged", "change"],
  );
  assert.equal(applyReviewedDiff(chunks, [0, 2]), body.text);
  assert.equal(applyReviewedDiff(chunks, [0]).split("\n")[0], original[0]);
  assert.equal(applyReviewedDiff(chunks, [0]).split("\n")[4], replacement[4]);
  assert.equal(applyReviewedDiff(chunks, []), result.json.text);
  const changed = applySelectionEdit(source, start, start + body.text.length, result.json.text);
  assert.equal(changed.slice(0, start), source.slice(0, start));
  assert.ok(changed.endsWith(source.slice(start + body.text.length)));
  assert.equal(reviewConversations("chat-writing-result-review")[0].messages[1].content, source);
  const unavailable = await invoke(f.session, "saveMessageVersion", {});
  assert.equal(unavailable.status, 503);
});

test("writing rejects foreign owners, other actions/selections, malformed or oversized requests and bounds valid repeats", async () => {
  const f = await setup("chat-writing-result-review");
  for (const [body, options, status] of [
    [rewriteBody(), { method: "GET" }, 405],
    [rewriteBody(), { headers: { "x-kova-owner": activeId } }, 401],
    [{ ...rewriteBody(), action: "improve" }, {}, 400],
    [{ ...rewriteBody(), text: "Unrelated text" }, {}, 400],
    [{ ...rewriteBody(), extra: true }, {}, 400],
    [{ ...rewriteBody(), instructions: "x".repeat(4097) }, {}, 400],
    [rewriteBody(), { raw: "{" }, 400],
    [rewriteBody(), { raw: "x".repeat(16385) }, 400],
    [rewriteBody(), { path: "/api/write?unexpected=1" }, 400],
    [rewriteBody(), { headers: { "content-type": "text/plain" } }, 400],
  ])
    assert.equal((await rewrite(f.session, body, options)).status, status);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await rewrite(f.session, rewriteBody(), { signal: controller.signal })).status,
    499,
  );
  for (let i = 0; i < 8; i++)
    assert.equal((await rewrite(f.session, rewriteBody())).json.text, WRITING_REVIEW_REPLACEMENT);
  assert.equal((await rewrite(f.session, rewriteBody())).status, 429);
  assert.equal(
    (await rewrite(f.session, rewriteBody(), { path: "/api/write/unknown" })).status,
    503,
  );
  f.session.dispose();
  assert.equal((await rewrite(f.session, rewriteBody())).status, 401);
  const fresh = await setup("chat-writing-result-review");
  assert.equal((await rewrite(fresh.session, rewriteBody())).json.text, WRITING_REVIEW_REPLACEMENT);
  const ordinary = await setup("default");
  assert.equal((await rewrite(ordinary.session, rewriteBody())).status, 503);
});

test("actual clean Temporary Chat payload receives fixed writing SSE without modifying history or enabling durable versions", async () => {
  const f = await setup("chat-writing-result-review");
  const historyRead = () =>
    f.session.registry.dispatch({
      url: FIXTURE_ORIGIN + "/api/chat/history",
      method: "GET",
      headers: { "x-kova-owner": REVIEW_OWNER },
    });
  const original = await historyRead();
  const history = await createChatHistoryPayload(
    [{ role: "user", content: "Show the local writing sample", attachments: [] }],
    0,
    { temporary: true, memoryEnabled: false, principal: REVIEW_OWNER, chatId: createdId },
  );
  const body = {
    ...history,
    chatId: createdId,
    mode: "instant",
    temporary: true,
    temporaryContext: "clean",
    clientTool: null,
    timezone: "UTC",
    locale: "en-US",
  };
  const response = await rewrite(f.session, body, { path: "/api/chat" });
  assert.equal(response.status, 200);
  assert.match(response.contentType, /^text\/event-stream/);
  assert.equal(response.headers["Cache-Control"], "no-store");
  const deltas = [];
  await consumeChatSse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(response.body));
        controller.close();
      },
    }),
    {
      onEvent: (event) => deltas.push(event.choices[0].delta),
    },
  );
  assert.deepEqual(deltas, [
    { content: reviewConversations("chat-writing-result-review")[0].messages[1].content },
  ]);
  assert.match(response.body, /data: \[DONE\]\n\n$/);
  assert.doesNotMatch(response.body, /Show the local writing sample/);
  assert.deepEqual(await historyRead(), original);
  assert.equal((await invoke(f.session, "saveMessageVersion", {})).status, 503);
  const chatMessage = readFileSync(
    new URL("../src/components/ChatMessage.tsx", import.meta.url),
    "utf8",
  );
  const editor = readFileSync(
    new URL("../src/components/ArtifactEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(chatMessage, /chatId: temporary \? null : chatId/);
  assert.match(chatMessage, /messageId: temporary \? null : message.id/);
  assert.match(editor, /const canPersistVersions = Boolean\(isSignedIn && chatId && messageId\)/);
  assert.equal((await rewrite(f.session, body, { path: "/api/chat" })).status, 200);
  assert.equal((await rewrite(f.session, body, { path: "/api/chat" })).status, 429);
});

test("temporary writing rejects regular/personalized/history/tool/file requests and observes abort/account disposal", async () => {
  const f = await setup("chat-writing-result-review");
  const valid = {
    chatId: createdId,
    mode: "instant",
    messages: [{ role: "user", content: "Local sample" }],
    temporary: true,
    temporaryContext: "clean",
    historyOffset: 0,
    memoryStartIndex: 0,
  };
  for (const value of [
    { ...valid, temporary: false },
    { ...valid, temporaryContext: "personalized" },
    { ...valid, clientTool: "image" },
    { ...valid, projectId },
    { ...valid, user: { name: "Unexpected profile" } },
    { ...valid, messages: [{ role: "user", content: "file", attachments: [{ id: createdId }] }] },
    { ...valid, messages: [{ role: "user", content: "x".repeat(2001) }] },
    { ...valid, messages: [...valid.messages, ...valid.messages] },
    { ...valid, historyOffset: 1 },
    { ...valid, messages: [{ role: "user", content: "Local", privateData: "unexpected" }] },
    { ...valid, summaryProof: {} },
    { ...valid, unknown: true },
  ])
    assert.equal((await rewrite(f.session, value, { path: "/api/chat" })).status, 400);
  assert.equal(
    (await rewrite(f.session, valid, { path: "/api/chat", headers: { "x-kova-owner": undefined } }))
      .status,
    401,
  );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await rewrite(f.session, valid, { path: "/api/chat", signal: controller.signal })).status,
    499,
  );
  assert.equal((await rewrite(f.session, valid, { path: "/api/chat" })).status, 200);
  f.session.dispose();
  assert.equal((await rewrite(f.session, valid, { path: "/api/chat" })).status, 401);
  assert.equal(f.fake.timers.size, 0);
  const fresh = await setup("chat-writing-result-review");
  assert.equal((await rewrite(fresh.session, valid, { path: "/api/chat" })).status, 200);
  const ordinary = await setup("default");
  assert.equal((await rewrite(ordinary.session, valid, { path: "/api/chat" })).status, 503);
});
