import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { toJSON } from "seroval";
import {
  PROJECT_MOVE_REVIEW_SOURCE_ID,
  PROJECT_MOVE_REVIEW_DESTINATION_ID,
  PROJECT_MOVE_REVIEW_CHAT_ID,
} from "./project-move-review-fixture.mjs";
import {
  createReviewChatStream,
  createReviewChatResponse,
  REVIEW_CHAT_RESPONSE_SCENARIOS,
  REVIEW_CHAT_RETRY_AFTER_SECONDS,
  validReviewChatBody,
  reviewChatOpeningEvent,
  reviewChatCompletionEvent,
  REVIEW_CHAT_STREAM_HOLD_MS,
  REVIEW_CHAT_STREAM_MAX_REQUESTS,
} from "./chat-stream-review-fixture.mjs";
import {
  BACKEND_PREFIX,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  createFixtureSession,
  createPrivateReviewServer,
  loadReviewPackage,
  reviewDailyUsage,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import { consumeChatSse, chatResponseError } from "../src/lib/chat-sse-client.mjs";
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const selection = {
  account: "pro",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario: "chat-stream-review",
};
const chatBody = {
  chatId: "review-chat-a",
  mode: "instant",
  messages: [{ role: "user", content: "Synthetic test prompt", attachments: [] }],
};
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
const asStream = (value) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });

test("inert SSE matches the real client: success completes, synthetic failure/timeout never auto-retry", async () => {
  const content = [];
  await consumeChatSse(asStream(reviewChatOpeningEvent() + reviewChatCompletionEvent("released")), {
    onEvent: (event) => content.push(event.choices[0].delta.content),
  });
  assert.match(
    content.join(""),
    /Synthetic review response.*No AI provider.*Synthetic completion/s,
  );
  for (const outcome of ["failed", "timeout"])
    await assert.rejects(
      consumeChatSse(asStream(reviewChatOpeningEvent() + reviewChatCompletionEvent(outcome))),
      (error) =>
        error.retryable === false &&
        error.category === "model_provider_failure" &&
        error.status === 503 &&
        /Synthetic review/.test(error.message),
    );
});

test("one bounded stream per session, idempotent exact release, abort/dispose/timeout remove listeners and timers", async () => {
  const clock = fakeClock();
  let active = true;
  const stream = createReviewChatStream({ isActive: () => active, clock });
  const abort = new AbortController();
  const first = stream.start(abort.signal);
  assert.equal(stream.start().status, 409);
  assert.equal(clock.timers.size, 1);
  assert.equal([...clock.timers.values()][0].ms, REVIEW_CHAT_STREAM_HOLD_MS);
  assert.equal(stream.complete("other", "released"), false);
  assert.equal(stream.complete(first.id, "stop"), false);
  assert.equal(stream.complete(first.id, "released"), true);
  assert.equal(await first.completion, "released");
  assert.equal(clock.timers.size, 0);
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  const second = stream.start();
  assert.equal(stream.complete(first.id, "released"), true);
  assert.equal(
    stream.status.active.id,
    second.id,
    "Old release must not finish an automatically queued request",
  );
  assert.equal(stream.complete(first.id, "failed"), false);
  stream.complete(second.id, "failed");
  assert.equal(await second.completion, "failed");
  const canceled = stream.start(abort.signal);
  abort.abort();
  assert.equal(await canceled.completion, "aborted");
  assert.equal(clock.timers.size, 0);
  const timed = stream.start();
  clock.expire();
  assert.equal(await timed.completion, "timeout");
  assert.equal(stream.complete(timed.id, "released"), false);
  const pending = stream.start();
  active = false;
  stream.dispose();
  assert.equal(await pending.completion, "disposed");
  assert.equal(stream.start().status, 401);
  assert.equal(clock.timers.size, 0);
  const limited = createReviewChatStream({ isActive: () => true, clock });
  for (let i = 0; i < REVIEW_CHAT_STREAM_MAX_REQUESTS; i++) {
    const request = limited.start();
    limited.complete(request.id, "released");
    await request.completion;
  }
  assert.equal(limited.start().status, 429);
});

test("text-only validation rejects tools, files, invalid roles, oversized text and non-chat payloads", () => {
  assert.equal(validReviewChatBody(chatBody), true);
  for (const change of [
    null,
    [],
    {},
    { ...chatBody, mode: "unknown" },
    { ...chatBody, clientTool: "image" },
    { ...chatBody, skill: {} },
    { ...chatBody, kova: {} },
    { ...chatBody, projectId: "project" },
    { ...chatBody, messages: [{ role: "tool", content: "x" }] },
    {
      ...chatBody,
      messages: [{ role: "user", content: "x", attachments: [{ url: "https://outside.invalid" }] }],
    },
    { ...chatBody, messages: [{ role: "user", content: "x".repeat(50001) }] },
    { ...chatBody, messages: [{ role: "assistant", content: "x" }] },
  ])
    assert.equal(validReviewChatBody(change), false);
});

test("dynamic daily usage keeps synthetic counts and follows the authoritative next UTC midnight contract", async () => {
  assert.deepEqual(reviewDailyUsage(Date.parse("2026-12-31T23:59:59.999Z")), {
    date: "2026-12-31",
    chats: 3,
    images: 0,
    uploads: 0,
    resetsAt: "2027-01-01T00:00:00.000Z",
  });
  const id = [...pkg.base.functionNames].find(([, name]) => name.startsWith("getMyDailyUsage_"))[0];
  const read = (session) => session.registry.dispatch({ url: FIXTURE_ORIGIN + "/_serverFn/" + id });
  const session = await createFixtureSession(pkg, selection);
  const usage = (await read(session)).json.result;
  assert.equal(usage.date, new Date().toISOString().slice(0, 10));
  assert.ok(Date.parse(usage.resetsAt) > Date.now());
  assert.equal(usage.uploads, 0);
  assert.equal(
    (
      await session.registry.dispatch({
        url: FIXTURE_ORIGIN + "/_serverFn/" + id,
        headers: { "x-kova-owner": "other" },
      })
    ).status,
    401,
  );
  assert.equal(
    (await session.registry.dispatch({ url: FIXTURE_ORIGIN + "/_serverFn/" + id, method: "POST" }))
      .status,
    405,
  );
  session.dispose();
  assert.equal((await read(session)).status, 401);
  const guest = await createFixtureSession(pkg, {
    ...selection,
    scenario: "default",
    account: "guest",
  });
  assert.equal((await read(guest)).status, 401);
});

test("stream and Project Move scenarios require explicit HTTP signed-in selection", async () => {
  for (const scenario of [
    "chat-stream-review",
    "project-move-review",
    ...REVIEW_CHAT_RESPONSE_SCENARIOS,
  ]) {
    await assert.rejects(
      catalog.installReviewState({}, scenario, "free"),
      /private HTTP review adapter/,
    );
    await assert.rejects(
      createFixtureSession(pkg, { ...selection, scenario, account: "guest" }),
      /requires/,
    );
    assert.ok(await catalog.installReviewState({}, scenario, "free", { adapter: "http" }));
  }
});

async function httpFixture(port) {
  const upstream = [];
  const review = createPrivateReviewServer({
    pkg,
    port,
    fetchImpl: async (url) => {
      upstream.push(url);
      throw new Error("No test API may reach upstream");
    },
  });
  await review.listen();
  const origin = review.origin;
  const controls = await fetch(origin + "/__local-review");
  const csrf = /name="csrf" value="([^"]+)"/.exec(await controls.text())[1];
  const csrfCookie = controls.headers.get("set-cookie").split(";")[0];
  let cookie = "",
    sessionId;
  const headers = (extra) => ({
    Origin: origin,
    Cookie: [csrfCookie, cookie].filter(Boolean).join("; "),
    ...extra,
  });
  const open = async (overrides = {}) => {
    const response = await fetch(origin + "/__local-review/start", {
      method: "POST",
      headers: headers(),
      body: new URLSearchParams({ ...selection, ...overrides, csrf }),
    });
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
    sessionId = cookie.split("=")[1];
    return response.text();
  };
  const state = async () => {
    const response = await fetch(origin + "/__local-review/chat-stream-status", {
      headers: headers(),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const chat = (body = chatBody, options = {}) =>
    fetch(origin + "/api/chat", {
      method: "POST",
      ...options,
      headers: headers({
        "Content-Type": "application/json",
        "X-Kova-Owner": REVIEW_OWNER,
        ...options.headers,
      }),
      body: JSON.stringify(body),
    });
  const action = (streamId, outcome = "released", overrides = {}, extraHeaders = {}) =>
    fetch(origin + "/__local-review/chat-stream-action", {
      method: "POST",
      headers: headers(extraHeaders),
      body: new URLSearchParams({ csrf, sessionId, streamId, outcome, ...overrides }),
    });
  return {
    review,
    origin,
    upstream,
    headers,
    open,
    state,
    chat,
    action,
    get sessionId() {
      return sessionId;
    },
    async close() {
      review.dispose();
      review.server.closeAllConnections();
      await new Promise((resolve) => review.server.close(resolve));
    },
  };
}

test("HTTP streams are real chunks; guarded controller releases/fails exact requests without provider passthrough", async () => {
  const f = await httpFixture(6198);
  try {
    const html = await f.open();
    assert.match(html, /Release synthetic success/);
    assert.match(html, /app’s actual Stop button/);
    const first = await f.chat();
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type"), /text\/event-stream/);
    assert.equal(first.headers.get("cache-control"), "no-store");
    const reader = first.body.getReader();
    const opening = new TextDecoder().decode((await reader.read()).value);
    assert.match(opening, /Synthetic review response/);
    assert.doesNotMatch(opening, /Synthetic test prompt/);
    let settled = false;
    const end = reader.read().then((value) => {
      settled = true;
      return value;
    });
    await new Promise(setImmediate);
    assert.equal(settled, false);
    const state = await f.state();
    const id = state.active.id;
    assert.equal((await f.chat()).status, 409);
    assert.equal(
      (await f.action(id, "released", {}, { Origin: "https://outside.invalid" })).status,
      403,
    );
    assert.equal((await f.action(id, "released", { csrf: "wrong" })).status, 403);
    assert.equal((await f.action(id, "released", { sessionId: "other" })).status, 409);
    assert.equal((await f.action("wrong")).status, 409);
    assert.equal((await f.action(id)).status, 200);
    assert.match(new TextDecoder().decode((await end).value), /\[DONE\]/);
    assert.equal((await reader.read()).done, true);
    const second = await f.chat();
    const secondState = await f.state();
    assert.equal((await f.action(id)).status, 200);
    assert.equal((await f.state()).active.id, secondState.active.id);
    assert.equal((await f.action(secondState.active.id, "failed")).status, 200);
    await assert.rejects(
      consumeChatSse(second.body),
      (error) => error.retryable === false && error.code === "private_review_chat_failed",
    );
    assert.equal((await f.chat({ ...chatBody, clientTool: "image" })).status, 400);
    assert.equal((await f.chat(chatBody, { headers: { "X-Kova-Owner": "wrong" } })).status, 401);
    const unsupported = await fetch(f.origin + "/api/write", {
      method: "POST",
      headers: f.headers(),
      body: "{}",
    });
    assert.equal(unsupported.status, 503);
    await f.open({ scenario: "default" });
    assert.equal((await f.chat()).status, 503);
    assert.deepEqual(f.upstream, []);
  } finally {
    await f.close();
  }
});

test("disconnect, reset/account switch and logout cancel owned streams and never complete a replacement", async () => {
  const f = await httpFixture(6199);
  try {
    await f.open();
    const controller = new AbortController();
    const first = await f.chat(chatBody, { signal: controller.signal });
    const firstId = (await f.state()).active.id;
    controller.abort();
    await first.body.cancel().catch(() => {});
    for (let i = 0; i < 30 && (await f.state()).active; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await f.state()).last.outcome, "aborted");
    assert.equal((await f.action(firstId)).status, 409);
    const second = await f.chat();
    const read = second.body.getReader();
    await read.read();
    const closed = read.read();
    const assertion = assert.rejects(closed);
    const oldSession = f.sessionId;
    const oldStream = (await f.state()).active.id;
    await f.open({ account: "free" });
    await assertion;
    assert.equal(f.review.sessions.has(oldSession), false);
    assert.equal((await f.action(oldStream, "released", { sessionId: oldSession })).status, 409);
    const third = await f.chat();
    const thirdReader = third.body.getReader();
    await thirdReader.read();
    const logoutRead = assert.rejects(thirdReader.read());
    const logout = await fetch(f.origin + BACKEND_PREFIX + "/auth/v1/logout", {
      method: "POST",
      headers: f.headers(),
      body: "{}",
    });
    assert.equal(logout.status, 204);
    await logoutRead;
    assert.equal((await f.state()).status, 409);
    assert.equal((await f.chat()).status, 401);
    assert.deepEqual(f.upstream, []);
  } finally {
    await f.close();
  }
});

test("Project Move shares the actual CRUD directory and Context state, with session isolation", async () => {
  const session = await createFixtureSession(pkg, {
    ...selection,
    scenario: "project-move-review",
  });
  const invoke = (name, data, method = "GET") => {
    const id = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name)[0];
    const payload = JSON.stringify(toJSON({ data, context: {} }));
    return session.registry.dispatch({
      url:
        FIXTURE_ORIGIN +
        "/_serverFn/" +
        id +
        (method === "GET" ? "?payload=" + encodeURIComponent(payload) : ""),
      method,
      body: method === "POST" ? Buffer.from(payload) : undefined,
    });
  };
  const projects = (await invoke("listProjects", undefined)).json.result;
  assert.equal(projects.length, 2);
  assert.equal(projects.find((p) => p.id === PROJECT_MOVE_REVIEW_SOURCE_ID).chat_count, 1);
  const target = (await invoke("getProject", { id: PROJECT_MOVE_REVIEW_DESTINATION_ID })).json
    .result;
  assert.equal(target.name, "Sample move destination");
  assert.match(target.system_prompt, /Synthetic destination instructions/);
  const originalContext = (await invoke("getProject", { id: PROJECT_MOVE_REVIEW_SOURCE_ID })).json
    .result.system_prompt;
  assert.ok(originalContext);
  assert.equal(
    (
      await invoke(
        "updateProject",
        { id: PROJECT_MOVE_REVIEW_SOURCE_ID, system_prompt: "Synthetic changed context" },
        "POST",
      )
    ).json.result.ok,
    true,
  );
  assert.equal(
    (await invoke("getProject", { id: PROJECT_MOVE_REVIEW_SOURCE_ID })).json.result.system_prompt,
    "Synthetic changed context",
  );
  const files = (
    await invoke("listFiles", { project_id: PROJECT_MOVE_REVIEW_SOURCE_ID, kind: "file" })
  ).json.result;
  assert.ok(files.some((file) => file.name === "Sample project notes.txt"));
  assert.equal(
    (
      await invoke(
        "moveChatToProject",
        { chat_id: PROJECT_MOVE_REVIEW_CHAT_ID, project_id: PROJECT_MOVE_REVIEW_DESTINATION_ID },
        "POST",
      )
    ).json.result.ok,
    true,
  );
  assert.deepEqual(
    (await invoke("listProjectChats", { project_id: PROJECT_MOVE_REVIEW_SOURCE_ID })).json.result,
    [],
  );
  assert.equal(
    (await invoke("listProjectChats", { project_id: PROJECT_MOVE_REVIEW_DESTINATION_ID })).json
      .result[0].id,
    PROJECT_MOVE_REVIEW_CHAT_ID,
  );
  assert.equal(
    (await invoke("getProjectChat", { id: PROJECT_MOVE_REVIEW_CHAT_ID })).json.result.project_id,
    PROJECT_MOVE_REVIEW_DESTINATION_ID,
  );
  const other = await createFixtureSession(pkg, { ...selection, scenario: "default" });
  const id = [...pkg.base.functionNames].find(
    ([, value]) => value.split("_")[0] === "listProjects",
  )[0];
  assert.equal(
    (await other.registry.dispatch({ url: FIXTURE_ORIGIN + "/_serverFn/" + id })).json.result
      .length,
    1,
  );
  session.dispose();
  assert.equal((await invoke("getProjectChat", { id: PROJECT_MOVE_REVIEW_CHAT_ID })).status, 401);
});

test("separate HTTP sessions can each hold one stream and cannot release one another", async () => {
  const f = await httpFixture(6200);
  try {
    const html = await f.open();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
    const first = await f.chat();
    const firstState = await f.state();
    const secondOpen = await fetch(f.origin + "/__local-review/start", {
      method: "POST",
      headers: { Origin: f.origin, Cookie: f.headers().Cookie.split("; ")[0] },
      body: new URLSearchParams({ ...selection, account: "free", csrf }),
    });
    assert.equal(secondOpen.status, 200);
    await secondOpen.text();
    const secondCookie = secondOpen.headers.get("set-cookie").split(";")[0];
    const secondId = secondCookie.split("=")[1];
    const second = await fetch(f.origin + "/api/chat", {
      method: "POST",
      headers: {
        Origin: f.origin,
        Cookie: secondCookie,
        "Content-Type": "application/json",
        "X-Kova-Owner": REVIEW_OWNER,
      },
      body: JSON.stringify(chatBody),
    });
    assert.equal(second.status, 200);
    const secondState = f.review.sessions.get(secondId).chatStream.status;
    assert.notEqual(firstState.active.id, secondState.active.id);
    assert.equal((await f.action(secondState.active.id)).status, 409);
    assert.equal((await f.action(firstState.active.id)).status, 200);
    await consumeChatSse(first.body);
    assert.equal(
      f.review.sessions.get(secondId).chatStream.status.active.id,
      secondState.active.id,
    );
    await second.body.cancel();
    assert.deepEqual(f.upstream, []);
  } finally {
    await f.close();
  }
});

test("inert response sequences use authoritative status, bounded backoff, fixed SSE and isolated lifetime", async () => {
  let now = 1000,
    active = true;
  const create = (scenario = "chat-retry-backoff") =>
    createReviewChatResponse({ scenario, isActive: () => active, now: () => now });
  const fixture = create();
  const response = (output) =>
    new Response(output.json ? JSON.stringify(output.json) : output.body, {
      status: output.status,
      headers: output.headers,
    });
  const first = fixture.respond();
  assert.equal(first.status, 503);
  assert.equal(first.headers["Retry-After"], "5");
  const failure = await chatResponseError(response(first));
  assert.equal(failure.retryable, true);
  assert.equal(failure.category, "model_provider_failure");
  assert.equal(failure.retryAfter, 5);
  now += 2100;
  assert.equal(fixture.respond().headers["Retry-After"], "3");
  const separate = create();
  assert.equal(separate.respond().headers["Retry-After"], "5");
  now = 6000;
  const success = fixture.respond();
  assert.equal(success.status, 200);
  assert.match(success.contentType, /text\/event-stream/);
  let text = "";
  await consumeChatSse(asStream(success.body), {
    onEvent: (event) => {
      text += event.choices[0].delta.content;
    },
  });
  assert.equal(
    text,
    "Synthetic retry completed after the local backoff. No AI provider was contacted.",
  );
  assert.equal(separate.respond().status, 503);
  const canceled = new AbortController();
  canceled.abort();
  assert.equal(fixture.respond(canceled.signal).status, 499);
  active = false;
  assert.equal(fixture.respond().status, 401);
  active = true;
  fixture.dispose();
  assert.equal(fixture.respond().status, 401);
  const rejection = create("chat-session-rejected");
  for (let i = 0; i < 2; i++) {
    const error = await chatResponseError(response(rejection.respond()));
    assert.equal(error.status, 401);
    assert.equal(error.code, "authentication_required");
    assert.equal(error.retryable, false);
    assert.equal(error.retryAfter, undefined);
  }
  const limit = create();
  for (let i = 0; i < REVIEW_CHAT_STREAM_MAX_REQUESTS; i++) limit.respond();
  assert.equal(limit.respond().status, 429);
  assert.throws(() => create("default"), /Known synthetic/);
});

test("HTTP chat rejection/backoff reuse validation, preserve auth, reset sequence and never call a provider", async () => {
  const f = await httpFixture(6202);
  try {
    const html = await f.open({ scenario: "chat-session-rejected" });
    assert.match(html, /authoritative HTTP 401/);
    assert.doesNotMatch(html, /id="chat-stream-control"/);
    const rejected = await chatResponseError(await f.chat());
    assert.equal(rejected.status, 401);
    assert.equal(rejected.code, "authentication_required");
    assert.equal(rejected.retryable, false);
    const identity = await fetch(f.origin + BACKEND_PREFIX + "/auth/v1/user", {
      headers: f.headers(),
    });
    assert.equal(identity.status, 200);
    assert.equal((await identity.json()).id, REVIEW_OWNER);
    assert.match(await f.open({ scenario: "chat-retry-backoff" }), /Retry-After: 5/);
    const old = f.review.sessions.get(f.sessionId);
    assert.equal((await f.chat({ ...chatBody, clientTool: "image" })).status, 400);
    assert.equal((await f.chat(chatBody, { headers: { "X-Kova-Owner": "foreign" } })).status, 401);
    assert.equal(
      (await f.chat(chatBody, { headers: { Origin: "https://outside.invalid" } })).status,
      403,
    );
    assert.equal((await fetch(f.origin + "/api/chat", { headers: f.headers() })).status, 405);
    const first = await f.chat();
    assert.equal(first.status, 503);
    assert.equal(first.headers.get("retry-after"), "5");
    const failure = await chatResponseError(first);
    assert.equal(failure.retryable, true);
    assert.equal(failure.category, "model_provider_failure");
    const early = await f.chat();
    assert.equal(early.status, 503);
    assert.ok(Number(early.headers.get("retry-after")) >= 1);
    await new Promise((resolve) =>
      setTimeout(resolve, REVIEW_CHAT_RETRY_AFTER_SECONDS * 1000 + 20),
    );
    const success = await f.chat();
    assert.equal(success.status, 200);
    let text = "";
    await consumeChatSse(success.body, {
      onEvent: (event) => {
        text += event.choices[0].delta.content;
      },
    });
    assert.match(text, /Synthetic retry completed/);
    assert.doesNotMatch(text, /Synthetic test prompt/);
    await f.open({ scenario: "chat-retry-backoff", account: "free" });
    assert.equal(old.chatResponse.respond().status, 401);
    assert.equal((await f.chat()).headers.get("retry-after"), "5");
    await fetch(f.origin + BACKEND_PREFIX + "/auth/v1/logout", {
      method: "POST",
      headers: f.headers(),
      body: "{}",
    });
    assert.equal((await f.chat()).status, 401);
    await f.open({ scenario: "default" });
    assert.equal((await f.chat()).status, 503);
    assert.deepEqual(f.upstream, []);
  } finally {
    await f.close();
  }
});
