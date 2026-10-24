import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { toJSON } from "seroval";
import {
  BACKEND_ORIGIN,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  REVIEW_LOADING_HOLD_MS,
  createFixtureSession,
  createPrivateReviewServer,
  loadReviewPackage,
  reviewDailyUsage,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import {
  ASYNC_READ_REVIEW_OPTIONS,
  REVIEW_LARGE_USAGE_COUNTS,
  USAGE_LARGE_COUNTS_REVIEW_DISCLOSURE,
  createAsyncReadReviewHandler,
} from "./async-read-review-fixture.mjs";
import { DAILY_IMAGE_LIMIT, DAILY_UPLOAD_LIMIT } from "../src/lib/limits.ts";
import {
  WORK_HISTORY_REVIEW_OPTIONS,
  WORK_HISTORY_REVIEW_RUN_ID,
} from "./work-history-review-fixture.mjs";
import { SUPPORT_REVIEW_OPTIONS, SUPPORT_REVIEW_SAMPLE_BODY } from "./support-review-fixture.mjs";
import {
  DIRECTORY_PLUGIN_REVIEW_OPTIONS,
  DIRECTORY_REVIEW_NEXT_CURSOR,
} from "./directory-plugin-review-fixture.mjs";
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const options = [
  ...ASYNC_READ_REVIEW_OPTIONS,
  ...WORK_HISTORY_REVIEW_OPTIONS,
  ...SUPPORT_REVIEW_OPTIONS,
  ...DIRECTORY_PLUGIN_REVIEW_OPTIONS,
];
const defaults = {
  account: "pro",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario: "default",
};
const ownerHeaders = { "x-kova-owner": REVIEW_OWNER };
const settle = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
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
function fnUrl(name, data) {
  const entry = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name);
  assert.ok(entry, `Manifest missing ${name}`);
  const url = new URL(`/_serverFn/${entry[0]}`, FIXTURE_ORIGIN);
  if (data !== undefined)
    url.searchParams.set("payload", JSON.stringify(toJSON({ data, context: {} })));
  return url.href;
}
const fnRead = (session, name, data, extra = {}) =>
  session.registry.dispatch({ url: fnUrl(name, data), ...extra });
const api = (session, path, extra = {}) =>
  session.registry.dispatch({ url: FIXTURE_ORIGIN + path, headers: ownerHeaders, ...extra });
const support = (session, extra = {}) =>
  api(session, "/api/public/help-submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(SUPPORT_REVIEW_SAMPLE_BODY)),
    ...extra,
  });

test("all finite async selections install only through HTTP and respect the account catalog", async () => {
  for (const option of options) {
    await assert.rejects(
      catalog.installReviewState({}, option.id, option.accounts[0]),
      /private HTTP review adapter/,
    );
    for (const account of option.accounts) {
      const session = await createFixtureSession(pkg, {
        ...defaults,
        account,
        scenario: option.id,
      });
      session.dispose();
      assert.equal(session.disposed, true);
    }
    if (!option.accounts.includes("guest"))
      await assert.rejects(
        createFixtureSession(pkg, { ...defaults, account: "guest", scenario: option.id }),
        /requires/,
      );
  }
});

test("Images keeps source capabilities and holds valid generation/edit without accepting writes or foreign owners", async () => {
  const clock = fakeClock(),
    session = await createFixtureSession(
      pkg,
      { ...defaults, scenario: "image-generation-pending" },
      { loadingClock: clock },
    );
  const sources = await api(session, "/api/generate-image?sources=1");
  assert.equal(sources.status, 200);
  assert.equal(sources.json.editingEnabled, true);
  assert.equal(sources.json.images.length, 1);
  const body = { prompt: "Synthetic sample instruction", aspectRatio: "1:1" };
  for (const data of [
    body,
    { ...body, operation: "edit", parentImageId: sources.json.images[0].id },
  ]) {
    const abort = new AbortController();
    const pending = api(session, "/api/generate-image", {
      method: "POST",
      body: Buffer.from(JSON.stringify(data)),
      signal: abort.signal,
    });
    await settle();
    assert.equal(session.loading.pendingCount, 1);
    assert.equal([...clock.timers.values()][0].ms, REVIEW_LOADING_HOLD_MS);
    if (data.operation) abort.abort();
    else clock.expire();
    const result = await pending;
    assert.equal(result.status, data.operation ? 499 : 503);
    assert.equal(result.json.imageUrl, undefined);
    assert.equal(clock.timers.size, 0);
  }
  for (const data of [
    { ...body, provider: "outside" },
    { ...body, prompt: "x".repeat(2001) },
    { ...body, operation: "edit", parentImageId: "foreign" },
  ])
    assert.equal(
      (
        await api(session, "/api/generate-image", {
          method: "POST",
          body: Buffer.from(JSON.stringify(data)),
        })
      ).status,
      400,
    );
  assert.equal(
    (await api(session, "/api/generate-image", { headers: { "x-kova-owner": "other" } })).status,
    401,
  );
  assert.equal(
    (await fnRead(session, "saveImageToLibrary", undefined, { method: "POST" })).status,
    503,
  );
  session.dispose();
  assert.equal((await api(session, "/api/generate-image")).status, 401);
});

test("usage/subscription holds are exact, isolated and disposed; existing billing-unavailable remains error fixture", async () => {
  for (const [scenario, name, data] of [
    ["usage-read-pending", "getMyDailyUsage", undefined],
    ["subscription-read-pending", "getSubscriptionSummary", { environment: "live" }],
  ]) {
    for (const ending of ["expire", "logout", "dispose"]) {
      const clock = fakeClock(),
        session = await createFixtureSession(
          pkg,
          { ...defaults, scenario },
          { loadingClock: clock },
        );
      const pending = fnRead(session, name, data);
      await settle();
      assert.equal(session.loading.pendingCount, 1);
      const independent = await createFixtureSession(pkg, defaults);
      assert.equal((await fnRead(independent, "getMyDailyUsage")).status, 200);
      independent.dispose();
      assert.equal(
        (await fnRead(session, name, data, { headers: { "x-kova-owner": "foreign" } })).status,
        401,
      );
      assert.equal((await fnRead(session, name, data, { method: "POST" })).status, 405);
      assert.equal((await fnRead(session, name, { ownerId: "foreign" })).status, 400);
      if (ending === "expire") clock.expire();
      else if (ending === "logout")
        await session.registry.dispatch({
          url: BACKEND_ORIGIN + "/auth/v1/logout",
          method: "POST",
        });
      else session.dispose();
      assert.equal((await pending).status, ending === "expire" ? 503 : 401);
      assert.equal(clock.timers.size, 0);
      session.dispose();
    }
  }
  for (const [scenario, name, data] of [
    ["usage-read-error", "getMyDailyUsage", undefined],
    ["billing-unavailable", "getSubscriptionSummary", { environment: "live" }],
  ]) {
    const session = await createFixtureSession(pkg, { ...defaults, scenario });
    assert.equal((await fnRead(session, name, data)).status, 503);
    session.dispose();
  }
});

test("large usage preserves the exact UTC DTO and existing Free remaining-count clamp", async () => {
  const snapshot = reviewDailyUsage(Date.parse("2026-12-31T23:59:59.999Z"));
  const handler = createAsyncReadReviewHandler("usage-large-counts", pkg.base.functionNames, {
    isActive: () => true,
    wait: () => assert.fail("Large-count inspection must not hold a request"),
    dailyUsage: () => snapshot,
  });
  let output;
  await handler({
    request: () => ({
      url: () => fnUrl("getMyDailyUsage"),
      headers: () => ownerHeaders,
      method: () => "GET",
      postData: () => null,
    }),
    fulfill: (value) => {
      output = value;
    },
    fallback: () => assert.fail("Large-count inspection must use the isolated fixture"),
  });
  assert.equal(output.status, 200);
  assert.equal(output.headers["Cache-Control"], "no-store");
  assert.deepEqual(output.json, {
    result: {
      date: "2026-12-31",
      ...REVIEW_LARGE_USAGE_COUNTS,
      resetsAt: "2027-01-01T00:00:00.000Z",
    },
    context: {},
  });
  assert.deepEqual([snapshot.chats, snapshot.images, snapshot.uploads], [3, 0, 0]);
  assert.ok(
    Object.values(REVIEW_LARGE_USAGE_COUNTS).every(
      (value) => Number.isSafeInteger(value) && value >= 10_000_000,
    ),
  );
  assert.equal(DAILY_IMAGE_LIMIT, 3);
  assert.equal(DAILY_UPLOAD_LIMIT, 2);
  assert.equal(Math.max(0, DAILY_IMAGE_LIMIT - output.json.result.images), 0);
  assert.equal(Math.max(0, DAILY_UPLOAD_LIMIT - output.json.result.uploads), 0);
  const settings = readFileSync(
    new URL("../src/components/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(settings, /Math\.max\(0, DAILY_IMAGE_LIMIT - usage\.images\)/);
  assert.match(settings, /Math\.max\(0, DAILY_UPLOAD_LIMIT - usage\.uploads\)/);
  assert.match(settings, /Accounting resets at midnight UTC/);
});

test("large usage is a bounded authenticated read for each actual tier; plans and default counts stay unchanged", async () => {
  for (const account of ["free", "plus", "pro"]) {
    const clock = fakeClock();
    const large = await createFixtureSession(
      pkg,
      { ...defaults, account, scenario: "usage-large-counts" },
      { loadingClock: clock },
    );
    const normal = await createFixtureSession(pkg, { ...defaults, account });
    const result = await fnRead(large, "getMyDailyUsage");
    assert.equal(result.status, 200);
    assert.deepEqual(
      [result.json.result.chats, result.json.result.images, result.json.result.uploads],
      Object.values(REVIEW_LARGE_USAGE_COUNTS),
    );
    assert.equal(result.json.result.date, new Date().toISOString().slice(0, 10));
    assert.equal(result.json.result.resetsAt, reviewDailyUsage().resetsAt);
    const ordinary = (await fnRead(normal, "getMyDailyUsage")).json.result;
    assert.deepEqual([ordinary.chats, ordinary.images, ordinary.uploads], [3, 0, 0]);
    const plan = await large.registry.dispatch({
      url: BACKEND_ORIGIN + "/rest/v1/rpc/current_subscription_summary",
      method: "POST",
      body: Buffer.from("{}"),
    });
    assert.equal((plan.json ?? JSON.parse(plan.body)).effectiveTier, account);
    assert.deepEqual(
      plan,
      await normal.registry.dispatch({
        url: BACKEND_ORIGIN + "/rest/v1/rpc/current_subscription_summary",
        method: "POST",
        body: Buffer.from("{}"),
      }),
    );
    assert.deepEqual(
      await fnRead(large, "getSubscriptionSummary", { environment: "live" }),
      await fnRead(normal, "getSubscriptionSummary", { environment: "live" }),
    );
    assert.equal(
      (await fnRead(large, "getMyDailyUsage", undefined, { headers: { "x-kova-owner": "other" } }))
        .status,
      401,
    );
    assert.equal(
      (await fnRead(large, "getMyDailyUsage", undefined, { method: "POST" })).status,
      405,
    );
    assert.equal((await fnRead(large, "getMyDailyUsage", { ownerId: "other" })).status, 400);
    assert.equal(
      (await large.registry.dispatch({ url: fnUrl("getMyDailyUsage") + "?unexpected=1" })).status,
      400,
    );
    assert.equal(
      (await large.registry.dispatch({ url: fnUrl("getMyDailyUsage") + "?payload=%7B" })).status,
      400,
    );
    assert.equal(
      (await fnRead(large, "getMyDailyUsage", undefined, { body: Buffer.from("{}") })).status,
      400,
    );
    assert.equal(large.loading.pendingCount, 0);
    assert.equal(clock.timers.size, 0);
    await large.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
    assert.equal((await fnRead(large, "getMyDailyUsage")).status, 401);
    large.dispose();
    normal.dispose();
  }
});

test("Work, Plugin and public Support overlays win registry precedence and leave other calls fail closed", async () => {
  const work = await createFixtureSession(pkg, {
    ...defaults,
    scenario: "work-history-detail-sample",
  });
  const list = await fnRead(work, "listWorkRuns");
  assert.equal(list.status ?? 200, 200);
  assert.equal(list.json.result[0].id, WORK_HISTORY_REVIEW_RUN_ID);
  const detail = await fnRead(work, "getWorkRun", { id: WORK_HISTORY_REVIEW_RUN_ID });
  assert.equal(detail.status ?? 200, 200);
  assert.equal(detail.json.result.run.id, WORK_HISTORY_REVIEW_RUN_ID);
  assert.equal(
    (await api(work, "/api/work/execution", { method: "POST", body: Buffer.from("{}") })).status,
    405,
  );
  work.dispose();
  for (const scenario of [
    "plugin-status-loading",
    "work-history-list-pending",
    "support-pending",
  ]) {
    const clock = fakeClock(),
      session = await createFixtureSession(pkg, { ...defaults, scenario }, { loadingClock: clock });
    const pending = scenario.startsWith("plugin")
      ? api(session, "/api/google/status")
      : scenario.startsWith("work")
        ? fnRead(session, "listWorkRuns")
        : support(session);
    await settle();
    assert.equal(session.loading.pendingCount, 1);
    session.dispose();
    assert.ok([401, 499].includes((await pending).status));
    assert.equal(clock.timers.size, 0);
  }
  const plugin = await createFixtureSession(pkg, { ...defaults, scenario: "plugin-status-error" });
  assert.equal((await api(plugin, "/api/google/status")).status, 503);
  assert.equal((await fnRead(plugin, "getGitHubManagement")).status, 503);
  plugin.dispose();
  for (const [scenario, status] of [
    ["support-accepted", 200],
    ["support-rejected", 400],
    ["support-uncertain", 503],
  ]) {
    const session = await createFixtureSession(pkg, { ...defaults, account: "guest", scenario });
    const result = await support(session);
    assert.equal(result.status, status);
    assert.equal(result.json.success, status === 200 ? true : undefined);
    session.dispose();
    assert.equal((await support(session)).status, 409);
  }
});

test("HTTP controls disclose synthetic outcomes; cookieless public pagination is reset-scoped and never forwards upstream", async () => {
  let upstreamCalls = 0;
  const review = createPrivateReviewServer({
    pkg,
    port: 6201,
    fetchImpl: async () => {
      upstreamCalls++;
      throw new Error("No upstream fixture requests allowed");
    },
  });
  await review.listen();
  try {
    const control = await fetch(review.origin + "/__local-review"),
      html = await control.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1],
      csrfCookie = control.headers.get("set-cookie").split(";")[0];
    let sessionCookie = "",
      id;
    const open = async (scenario, account = "guest") => {
      const response = await fetch(review.origin + "/__local-review/start", {
        method: "POST",
        headers: {
          Origin: review.origin,
          Cookie: [csrfCookie, sessionCookie].filter(Boolean).join("; "),
        },
        body: new URLSearchParams({ ...defaults, scenario, account, csrf }),
      });
      assert.equal(response.status, 200);
      sessionCookie = response.headers.get("set-cookie").split(";")[0];
      id = sessionCookie.split("=")[1];
      return response.text();
    };
    const directory = (suffix = "") => fetch(review.origin + "/api/kovas/directory" + suffix);
    assert.equal((await directory()).status, 401);
    assert.match(
      await open("assistant-directory-next-page-error"),
      /23 synthetic cards|synthetic interface records/,
    );
    const first = await (await directory()).json();
    assert.equal(first.rows.length, 21);
    const after = "?after=" + DIRECTORY_REVIEW_NEXT_CURSOR;
    assert.equal((await directory(after)).status, 503);
    assert.equal((await (await directory(after)).json()).rows.length, 3);
    assert.equal((await fetch(review.origin + "/api/google/status")).status, 401);
    assert.equal(
      (
        await fetch(review.origin + "/api/kovas/directory", {
          headers: { "sec-fetch-site": "cross-site" },
        })
      ).status,
      403,
    );
    await open("assistant-directory-loading");
    const old = review.sessions.get(id);
    const pending = old.registry.dispatch({ url: FIXTURE_ORIGIN + "/api/kovas/directory" });
    await settle();
    assert.equal(old.loading.pendingCount, 1);
    assert.match(
      await open("support-accepted"),
      /does not mean a real request was accepted or sent/,
    );
    assert.ok([401, 499].includes((await pending).status));
    assert.equal(old.disposed, true);
    assert.equal((await directory()).status, 401);
    const accepted = await fetch(review.origin + "/api/public/help-submit", {
      method: "POST",
      headers: { Origin: review.origin, Cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify(SUPPORT_REVIEW_SAMPLE_BODY),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { success: true });
    const largeControls = await open("usage-large-counts", "free");
    assert.ok(largeControls.includes(USAGE_LARGE_COUNTS_REVIEW_DISCLOSURE));
    assert.doesNotMatch(largeControls, /Daily usage is synthetic: 3 chats/);
    const largeSession = review.sessions.get(id);
    const usageURL = review.origin + new URL(fnUrl("getMyDailyUsage")).pathname;
    const usageRead = () =>
      fetch(usageURL, { headers: { Cookie: sessionCookie, ...ownerHeaders } });
    const largeUsage = await usageRead();
    assert.equal(largeUsage.status, 200);
    assert.equal(largeUsage.headers.get("cache-control"), "no-store");
    const largeBody = await largeUsage.json();
    assert.deepEqual(
      [largeBody.result.chats, largeBody.result.images, largeBody.result.uploads],
      Object.values(REVIEW_LARGE_USAGE_COUNTS),
    );
    assert.match(
      await open("default", "free"),
      /Daily usage is synthetic: 3 chats, 0 images and 0 uploads/,
    );
    assert.equal(largeSession.disposed, true);
    assert.equal((await fnRead(largeSession, "getMyDailyUsage")).status, 401);
    const normalBody = await (await usageRead()).json();
    assert.deepEqual(
      [normalBody.result.chats, normalBody.result.images, normalBody.result.uploads],
      [3, 0, 0],
    );
    assert.equal((await directory()).status, 401);
    assert.equal(upstreamCalls, 0);
  } finally {
    review.dispose();
    await new Promise((resolve) => review.server.close(resolve));
  }
});
