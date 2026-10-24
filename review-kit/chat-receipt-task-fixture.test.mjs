import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { toJSON } from "seroval";
import {
  FIXTURE_ORIGIN,
  BACKEND_ORIGIN,
  REVIEW_OWNER,
  FixtureRegistry,
  createFixtureSession,
  loadReviewPackage,
  reviewConversations,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import { normalizeTaskCreatedReceipt } from "../src/lib/task-created-receipt.mjs";
import { parseTaskPayload } from "../src/lib/scheduled-task-policy.mjs";
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const taskId = catalog.CHAT_RECEIPT_TASK_ID;
const selection = {
  account: "pro",
  theme: "dark",
  path: "/",
  size: "desktop",
  state: "populated",
  scenario: "chat-copy-task",
};
const owner = { expectedUserId: REVIEW_OWNER };
const reads = new Set([
  "isScheduledTasksEligible",
  "listScheduledTasks",
  "listScheduledTaskOffers",
  "listScheduledTaskConnections",
  "listScheduledTaskContextOptions",
  "listScheduledTaskRuns",
]);
function url(name) {
  const item = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name);
  assert.ok(item, `Packaged ${name} contract required`);
  return FIXTURE_ORIGIN + "/_serverFn/" + item[0];
}
const invoke = (session, name, data = owner, extra = {}) =>
  session.registry.dispatch({
    url: url(name),
    method: "POST",
    body: Buffer.from(JSON.stringify(toJSON({ data, context: {} }))),
    ...extra,
  });
const list = async (session) => {
  const response = await invoke(session, "listScheduledTasks");
  assert.equal(response.status, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  return response.json.result;
};
function isolated({
  account = "pro",
  now = Date.parse("2026-10-19T12:00:00Z"),
  isActive = () => true,
} = {}) {
  const registry = new FixtureRegistry();
  const handler = catalog.createChatReceiptTaskReadHandler(
    "chat-copy-task",
    account,
    pkg.base.functionNames,
    { isActive, now },
  );
  registry.route("**/*", handler);
  return { registry, handler, now };
}

test("receipt resolves to exactly the existing owner-bound ScheduledTask row with its established title/schedule", async () => {
  const sample = isolated();
  const receipt = normalizeTaskCreatedReceipt(
    reviewConversations("chat-copy-task")[0].messages[1].activities[0].taskReceipt,
  );
  assert.deepEqual(receipt, { operation: "created", source: "persisted-result", taskId });
  const rows = await list(sample);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, receipt.taskId);
  const seeded = catalog
    .createReviewTaskScenario(sample.now)("listScheduledTasks", {
      method: () => "POST",
      postData: () => JSON.stringify(toJSON({ data: owner, context: {} })),
    })
    .find((row) => row.id === taskId);
  assert.deepEqual(rows[0], seeded);
  assert.equal(rows[0].title, "Synthetic active task — never executes");
  assert.equal(rows[0].repeat, "daily");
  assert.equal(rows[0].timezone, "UTC");
  assert.equal(rows[0].run_at, "2026-10-26T12:00:00.000Z");
  assert.equal(rows[0].schedule_local, "2026-10-26T12:00:00");
  const fields = source("src/lib/scheduled-tasks.functions.ts")
    .match(/const fields =\s*"([^"]+)"/)[1]
    .split(",");
  assert.deepEqual(Object.keys(rows[0]).sort(), fields.sort());
  assert.doesNotThrow(() =>
    parseTaskPayload({
      title: rows[0].title,
      prompt: rows[0].prompt,
      repeat: rows[0].repeat,
      timezone: rows[0].timezone,
      localTime: rows[0].schedule_local,
      triggerMode: rows[0].trigger_mode,
      contextRefs: rows[0].context_refs,
      eventTriggers: rows[0].event_triggers,
    }),
  );
  rows[0].title = "cannot mutate fixture";
  assert.deepEqual((await list(sample))[0], seeded);
  const route = source("src/routes/scheduled-tasks.tsx");
  assert.match(route, /tasks.find\(\(task\) => task.id === requestedTaskId\)/);
  assert.match(route, /openTaskEditor\(selected, "settings", null\)/);
});

test("eligibility is honestly non-executing; exact task history and dependency reads are empty", async () => {
  const sample = isolated();
  const expected = new Map([
    [
      "isScheduledTasksEligible",
      { eligible: true, executionAvailable: false, reason: "generation_disabled" },
    ],
    ["listScheduledTaskOffers", { sent: [], received: [] }],
    ["listScheduledTaskConnections", { connections: [], grants: [] }],
  ]);
  for (const [name, result] of expected)
    assert.deepEqual((await invoke(sample, name)).json, { result, context: {} });
  for (const kind of ["library", "project_file"])
    assert.deepEqual(
      (await invoke(sample, "listScheduledTaskContextOptions", { ...owner, kind, after: null }))
        .json.result,
      { items: [], nextCursor: null },
    );
  for (const before of [undefined, "2026-10-19T12:00:00.000Z"]) {
    const response = await invoke(sample, "listScheduledTaskRuns", {
      ...owner,
      taskId,
      ...(before ? { before } : {}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.json.result, []);
  }
  const task = (await list(sample))[0];
  for (const field of ["last_run_at", "last_result", "last_error"]) assert.equal(task[field], null);
});

test("only chat-copy-task installs the read overlay for Free/Plus/Pro; unconfirmed and default stay unchanged", async () => {
  await assert.rejects(createFixtureSession(pkg, { ...selection, account: "guest" }), /requires/);
  for (const account of ["free", "plus", "pro"])
    for (const state of ["populated", "empty", "error", "loading"]) {
      const session = await createFixtureSession(pkg, { ...selection, account, state });
      assert.equal(session.selection.path, "/");
      assert.equal((await list(session))[0].id, taskId);
      assert.equal(
        (await invoke(session, "isScheduledTasksEligible")).json.result.executionAvailable,
        false,
      );
      session.dispose();
    }
  const normal = await createFixtureSession(pkg, { ...selection, scenario: "default" });
  const unconfirmed = await createFixtureSession(pkg, {
    ...selection,
    scenario: "chat-task-unconfirmed",
  });
  assert.equal(
    normalizeTaskCreatedReceipt(
      reviewConversations("chat-task-unconfirmed")[0].messages[1].activities[0].taskReceipt,
    ),
    null,
  );
  for (const name of ["listScheduledTasks", "isScheduledTasksEligible", "createScheduledTask"])
    assert.deepEqual(await invoke(unconfirmed, name), await invoke(normal, name));
  assert.ok(
    !(await invoke(unconfirmed, "listScheduledTasks")).json.result.some(
      (task) => task.id === taskId,
    ),
  );
  normal.dispose();
  unconfirmed.dispose();
});

test("method, owner, payload and task identity guards reject unsupported reads", async () => {
  const sample = isolated();
  for (const data of [{}, { expectedUserId: "foreign" }])
    assert.equal((await invoke(sample, "listScheduledTasks", data)).status, 401);
  assert.equal(
    (await invoke(sample, "listScheduledTasks", owner, { headers: { "x-kova-owner": "foreign" } }))
      .status,
    401,
  );
  for (const method of ["GET", "PUT", "DELETE"])
    assert.equal((await invoke(sample, "listScheduledTasks", owner, { method })).status, 405);
  for (const body of [
    Buffer.from("{"),
    Buffer.alloc(8193, "x"),
    Buffer.from(JSON.stringify(toJSON({ data: owner, context: { other: true } }))),
    Buffer.from(JSON.stringify(toJSON({ data: owner, extra: true }))),
  ])
    assert.equal((await invoke(sample, "listScheduledTasks", owner, { body })).status, 400);
  assert.equal((await invoke(sample, "listScheduledTasks", { ...owner, taskId })).status, 400);
  assert.equal(
    (
      await invoke(sample, "listScheduledTasks", owner, {
        url: url("listScheduledTasks") + "?payload=unused",
      })
    ).status,
    400,
  );
  for (const data of [
    { ...owner },
    { ...owner, taskId: "bad" },
    { ...owner, taskId, before: "yesterday" },
    { ...owner, taskId, cursor: "invented" },
  ])
    assert.equal((await invoke(sample, "listScheduledTaskRuns", data)).status, 400);
  assert.equal(
    (await invoke(sample, "listScheduledTaskRuns", { ...owner, taskId: catalog.REVIEW_TASK_ID }))
      .status,
    404,
  );
  assert.equal(
    (await invoke(sample, "listScheduledTaskContextOptions", { ...owner, kind: "connected" }))
      .status,
    400,
  );
  assert.equal(
    (
      await invoke(sample, "listScheduledTaskContextOptions", {
        ...owner,
        kind: "library",
        after: catalog.REVIEW_TASK_ID,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await invoke(sample, "listScheduledTaskResourceOptions", {
        ...owner,
        grantId: catalog.REVIEW_TASK_ID,
      })
    ).status,
    405,
  );
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    (await invoke(sample, "listScheduledTasks", owner, { signal: abort.signal })).status,
    499,
  );
  assert.equal((await list(sample)).length, 1);
});

test("every packaged scheduled-task mutation remains blocked and the matching record cannot change", async () => {
  const sample = isolated();
  const before = await list(sample);
  const mutations = [
    ...new Set(
      [...pkg.base.functionNames.values()]
        .map((name) => name.split("_")[0])
        .filter((name) => name.includes("ScheduledTask") && !reads.has(name)),
    ),
  ];
  for (const name of [
    "createScheduledTask",
    "updateScheduledTask",
    "deleteScheduledTask",
    "offerScheduledTaskCopy",
    "decideScheduledTaskCopy",
    "grantScheduledTaskConnection",
    "revokeScheduledTaskConnection",
  ])
    assert.ok(mutations.includes(name));
  for (const name of mutations) {
    const result = await invoke(sample, name, {
      ...owner,
      id: taskId,
      expectedRevision: 1,
      mutationId: "abababab-abab-4bab-8bab-abababababab",
      title: "should not be saved",
      status: "paused",
    });
    assert.equal(result.status, 405, name);
    assert.match(result.json.error, /read-only/);
  }
  assert.deepEqual(await list(sample), before);
});

test("inactive/logout/reset sessions and unrelated routes cannot use this task read", async () => {
  let active = true;
  const sample = isolated({ isActive: () => active });
  assert.equal((await list(sample)).length, 1);
  active = false;
  assert.equal((await invoke(sample, "listScheduledTasks")).status, 401);
  const session = await createFixtureSession(pkg, selection);
  await session.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
  assert.equal((await invoke(session, "listScheduledTasks")).status, 401);
  const reset = await createFixtureSession(pkg, selection);
  assert.equal((await list(reset)).length, 1);
  reset.dispose();
  assert.equal((await invoke(reset, "listScheduledTaskRuns", { ...owner, taskId })).status, 401);
  let fallbacks = 0;
  for (const path of [
    url("listScheduledTasks").replace(FIXTURE_ORIGIN, "https://outside.invalid"),
    url("listScheduledTasks") + "/extra",
    FIXTURE_ORIGIN + "/_serverFn/unknown",
    FIXTURE_ORIGIN + "/api/scheduled-tasks",
  ])
    await sample.handler({ request: () => ({ url: () => path }), fallback: () => fallbacks++ });
  assert.equal(fallbacks, 4);
  for (const scenario of ["default", "chat-task-unconfirmed"])
    assert.throws(
      () =>
        catalog.createChatReceiptTaskReadHandler(scenario, "pro", pkg.base.functionNames, {
          isActive: () => true,
        }),
      /exact/,
    );
});
