import assert from "node:assert/strict";
import test from "node:test";
import http, { request as httpRequest } from "node:http";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toJSON } from "seroval";
import {
  FIXTURE_ORIGIN,
  BACKEND_ORIGIN,
  BACKEND_PREFIX,
  REVIEW_OWNER,
  REVIEW_OUTPUT_CHAT_ID,
  REVIEW_OUTPUT_LIBRARY_ID,
  FixtureRegistry,
  rewriteReviewText,
  globMatches,
  initialStorage,
  syntheticSession,
  reviewConversations,
  loadReviewPackage,
  createFixtureSession,
  createPrivateReviewServer,
  packagedPdfWorkerSources,
  readGuardedUpstreamDocument,
} from "./private-http-review.mjs";
import * as sourceReviewState from "./review-state-fixtures.mjs";
import {
  createChatHistoryState,
  seedChatHistory,
  applyChatHistoryPage,
  visibleChatHistory,
} from "../src/lib/chat-history-state.mjs";
import { createChatHistoryController } from "../src/lib/chat-history-controller.mjs";
import { searchConversations } from "../src/lib/conversation-search.ts";
const packageRoot =
  process.env.KOVA_REVIEW_PACKAGE ||
  fileURLToPath(new URL("../../exports/KovaGPT-Recovery-Candidate-5502efb", import.meta.url));
const pkg = await loadReviewPackage(packageRoot);
// Test the working scenario catalog against already packaged base fixtures.
// No application build or package rewrite is needed for these adapter tests.
const outputPkg = { ...pkg, state: sourceReviewState };
const defaults = {
  account: "plus",
  theme: "dark",
  path: "/",
  size: "phone",
  state: "populated",
  scenario: "default",
};
const serverURL = (name) =>
  FIXTURE_ORIGIN +
  "/_serverFn/" +
  [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name)[0];
const invoke = (session, name, data = {}, method = "POST") =>
  session.registry.dispatch({
    url: serverURL(name),
    method,
    body: Buffer.from(JSON.stringify(toJSON({ data, context: {} }))),
  });

test("rewrite changes only exact known backend origin/key and fixture loopback origin", () => {
  const value = `${BACKEND_ORIGIN}/auth/v1/user https://example.invalid ${FIXTURE_ORIGIN}/api/private-files`;
  const result = rewriteReviewText(value, "http://127.0.0.1:4191");
  assert.equal(
    result,
    `http://127.0.0.1:4191${BACKEND_PREFIX}/auth/v1/user https://example.invalid http://127.0.0.1:4191/api/private-files`,
  );
  assert.ok(!result.includes(BACKEND_ORIGIN));
});
test("ordinary storage is explicit and synthetic, without prototype interception", () => {
  const stored = initialStorage(defaults);
  assert.equal(stored["kova-theme-mode"], "dark");
  const session = JSON.parse(stored["sb-127-auth-token"]);
  assert.equal(session.user.id, REVIEW_OWNER);
  assert.match(session.user.email, /@example\.invalid$/);
  assert.equal(session.refresh_token, "private-local-review-not-a-real-credential");
  assert.equal(
    JSON.parse(Buffer.from(session.access_token.split(".")[0], "base64url")).alg,
    "none",
  );
  assert.equal(
    Object.keys(initialStorage({ ...defaults, account: "guest" })).some((key) =>
      key.startsWith("sb-"),
    ),
    false,
  );
  assert.equal(syntheticSession("guest"), null);
});
test("fixture registry supports handler precedence and fallback, with fail-closed continuation", async () => {
  const registry = new FixtureRegistry();
  await registry.route("**/api/**", (route) => route.fulfill({ json: { first: true } }));
  await registry.route("**/api/**", (route) => route.fallback());
  assert.deepEqual((await registry.dispatch({ url: FIXTURE_ORIGIN + "/api/test" })).json, {
    first: true,
  });
  assert.equal((await registry.dispatch({ url: "https://outside.invalid/api" })).status, 503);
  await registry.route("**/*", (route) => route.continue());
  assert.equal((await registry.dispatch({ url: FIXTURE_ORIGIN + "/api/test" })).status, 503);
  assert.ok(globMatches("**/api/private-files?**", FIXTURE_ORIGIN + "/api/private-files?id=1"));
  assert.ok(!globMatches("**/api/private-files?**", FIXTURE_ORIGIN + "/api/private-files"));
});
test("all four explicit account choices create isolated fixture sessions", async () => {
  for (const account of ["guest", "free", "plus", "pro"]) {
    const session = await createFixtureSession(pkg, { ...defaults, account });
    assert.equal(session.authActive, account !== "guest");
    const user = await session.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/user" });
    assert.equal(user.status ?? 200, account === "guest" ? 401 : 200);
    if (account !== "guest")
      assert.equal((await invoke(session, "getSubscriptionSummary")).json.result.tier, account);
  }
});
test("existing project create/read/rename/delete persists in one review session only", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const initial = (await invoke(session, "listProjects")).json.result;
  assert.equal(initial.length, 1);
  const created = (
    await invoke(session, "createProject", {
      name: "Adapter sample",
      description: "Synthetic only",
    })
  ).json.result;
  assert.ok(created.id);
  assert.equal((await invoke(session, "listProjects")).json.result.length, 2);
  await invoke(session, "updateProject", { id: created.id, name: "Renamed sample" });
  assert.equal(
    (await invoke(session, "getProject", { id: created.id })).json.result.name,
    "Renamed sample",
  );
  await invoke(session, "deleteProject", { id: created.id });
  assert.equal((await invoke(session, "listProjects")).json.result.length, 1);
  const fresh = await createFixtureSession(pkg, defaults);
  assert.equal((await invoke(fresh, "listProjects")).json.result.length, 1);
});
test("empty collection state covers Library, Projects and Scheduled tasks list contracts", async () => {
  const session = await createFixtureSession(pkg, {
    ...defaults,
    path: "/projects",
    state: "empty",
  });
  const library = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/library/items?limit=20",
    headers: { "x-kova-owner": REVIEW_OWNER },
  });
  assert.deepEqual(library.json, { items: [], cursor: null, hasMore: false });
  assert.deepEqual((await invoke(session, "listProjects", {}, "GET")).json, {
    result: [],
    context: {},
  });
  assert.deepEqual(
    (await invoke(session, "listScheduledTasks", { expectedUserId: REVIEW_OWNER })).json,
    { result: [], context: {} },
  );
});
test("error collection state fails list reads without corrupting project detail or mutation fixtures", async () => {
  for (const state of ["empty", "error"]) {
    const session = await createFixtureSession(pkg, { ...defaults, state });
    const projectId = "33333333-3333-4333-8333-333333333333";
    assert.equal(
      (await invoke(session, "getProject", { id: projectId })).json.result.id,
      projectId,
    );
    assert.equal(
      (await invoke(session, "listFiles", { project_id: projectId })).json.result.length,
      1,
    );
    assert.equal(
      (await invoke(session, "listMembers", { project_id: projectId })).json.result.length,
      2,
    );
    const created = (await invoke(session, "createProject", { name: "State review project" })).json
      .result;
    assert.equal(
      (await invoke(session, "getProject", { id: created.id })).json.result.name,
      "State review project",
    );
    const eligibility = await invoke(session, "isScheduledTasksEligible", {
      expectedUserId: REVIEW_OWNER,
    });
    assert.deepEqual(eligibility.json.result, { eligible: true, executionAvailable: false });
    if (state === "error") {
      for (const [name, method] of [
        ["listProjects", "GET"],
        ["listScheduledTasks", "POST"],
      ]) {
        const failure = await invoke(session, name, { expectedUserId: REVIEW_OWNER }, method);
        assert.equal(failure.status, 503);
        assert.equal(failure.contentType, "text/plain");
        assert.match(failure.body, /^Simulated .+ list failure\. Reset to retry\.$/);
        assert.equal(failure.json, undefined);
      }
      const library = await session.registry.dispatch({
        url: FIXTURE_ORIGIN + "/api/library/items",
        headers: { "x-kova-owner": REVIEW_OWNER },
      });
      assert.equal(library.status, 503);
      assert.match(library.json.error, /Simulated read failure/);
    }
  }
  const fresh = await createFixtureSession(pkg, defaults);
  assert.equal((await invoke(fresh, "listProjects", {}, "GET")).json.result.length, 1);
});
test("explicit task and billing scenarios retain precedence over collection state", async () => {
  for (const state of ["empty", "error"]) {
    const session = await createFixtureSession(pkg, {
      ...defaults,
      state,
      scenario: "tasks-editor",
    });
    assert.equal(session.selection.path, "/scheduled-tasks");
    const tasks = await invoke(session, "listScheduledTasks", { expectedUserId: REVIEW_OWNER });
    assert.equal(tasks.json.result.length, 2);
    assert.deepEqual(
      (await invoke(session, "isScheduledTasksEligible", { expectedUserId: REVIEW_OWNER })).json
        .result,
      { eligible: true, executionAvailable: true },
    );
    const billing = await createFixtureSession(pkg, {
      ...defaults,
      state,
      scenario: "billing-trial-active",
    });
    assert.equal((await invoke(billing, "getSubscriptionSummary")).json.result.trialing, true);
  }
});
test("existing Library folder mutation preserves owner checks and remains local", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const call = (owner) =>
    session.registry.dispatch({
      url: FIXTURE_ORIGIN + "/api/library/folders",
      method: "POST",
      headers: { "x-kova-owner": owner },
      body: Buffer.from(JSON.stringify({ name: "Synthetic folder", parentId: null })),
    });
  assert.equal((await call("not-owner")).status, 401);
  const added = await call(REVIEW_OWNER);
  assert.equal(added.json.folder.name, "Synthetic folder");
  const list = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/library/folders",
    headers: { "x-kova-owner": REVIEW_OWNER },
  });
  assert.equal(list.json.folders.length, 1);
});
test("bounded synthetic project upload/read/remove uses the reusable fixture contracts", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const headers = {
    "x-kova-owner": REVIEW_OWNER,
    "content-type": "application/octet-stream",
    "x-kova-project-id": "33333333-3333-4333-8333-333333333333",
    "x-kova-idempotency-key": "11111111-1111-4111-8111-111111111111",
    "x-kova-file-name": "Synthetic.txt",
  };
  const uploaded = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/project-files",
    method: "POST",
    headers,
    body: Buffer.from("Synthetic test file.\n"),
  });
  assert.equal(uploaded.status, 201);
  const id = uploaded.json.file.id;
  const signed = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/project-files?id=" + id,
    headers,
  });
  assert.ok(signed.json.url.startsWith(FIXTURE_ORIGIN + "/api/private-files?"));
  const file = await session.registry.dispatch({ url: signed.json.url, headers });
  assert.equal(file.body.toString(), "Synthetic test file.\n");
  const removed = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/project-files",
    method: "DELETE",
    headers,
    body: Buffer.from(JSON.stringify({ id })),
  });
  assert.equal(removed.status, 204);
});
test("existing image/tasks/billing scenarios remain available without providers", async () => {
  const tasks = await createFixtureSession(pkg, { ...defaults, scenario: "tasks-editor" });
  assert.equal(tasks.selection.path, "/scheduled-tasks");
  const listed = await invoke(tasks, "listScheduledTasks", { expectedUserId: REVIEW_OWNER });
  assert.equal(listed.json.result.length, 2);
  const billing = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "billing-trial-active",
  });
  assert.equal((await invoke(billing, "getSubscriptionSummary")).json.result.trialing, true);
  const images = await createFixtureSession(pkg, { ...defaults, scenario: "image-sample-success" });
  const image = await images.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/generate-image",
    method: "POST",
    body: Buffer.from(JSON.stringify({ prompt: "Synthetic sample", aspectRatio: "1:1" })),
  });
  assert.equal(image.json.metadata.reviewOnly, true);
  assert.match(image.json.imageUrl, /^data:image\/jpeg;base64,/);
});
test("unsupported scenario/account combinations fail before any review session is created", async () => {
  await assert.rejects(
    createFixtureSession(pkg, { ...defaults, account: "guest", scenario: "tasks-editor" }),
    /requires/,
  );
  await assert.rejects(
    createFixtureSession(pkg, { ...defaults, account: "guest", scenario: "image-sample-success" }),
    /signed-in/,
  );
  await assert.rejects(
    createFixtureSession(pkg, { ...defaults, path: "https://outside.invalid" }),
    /Invalid/,
  );
});
test("returning-user onboarding is completed normally; explicit onboarding scenario is not hidden", async () => {
  const ordinary = await createFixtureSession(pkg, defaults);
  assert.equal((await invoke(ordinary, "getOnboarding")).json.result.completed, true);
  const fresh = await createFixtureSession(pkg, { ...defaults, scenario: "onboarding-new" });
  assert.equal((await invoke(fresh, "getOnboarding")).json.result.completed, false);
});
test("HTTP controls/reset, CSP, isolated API dispatch, asset rewrite and guest reset", async () => {
  const calls = [];
  const review = createPrivateReviewServer({
    pkg,
    port: 6191,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/auth?"))
        return new Response(null, { status: 302, headers: { Location: "/?sign-in=1" } });
      if (url.includes("/redirect-case/")) {
        const kind = new URL(url).pathname.split("/").at(-1);
        const locations = {
          absolute: FIXTURE_ORIGIN + "/auth?mode=sign-up",
          external: "https://outside.invalid/sign-in",
          https: "https://127.0.0.1:4189/auth",
          credentials: "http://unwanted@127.0.0.1:4189/auth",
          missing: null,
        };
        return new Response(null, {
          status: 302,
          headers: locations[kind] ? { Location: locations[kind] } : {},
        });
      }
      return new Response(
        `<html><body><a href="${BACKEND_ORIGIN}">Mock upstream page</a></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
  await review.listen();
  try {
    const origin = review.origin;
    const initial = await fetch(origin + "/__local-review");
    const html = await initial.text();
    assert.match(html, /Open \/ reset synthetic review/);
    assert.match(html, /320 × 700/);
    assert.match(html, /label for="review-account">Account/);
    assert.match(html, /label for="review-state">Library \/ Projects \/ Tasks state/);
    assert.match(html, /State applies to Library, Projects and Scheduled tasks list reads/);
    assert.match(html, /Project details and unrelated server endpoints keep their fixtures/);
    assert.match(html, /Explicit scenarios override matching state/);
    assert.equal(initial.headers.get("referrer-policy"), "same-origin");
    assert.ok(
      initial.headers
        .get("content-security-policy")
        .includes(`worker-src ${packagedPdfWorkerSources(pkg.root + "/dist/client", origin)};`),
    );
    assert.doesNotMatch(
      initial.headers.get("content-security-policy"),
      /worker-src (?:\'self\'|blob:|\*)/,
    );
    const csrfCookie = initial.headers.get("set-cookie").split(";")[0];
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
    const repeat = await fetch(origin + "/__local-review", { headers: { Cookie: csrfCookie } });
    assert.match(await repeat.text(), new RegExp(`name="csrf" value="${csrf}"`));
    const icon = await fetch(origin + "/favicon.ico", { redirect: "manual" });
    assert.notEqual(icon.status, 303);
    assert.equal(icon.headers.get("set-cookie"), null);
    const blocked = await fetch(origin + "/__local-review/start", {
      method: "POST",
      headers: { Cookie: csrfCookie },
      body: "csrf=" + csrf,
    });
    assert.equal(blocked.status, 403);
    const open = await fetch(origin + "/__local-review/start", {
      method: "POST",
      headers: { Origin: origin, Cookie: csrfCookie },
      body: new URLSearchParams({ ...defaults, csrf }),
    });
    assert.equal(open.status, 200);
    const openHTML = await open.text();
    assert.match(openHTML, /localStorage\.clear\(\)/);
    assert.match(openHTML, /indexedDB\.deleteDatabase\('kovagpt-chat-history-v1'\)/);
    assert.match(openHTML, /Close other private review app tabs/);
    assert.ok(!openHTML.includes("Storage.prototype"));
    assert.ok(!openHTML.includes(BACKEND_ORIGIN));
    const sessionCookie = open.headers.get("set-cookie").split(";")[0];
    const headers = { Cookie: sessionCookie };
    const app = await fetch(origin + "/projects", { headers });
    assert.match(await app.text(), new RegExp(BACKEND_PREFIX));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].options.headers, { Accept: "text/html" });
    const missing = await fetch(origin + "/api/unknown-live-service", { headers });
    assert.equal(missing.status, 503);
    assert.equal(calls.length, 1);
    const blockedWorker = await fetch(origin + "/kova-sw.js", { headers });
    assert.equal(blockedWorker.status, 403);
    const auth = await fetch(origin + BACKEND_PREFIX + "/auth/v1/user", { headers });
    assert.equal((await auth.json()).id, REVIEW_OWNER);
    const chatHeaders = { ...headers, "x-kova-owner": REVIEW_OWNER };
    const chatPage = await (
      await fetch(origin + "/api/chat/history", { headers: chatHeaders })
    ).json();
    const chatMutation = mutationFor(chatPage);
    const deniedChatMutation = await fetch(origin + "/api/chat/history", {
      method: "POST",
      headers: {
        ...chatHeaders,
        Origin: "https://outside.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chatMutation),
    });
    assert.equal(deniedChatMutation.status, 403);
    const allowedChatMutation = await fetch(origin + "/api/chat/history", {
      method: "POST",
      headers: { ...chatHeaders, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(chatMutation),
    });
    assert.equal(allowedChatMutation.status, 200);
    assert.equal((await allowedChatMutation.json()).revision, 2);
    assert.equal(calls.length, 1);
    const authRedirect = await fetch(origin + "/auth?email=review%40example.invalid&mode=sign-in", {
      headers,
      redirect: "manual",
    });
    assert.equal(authRedirect.status, 302);
    assert.equal(authRedirect.headers.get("location"), "/?sign-in=1");
    assert.equal(
      calls.at(-1).url,
      FIXTURE_ORIGIN + "/auth?email=review%40example.invalid&mode=sign-in",
    );
    const absoluteRedirect = await fetch(origin + "/redirect-case/absolute", {
      headers,
      redirect: "manual",
    });
    assert.equal(absoluteRedirect.status, 302);
    assert.equal(absoluteRedirect.headers.get("location"), "/auth?mode=sign-up");
    for (const kind of ["external", "https", "credentials", "missing"]) {
      const rejectedRedirect = await fetch(origin + "/redirect-case/" + kind, {
        headers,
        redirect: "manual",
      });
      assert.equal(rejectedRedirect.status, 503);
      assert.equal(rejectedRedirect.headers.get("location"), null);
      assert.match((await rejectedRedirect.json()).error, /blocked an upstream redirect/);
    }
    const badHostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(
        origin + "/__local-review",
        { headers: { Host: "attacker.invalid" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(badHostStatus, 403);
    const reset = await fetch(origin + "/__local-review/start", {
      method: "POST",
      headers: { Origin: origin, Cookie: sessionCookie + "; " + csrfCookie },
      body: new URLSearchParams({ ...defaults, account: "guest", csrf }),
    });
    assert.equal(reset.status, 200);
    assert.equal(review.sessions.size, 1);
    assert.equal((await fetch(origin + BACKEND_PREFIX + "/auth/v1/user", { headers })).status, 401);
  } finally {
    await new Promise((resolve) => review.server.close(resolve));
  }
});
test("conversation pages satisfy the actual history state contract without legacy conflicts", async () => {
  const session = await createFixtureSession(pkg, defaults);
  let state = await seedChatHistory(
    createChatHistoryState(REVIEW_OWNER),
    reviewConversations(),
    [],
  );
  const headers = { "x-kova-owner": REVIEW_OWNER };
  let page;
  do {
    const output = await session.registry.dispatch({
      url:
        FIXTURE_ORIGIN +
        "/api/chat/history?cursor=" +
        state.cursor +
        (state.epoch ? "&epoch=" + state.epoch : ""),
      headers,
    });
    assert.equal(output.status, 200);
    page = output.json;
    assert.equal(page.records.length, 1);
    state = await applyChatHistoryPage(state, page);
  } while (page.hasMore);
  assert.equal(state.complete, true);
  assert.deepEqual(visibleChatHistory(state), reviewConversations());
  assert.equal(
    Object.values(state.records).some((record) => record.migration || record.conflict),
    false,
  );
  const unchanged = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history?cursor=2&epoch=" + state.epoch,
    headers,
  });
  assert.deepEqual(unchanged.json.records, []);
  assert.equal(unchanged.json.nextCursor, 2);
  const write = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history",
    method: "PATCH",
    headers,
    body: Buffer.from(JSON.stringify({ id: "synthetic-write" })),
  });
  assert.equal(write.status, 503);
  assert.match(write.json.error, /writes are not connected/);
  const reset = await createFixtureSession(pkg, defaults);
  const resetPage = await reset.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history?cursor=2&epoch=" + state.epoch,
    headers,
  });
  assert.notEqual(resetPage.json.epoch, state.epoch);
  assert.equal(resetPage.json.nextCursor, 1);
});
test("chat-outputs seeds one extra active chat with matching isolated history for signed-in accounts", async () => {
  for (const account of ["free", "plus", "pro"]) {
    const selection = { ...defaults, account, scenario: "chat-outputs", path: "/library" };
    const session = await createFixtureSession(outputPkg, selection);
    assert.equal(session.selection.path, "/");
    const storage = initialStorage(selection);
    const conversations = JSON.parse(storage[`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`]);
    assert.equal(conversations.length, 3);
    assert.deepEqual(conversations.slice(0, 2), reviewConversations());
    assert.equal(storage[`nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`], REVIEW_OUTPUT_CHAT_ID);
    assert.equal(
      storage[`kova-draft-v2:user:${REVIEW_OWNER}:${conversations[1].id}`],
      "Second chat draft",
    );
    let state = await seedChatHistory(createChatHistoryState(REVIEW_OWNER), conversations, []);
    let page;
    do {
      const response = await historyPage(
        session,
        "?cursor=" + state.cursor + (state.epoch ? "&epoch=" + state.epoch : ""),
      );
      assert.equal(response.status, 200);
      page = response.json;
      state = await applyChatHistoryPage(state, page);
    } while (page.hasMore);
    assert.equal(page.currentVersion, 3);
    assert.deepEqual(visibleChatHistory(state), conversations);
    assert.ok(Object.values(state.records).every((row) => !row.migration && !row.conflict));
    const fresh = await createFixtureSession(outputPkg, defaults);
    assert.equal((await historyPage(fresh)).json.currentVersion, 2);
  }
  await assert.rejects(
    createFixtureSession(outputPkg, { ...defaults, account: "guest", scenario: "chat-outputs" }),
    /requires a synthetic/,
  );
});
test("chat-outputs Library attachment points to the existing sample item and cannot mutate chat content", async () => {
  const session = await createFixtureSession(outputPkg, { ...defaults, scenario: "chat-outputs" });
  const outputChat = reviewConversations("chat-outputs").at(-1);
  const attached = outputChat.messages[0].attachments.find((item) => item.kind === "library_file");
  assert.equal(attached.libraryItemId, REVIEW_OUTPUT_LIBRARY_ID);
  const list = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/library/items",
    method: "POST",
    headers: { "x-kova-owner": REVIEW_OWNER },
    body: Buffer.from(JSON.stringify({ operation: "list" })),
  });
  const source = list.json.items.find((item) => item.id === attached.libraryItemId);
  assert.ok(source, "Library attachment must refer to a real disposable fixture item");
  assert.equal(source.file_name, attached.name);
  assert.equal(source.file_type, attached.fileType);
  const detail = await session.registry.dispatch({
    url:
      FIXTURE_ORIGIN +
      "/api/library/items?" +
      new URLSearchParams({ id: source.id, generation: source.content_generation }),
    headers: { "x-kova-owner": REVIEW_OWNER },
  });
  assert.equal(detail.status ?? 200, 200);
  assert.equal(detail.json.content_text, source.content_text);
  const first = (await historyPage(session)).json;
  const page = (await historyPage(session, "?epoch=" + first.epoch + "&cursor=2")).json;
  assert.equal(page.records[0].id, outputChat.id);
  const modified = structuredClone(outputChat);
  modified.messages[0].attachments[0].content = "Unrequested replacement";
  const rejected = await historyCall(session, mutationFor(page, { payload: modified }));
  assert.equal(rejected.status, 503);
  assert.deepEqual(
    (await historyPage(session, "?epoch=" + first.epoch + "&cursor=2")).json.records[0].payload,
    outputChat,
  );
});
const historyCall = (session, body, headers = { "x-kova-owner": REVIEW_OWNER }) =>
  session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history",
    method: "POST",
    headers,
    body: Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)),
  });
const historyPage = (session, query = "") =>
  session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history" + query,
    headers: { "x-kova-owner": REVIEW_OWNER },
  });
const mutationFor = (page, changes = {}) => ({
  id: page.records[0].id,
  mutationId: crypto.randomUUID(),
  epoch: page.epoch,
  expectedRevision: page.records[0].revision,
  payload: { ...page.records[0].payload, title: "Renamed synthetic checklist" },
  archived: false,
  ...changes,
});

test("actual chat controller supports sample rename, local search, archive and restore across reload", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const writes = [],
    statuses = [];
  let device = null;
  const makeController = () =>
    createChatHistoryController({
      ownerId: REVIEW_OWNER,
      signal: new AbortController().signal,
      loadDevice: async () => structuredClone(device),
      commitDevice: async (_previous, next) => {
        device = structuredClone(next);
      },
      getLegacy: () => ({ active: reviewConversations(), archived: [] }),
      status: (status) => statuses.push(status),
      transport: async ({ method, body, cursor, epoch }) => {
        if (method === "POST") writes.push(structuredClone(body));
        const output =
          method === "POST"
            ? await historyCall(session, body)
            : await historyPage(session, "?cursor=" + cursor + (epoch ? "&epoch=" + epoch : ""));
        if (output.status !== 200)
          throw Object.assign(new Error(output.json.error), { status: output.status });
        return output.json;
      },
    });
  let controller = makeController();
  await controller.initialize();
  await controller.pump();
  const original = visibleChatHistory(controller.getState())[0];
  const renamed = {
    ...original,
    title: "Launch review checklist",
    updatedAt: original.updatedAt + 1000,
  };
  controller.markDirty();
  assert.equal(
    await controller.write(
      visibleChatHistory(controller.getState()).map((chat) =>
        chat.id === renamed.id ? renamed : chat,
      ),
      false,
    ),
    true,
  );
  await controller.pump();
  await controller.pump();
  assert.equal(statuses.at(-1).phase, "saved");
  assert.equal(
    searchConversations(visibleChatHistory(controller.getState()), "in:title:launch")[0]
      .conversation.id,
    original.id,
  );
  assert.equal(
    searchConversations(visibleChatHistory(controller.getState()), '"release checklist"')[0]
      .conversation.id,
    original.id,
  );
  controller.markDirty();
  assert.equal(await controller.write([renamed], true), true);
  await controller.pump();
  await controller.pump();
  assert.equal(statuses.at(-1).phase, "saved");
  assert.deepEqual(searchConversations(visibleChatHistory(controller.getState()), "launch"), []);
  assert.equal(
    searchConversations(visibleChatHistory(controller.getState(), true), "launch")[0].conversation
      .id,
    original.id,
  );
  // Reload the persisted controller state, as the product does with IndexedDB.
  controller = makeController();
  await controller.initialize();
  await controller.pump();
  const archived = visibleChatHistory(controller.getState(), true)[0];
  assert.deepEqual(archived, renamed);
  controller.markDirty();
  assert.equal(
    await controller.write([archived, ...visibleChatHistory(controller.getState())], false),
    true,
  );
  controller.markDirty();
  assert.equal(await controller.write([], true), true);
  await controller.pump();
  await controller.pump();
  assert.equal(statuses.at(-1).phase, "saved");
  assert.deepEqual(visibleChatHistory(controller.getState(), true), []);
  assert.equal(
    searchConversations(visibleChatHistory(controller.getState()), "launch")[0].conversation.id,
    original.id,
  );
  assert.equal(writes.length, 3);
  assert.deepEqual(
    writes.map(({ archived }) => archived),
    [false, true, false],
  );
  assert.ok(writes.every(({ payload }) => payload !== null));
  assert.ok(
    Object.values(controller.getState().records).every(
      (row) => !row.dirty && !row.conflict && !row.migration,
    ),
  );
  const reset = await createFixtureSession(pkg, defaults);
  assert.equal((await historyPage(reset)).json.records[0].payload.title, original.title);
});
test("chat fixture receipts, revisions, epochs and ordered incremental reads follow the source contract", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const first = (await historyPage(session)).json;
  const rename = mutationFor(first);
  const saved = await historyCall(session, rename);
  assert.deepEqual(saved.json, {
    id: rename.id,
    mutationId: rename.mutationId,
    revision: 2,
    syncVersion: 3,
  });
  const archive = {
    ...rename,
    mutationId: crypto.randomUUID(),
    expectedRevision: 2,
    archived: true,
  };
  assert.equal((await historyCall(session, archive)).json.syncVersion, 4);
  const reordered = Object.fromEntries(Object.entries(rename).reverse());
  assert.deepEqual((await historyCall(session, reordered)).json, saved.json);
  assert.equal((await historyCall(session, { ...rename, archived: true })).status, 409);
  assert.equal(
    (await historyCall(session, { ...rename, mutationId: crypto.randomUUID() })).status,
    409,
  );
  assert.equal(
    (await historyCall(session, { ...archive, epoch: crypto.randomUUID() })).status,
    409,
  );
  const changed = (await historyPage(session, "?epoch=" + first.epoch + "&cursor=2")).json;
  assert.equal(changed.currentVersion, 4);
  assert.equal(changed.records[0].revision, 3);
  assert.equal(changed.records[0].mutation_id, archive.mutationId);
  assert.equal(changed.records[0].archived, true);
  assert.equal(changed.nextCursor, 4);
  assert.equal(changed.hasMore, false);
  const freshRead = (await historyPage(session)).json;
  assert.equal(freshRead.records[0].sync_version, 2);
  assert.equal(freshRead.hasMore, true);
  assert.deepEqual(
    (await historyPage(session, "?epoch=" + first.epoch + "&cursor=4")).json.records,
    [],
  );
  const uppercaseEpoch = (
    await historyPage(session, "?epoch=" + first.epoch.toUpperCase() + "&cursor=4")
  ).json;
  assert.equal(uppercaseEpoch.reset, false);
  assert.equal(uppercaseEpoch.nextCursor, 4);
  assert.deepEqual(uppercaseEpoch.records, []);
  assert.equal((await historyPage(session, "?epoch=" + first.epoch + "&cursor=5")).status, 400);
  const fresh = await createFixtureSession(pkg, defaults);
  assert.equal((await historyCall(fresh, rename)).status, 409);
  assert.equal((await historyPage(fresh)).json.currentVersion, 2);
});
test("actual chat controller pins and unpins existing samples across reload without sync errors", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const statuses = [];
  let device = null;
  const makeController = () =>
    createChatHistoryController({
      ownerId: REVIEW_OWNER,
      signal: new AbortController().signal,
      loadDevice: async () => structuredClone(device),
      commitDevice: async (_previous, next) => {
        device = structuredClone(next);
      },
      getLegacy: () => ({ active: reviewConversations(), archived: [] }),
      status: (status) => statuses.push(status),
      transport: async ({ method, body, cursor, epoch }) => {
        const output =
          method === "POST"
            ? await historyCall(session, body)
            : await historyPage(session, "?cursor=" + cursor + (epoch ? "&epoch=" + epoch : ""));
        if (output.status !== 200)
          throw Object.assign(new Error(output.json.error), { status: output.status });
        return output.json;
      },
    });
  let controller = makeController();
  await controller.initialize();
  await controller.pump();
  const original = visibleChatHistory(controller.getState())[0];
  const pinned = { ...original, pinned: true, pinnedAt: original.updatedAt + 1000 };
  const save = async (chat) => {
    controller.markDirty();
    assert.equal(
      await controller.write(
        visibleChatHistory(controller.getState()).map((item) =>
          item.id === chat.id ? chat : item,
        ),
        false,
      ),
      true,
    );
    await controller.pump();
    await controller.pump();
    assert.equal(statuses.at(-1).phase, "saved");
  };
  await save(pinned);
  controller = makeController();
  await controller.initialize();
  await controller.pump();
  assert.deepEqual(
    visibleChatHistory(controller.getState()).find((item) => item.id === original.id),
    pinned,
  );
  // Same shape as the app toggle, normalized by its actual history controller.
  await save({ ...pinned, pinned: false, pinnedAt: undefined });
  controller = makeController();
  await controller.initialize();
  await controller.pump();
  assert.deepEqual(
    visibleChatHistory(controller.getState()).find((item) => item.id === original.id),
    original,
  );
  assert.ok(
    Object.values(controller.getState().records).every(
      (row) => !row.dirty && !row.conflict && !row.migration,
    ),
  );
  const reset = await createFixtureSession(pkg, defaults);
  assert.deepEqual((await historyPage(reset)).json.records[0].payload, original);
});
test("chat writes remain fail-closed for other owners, new/deleted chats, content and unsupported fields", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const first = (await historyPage(session)).json;
  const rename = mutationFor(first);
  assert.equal((await historyCall(session, rename, { "x-kova-owner": "different" })).status, 401);
  const guest = await createFixtureSession(pkg, { ...defaults, account: "guest" });
  assert.equal((await historyCall(guest, rename)).status, 401);
  for (const body of [
    { ...rename, payload: null },
    {
      ...rename,
      id: "new-chat",
      expectedRevision: 0,
      payload: { ...rename.payload, id: "new-chat" },
    },
    ...[
      { messages: [] },
      { mode: "max" },
      { createdAt: 0 },
      { temporary: true },
      { arbitrary: "unsupported" },
    ].map((change) => ({ ...rename, payload: { ...rename.payload, ...change } })),
  ]) {
    const output = await historyCall(session, body);
    assert.equal(output.status, 503);
    assert.match(output.json.error, /only rename\/pin\/unpin\/archive\/restore/);
  }
  for (const body of [
    [],
    null,
    {},
    { ...rename, hash: "not-a-wire-field" },
    { ...rename, mutationId: "invalid" },
    { ...rename, expectedRevision: -1 },
    { ...rename, archived: "true" },
    { ...rename, payload: [] },
    { ...rename, payload: { ...rename.payload, title: "x".repeat(501) } },
    { ...rename, payload: { ...rename.payload, updatedAt: -1 } },
    { ...rename, payload: { ...rename.payload, pinned: "true" } },
    { ...rename, payload: { ...rename.payload, pinned: null } },
    { ...rename, payload: { ...rename.payload, pinnedAt: -1 } },
    { ...rename, payload: { ...rename.payload, pinnedAt: 1.5 } },
    { ...rename, payload: { ...rename.payload, pinnedAt: 8_640_000_000_000_001 } },
    { ...rename, payload: { ...rename.payload, pinnedAt: "now" } },
    { ...rename, payload: { ...rename.payload, id: "wrong-id" } },
    Buffer.from("{invalid"),
  ])
    assert.equal((await historyCall(session, body)).status, 400);
  assert.equal(
    (await historyCall(session, Buffer.alloc(4 * 1024 * 1024 + 65537, " "))).status,
    413,
  );
  const unchanged = (await historyPage(session)).json;
  assert.equal(unchanged.currentVersion, 2);
  assert.deepEqual(unchanged.records[0], first.records[0]);
  await session.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
  assert.equal((await historyCall(session, rename)).status, 401);
});
test("chat receipt memory is bounded without silently replaying an old mutation as new", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const first = (await historyPage(session)).json;
  let body = mutationFor(first),
    saved;
  for (let index = 0; index < 256; index++) {
    body = {
      ...body,
      expectedRevision: index + 1,
      mutationId: crypto.randomUUID(),
      archived: index % 2 === 0,
    };
    saved = await historyCall(session, body);
    assert.equal(saved.status, 200);
  }
  assert.equal(
    (
      await historyCall(session, {
        ...body,
        expectedRevision: 257,
        mutationId: crypto.randomUUID(),
      })
    ).status,
    413,
  );
  assert.deepEqual((await historyCall(session, body)).json, saved.json);
  assert.equal((await historyPage(session)).json.currentVersion, 258);
});
test("conversation fixture rejects guest/wrong owners and malformed pagination", async () => {
  const session = await createFixtureSession(pkg, defaults);
  const request = (suffix = "", headers = { "x-kova-owner": REVIEW_OWNER }) =>
    session.registry.dispatch({ url: FIXTURE_ORIGIN + "/api/chat/history" + suffix, headers });
  assert.equal((await request("", { "x-kova-owner": "different" })).status, 401);
  for (const query of [
    "?cursor=-1",
    "?cursor=1&cursor=2",
    "?epoch=not-uuid",
    "?unrecognized=value",
  ])
    assert.equal((await request(query)).status, 400);
  const guest = await createFixtureSession(pkg, { ...defaults, account: "guest" });
  assert.equal(
    (
      await guest.registry.dispatch({
        url: FIXTURE_ORIGIN + "/api/chat/history",
        headers: { "x-kova-owner": REVIEW_OWNER },
      })
    ).status,
    401,
  );
});
test("unsupported route diagnostics are limited to method/path and suppress repeated query variants", async () => {
  const session = await createFixtureSession(pkg, defaults),
    diagnostics = [];
  session.registry.diagnostic = (value) => diagnostics.push(value);
  for (const query of ["private=not-logged", "private=also-not-logged"])
    await session.registry.dispatch({
      url: FIXTURE_ORIGIN + "/api/unconnected?" + query,
      headers: { Authorization: "never-logged" },
    });
  assert.deepEqual(diagnostics, [{ method: "GET", path: "/api/unconnected" }]);
});
test("native document reader exposes a redirect without following it and bounds HTML bytes", async () => {
  const original = http.request;
  let calls = 0,
    oversized = false;
  http.request = (url, options, receive) => {
    calls++;
    assert.equal(url.origin, FIXTURE_ORIGIN);
    assert.deepEqual(options.headers, { Accept: "text/html" });
    const request = new EventEmitter();
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 302;
      response.headers = { location: "https://outside.invalid/", "content-type": "text/html" };
      response.destroy = (error) => response.emit("error", error);
      receive(response);
      response.emit(
        "data",
        oversized ? Buffer.alloc(8 * 1024 * 1024 + 1) : Buffer.from("Redirect body"),
      );
      if (!oversized) response.emit("end");
    };
    return request;
  };
  syncBuiltinESMExports();
  try {
    const response = await readGuardedUpstreamDocument(FIXTURE_ORIGIN + "/auth");
    assert.equal(calls, 1);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://outside.invalid/");
    assert.equal(await response.text(), "Redirect body");
    oversized = true;
    await assert.rejects(
      readGuardedUpstreamDocument(FIXTURE_ORIGIN + "/auth"),
      /document_too_large/,
    );
    assert.equal(calls, 2);
  } finally {
    http.request = original;
    syncBuiltinESMExports();
  }
});
test("native document reader rejects non-loopback targets before any HTTP request", async () => {
  for (const url of [
    "https://outside.invalid/",
    "http://127.0.0.1:4190/",
    "https://127.0.0.1:4189/",
    "http://user@127.0.0.1:4189/",
  ])
    await assert.rejects(readGuardedUpstreamDocument(url), /upstream_origin_denied/);
});
test("adapter source has no browser-control dependency or production-source import", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./private-http-review.mjs", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /from ["'](?:playwright|puppeteer)|\.evaluate\(|addInitScript\([^)]*=>|Storage\.prototype|navigator\.clipboard/,
  );
  assert.doesNotMatch(source, /from ["'][^"']*\/src\//);
});

test("voice review stays disconnected and never forwards synthetic audio", async () => {
  for (const account of ["guest", "free", "plus", "pro"]) {
    const session = await createFixtureSession(pkg, { ...defaults, account });
    const get = await session.registry.dispatch({
      url: FIXTURE_ORIGIN + "/api/voice",
      method: "GET",
    });
    assert.equal(get.status, account === "guest" ? 401 : 200);
    if (account !== "guest")
      assert.deepEqual(get.json, {
        configured: false,
        stt: false,
        tts: false,
        sts: false,
        voices: [],
        defaultVoiceId: null,
      });
    const post = await session.registry.dispatch({
      url: FIXTURE_ORIGIN + "/api/voice",
      method: "POST",
      body: Buffer.from("synthetic-not-audio"),
    });
    assert.equal(post.status, account === "guest" ? 401 : 503);
  }
});

test("explicit public directory recovery works over HTTP without a session cookie and exposes no account data", async () => {
  const review = createPrivateReviewServer({
    pkg: outputPkg,
    port: 6193,
    fetchImpl: async () => {
      throw Error("No upstream allowed");
    },
  });
  await review.listen();
  try {
    const origin = review.origin;
    assert.equal((await fetch(origin + "/api/kovas/directory")).status, 401);
    const page = await fetch(origin + "/__local-review");
    const html = await page.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
    const cookie = page.headers.get("set-cookie").split(";")[0];
    const start = (scenario) =>
      fetch(origin + "/__local-review/start", {
        method: "POST",
        headers: { Origin: origin, Cookie: cookie },
        body: new URLSearchParams({ ...defaults, account: "guest", scenario, csrf }),
      });
    assert.equal((await start("assistant-directory-recovery")).status, 200);
    assert.equal((await fetch(origin + "/api/kovas/directory")).status, 503);
    assert.deepEqual(await (await fetch(origin + "/api/kovas/directory")).json(), { rows: [] });
    assert.equal(
      (
        await fetch(origin + "/api/kovas/directory", {
          headers: { "sec-fetch-site": "cross-site" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(origin + "/api/kovas")).status, 401);
    assert.equal(
      (
        await fetch(origin + "/api/kovas/directory", {
          method: "POST",
          headers: { Origin: origin },
        })
      ).status,
      401,
    );
    assert.equal((await start("default")).status, 200);
    assert.equal((await fetch(origin + "/api/kovas/directory")).status, 401);
  } finally {
    review.dispose();
    await new Promise((resolve) => review.server.close(resolve));
  }
});

test("private CSP permits only exact bundled PDF worker assets", () => {
  const root = mkdtempSync(join(tmpdir(), "kova-worker-csp-"));
  try {
    assert.equal(packagedPdfWorkerSources(root, "http://127.0.0.1:4191"), "'none'");
    mkdirSync(join(root, "assets"));
    for (const name of [
      "pdf.worker-Ab_12.mjs",
      "pdf.worker-Cd-34.js",
      "document-extraction.worker-Xy_56.js",
      "other-worker.js",
      "pdf.worker-untrusted.txt",
    ])
      writeFileSync(join(root, "assets", name), "// synthetic worker asset");
    assert.equal(
      packagedPdfWorkerSources(root, "http://127.0.0.1:4191"),
      "http://127.0.0.1:4191/assets/document-extraction.worker-Xy_56.js http://127.0.0.1:4191/assets/pdf.worker-Ab_12.mjs http://127.0.0.1:4191/assets/pdf.worker-Cd-34.js",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
