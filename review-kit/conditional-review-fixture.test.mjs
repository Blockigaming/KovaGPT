import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import {
  CONDITIONAL_REVIEW_OPTIONS,
  createDeveloperConsoleReviewHandler,
  createChatHistoryRecovery,
  HISTORY_RECOVERY_HOLD_MS,
} from "./conditional-review-fixture.mjs";
import {
  BACKEND_ORIGIN,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  PATHS,
  createFixtureSession,
  createConversationFixture,
  loadReviewPackage,
  reviewConversations,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import { createChatHistoryController } from "../src/lib/chat-history-controller.mjs";
import { visibleChatHistory } from "../src/lib/chat-history-state.mjs";
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const root = new URL("../", import.meta.url);
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const defaults = {
  account: "pro",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario: "default",
};
const owner = { "x-kova-owner": REVIEW_OWNER };
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
function fakeClock() {
  let next = 0;
  const timers = new Map();
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
const read = (session, query = "", options = {}) =>
  session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history" + query,
    headers: owner,
    ...options,
  });
const cursor = (page) => `?cursor=${page.nextCursor}&epoch=${page.epoch}`;
async function initial(session) {
  const first = await read(session);
  assert.equal(first.status, 200);
  assert.equal(first.json.records.length, 1);
  assert.equal(first.json.hasMore, true);
  const last = await read(session, cursor(first.json));
  assert.equal(last.status, 200);
  assert.equal(last.json.hasMore, false);
  return { first: first.json, last: last.json };
}
const consoleRead = (session, query = "?limitsPage=0", extra = {}) =>
  session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/developer/console" + query,
    headers: { "x-kova-expected-user": REVIEW_OWNER },
    ...extra,
  });

test("conditional options are explicit signed-in HTTP scenarios; translation routes are selectable without fixtures", async () => {
  for (const option of CONDITIONAL_REVIEW_OPTIONS) {
    await assert.rejects(catalog.installReviewState({}, option.id, "free"), /private HTTP/);
    await assert.rejects(
      createFixtureSession(pkg, { ...defaults, account: "guest", scenario: option.id }),
      /requires/,
    );
    for (const account of option.accounts) {
      const session = await createFixtureSession(pkg, {
        ...defaults,
        account,
        scenario: option.id,
      });
      assert.equal(session.selection.path, option.path);
      session.dispose();
    }
  }
  for (const path of [
    "/translation",
    "/translate",
    "/translate/english-to-french",
    "/developers/console",
  ]) {
    assert.equal(PATHS.filter((value) => value === path).length, 1);
    const session = await createFixtureSession(pkg, { ...defaults, path });
    assert.equal(session.selection.path, path);
    session.dispose();
  }
});

test("developer console matches the real empty DTO and leaves every mutation and adjacent route unchanged", async () => {
  const session = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "developer-console-empty",
  });
  const expected = {
    enabled: false,
    accounts: [],
    projects: [],
    keys: [],
    limits: [],
    usage: [],
    balances: [],
    limitsPage: 0,
    limitsHasMore: false,
  };
  for (const query of ["", "?limitsPage=0"]) {
    const result = await consoleRead(session, query);
    assert.equal(result.status, 200);
    assert.equal(result.headers["Cache-Control"], "no-store");
    assert.deepEqual(result.json, expected);
    result.json.accounts.push("cannot retain");
  }
  const defaultSession = await createFixtureSession(pkg, defaults);
  for (const method of ["POST", "PUT", "DELETE"]) {
    const extra = { method, body: Buffer.from('{"operation":"create_key"}') };
    assert.deepEqual(
      await consoleRead(session, "", extra),
      await consoleRead(defaultSession, "", extra),
    );
  }
  for (const path of ["/api/developer/funding", "/api/developer/files"]) {
    const request = {
      url: FIXTURE_ORIGIN + path,
      headers: { "x-kova-expected-user": REVIEW_OWNER },
    };
    assert.deepEqual(
      await session.registry.dispatch(request),
      await defaultSession.registry.dispatch(request),
    );
  }
  const source = readFileSync(new URL("src/routes/developers.console.tsx", root), "utf8");
  assert.match(source, /X-Kova-Expected-User/);
  assert.match(source, /limitsHasMore: boolean/);
  session.dispose();
  defaultSession.dispose();
});

test("developer first-page reads reject inactive/foreign owners, invalid pages, ambiguity and bodies", async () => {
  const session = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "developer-console-empty",
  });
  for (const headers of [
    {},
    { "x-kova-expected-user": "foreign" },
    { "x-kova-expected-user": REVIEW_OWNER, "x-kova-owner": "foreign" },
  ])
    assert.equal((await consoleRead(session, "", { headers })).status, 401);
  for (const query of [
    "?limitsPage=-1",
    "?limitsPage=1",
    "?limitsPage=10001",
    "?limitsPage=0.5",
    "?limitsPage=NaN",
    "?limitsPage=",
    "?limitsPage=0&limitsPage=0",
    "?owner=other",
    "?limitsPage=00",
  ])
    assert.equal((await consoleRead(session, query)).status, 400);
  assert.equal((await consoleRead(session, "", { body: Buffer.from("{}") })).status, 400);
  const abort = new AbortController();
  abort.abort();
  assert.equal((await consoleRead(session, "", { signal: abort.signal })).status, 499);
  session.dispose();
  assert.equal((await consoleRead(session)).status, 401);
  let fallbacks = 0;
  const handler = createDeveloperConsoleReviewHandler({ isActive: () => true });
  await handler({
    request: () => ({
      url: () => "https://outside.invalid/api/developer/console",
      method: () => "GET",
    }),
    fallback: () => fallbacks++,
  });
  assert.equal(fallbacks, 1);
});

test("history returns original pagination, fails exactly one idle read and delegates an unchanged response after ten seconds", async () => {
  const clock = fakeClock(),
    session = await createFixtureSession(
      pkg,
      { ...defaults, scenario: "chat-history-recovery" },
      { loadingClock: clock },
    );
  const pages = await initial(session);
  assert.deepEqual(
    [pages.first.records[0].payload, pages.last.records[0].payload],
    reviewConversations(),
  );
  assert.equal((await read(session, "?cursor=bad")).status, 400);
  assert.equal(
    (await read(session, cursor(pages.last), { headers: { "x-kova-owner": "foreign" } })).status,
    401,
  );
  assert.equal((await read(session, cursor(pages.last))).status, 503);
  assert.equal((await read(session, "?cursor=invalid")).status, 400);
  assert.equal(clock.timers.size, 0);
  let completed = false;
  const pending = read(session, cursor(pages.last)).then((value) => {
    completed = true;
    return value;
  });
  await settle();
  assert.equal(completed, false);
  assert.equal(session.historyRecovery.pendingCount, 1);
  assert.equal([...clock.timers.values()][0].ms, 10000);
  assert.equal(HISTORY_RECOVERY_HOLD_MS, 10000);
  clock.expire();
  const recovered = await pending;
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.json, { ...pages.last, records: [], reset: false });
  assert.deepEqual(await read(session, cursor(pages.last)), recovered);
  assert.equal(clock.timers.size, 0);
  session.dispose();
});

test("real controller alone emits saved/offline/syncing/saved while retaining records and zero writes", async () => {
  const clock = fakeClock(),
    session = await createFixtureSession(
      pkg,
      { ...defaults, scenario: "chat-history-recovery" },
      { loadingClock: clock },
    ),
    statuses = [],
    methods = [];
  let device = null;
  const controller = createChatHistoryController({
    ownerId: REVIEW_OWNER,
    signal: new AbortController().signal,
    loadDevice: async () => device,
    commitDevice: async (_previous, next) => {
      device = structuredClone(next);
    },
    getLegacy: () => ({ active: reviewConversations(), archived: [] }),
    status: (value) => statuses.push(value),
    transport: async ({ method, cursor: position, epoch, signal }) => {
      methods.push(method);
      assert.equal(method, "GET");
      const output = await read(session, `?cursor=${position}${epoch ? "&epoch=" + epoch : ""}`, {
        signal,
      });
      if (output.status !== 200)
        throw Object.assign(new Error(output.json.error), { status: output.status });
      return output.json;
    },
  });
  await controller.initialize();
  await controller.pump();
  assert.equal(statuses.at(-1).phase, "saved");
  const before = visibleChatHistory(controller.getState());
  await controller.pump();
  assert.equal(statuses.at(-1).phase, "offline");
  assert.equal(statuses.at(-1).pending, 0);
  assert.deepEqual(visibleChatHistory(controller.getState()), before);
  const retry = controller.retry();
  await settle();
  assert.equal(statuses.at(-1).phase, "syncing");
  assert.equal(session.historyRecovery.pendingCount, 1);
  clock.expire();
  await retry;
  assert.equal(statuses.at(-1).phase, "saved");
  assert.deepEqual(visibleChatHistory(controller.getState()), before);
  assert.ok(methods.every((method) => method === "GET"));
  controller.stop();
  session.dispose();
});

test("held history re-reads the same seeded handler so accepted metadata writes are not hidden", async () => {
  const clock = fakeClock(),
    session = await createFixtureSession(
      pkg,
      { ...defaults, scenario: "chat-history-recovery" },
      { loadingClock: clock },
    );
  const pages = await initial(session);
  await read(session, cursor(pages.last));
  const pending = read(session, cursor(pages.last));
  await settle();
  const record = pages.first.records[0];
  const body = {
    id: record.id,
    mutationId: crypto.randomUUID(),
    epoch: pages.first.epoch,
    expectedRevision: record.revision,
    payload: {
      ...record.payload,
      title: "Synthetic retained rename",
      updatedAt: record.payload.updatedAt + 1,
    },
    archived: false,
  };
  const written = await read(session, "", {
    method: "POST",
    body: Buffer.from(JSON.stringify(body)),
  });
  assert.equal(written.status, 200);
  clock.expire();
  const recovered = await pending;
  assert.equal(recovered.json.records[0].payload.title, body.payload.title);
  assert.equal(recovered.json.records[0].revision, 2);
  assert.equal(
    (
      await read(session, "", {
        method: "POST",
        body: Buffer.from(
          JSON.stringify({ ...body, id: crypto.randomUUID(), mutationId: crypto.randomUUID() }),
        ),
      })
    ).status,
    503,
  );
  session.dispose();
});

test("abort, logout, disposal and concurrent capacity clean timers/listeners without accepting stale reads", async () => {
  for (const end of ["abort", "logout", "dispose"]) {
    const clock = fakeClock(),
      session = await createFixtureSession(
        pkg,
        { ...defaults, scenario: "chat-history-recovery" },
        { loadingClock: clock },
      );
    const { last } = await initial(session);
    await read(session, cursor(last));
    const abort = new AbortController(),
      pending = read(session, cursor(last), { signal: abort.signal });
    await settle();
    assert.equal(getEventListeners(abort.signal, "abort").length, 1);
    if (end === "abort") abort.abort();
    else if (end === "logout")
      await session.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
    else session.dispose();
    assert.equal((await pending).status, end === "abort" ? 499 : 401);
    assert.equal(clock.timers.size, 0);
    assert.equal(getEventListeners(abort.signal, "abort").length, 0);
    if (end === "abort") {
      const retry = read(session, cursor(last));
      await settle();
      clock.expire();
      assert.equal((await retry).status, 200);
    }
    session.dispose();
  }
  const clock = fakeClock(),
    session = await createFixtureSession(
      pkg,
      { ...defaults, scenario: "chat-history-recovery" },
      { loadingClock: clock },
    );
  const { last } = await initial(session);
  await read(session, cursor(last));
  const requests = Array.from({ length: 64 }, () => read(session, cursor(last)));
  await settle();
  assert.equal(session.historyRecovery.pendingCount, 64);
  assert.equal((await read(session, cursor(last))).status, 503);
  session.dispose();
  assert.ok((await Promise.all(requests)).every((result) => result.status === 401));
  assert.equal(clock.timers.size, 0);
});

test("history scenario session reset is independent; default remains immediate and foreign routes do not enter the wrapper", async () => {
  const old = await createFixtureSession(pkg, { ...defaults, scenario: "chat-history-recovery" }),
    fresh = await createFixtureSession(pkg, { ...defaults, scenario: "chat-history-recovery" }),
    normal = await createFixtureSession(pkg, defaults);
  const { last } = await initial(old);
  assert.equal((await read(old, cursor(last))).status, 503);
  await initial(fresh);
  const normalPages = await initial(normal);
  assert.equal((await read(normal, cursor(normalPages.last))).status, 200);
  old.dispose();
  assert.equal((await read(old, cursor(last))).status, 401);
  let called = 0;
  const wrapper = createChatHistoryRecovery({
    handler: createConversationFixture(),
    isActive: () => true,
  });
  await wrapper.handler({
    request: () => ({ url: () => "https://outside.invalid/api/chat/history", method: () => "GET" }),
    fallback: () => called++,
  });
  assert.equal(called, 1);
  wrapper.dispose();
  fresh.dispose();
  normal.dispose();
});
