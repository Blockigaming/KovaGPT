import assert from "node:assert/strict";
import test from "node:test";
import { toJSON } from "seroval";
import { parseWorkRunList } from "../src/lib/work-response.mjs";
import {
  createWorkHistoryReviewHandler,
  installWorkHistoryReviewFixture,
  WORK_HISTORY_REVIEW_DISCLOSURE,
  WORK_HISTORY_REVIEW_OPTIONS,
  WORK_HISTORY_REVIEW_SCENARIOS,
  WORK_HISTORY_REVIEW_OWNER as owner,
  WORK_HISTORY_REVIEW_RUN_ID as runId,
} from "./work-history-review-fixture.mjs";

// Pure mocked routes: no packaged app, live requests, browser, full build,
// credentials, or backend. Pending holds are controlled promises, not timers.
const origin = "http://127.0.0.1:4189";
const mutations = [
  "controlWorkRun",
  "saveGraphPreference",
  "renameDeliverable",
  "moveDeliverable",
  "deleteDeliverable",
  "restoreDeliverable",
  "duplicateDeliverable",
  "downloadDeliverable",
  "restoreDeliverableRevision",
  "decideApproval",
];
const functions = ["listWorkRuns", "getWorkRun", ...mutations, "listProjects", "getMyProfile"];
const functionNames = new Map(
  functions.map((name, index) => [
    String(index).padStart(64, "0"),
    `${name}_createServerFn_handler`,
  ]),
);
const functionId = (name) =>
  [...functionNames].find(([, value]) => value.startsWith(name + "_"))[0];
const serialize = (data, context = {}) => JSON.stringify(toJSON({ data, context }));
function setup(scenario = "work-history-detail-sample", wait = async () => "expired") {
  const state = { active: true, waits: [], fulfills: 0 };
  const handler = createWorkHistoryReviewHandler(scenario, functionNames, {
    isActive: () => state.active,
    wait: (signal) => {
      state.waits.push(signal);
      return wait(signal);
    },
  });
  async function invoke(name, data, options = {}) {
    const method = options.method ?? "GET";
    const raw = Object.hasOwn(options, "raw") ? options.raw : serialize(data);
    const url = new URL(options.path ?? `/_serverFn/${functionId(name)}`, options.origin ?? origin);
    if (raw !== null && method === "GET") url.searchParams.set("payload", raw);
    if (options.duplicatePayload) url.searchParams.append("payload", raw);
    if (options.query) url.searchParams.set(options.query, "invalid");
    let response;
    await handler({
      request: () => ({
        url: () => url.href,
        method: () => method,
        headers: () => options.headers ?? {},
        postData: () => options.body ?? (method === "GET" ? null : raw),
        signal: () => options.signal,
      }),
      fulfill: async (value) => {
        state.fulfills += 1;
        response = value;
      },
      fallback: async () => {
        response = { fallback: true };
      },
    });
    return response;
  }
  return { state, invoke };
}
const keys = (value) => Object.keys(value).sort();
const result = async (fixture, name, data) => (await fixture.invoke(name, data)).json.result;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("scenario options are immutable, signed-in only and scoped to the existing Work route", () => {
  assert.equal(WORK_HISTORY_REVIEW_SCENARIOS.length, 7);
  assert.deepEqual(
    WORK_HISTORY_REVIEW_OPTIONS.map(({ id }) => id),
    WORK_HISTORY_REVIEW_SCENARIOS,
  );
  assert.ok(Object.isFrozen(WORK_HISTORY_REVIEW_OPTIONS));
  for (const option of WORK_HISTORY_REVIEW_OPTIONS) {
    assert.equal(option.path, "/work");
    assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
    assert.ok(Object.isFrozen(option) && Object.isFrozen(option.accounts));
  }
  assert.match(WORK_HISTORY_REVIEW_DISCLOSURE, /Synthetic historical Work reads only/);
  assert.match(WORK_HISTORY_REVIEW_DISCLOSURE, /No work starts/);
});

test("factory fails closed for unknown scenarios, absent session/hold and missing contracts", () => {
  const options = { isActive: () => true, wait: async () => "expired" };
  assert.throws(() => createWorkHistoryReviewHandler("default", functionNames, options), /Unknown/);
  assert.throws(
    () => createWorkHistoryReviewHandler("work-history-detail-sample", functionNames),
    /active session/,
  );
  assert.throws(
    () =>
      createWorkHistoryReviewHandler("work-history-list-pending", functionNames, {
        isActive: () => true,
      }),
    /bounded pending hold/,
  );
  assert.throws(
    () => createWorkHistoryReviewHandler("work-history-detail-sample", {}, options),
    /manifest/,
  );
  assert.throws(
    () => createWorkHistoryReviewHandler("work-history-detail-sample", new Map(), options),
    /missing listWorkRuns/,
  );
  const missingDetail = new Map([["one", "listWorkRuns_createServerFn_handler"]]);
  assert.throws(
    () => createWorkHistoryReviewHandler("work-history-detail-sample", missingDetail, options),
    /missing getWorkRun/,
  );
});

test("sample list and detail use the actual historical Work DTO without execution/storage links", async () => {
  const fixture = setup();
  const runs = parseWorkRunList(await result(fixture, "listWorkRuns"));
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.deepEqual(keys(run), [
    "attempts",
    "completedAt",
    "createdAt",
    "error",
    "id",
    "input",
    "kind",
    "maxAttempts",
    "projectId",
    "startedAt",
    "status",
  ]);
  assert.equal(run.id, runId);
  assert.equal(run.kind, "team");
  assert.equal(run.status, "completed");
  assert.equal(run.input.sampleOnly, true);
  assert.match(run.input.disclosure, /fictional/);
  assert.equal(run.projectId, null);
  const detail = await result(fixture, "getWorkRun", { id: runId });
  assert.deepEqual(detail.run, run);
  assert.deepEqual(keys(detail), [
    "approvals",
    "deliverables",
    "edges",
    "events",
    "graphPreference",
    "run",
    "tasks",
  ]);
  assert.equal(detail.tasks.length, 2);
  assert.equal(detail.events.length, 2);
  assert.deepEqual(detail.deliverables, []);
  for (const task of detail.tasks) {
    assert.deepEqual(keys(task), [
      "attempt",
      "completedAt",
      "id",
      "key",
      "maxAttempts",
      "objective",
      "role",
      "startedAt",
      "status",
    ]);
    assert.match(task.role, /Sample/);
    assert.match(task.objective, /Synthetic/);
    assert.equal(task.status, "completed");
  }
  for (const event of detail.events) {
    assert.deepEqual(keys(event), ["createdAt", "id", "payload", "previewUrl", "type"]);
    assert.match(event.payload.title, /Synthetic/);
    assert.equal(event.previewUrl, null);
    assert.equal(event.payload.sampleOnly, true);
  }
  assert.equal(detail.approvals[0].status, "denied");
  assert.equal(detail.approvals[0].request.sampleOnly, true);
  assert.deepEqual(keys(detail.approvals[0]), [
    "createdAt",
    "destination",
    "id",
    "reason",
    "request",
    "risk",
    "runId",
    "status",
    "tool",
  ]);
  assert.deepEqual(keys(detail.edges[0]), [
    "condition",
    "id",
    "metadata",
    "source",
    "target",
    "type",
  ]);
  assert.equal(detail.edges[0].type, "requires");
  assert.ok(detail.tasks.some(({ id }) => id === detail.edges[0].source));
  assert.ok(detail.tasks.some(({ id }) => id === detail.edges[0].target));
  assert.doesNotMatch(JSON.stringify(detail), /https?:|storage_path|downloadUrl/);
  assert.deepEqual(detail.graphPreference, {
    direction: "LR",
    density: "comfortable",
    positions: {},
    pinned: [],
  });
  assert.equal(
    (await fixture.invoke("getWorkRun", { id: runId })).headers["Cache-Control"],
    "no-store",
  );
});

test("successful empty list and empty related collections are distinct actual DTO states", async () => {
  const listEmpty = setup("work-history-list-empty");
  assert.deepEqual(parseWorkRunList(await result(listEmpty, "listWorkRuns")), []);
  assert.equal((await listEmpty.invoke("getWorkRun", { id: runId })).status, 404);
  const detailEmpty = setup("work-history-detail-empty");
  assert.equal((await result(detailEmpty, "listWorkRuns")).length, 1);
  const detail = await result(detailEmpty, "getWorkRun", { id: runId });
  assert.equal(detail.run.id, runId);
  for (const field of ["events", "deliverables", "approvals", "tasks", "edges"])
    assert.deepEqual(detail[field], []);
  assert.equal(detail.graphPreference, null);
});

test("list and detail errors fail only the selected existing read and remain errors on retry", async () => {
  const list = setup("work-history-list-error");
  for (let retry = 0; retry < 2; retry++)
    assert.equal((await list.invoke("listWorkRuns")).status, 503);
  const detail = setup("work-history-detail-error");
  assert.equal((await result(detail, "listWorkRuns")).length, 1);
  for (let retry = 0; retry < 2; retry++) {
    const response = await detail.invoke("getWorkRun", { id: runId });
    assert.equal(response.status, 503);
    assert.match(response.body, /Simulated historical Work read failure/);
    assert.equal(response.json, undefined);
  }
});

test("pending reads use only the parent's bounded signal-aware hold and never return success", async () => {
  for (const [scenario, name, data] of [
    ["work-history-list-pending", "listWorkRuns", undefined],
    ["work-history-detail-pending", "getWorkRun", { id: runId }],
  ]) {
    const gate = deferred();
    const fixture = setup(scenario, () => gate.promise);
    const signal = new AbortController().signal;
    const pending = fixture.invoke(name, data, { signal });
    await Promise.resolve();
    assert.equal(fixture.state.fulfills, 0);
    assert.deepEqual(fixture.state.waits, [signal]);
    if (name === "getWorkRun") assert.equal((await result(fixture, "listWorkRuns")).length, 1);
    gate.resolve("expired");
    const response = await pending;
    assert.equal(response.status, 503);
    assert.match(response.body, /hold ended/);
    assert.equal(response.json, undefined);
  }
});

test("reset, abort, capacity and a rejected hold stay local and fail closed", async () => {
  for (const [reason, expected] of [
    ["reset", 499],
    ["aborted", 499],
    ["capacity", 503],
  ]) {
    const fixture = setup("work-history-list-pending", async () => reason);
    const response = await fixture.invoke("listWorkRuns");
    assert.equal(response.status, expected);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(response.fallback, undefined);
  }
  const failure = setup("work-history-list-pending", async () => {
    throw new Error("hold failed");
  });
  assert.equal((await failure.invoke("listWorkRuns")).status, 503);
  const gate = deferred();
  const inactive = setup("work-history-detail-pending", () => gate.promise);
  const pending = inactive.invoke("getWorkRun", { id: runId });
  inactive.state.active = false;
  gate.resolve("expired");
  assert.equal((await pending).status, 401);
});

test("inactive or mismatched principals cannot read, wait, or mutate the samples", async () => {
  const fixture = setup("work-history-list-pending");
  for (const name of ["listWorkRuns", "getWorkRun", ...mutations]) {
    const data = name === "listWorkRuns" ? undefined : { id: runId };
    assert.equal(
      (await fixture.invoke(name, data, { headers: { "x-kova-owner": "other" } })).status,
      401,
    );
  }
  fixture.state.active = false;
  assert.equal((await fixture.invoke("listWorkRuns")).status, 401);
  assert.deepEqual(fixture.state.waits, []);
  const sample = setup();
  assert.equal(
    (await sample.invoke("getWorkRun", { id: runId }, { headers: { "x-kova-owner": owner } })).json
      .result.run.id,
    runId,
  );
});

test("strict methods and payload guards reject ambiguous, extra, malformed and unbounded reads", async () => {
  const fixture = setup("work-history-list-pending");
  for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"])
    assert.equal((await fixture.invoke("listWorkRuns", undefined, { method })).status, 405);
  for (const options of [
    { raw: "" },
    { raw: "not-json" },
    { raw: "x".repeat(32769) },
    { raw: serialize({ value: "é".repeat(20000) }) },
    { raw: JSON.stringify(toJSON([])) },
    { raw: JSON.stringify(toJSON({ data: undefined, context: {}, extra: true })) },
    { raw: serialize(undefined, { owner }) },
    { duplicatePayload: true },
    { query: "id" },
    { body: "unexpected-get-body" },
  ]) {
    const response = await fixture.invoke("listWorkRuns", undefined, options);
    assert.equal(response.status, 400, JSON.stringify(options).slice(0, 120));
  }
  for (const data of [null, [], "value", { owner }, { id: runId }])
    assert.equal((await fixture.invoke("listWorkRuns", data)).status, 400);
  for (const data of [undefined, null, [], {}, { id: "invalid" }, { id: runId, owner }])
    assert.equal((await fixture.invoke("getWorkRun", data)).status, 400);
  assert.equal((await fixture.invoke("getWorkRun", undefined, { raw: null })).status, 400);
  assert.equal(
    (await fixture.invoke("getWorkRun", { id: "11111111-1111-4111-8111-111111111111" })).status,
    404,
  );
  assert.deepEqual(fixture.state.waits, []);
});

test("no-input list requests accept omitted payload and empty TanStack data", async () => {
  const fixture = setup("work-history-list-empty");
  assert.deepEqual(
    (await fixture.invoke("listWorkRuns", undefined, { raw: null })).json.result,
    [],
  );
  assert.deepEqual((await fixture.invoke("listWorkRuns", {})).json.result, []);
  assert.deepEqual((await fixture.invoke("listWorkRuns", undefined)).json.result, []);
});

test("all historical mutations and Start execution reject without affecting sample data", async () => {
  const fixture = setup();
  const original = await result(fixture, "getWorkRun", { id: runId });
  for (const name of mutations) {
    const response = await fixture.invoke(
      name,
      { id: runId, action: "cancel" },
      { method: "POST" },
    );
    assert.equal(response.status, 405, name);
    assert.match(response.body, /read-only/);
  }
  const start = await fixture.invoke(
    null,
    { operation: "submit" },
    { method: "POST", path: "/api/work/execution" },
  );
  assert.equal(start.status, 405);
  assert.deepEqual(await result(fixture, "getWorkRun", { id: runId }), original);
  assert.deepEqual(fixture.state.waits, []);
});

test("unrelated functions, provider/auth paths, other origins and execution GET keep their existing handler", async () => {
  const fixture = setup();
  for (const name of ["listProjects", "getMyProfile"])
    assert.deepEqual(await fixture.invoke(name), { fallback: true });
  assert.deepEqual(
    await fixture.invoke("listWorkRuns", undefined, { origin: "https://example.invalid" }),
    { fallback: true },
  );
  for (const path of [
    "/api/work/execution",
    "/api/auth/me",
    "/api/generate-image",
    "/api/work/sync",
    "/_serverFn/unknown",
    `/_serverFn/${functionId("listWorkRuns")}/extra`,
  ])
    assert.deepEqual(await fixture.invoke(null, undefined, { path, raw: null }), {
      fallback: true,
    });
});

test("returned objects and installed handlers are isolated from callers and other sessions", async () => {
  const first = setup();
  const second = setup();
  const list = await result(first, "listWorkRuns");
  const detail = await result(first, "getWorkRun", { id: runId });
  list[0].input.objective = "Changed";
  detail.tasks[0].role = "Changed";
  detail.events.length = 0;
  assert.notEqual((await result(first, "listWorkRuns"))[0].input.objective, "Changed");
  assert.notEqual((await result(first, "getWorkRun", { id: runId })).tasks[0].role, "Changed");
  first.state.active = false;
  assert.equal((await second.invoke("getWorkRun", { id: runId })).json.result.events.length, 2);
});

test("installer registers only bounded historical functions and the execution write guard", async () => {
  const registrations = [];
  const names = new Map(functionNames);
  const handler = await installWorkHistoryReviewFixture(
    {
      route: async (pattern, fn) => registrations.push({ pattern, fn }),
    },
    "work-history-list-empty",
    names,
    { isActive: () => true },
  );
  assert.deepEqual(
    registrations.map(({ pattern }) => pattern),
    [origin + "/_serverFn/*", origin + "/api/work/execution"],
  );
  assert.ok(registrations.every(({ fn }) => fn === handler));
  names.clear();
  let response;
  await handler({
    request: () => ({
      url: () => `${origin}/_serverFn/${functionId("listWorkRuns")}`,
      method: () => "GET",
      headers: () => ({}),
      postData: () => null,
    }),
    fulfill: async (value) => {
      response = value;
    },
    fallback: async () => {
      throw new Error("must not fall through");
    },
  });
  assert.deepEqual(response.json.result, []);
});
