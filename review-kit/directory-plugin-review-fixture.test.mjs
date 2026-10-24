import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { toJSON } from "seroval";
import { findKnownGoogleScheduleDependencies as findDependencies } from "../src/lib/google-schedule-dependencies.ts";
import { googleConnectionHealth } from "../src/lib/google-account-policy.mjs";
import { parseTaskContext, parseTaskTriggers } from "../src/lib/scheduled-task-policy.mjs";
import * as reviewCatalog from "./review-state-fixtures.mjs";
import {
  createDirectoryPluginReviewHandler,
  DIRECTORY_PLUGIN_REVIEW_OPTIONS,
  DIRECTORY_PLUGIN_REVIEW_SCENARIOS,
  DIRECTORY_PLUGIN_REVIEW_DISCLOSURE,
  DIRECTORY_PLUGIN_REVIEW_OWNER as owner,
  DIRECTORY_REVIEW_NEXT_CURSOR as cursor,
} from "./directory-plugin-review-fixture.mjs";

// Mock requests only: no browser, listener, compilation, provider or live call.
const origin = "http://127.0.0.1:4189";
const names = [
  "getGitHubManagement",
  "refreshGitHubInstallations",
  "updateGitHubRepositoryGrants",
  "disconnectGitHub",
  "listProjects",
  "getGoogleStatus",
  "getGmailSummary",
  "getCalendarSummary",
  "listScheduledTasks",
  "listScheduledTaskConnections",
  "createScheduledTask",
  "updateScheduledTask",
  "deleteScheduledTask",
  "grantScheduledTaskConnection",
  "revokeScheduledTaskConnection",
  "offerScheduledTaskCopy",
  "decideScheduledTaskCopy",
  "listScheduledTaskResourceOptions",
];
const functionNames = new Map(
  names.map((name, index) => [String(index).padStart(64, "0"), `${name}_createServerFn_handler`]),
);
const functionPath = (name) =>
  "/_serverFn/" + [...functionNames].find(([, value]) => value.startsWith(name + "_"))[0];
const directoryPath = "/api/kovas/directory";
const nextPath = directoryPath + "?after=" + cursor;
const serialize = (value) => JSON.stringify(toJSON(value));
function fixture(scenario = "assistant-directory-populated", options = {}) {
  const state = { active: true, waits: [] };
  const handler = createDirectoryPluginReviewHandler(
    scenario,
    options.account ?? (scenario.startsWith("plugin-") ? "free" : "guest"),
    functionNames,
    {
      isActive: () => state.active,
      wait: async (signal) => {
        state.waits.push(signal);
        return options.wait ? options.wait(signal) : "expired";
      },
    },
  );
  async function request(path, options = {}) {
    let output;
    await handler({
      request: () => ({
        url: () => new URL(path, options.origin ?? origin).href,
        method: () => options.method ?? "GET",
        headers: () => options.headers ?? {},
        postData: () => options.body ?? null,
        signal: () => options.signal,
      }),
      fulfill: async (value) => {
        output = value;
      },
      fallback: async () => {
        output = { fallback: true };
      },
    });
    return output;
  }
  return { state, request };
}
const googleHeaders = { "x-kova-owner": owner };
const google = (review, options) =>
  review.request("/api/google/status", { headers: googleHeaders, ...options });
const github = (review, options) => review.request(functionPath("getGitHubManagement"), options);
function rejected(result, status = 503) {
  assert.equal(result.status, status);
  assert.equal(typeof result.json.error, "string");
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.json.rows, undefined);
  assert.equal(result.json.result, undefined);
  assert.equal(result.json.url, undefined);
}

test("finite options freeze account scope, use actual pages, and disclose synthetic boundaries", () => {
  assert.equal(DIRECTORY_PLUGIN_REVIEW_OPTIONS.length, 14);
  assert.equal(new Set(DIRECTORY_PLUGIN_REVIEW_SCENARIOS).size, 14);
  assert.ok(Object.isFrozen(DIRECTORY_PLUGIN_REVIEW_OPTIONS));
  for (const option of DIRECTORY_PLUGIN_REVIEW_OPTIONS) {
    assert.ok(Object.isFrozen(option));
    assert.ok(Object.isFrozen(option.accounts));
    assert.equal(
      option.path,
      option.id.startsWith("assistant-")
        ? "/assistants"
        : option.id.includes("-return-")
          ? "/apps?google_connected=1"
          : "/apps",
    );
    assert.equal(option.accounts.includes("guest"), option.id.startsWith("assistant-"));
  }
  for (const text of ["synthetic", "cookieless", "static", "OAuth", "timeout"])
    assert.ok(DIRECTORY_PLUGIN_REVIEW_DISCLOSURE.includes(text));
});

const dependencyScenarios = [
  "plugin-google-disconnect-known",
  "plugin-google-disconnect-error",
  "plugin-google-disconnect-partial-empty",
];
const dependencyRead = (review, name, options = {}) =>
  review.request(functionPath(name), {
    method: "POST",
    body: serialize({ data: { expectedUserId: owner }, context: {} }),
    ...options,
  });
const dependencySnapshot = async (review) => ({
  status: (await google(review)).json,
  tasks: (await dependencyRead(review, "listScheduledTasks")).json.result,
  connections: (await dependencyRead(review, "listScheduledTaskConnections")).json.result,
});

test("disconnect options are controller-visible, signed-in and private HTTP only", async () => {
  for (const scenario of dependencyScenarios) {
    const option = DIRECTORY_PLUGIN_REVIEW_OPTIONS.find(({ id }) => id === scenario);
    assert.equal(option.path, "/apps");
    assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
    assert.deepEqual(
      reviewCatalog.REVIEW_STATE_OPTIONS.find(({ id }) => id === scenario),
      option,
    );
    assert.throws(() => fixture(scenario, { account: "guest" }), /eligible/);
    await assert.rejects(
      reviewCatalog.installReviewState({}, scenario, "free"),
      /private HTTP review adapter/,
    );
    for (const account of option.accounts)
      assert.equal((await google(fixture(scenario, { account }))).status, 200);
  }
  for (const missing of ["listScheduledTasks", "listScheduledTaskConnections"])
    assert.throws(
      () =>
        createDirectoryPluginReviewHandler(
          dependencyScenarios[0],
          "free",
          new Map([...functionNames].filter(([, value]) => !value.startsWith(missing + "_"))),
          { isActive: () => true, wait: async () => "expired" },
        ),
      new RegExp("missing " + missing),
    );
  for (const phrase of [
    ".invalid",
    "then Cancel",
    "do not confirm",
    "Partial-empty",
    "POST Seroval",
    "expired/revoked",
    "projects",
  ])
    assert.ok(DIRECTORY_PLUGIN_REVIEW_DISCLOSURE.includes(phrase));
});

test("disconnect status mirrors actual Google account health with synthetic identities and no credentials", async () => {
  const review = fixture(dependencyScenarios[0]);
  const { status, connections, tasks } = await dependencySnapshot(review);
  assert.equal(status.connected, true);
  assert.equal(status.state, "connected");
  assert.equal(status.accounts.length, 2);
  assert.equal(status.selectedConnectionId, status.accounts[0].id);
  assert.equal(status.selectionRevision, 1);
  assert.equal(status.email, "synthetic-google-primary@example.invalid");
  for (const account of status.accounts) {
    assert.match(account.email, /^synthetic-google-.+@example\.invalid$/);
    assert.deepEqual(
      account,
      googleConnectionHealth(
        {
          id: account.id,
          credential_revision: account.connectionRevision,
          email: account.email,
          google_sub: "synthetic-google-sub",
          scopes: account.scopes.join(" "),
          expires_at: "2099-01-01T00:00:00.000Z",
          reauthorization_required: false,
          has_refresh_token: false,
        },
        Date.parse("2026-10-19T00:00:00Z"),
      ),
    );
  }
  assert.deepEqual(
    connections.connections.map(({ id }) => id),
    status.accounts.map(({ id }) => id),
  );
  for (const task of tasks) {
    assert.match(task.title, /^Synthetic .+sample only$/);
    assert.equal(task.status, "paused");
    assert.equal(task.next_run_at, null);
    assert.deepEqual(parseTaskContext(task.context_refs), task.context_refs);
    assert.deepEqual(parseTaskTriggers(task.event_triggers), task.event_triggers);
  }
  const serialized = JSON.stringify({ status, connections, tasks });
  assert.doesNotMatch(
    serialized,
    /access_token|refresh_token|client_secret|token_ciphertext|authorization_url/,
  );
  const gitHubStatus = await github(review);
  assert.deepEqual(gitHubStatus.json.result, {
    configured: false,
    accounts: [],
    installations: [],
    repositories: [],
    health: "credentials_not_configured",
  });
});

test("known fixture joins exact Gmail grant to account and task IDs, deduplicating context plus trigger", async () => {
  const review = fixture(dependencyScenarios[0]);
  const { status, tasks, connections } = await dependencySnapshot(review);
  const primary = status.selectedConnectionId;
  const grant = connections.grants.find(
    (grant) => grant.provider === "gmail" && grant.connection_ref === primary,
  );
  assert.ok(grant);
  assert.equal(tasks[0].context_refs[0].grantId, grant.id);
  assert.equal(tasks[0].event_triggers[0].grantId, grant.id);
  assert.equal(tasks[1].event_triggers[0].grantId, grant.id);
  const matching = findDependencies(primary, tasks, connections.grants);
  assert.equal(matching.knownCount, 2);
  assert.deepEqual(
    matching.schedules,
    tasks.slice(0, 2).map(({ id, title }) => ({
      id,
      title,
      href: `/scheduled-tasks?taskId=${id}`,
    })),
  );
  assert.deepEqual(
    matching.schedules.map(({ title }) => title),
    ["Synthetic inbox digest · sample only", "Synthetic mail alert · sample only"],
  );
  assert.deepEqual(
    findDependencies(status.accounts[1].id, tasks, connections.grants).schedules.map(
      ({ id }) => id,
    ),
    [tasks[2].id],
  );
  for (const change of [
    { provider: "github" },
    { connection_ref: status.accounts[1].id },
    { id: primary },
    { expires_at: "2020-01-01T00:00:00.000Z" },
  ])
    assert.equal(
      findDependencies(
        primary,
        tasks,
        connections.grants.map((row) => (row.id === grant.id ? { ...row, ...change } : row)),
      ).knownCount,
      0,
    );
  assert.equal(review.state.waits.length, 0);
});

test("unknown dependencies remain errors, while partial-empty retains tasks without claiming complete absence", async () => {
  const unknown = fixture(dependencyScenarios[1]);
  assert.equal((await google(unknown)).json.connected, true);
  for (const name of ["listScheduledTasks", "listScheduledTaskConnections"]) {
    const first = await dependencyRead(unknown, name);
    rejected(first);
    assert.match(first.json.error, /could not be checked/);
    assert.deepEqual(await dependencyRead(unknown, name), first);
  }
  const known = await dependencySnapshot(fixture(dependencyScenarios[0]));
  const partial = await dependencySnapshot(fixture(dependencyScenarios[2]));
  assert.deepEqual(partial.status, known.status);
  assert.deepEqual(partial.tasks, known.tasks);
  assert.ok(partial.tasks.length > 0);
  assert.ok(partial.connections.grants.length > 0);
  assert.equal(
    findDependencies(partial.status.selectedConnectionId, partial.tasks, partial.connections.grants)
      .knownCount,
    0,
  );
  assert.equal(
    findDependencies(partial.status.accounts[1].id, partial.tasks, partial.connections.grants)
      .knownCount,
    1,
  );
});

test("dependency reads preserve declared POST methods and bounded exact Seroval owner envelopes", async () => {
  const source = readFileSync("src/lib/scheduled-tasks.functions.ts", "utf8");
  for (const name of ["listScheduledTasks", "listScheduledTaskConnections"]) {
    assert.match(
      source,
      new RegExp(`export const ${name} = createServerFn\\(\\{ method: "POST" \\}\\)`),
    );
    const review = fixture(dependencyScenarios[0]);
    const response = await dependencyRead(review, name);
    assert.equal(response.status, 200);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.deepEqual(Object.keys(response.json), ["result", "context"]);
    assert.deepEqual(response.json.context, {});
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD"])
      rejected(await dependencyRead(review, name, { method }), 405);
    rejected(await dependencyRead(review, name, { headers: { "x-kova-owner": "other" } }), 401);
    rejected(
      await dependencyRead(review, name, {
        body: serialize({ data: { expectedUserId: "other" }, context: {} }),
      }),
      401,
    );
    for (const body of [
      null,
      "",
      "bad-json",
      "x".repeat(4097),
      serialize({ data: { expectedUserId: owner }, context: {}, extra: true }),
      serialize({ data: { expectedUserId: owner, id: owner }, context: {} }),
      serialize({ data: { expectedUserId: owner }, context: { userId: owner } }),
      serialize({ data: { expectedUserId: owner }, context: null }),
      serialize({ data: { expectedUserId: 1 }, context: {} }),
      serialize({ data: {}, context: {} }),
      serialize({ data: [], context: {} }),
      serialize({ data: null, context: {} }),
      serialize({ data: owner, context: {} }),
      serialize({}),
      serialize([]),
      serialize(null),
      JSON.stringify({ data: { expectedUserId: owner }, context: {} }),
    ])
      rejected(await dependencyRead(review, name, { body }), 400);
    for (const query of [
      "?payload=" + encodeURIComponent(serialize({ data: { expectedUserId: owner } })),
      "?owner=" + owner,
      "?payload=a&payload=b",
    ])
      rejected(
        await review.request(functionPath(name) + query, {
          method: "POST",
          body: serialize({ data: { expectedUserId: owner }, context: {} }),
        }),
        400,
      );
    assert.equal(
      (
        await dependencyRead(review, name, {
          body: serialize({ data: { expectedUserId: owner } }),
          headers: googleHeaders,
        })
      ).status,
      200,
    );
  }
});

test("synthetic connected status retains strict Google owner, GET and no-input validation", async () => {
  for (const scenario of dependencyScenarios) {
    const review = fixture(scenario);
    rejected(await google(review, { headers: {} }), 401);
    rejected(await google(review, { headers: { "x-kova-owner": "other" } }), 401);
    rejected(await google(review, { method: "POST" }), 405);
    rejected(await google(review, { body: "{}" }), 400);
    rejected(
      await review.request("/api/google/status?owner=" + owner, { headers: googleHeaders }),
      400,
    );
    rejected(await github(review, { headers: { "x-kova-owner": "other" } }), 401);
    rejected(await github(review, { method: "POST" }), 405);
    assert.equal((await google(review)).json.connected, true);
  }
});

test("disconnect review blocks all provider, OAuth, disconnect and task mutation paths without changing status", async () => {
  for (const scenario of dependencyScenarios) {
    const review = fixture(scenario);
    const before = await google(review);
    for (const path of [
      "/api/google/auth",
      "/api/google/disconnect",
      "/api/google/select",
      "/api/google/gmail",
      "/api/google/calendar",
      "/api/google/drive",
      "/api/auth/google/start",
      "/api/auth/google/callback",
      "/api/internal/google-oauth-cleanup",
      "/api/internal/scheduled-execution",
      "/api/github/auth",
      "/api/github/callback",
      ...names
        .filter((name) =>
          /^(getGoogle|getGmail|getCalendar|refreshGitHub|updateGitHub|disconnectGitHub|createScheduled|updateScheduled|deleteScheduled|grantScheduled|revokeScheduled|offerScheduled|decideScheduled|listScheduledTaskResource)/.test(
            name,
          ),
        )
        .map(functionPath),
    ]) {
      for (const method of ["GET", "POST", "DELETE"])
        rejected(
          await review.request(path, {
            method,
            headers: googleHeaders,
            body: serialize({ data: { expectedUserId: owner }, context: {} }),
          }),
        );
    }
    assert.deepEqual(await google(review), before);
    assert.equal(review.state.waits.length, 0);
  }
});

test("dependency fixture clones responses and resets without state changes or stale-session reads", async () => {
  const review = fixture(dependencyScenarios[0]);
  const original = await dependencySnapshot(review);
  const tampered = await dependencySnapshot(review);
  tampered.status.accounts[0].connected = false;
  tampered.status.accounts[0].scopes.pop();
  tampered.tasks[0].context_refs[0].grantId = owner;
  tampered.connections.grants.pop();
  assert.deepEqual(await dependencySnapshot(review), original);
  const aborted = new AbortController();
  aborted.abort();
  rejected(await google(review, { signal: aborted.signal }), 499);
  for (const name of ["listScheduledTasks", "listScheduledTaskConnections"])
    rejected(await dependencyRead(review, name, { signal: aborted.signal }), 499);
  review.state.active = false;
  rejected(await google(review), 401);
  for (const name of ["listScheduledTasks", "listScheduledTaskConnections"])
    rejected(await dependencyRead(review, name), 401);
  assert.deepEqual(await dependencySnapshot(fixture(dependencyScenarios[0])), original);
  assert.deepEqual(await fixture(dependencyScenarios[0]).request(functionPath("listProjects")), {
    fallback: true,
  });
  assert.deepEqual(
    await google(fixture(dependencyScenarios[0]), { origin: "https://example.invalid" }),
    { fallback: true },
  );
});

test(
  "existing HTTP registry installs dependency overlay, preserves owner/session guards and restores defaults on reset",
  { skip: !process.env.KOVA_REVIEW_PACKAGE },
  async () => {
    const { createFixtureSession, loadReviewPackage, FIXTURE_ORIGIN } =
      await import("./private-http-review.mjs");
    const pkg = {
      ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)),
      state: reviewCatalog,
    };
    const selection = {
      account: "plus",
      theme: "dark",
      path: "/apps",
      size: "phone",
      state: "empty",
      scenario: dependencyScenarios[0],
    };
    const session = await createFixtureSession(pkg, selection);
    const read = (active, name) =>
      active.registry.dispatch({
        url:
          FIXTURE_ORIGIN +
          "/_serverFn/" +
          [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name)[0],
        method: "POST",
        body: Buffer.from(serialize({ data: { expectedUserId: owner }, context: {} })),
      });
    const status = (active) =>
      active.registry.dispatch({
        url: FIXTURE_ORIGIN + "/api/google/status",
        headers: googleHeaders,
      });
    assert.equal((await status(session)).json.connected, true);
    assert.equal((await read(session, "listScheduledTasks")).json.result.length, 5);
    assert.equal(
      (await read(session, "listScheduledTaskConnections")).json.result.grants.length,
      3,
    );
    session.dispose();
    assert.equal((await status(session)).status, 401);
    assert.equal((await read(session, "listScheduledTasks")).status, 401);
    const reset = await createFixtureSession(pkg, { ...selection, scenario: "default" });
    assert.equal((await status(reset)).json.connected, false);
    assert.deepEqual((await read(reset, "listScheduledTasks")).json.result, []);
    reset.dispose();
  },
);

test("construction rejects unknown scenarios, guest Plugin claims and missing real function", () => {
  assert.throws(() => fixture("fake-catalog-loading"), /eligible/);
  assert.throws(() => fixture("plugin-status-error", { account: "guest" }), /eligible/);
  assert.throws(() => fixture("assistant-directory-populated", { account: "admin" }), /eligible/);
  assert.throws(
    () =>
      createDirectoryPluginReviewHandler("plugin-status-error", "free", new Map(), {
        isActive: () => true,
        wait: async () => "expired",
      }),
    /missing getGitHubManagement/,
  );
  assert.throws(
    () =>
      createDirectoryPluginReviewHandler("assistant-directory-loading", "guest", new Map(), {
        isActive: () => true,
      }),
    /bounded wait/,
  );
});

test("public directory works cookieless for guest and signed-in scenarios without account data", async () => {
  for (const account of ["guest", "free", "plus", "pro"]) {
    const review = fixture("assistant-directory-populated", { account });
    const response = await review.request(directoryPath);
    assert.equal(response.status, 200);
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.deepEqual(Object.keys(response.json), ["rows"]);
    assert.equal(response.json.rows.length, 21);
    const serialized = JSON.stringify(response.json);
    assert.ok(!serialized.includes(owner));
    for (const field of ["owner_id", "email", "instructions", "knowledge", "access_token"])
      assert.ok(!serialized.includes(`"${field}"`));
  }
});

test("real KovaCard shape supplies 20 displayed rows plus sentinel, then three terminal rows", async () => {
  const review = fixture();
  const first = (await review.request(directoryPath)).json.rows;
  const next = (await review.request(nextPath)).json.rows;
  assert.equal(first.length, 21);
  assert.equal(first.slice(0, 20).at(-1).id, cursor);
  assert.equal(next.length, 3);
  assert.equal(first.at(-1).id, next[0].id);
  const displayed = [...first.slice(0, 20), ...next];
  assert.equal(new Set(displayed.map(({ id }) => id)).size, 23);
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  for (const row of displayed) {
    assert.deepEqual(Object.keys(row).sort(), [
      "blocked",
      "config",
      "id",
      "owned",
      "revision",
      "version_id",
      "visibility",
    ]);
    assert.match(row.id, uuid);
    assert.match(row.version_id, uuid);
    assert.equal(row.owned, false);
    assert.equal(row.revision, 1);
    assert.equal(row.visibility, "public");
    assert.equal(row.blocked, false);
    assert.match(row.config.name, /^Synthetic review assistant/);
    assert.match(row.config.description, /Not a published assistant/);
    assert.equal(row.config.mode, "instant");
    assert.equal(row.config.allowFork, false);
    assert.deepEqual(row.config.tools, []);
    assert.deepEqual(row.config.apps, []);
    assert.deepEqual(row.config.starters, []);
    assert.equal(row.config.instructions, undefined);
    assert.equal(row.config.knowledge, undefined);
  }
  assert.ok(displayed.some(({ config }) => config.name.includes("Writing")));
  assert.ok(displayed.some(({ config }) => config.name.includes("Planning")));
  assert.ok(displayed.some(({ config }) => config.name.includes("Study")));
});

test("directory reads clone records and repeat without hidden pagination mutation", async () => {
  const review = fixture();
  const original = await review.request(directoryPath);
  const changed = await review.request(directoryPath);
  changed.json.rows[0].config.name = "Tampered";
  changed.json.rows.pop();
  assert.deepEqual(await review.request(directoryPath), original);
  const next = await review.request(nextPath);
  assert.deepEqual(await review.request(nextPath), next);
  assert.deepEqual(await review.request(directoryPath), original);
});

test("next-page failure leaves first page deterministic; Retry succeeds and reset re-arms failure", async () => {
  const review = fixture("assistant-directory-next-page-error");
  const first = await review.request(directoryPath);
  rejected(await review.request(nextPath));
  assert.deepEqual(await review.request(directoryPath), first);
  const next = await review.request(nextPath);
  assert.equal(next.status, 200);
  assert.equal(next.json.rows.length, 3);
  assert.deepEqual(await review.request(nextPath), next);
  const reset = fixture("assistant-directory-next-page-error");
  assert.deepEqual(await reset.request(directoryPath), first);
  rejected(await reset.request(nextPath));
});

test("directory accepts only its bounded existing cursor and GET without body", async () => {
  const review = fixture("assistant-directory-next-page-error");
  for (const path of [
    directoryPath + "?after=",
    directoryPath + "?after=" + owner,
    directoryPath + "?after=arbitrary",
    directoryPath + "?owner=" + owner,
    directoryPath + "?limit=1000",
    directoryPath + "?query=Writing",
    nextPath + "&after=" + cursor,
  ])
    rejected(await review.request(path), 400);
  rejected(await review.request(directoryPath, { body: "{}" }), 400);
  for (const method of ["POST", "PUT", "DELETE", "HEAD"])
    rejected(await review.request(directoryPath, { method }), 405);
  // Rejected input does not consume the next-page failure.
  rejected(await review.request(nextPath));
});

test("synthetic cards cannot acquire detail, custom-Kova writes or provider operations", async () => {
  const review = fixture();
  const id = (await review.request(directoryPath)).json.rows[0].id;
  for (const path of [
    "/api/kovas?scope=read&id=" + id,
    "/api/kovas?scope=read&id=" + owner,
    "/api/kovas?scope=owned",
    "/api/kovas/detail",
    "/api/admin/kovas",
    "/api/google/auth",
    "/api/google/status",
    "/api/github/auth",
    functionPath("getGitHubManagement"),
    functionPath("disconnectGitHub"),
  ]) {
    rejected(await review.request(path));
    rejected(await review.request(path, { method: "POST", body: "{}" }));
  }
});

test("directory loading waits with request signal, then returns only labeled failure", async () => {
  let finish;
  const controller = new AbortController();
  const review = fixture("assistant-directory-loading", {
    wait: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  let completed = false;
  const pending = review.request(directoryPath, { signal: controller.signal }).then((value) => {
    completed = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(review.state.waits, [controller.signal]);
  finish("expired");
  const response = await pending;
  rejected(response);
  assert.match(response.json.error, /loading hold ended/);
});

test("both real Plugin status endpoints error persistently without invented catalog or connected DTOs", async () => {
  const review = fixture("plugin-status-error");
  for (const read of [google, github]) {
    const first = await read(review);
    rejected(first);
    assert.match(first.json.error, /status read failed/);
    assert.deepEqual(await read(review), first);
    assert.equal(first.json.connected, undefined);
    assert.equal(first.json.accounts, undefined);
  }
  assert.equal(review.state.waits.length, 0);
  assert.deepEqual(await review.request("/api/plugins/catalog"), { fallback: true });
  assert.deepEqual(await review.request("/apps"), { fallback: true });
  // The summary route's differently-shaped getGoogleStatus is not the Apps read.
  assert.deepEqual(await review.request(functionPath("getGoogleStatus")), { fallback: true });
});

test("Plugin loading independently holds actual Google and GitHub reads and fails locally", async () => {
  const releases = [];
  const review = fixture("plugin-status-loading", {
    wait: () => new Promise((resolve) => releases.push(resolve)),
  });
  const controller = new AbortController();
  const googlePending = google(review, { signal: controller.signal });
  const githubPending = github(review, { signal: controller.signal });
  assert.equal(review.state.waits.length, 2);
  assert.deepEqual(review.state.waits, [controller.signal, controller.signal]);
  releases[0]("expired");
  releases[1]("expired");
  rejected(await googlePending);
  rejected(await githubPending);
});

test("Plugin ownership, method and no-input payload boundaries reject before waiting", async () => {
  const review = fixture("plugin-status-loading");
  rejected(await google(review, { headers: {} }), 401);
  rejected(await google(review, { headers: { "x-kova-owner": "other" } }), 401);
  rejected(await github(review, { headers: { "x-kova-owner": "other" } }), 401);
  rejected(await google(review, { method: "POST" }), 405);
  rejected(await github(review, { method: "POST" }), 405);
  rejected(await google(review, { body: "{}" }), 400);
  rejected(
    await review.request("/api/google/status?owner=" + owner, { headers: googleHeaders }),
    400,
  );
  for (const query of [
    "payload=bad-json",
    "payload=" + "x".repeat(4097),
    "owner=" + owner,
    "payload=" + encodeURIComponent(serialize({ data: { owner_id: owner }, context: {} })),
    "payload=" + encodeURIComponent(serialize({ data: {}, context: { userId: owner } })),
    "payload=" + encodeURIComponent(serialize({ data: {}, context: {}, other: true })),
    "payload=" + encodeURIComponent(serialize({ data: [] })),
    "payload=" + encodeURIComponent(serialize({ data: null })),
    "payload=" +
      encodeURIComponent(serialize({ data: {} })) +
      "&payload=" +
      encodeURIComponent(serialize({})),
  ])
    rejected(await review.request(functionPath("getGitHubManagement") + "?" + query), 400);
  rejected(await github(review, { body: "{}" }), 400);
  assert.equal(review.state.waits.length, 0);
  for (const envelope of [
    {},
    { context: {} },
    { data: undefined, context: {} },
    { data: {}, context: {} },
  ]) {
    const response = await review.request(
      functionPath("getGitHubManagement") + "?payload=" + encodeURIComponent(serialize(envelope)),
    );
    rejected(response);
    assert.match(response.json.error, /loading hold ended/);
  }
  assert.equal(review.state.waits.length, 4);
});

test("Plugin status scenarios deny OAuth, provider reads and all management writes", async () => {
  const review = fixture("plugin-status-loading");
  for (const path of [
    "/api/google/auth",
    "/api/google/disconnect",
    "/api/google/select",
    "/api/google/drive",
    "/api/google/calendar",
    "/api/github/auth",
    "/api/github/callback",
    functionPath("refreshGitHubInstallations"),
    functionPath("updateGitHubRepositoryGrants"),
    functionPath("disconnectGitHub"),
  ]) {
    rejected(await review.request(path));
    rejected(await review.request(path, { method: "POST", body: "{}" }));
  }
  assert.equal(review.state.waits.length, 0);
});

test("ended sessions, abort, disposal and capacity never expose a successful response", async () => {
  for (const scenario of ["assistant-directory-loading", "plugin-status-loading"]) {
    const read = scenario.startsWith("assistant-")
      ? (review, options) => review.request(directoryPath, options)
      : google;
    const ended = fixture(scenario);
    ended.state.active = false;
    rejected(await read(ended), 401);
    assert.equal(ended.state.waits.length, 0);
    const controller = new AbortController();
    controller.abort();
    const aborted = fixture(scenario);
    rejected(await read(aborted, { signal: controller.signal }), 499);
    assert.equal(aborted.state.waits.length, 0);
    for (const reason of ["aborted", "reset", "disposed", "capacity", "released"]) {
      const review = fixture(scenario, { wait: async () => reason });
      rejected(await read(review), ["aborted", "reset", "disposed"].includes(reason) ? 499 : 503);
    }
    const failedWait = fixture(scenario, {
      wait: async () => {
        throw Error("closed");
      },
    });
    rejected(await read(failedWait));
    let finish;
    const changed = fixture(scenario, {
      wait: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = read(changed);
    changed.state.active = false;
    finish("expired");
    rejected(await pending, 499);
  }
});

test("unrelated routes and other origins retain fallback; no fixture fetch runs", async () => {
  for (const scenario of ["assistant-directory-populated", "plugin-status-error"]) {
    const review = fixture(scenario);
    for (const path of [
      "/api/library/items",
      "/api/chat",
      "/api/voice",
      functionPath("listProjects"),
    ])
      assert.deepEqual(await review.request(path), { fallback: true });
    for (const path of [directoryPath, "/api/google/status", functionPath("getGitHubManagement")])
      assert.deepEqual(await review.request(path, { origin: "https://example.invalid" }), {
        fallback: true,
      });
  }
});

test("provider health samples retain identity and distinguish expired, partial and healthy without writes", async () => {
  for (const [state, googleState, githubHealth] of [
    ["expired", "reauthorization_required", "reconnect_required"],
    ["partial", "permission_incomplete", "degraded"],
    ["healthy", "connected", "healthy"],
  ]) {
    const review = fixture(`plugin-health-${state}`);
    const g = (await google(review)).json;
    const h = (await github(review)).json.result;
    assert.equal(g.state, googleState);
    assert.equal(g.accounts.length, 1);
    assert.equal(g.selectedConnectionId, g.accounts[0].id);
    assert.match(g.email, /@example\.invalid$/);
    assert.equal(h.health, githubHealth);
    assert.equal(h.accounts[0].login, "synthetic-review-account");
    assert.deepEqual(h.installations, []);
    if (state === "partial") assert.equal(g.has.drive, false);
    for (const path of [
      "/api/auth/google",
      "/api/google/disconnect",
      functionPath("disconnectGitHub"),
    ])
      rejected(await review.request(path, { method: "POST", headers: googleHeaders }));
    rejected(await google(review, { headers: { "x-kova-owner": "foreign" } }), 401);
    review.state.active = false;
    rejected(await google(review), 401);
  }
});

test("synthetic return status waits, verifies only healthy DTO, and invalidates canceled reads", async () => {
  for (const state of ["unverified", "verified"]) {
    const review = fixture(`plugin-health-return-${state}`);
    const result = (await google(review)).json;
    assert.equal(review.state.waits.length, 1);
    assert.equal(result.connected, state === "verified");
    assert.equal(result.state, state === "verified" ? "connected" : "reauthorization_required");
  }
  const review = fixture("plugin-health-return-unverified", { wait: async () => "reset" });
  rejected(await google(review), 499);
});
