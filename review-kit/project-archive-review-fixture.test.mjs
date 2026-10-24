import assert from "node:assert/strict";
import test from "node:test";
import { toJSON } from "seroval";
import {
  createProjectArchiveReviewHandler,
  PROJECT_ARCHIVE_REVIEW_ID as projectId,
  PROJECT_ARCHIVE_REVIEW_TIME,
  PROJECT_ARCHIVE_REVIEW_OPTION,
} from "./project-archive-review-fixture.mjs";
import {
  BACKEND_ORIGIN,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  createFixtureSession,
  loadReviewPackage,
  FixtureRegistry,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const defaults = {
  account: "pro",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario: "project-archive-review",
};
const functionUrl = (name) => {
  const entry = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name);
  assert.ok(entry, `Missing ${name} contract`);
  return FIXTURE_ORIGIN + "/_serverFn/" + entry[0];
};
function invoke(session, name, data, method = "GET", extra = {}) {
  const raw = data === undefined ? null : JSON.stringify(toJSON({ data, context: {} }));
  return session.registry.dispatch({
    url: functionUrl(name) + (method === "GET" && raw ? "?payload=" + encodeURIComponent(raw) : ""),
    method,
    body: method === "GET" || raw === null ? Buffer.alloc(0) : Buffer.from(raw),
    ...extra,
  });
}
const archive = (session, archived) =>
  invoke(session, "setProjectArchived", { id: projectId, archived }, "POST");
const detail = async (session) =>
  (await invoke(session, "getProject", { id: projectId })).json.result;
const list = async (session) => (await invoke(session, "listProjects")).json.result;
const create = async (overrides = {}) => createFixtureSession(pkg, { ...defaults, ...overrides });

test("Archive scenario is explicit, signed-in HTTP-only and selects the existing directory", async () => {
  assert.equal(PROJECT_ARCHIVE_REVIEW_OPTION.path, "/projects");
  assert.deepEqual(PROJECT_ARCHIVE_REVIEW_OPTION.accounts, ["free", "plus", "pro"]);
  await assert.rejects(catalog.installReviewState({}, defaults.scenario, "free"), /private HTTP/);
  await assert.rejects(create({ account: "guest" }), /requires/);
  for (const account of PROJECT_ARCHIVE_REVIEW_OPTION.accounts) {
    const session = await create({ account });
    assert.equal(session.selection.path, "/projects");
    assert.equal((await archive(session, true)).status, 200);
    assert.equal((await detail(session)).archived_at, PROJECT_ARCHIVE_REVIEW_TIME);
    session.dispose();
  }
});

test("archive retains the same project detail, context, chat, file and membership identities; Restore clears only archived_at", async () => {
  const session = await create();
  const before = await detail(session);
  assert.equal(before.id, projectId);
  assert.equal(before.archived_at, null);
  assert.equal(before.name, "Review project");
  const reads = [
    "listProjectChats",
    "listFiles",
    "listMembers",
    "listInvites",
    "listMemory",
    "getProjectNote",
    "listTasks",
    "listActivity",
  ];
  const snapshots = new Map();
  for (const name of reads)
    snapshots.set(name, await invoke(session, name, { project_id: projectId }));
  const file = snapshots.get("listFiles").json.result[0];
  assert.equal(file.project_id, projectId);
  assert.equal(typeof file.id, "string");
  const fileRead = () =>
    session.registry.dispatch({ url: file.signed_url, headers: { "x-kova-owner": REVIEW_OWNER } });
  const fileBefore = await fileRead();
  for (let retry = 0; retry < 2; retry++) {
    const result = await archive(session, true);
    assert.deepEqual(result.json, { result: { ok: true }, context: {} });
    assert.equal(result.headers["Cache-Control"], "no-store");
  }
  assert.deepEqual(await detail(session), { ...before, archived_at: PROJECT_ARCHIVE_REVIEW_TIME });
  assert.deepEqual(await list(session), [{ ...before, archived_at: PROJECT_ARCHIVE_REVIEW_TIME }]);
  for (const name of reads)
    assert.deepEqual(await invoke(session, name, { project_id: projectId }), snapshots.get(name));
  assert.deepEqual(await fileRead(), fileBefore);
  const returned = await detail(session);
  returned.name = "must not mutate backing state";
  assert.equal((await detail(session)).name, before.name);
  await archive(session, false);
  assert.deepEqual(await detail(session), before);
  assert.deepEqual(await list(session), [before]);
  for (const name of reads)
    assert.deepEqual(await invoke(session, name, { project_id: projectId }), snapshots.get(name));
  session.dispose();
});

test("strict account, ID, method, cancellation and bounded payload checks prevent archive changes", async () => {
  const session = await create(),
    before = await detail(session);
  for (const headers of [{ "x-kova-owner": "foreign" }, { "x-kova-owner": "" }])
    assert.equal(
      (
        await invoke(session, "setProjectArchived", { id: projectId, archived: true }, "POST", {
          headers,
        })
      ).status,
      401,
    );
  for (const data of [
    { id: projectId },
    { id: projectId, archived: "true" },
    { id: projectId, archived: 1 },
    { id: projectId, archived: true, owner_id: REVIEW_OWNER },
    null,
    [],
    { id: 123, archived: true },
  ])
    assert.equal((await invoke(session, "setProjectArchived", data, "POST")).status, 400);
  assert.equal(
    (
      await invoke(
        session,
        "setProjectArchived",
        { id: "44444444-4444-4444-8444-444444444444", archived: true },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal((await invoke(session, "getProject", { id: "foreign" })).status, 404);
  assert.equal(
    (await invoke(session, "setProjectArchived", { id: projectId, archived: true }, "GET")).status,
    405,
  );
  assert.equal((await invoke(session, "listProjects", undefined, "POST")).status, 405);
  const raw = JSON.stringify(toJSON({ data: { id: projectId, archived: true }, context: {} }));
  for (const [body, query] of [
    ["{", ""],
    ["x".repeat(8193), ""],
    [raw, "?payload=other"],
    [
      JSON.stringify(
        toJSON({ data: { id: projectId, archived: true }, context: { ownerId: REVIEW_OWNER } }),
      ),
      "",
    ],
  ])
    assert.equal(
      (
        await session.registry.dispatch({
          url: functionUrl("setProjectArchived") + query,
          method: "POST",
          body: Buffer.from(body),
        })
      ).status,
      400,
    );
  assert.equal(
    (await session.registry.dispatch({ url: functionUrl("listProjects") + "?payload=" })).status,
    400,
  );
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    (
      await invoke(session, "setProjectArchived", { id: projectId, archived: true }, "POST", {
        signal: abort.signal,
      })
    ).status,
    499,
  );
  assert.deepEqual(await detail(session), before);
  session.dispose();
});

test("other project writes reject without altering archive state or any existing list", async () => {
  const session = await create(),
    before = await detail(session);
  for (const name of [
    "createProject",
    "updateProject",
    "deleteProject",
    "pinProject",
    "duplicateProject",
    "saveProjectNote",
    "createTask",
    "updateTask",
    "reorderTasks",
    "deleteTask",
    "reindexProjectFile",
    "addMemory",
    "deleteMemory",
    "importChatToProject",
    "moveChatToProject",
    "removeMember",
    "leaveProject",
    "updateMemberRole",
    "inviteMember",
    "revokeInvite",
    "acceptInvite",
    "declineInvite",
    "createProjectChat",
    "saveProjectChat",
    "deleteProjectChat",
  ])
    assert.equal(
      (await invoke(session, name, { id: projectId, name: "Unsupported write" }, "POST")).status,
      503,
      name,
    );
  for (const path of ["/api/project-files", "/api/project-suggest", "/api/project-templates"])
    for (const method of ["POST", "DELETE"])
      assert.equal(
        (
          await session.registry.dispatch({
            url: FIXTURE_ORIGIN + path,
            method,
            headers: { "x-kova-owner": REVIEW_OWNER },
            body: Buffer.from("{}"),
          })
        ).status,
        503,
      );
  assert.deepEqual(await detail(session), before);
  assert.deepEqual(await list(session), [before]);
  session.dispose();
});

test("reset/account sessions isolate archive state; logout closes mutation and default remains unsupported", async () => {
  const first = await create(),
    second = await create({ account: "free" }),
    normal = await create({ scenario: "default" });
  await archive(first, true);
  assert.equal((await detail(first)).archived_at, PROJECT_ARCHIVE_REVIEW_TIME);
  assert.equal((await detail(second)).archived_at, null);
  assert.equal((await archive(normal, true)).status, 503);
  assert.equal((await detail(normal)).archived_at, null);
  await first.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
  assert.equal((await archive(first, false)).status, 401);
  assert.equal((await invoke(first, "listProjects")).status, 401);
  const reset = await create();
  assert.equal((await detail(reset)).archived_at, null);
  first.dispose();
  second.dispose();
  normal.dispose();
  reset.dispose();
});

test("factory reads current state and rejects missing/changed owner, deleted sample and foreign paths", async () => {
  const source = await create({ scenario: "default" });
  const original = await detail(source);
  source.dispose();
  let rows = [structuredClone(original)],
    active = true;
  const registry = new FixtureRegistry();
  await registry.route(
    "**/*",
    createProjectArchiveReviewHandler(pkg.base.functionNames, {
      isActive: () => active,
      getProjects: () => rows,
    }),
  );
  const session = { registry };
  for (const change of [
    { owner_id: "foreign" },
    { role: "viewer" },
    { deletion_requested_at: "2026-10-19T00:00:00Z" },
  ]) {
    rows = [{ ...original, ...change }];
    assert.equal((await archive(session, true)).status, 403);
  }
  rows = [];
  assert.equal((await archive(session, true)).status, 403);
  rows = [structuredClone(original)];
  active = false;
  assert.equal((await archive(session, true)).status, 401);
  active = true;
  assert.throws(
    () =>
      createProjectArchiveReviewHandler(new Map(), {
        isActive: () => true,
        getProjects: () => rows,
      }),
    /missing/,
  );
  assert.throws(
    () =>
      createProjectArchiveReviewHandler(pkg.base.functionNames, {
        isActive: () => true,
        getProjects: () => [],
      }),
    /owner/,
  );
  const handler = createProjectArchiveReviewHandler(pkg.base.functionNames, {
    isActive: () => true,
    getProjects: () => rows,
  });
  let fallbacks = 0;
  for (const url of [
    functionUrl("setProjectArchived").replace(FIXTURE_ORIGIN, "https://outside.invalid"),
    functionUrl("setProjectArchived") + "/extra",
    functionUrl("getMyDailyUsage"),
  ])
    await handler({
      request: () => ({ url: () => url, method: () => "GET" }),
      fallback: () => fallbacks++,
    });
  assert.equal(fallbacks, 3);
});
