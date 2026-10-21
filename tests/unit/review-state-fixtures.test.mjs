import assert from "node:assert/strict";
import test from "node:test";
import { toJSON } from "seroval";
import {
  createReviewStateHandler,
  installReviewState,
  REVIEW_STATE_OPTIONS,
  REVIEW_STATE_SCENARIOS,
  REVIEW_TASK_ID,
} from "../../review-kit/review-state-fixtures.mjs";
const names = new Map(
  [
    "getSubscriptionSummary",
    "createPortalSession",
    "getOnboarding",
    "saveOnboarding",
    "skipOnboarding",
    "readMemorySources",
    "listProjects",
  ].map((name, index) => [String(index).repeat(64), `${name}_createServerFn_handler`]),
);
const urlFor = (name) =>
  `http://127.0.0.1:4189/_serverFn/${[...names].find(([, value]) => value.startsWith(name + "_"))[0]}`;
async function request(handler, url, method = "GET", data) {
  let result;
  await handler({
    request: () => ({
      url: () => url,
      method: () => method,
      postData: () => JSON.stringify(toJSON({ data, context: {} })),
    }),
    fulfill: (value) => {
      result = value;
    },
    fallback: () => {
      result = "fallback";
    },
  });
  return result;
}
const now = Date.parse("2026-10-17T00:00:00Z");
for (const scenario of [
  "billing-trial-active",
  "billing-trial-canceled",
  "billing-payment-past-due",
  "billing-portal-failure",
]) {
  test(`${scenario} supplies the existing summary contract and never a real portal URL`, async () => {
    const handler = createReviewStateHandler(scenario, "plus", names, now);
    const {
      json: { result },
    } = await request(handler, urlFor("getSubscriptionSummary"));
    assert.equal(result.tier, "plus");
    assert.equal(result.effectiveTier, "plus");
    assert.equal(result.trialing, scenario.startsWith("billing-trial-"));
    assert.equal(result.cancelAtPeriodEnd, scenario === "billing-trial-canceled");
    assert.equal(
      result.status,
      scenario.startsWith("billing-trial-")
        ? "trialing"
        : scenario === "billing-payment-past-due"
          ? "past_due"
          : "active",
    );
    assert.equal(result.currentPeriodEnd, "2026-10-24T00:00:00.000Z");
    assert.equal(result.priceId, null);
    assert.equal(result.billingPortalAvailable, true);
    const portal = await request(handler, urlFor("createPortalSession"), "POST");
    assert.equal(typeof portal.json.result.error, "string");
    assert.equal(portal.json.result.url, undefined);
  });
}
test("billing status failure remains an error rather than a free-plan response", async () => {
  const handler = createReviewStateHandler("billing-unavailable", "free", names, now);
  assert.equal((await request(handler, urlFor("getSubscriptionSummary"))).status, 503);
});
test("new onboarding persists only within its disposable scenario handler", async () => {
  const handler = createReviewStateHandler("onboarding-new", "free", names, now);
  assert.equal((await request(handler, urlFor("getOnboarding"))).json.result.completed, false);
  assert.equal((await request(handler, urlFor("saveOnboarding"), "POST")).json.result.ok, true);
  assert.equal((await request(handler, urlFor("getOnboarding"))).json.result.completed, true);
  const fresh = createReviewStateHandler("onboarding-new", "free", names, now);
  assert.equal((await request(fresh, urlFor("getOnboarding"))).json.result.completed, false);
});
test("onboarding persistence failure does not claim completion", async () => {
  const handler = createReviewStateHandler("onboarding-save-error", "pro", names, now);
  for (const action of ["saveOnboarding", "skipOnboarding"])
    assert.equal((await request(handler, urlFor(action), "POST")).status, 503);
  assert.equal((await request(handler, urlFor("getOnboarding"))).json.result.completed, false);
});
for (const scenario of ["auth-recovery-sent", "auth-recovery-error"]) {
  test(`${scenario} handles only synthetic request responses, never reset credentials`, async () => {
    const handler = createReviewStateHandler(scenario, "guest", names, now);
    for (const url of [
      "http://127.0.0.1:4189/api/auth/recovery/request",
      "https://abcdefghijklmnopqrst.supabase.co/auth/v1/recover",
    ]) {
      const response = await request(handler, url, "POST");
      assert.equal(response.status ?? 200, scenario === "auth-recovery-sent" ? 200 : 503);
      assert.equal(await request(handler, url, "GET"), "fallback");
    }
    assert.equal(
      await request(handler, "http://127.0.0.1:4189/api/auth/recovery/reset", "POST"),
      "fallback",
    );
    assert.equal(
      await request(handler, "https://unrelated.example/auth/v1/recover", "POST"),
      "fallback",
    );
  });
}
test("scenario validation rejects unknown and incompatible account states before installing routes", async () => {
  assert.throws(() => createReviewStateHandler("invented", "free", names), /Unknown/);
  assert.throws(() => createReviewStateHandler("billing-trial-active", "pro", names), /requires/);
  assert.throws(
    () => createReviewStateHandler("billing-portal-failure", "guest", names),
    /requires/,
  );
  await assert.rejects(installReviewState({}, "onboarding-new", "guest"), /requires/);
  const defaultOption = await installReviewState({}, "default", "guest");
  assert.equal(defaultOption.path, null);
  assert.deepEqual(
    REVIEW_STATE_SCENARIOS,
    REVIEW_STATE_OPTIONS.map(({ id }) => id),
  );
});
test("unknown reads, unrelated origins and mutation endpoints fall through to the existing closed fixtures", async () => {
  const handler = createReviewStateHandler("billing-trial-active", "plus", names, now);
  for (const url of [
    urlFor("saveOnboarding"),
    urlFor("getSubscriptionSummary").replace("http://127.0.0.1:4189", "https://remote.example"),
    "http://127.0.0.1:4189/api/payments",
    "http://127.0.0.1:4189/_serverFn/unknown",
  ])
    assert.equal(await request(handler, url), "fallback");
});
test("chat-outputs is an explicit signed-in HTTP review scenario without provider routes", async () => {
  for (const account of ["free", "plus", "pro"]) {
    const option = await installReviewState({}, "chat-outputs", account, { adapter: "http" });
    assert.equal(option.path, "/");
    const handler = createReviewStateHandler("chat-outputs", account, names, now);
    assert.equal(await request(handler, urlFor("getSubscriptionSummary")), "fallback");
    assert.equal(await request(handler, "http://127.0.0.1:4189/api/chat", "POST"), "fallback");
  }
  await assert.rejects(installReviewState({}, "chat-outputs", "guest"), /requires/);
  await assert.rejects(
    installReviewState({}, "chat-outputs", "free"),
    /private HTTP review adapter/,
  );
});

const taskNames = [
  "isScheduledTasksEligible",
  "listScheduledTasks",
  "listScheduledTaskOffers",
  "listScheduledTaskConnections",
  "listScheduledTaskContextOptions",
  "listScheduledTaskResourceOptions",
  "listScheduledTaskRuns",
  "createScheduledTask",
  "updateScheduledTask",
  "deleteScheduledTask",
];
const taskManifest = new Map(
  taskNames.map((name, index) => [index.toString(16).repeat(64), `${name}_createServerFn_handler`]),
);
const taskOwner = "22222222-2222-4222-8222-222222222222";
const taskUrl = (name) =>
  `http://127.0.0.1:4189/_serverFn/${[...taskManifest].find(([, value]) => value.startsWith(name + "_"))[0]}`;
const taskRequest = (handler, name, data = {}) =>
  request(handler, taskUrl(name), "POST", { expectedUserId: taskOwner, ...data });
const newId = "99999999-9999-4999-8999-999999999999";
const mutationId = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const draft = {
  id: newId,
  mutationId: mutationId(1),
  title: "Sample recurrence",
  prompt: "Only a disposable review draft.",
  timezone: "America/New_York",
  localTime: "2026-10-24T09:00",
  repeat: "monthly",
  triggerMode: "time",
  contextRefs: [],
  eventTriggers: [],
};

test("tasks-editor exposes active/paused samples and exact history shapes without scheduling or delivery", async () => {
  const handler = createReviewStateHandler("tasks-editor", "plus", taskManifest, now);
  assert.deepEqual((await taskRequest(handler, "isScheduledTasksEligible")).json.result, {
    eligible: true,
    executionAvailable: true,
  });
  const list = (await taskRequest(handler, "listScheduledTasks")).json.result;
  assert.deepEqual(list.map(({ status }) => status).sort(), ["paused", "scheduled"]);
  const histories = (
    await taskRequest(handler, "listScheduledTaskRuns", { taskId: REVIEW_TASK_ID })
  ).json.result;
  assert.deepEqual(
    histories.map(({ status }) => status),
    ["complete", "failed"],
  );
  assert.ok(
    histories.every(
      (row) =>
        row.result_summary.startsWith("SAMPLE ONLY:") && row.delivery_status === "not_configured",
    ),
  );
  assert.deepEqual((await taskRequest(handler, "listScheduledTaskConnections")).json.result, {
    connections: [],
    grants: [],
  });
  assert.deepEqual((await taskRequest(handler, "listScheduledTaskContextOptions")).json.result, {
    items: [],
    nextCursor: null,
  });
  assert.throws(() => createReviewStateHandler("tasks-editor", "guest", taskManifest), /requires/);
});

for (const account of ["free", "plus", "pro"])
  test(`${account} tasks-editor supports create, edit, history, pause, resume and delete in an isolated review`, async () => {
    const handler = createReviewStateHandler("tasks-editor", account, taskManifest, now);
    const created = (await taskRequest(handler, "createScheduledTask", draft)).json.result;
    assert.equal(created.revision, 1);
    assert.equal(created.status, "scheduled");
    assert.equal(created.timezone, "America/New_York");
    assert.equal(created.repeat, "monthly");
    assert.equal(created.run_at, "2026-10-24T13:00:00.000Z");
    assert.equal(created.next_run_at, null);
    const duplicate = (await taskRequest(handler, "createScheduledTask", draft)).json.result;
    assert.deepEqual(duplicate, created);
    const edited = (
      await taskRequest(handler, "updateScheduledTask", {
        ...draft,
        expectedRevision: 1,
        mutationId: mutationId(2),
        repeat: "weekly",
      })
    ).json.result;
    assert.equal(edited.revision, 2);
    assert.equal(edited.status, "paused");
    assert.equal(edited.repeat, "weekly");
    const stale = await taskRequest(handler, "updateScheduledTask", {
      id: newId,
      mutationId: mutationId(3),
      expectedRevision: 1,
      status: "paused",
    });
    assert.equal(stale.status, 400);
    const paused = (
      await taskRequest(handler, "updateScheduledTask", {
        id: newId,
        mutationId: mutationId(4),
        expectedRevision: 2,
        status: "paused",
      })
    ).json.result;
    assert.equal(paused.status, "paused");
    assert.equal(paused.revision, 3);
    const resumed = (
      await taskRequest(handler, "updateScheduledTask", {
        id: newId,
        mutationId: mutationId(5),
        expectedRevision: 3,
        status: "scheduled",
      })
    ).json.result;
    assert.equal(resumed.status, "scheduled");
    assert.equal(resumed.revision, 4);
    assert.deepEqual(
      (await taskRequest(handler, "listScheduledTaskRuns", { taskId: newId })).json.result,
      [],
    );
    assert.equal(
      (await taskRequest(handler, "listScheduledTaskRuns", { taskId: REVIEW_TASK_ID })).json.result
        .length,
      2,
    );
    const removal = { id: newId, mutationId: mutationId(6), expectedRevision: 4 };
    assert.equal((await taskRequest(handler, "deleteScheduledTask", removal)).json.result.ok, true);
    assert.equal((await taskRequest(handler, "deleteScheduledTask", removal)).json.result.ok, true);
    assert.equal((await taskRequest(handler, "listScheduledTasks")).json.result.length, 2);
    const fresh = createReviewStateHandler("tasks-editor", account, taskManifest, now);
    assert.equal((await taskRequest(fresh, "listScheduledTasks")).json.result.length, 2);
  });

for (const account of ["free", "plus", "pro"])
  test(`${account} Save and pause persists a paused row from the editor's status-free edit payload`, async () => {
    const handler = createReviewStateHandler("tasks-editor", account, taskManifest, now);
    const active = (await taskRequest(handler, "listScheduledTasks")).json.result.find(
      ({ status }) => status === "scheduled",
    );
    const history = (await taskRequest(handler, "listScheduledTaskRuns", { taskId: active.id }))
      .json.result;
    // ScheduledTaskEditor.save sends settings plus identity, with no status field.
    // The real edit RPC owns the transition to paused and revokes execution consent.
    const edit = {
      id: active.id,
      mutationId: mutationId(7),
      expectedRevision: active.revision,
      title: "Saved and paused review task",
      prompt: active.prompt,
      timezone: active.timezone,
      repeat: active.repeat,
      triggerMode: active.trigger_mode,
      contextRefs: active.context_refs,
      eventTriggers: active.event_triggers,
      localTime: active.schedule_local,
    };
    const edited = (await taskRequest(handler, "updateScheduledTask", edit)).json.result;
    assert.equal(edited.title, edit.title);
    assert.equal(edited.status, "paused");
    assert.equal(edited.revision, active.revision + 1);
    assert.equal(edited.next_run_at, null);
    assert.deepEqual((await taskRequest(handler, "updateScheduledTask", edit)).json.result, edited);
    assert.deepEqual(
      (await taskRequest(handler, "listScheduledTasks")).json.result.find(
        ({ id }) => id === active.id,
      ),
      edited,
    );
    assert.deepEqual(
      (await taskRequest(handler, "listScheduledTaskRuns", { taskId: active.id })).json.result,
      history,
    );
    const resumed = (
      await taskRequest(handler, "updateScheduledTask", {
        id: active.id,
        mutationId: mutationId(8),
        expectedRevision: edited.revision,
        status: "scheduled",
      })
    ).json.result;
    assert.equal(resumed.status, "scheduled");
    assert.equal(resumed.revision, edited.revision + 1);
  });

test("task fixtures reject wrong owners, malformed or ambiguous schedules, unsupported connected tasks and reused mutation data", async () => {
  const handler = createReviewStateHandler("tasks-editor", "plus", taskManifest, now);
  assert.equal(
    (await taskRequest(handler, "listScheduledTasks", { expectedUserId: "other-owner" })).status,
    400,
  );
  for (const localTime of ["invalid", "2026-11-01T01:30", "2027-03-14T02:30"]) {
    assert.equal(
      (await taskRequest(handler, "createScheduledTask", { ...draft, localTime })).status,
      400,
    );
  }
  assert.equal(
    (await taskRequest(handler, "createScheduledTask", { ...draft, triggerMode: "event" })).status,
    400,
  );
  await taskRequest(handler, "createScheduledTask", draft);
  assert.equal(
    (
      await taskRequest(handler, "createScheduledTask", {
        ...draft,
        title: "Changed under same mutation",
      })
    ).status,
    400,
  );
});

test("source review memory inspection is synthetic, owner-bound and read-only", async () => {
  const handler = createReviewStateHandler("chat-sources-used", "free", names);
  const data = {
    ownerId: "22222222-2222-4222-8222-222222222222",
    sources: [{ kind: "chat_memory", id: "66666666-6666-4666-8666-666666666666" }],
  };
  const url = (input) =>
    urlFor("readMemorySources") +
    "?payload=" +
    encodeURIComponent(JSON.stringify(toJSON({ data: input, context: {} })));
  const result = await request(handler, url(data));
  assert.match(result.json.result[0].content, /Synthetic.*No personal memory/);
  assert.equal((await request(handler, url({ ...data, ownerId: "other" }))).status, 400);
  assert.equal((await request(handler, url(data), "POST", data)).status, 400);
  assert.equal(
    await request(createReviewStateHandler("default", "free", names), url(data)),
    "fallback",
  );
});

test("bounded many-project picker fixture is read-only and signed-in only", async () => {
  assert.throws(() => createReviewStateHandler("picker-many-projects", "guest", names, now));
  const handler = createReviewStateHandler("picker-many-projects", "free", names, now);
  const response = await request(handler, urlFor("listProjects"));
  assert.equal(response.json.result.length, 9);
  assert.equal(new Set(response.json.result.map((row) => row.id)).size, 9);
  assert.ok(
    response.json.result.every(
      (row) => row.owner_id === "22222222-2222-4222-8222-222222222222" && row.archived_at === null,
    ),
  );
  assert.equal((await request(handler, urlFor("listProjects"), "POST")).status, 405);
});
test("directory recovery fails once then returns verified empty without writes", async () => {
  const handler = createReviewStateHandler("assistant-directory-recovery", "guest", names, now);
  const url = "http://127.0.0.1:4189/api/kovas/directory";
  assert.equal((await request(handler, url)).status, 503);
  assert.deepEqual((await request(handler, url)).json, { rows: [] });
  assert.equal((await request(handler, url, "POST")).status, 405);
  assert.equal(await request(handler, "https://example.invalid/api/kovas/directory"), "fallback");
});

test("last-run unavailable and empty fixtures keep task records distinct and block mutations", async () => {
  for (const scenario of ["tasks-history-error", "tasks-history-empty"]) {
    const handler = createReviewStateHandler(scenario, "free", taskManifest, now);
    assert.equal((await taskRequest(handler, "listScheduledTasks")).json.result.length, 2);
    const history = await taskRequest(handler, "listScheduledTaskRuns", { taskId: REVIEW_TASK_ID });
    if (scenario.endsWith("error")) assert.equal(history.status, 503);
    else assert.deepEqual(history.json.result, []);
    assert.equal((await taskRequest(handler, "createScheduledTask", draft)).status, 405);
    assert.equal((await taskRequest(handler, "listScheduledTasks")).json.result.length, 2);
    assert.throws(() => createReviewStateHandler(scenario, "guest", taskManifest), /requires/);
  }
});
