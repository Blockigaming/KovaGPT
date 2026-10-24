import assert from "node:assert/strict";
import test from "node:test";
import { toJSON } from "seroval";
import {
  PROJECT_MEMBER_REVIEW_OWNER as owner,
  PROJECT_MEMBER_REVIEW_ID as projectId,
  PROJECT_MEMBER_REVIEW_PROJECT_OWNER as projectOwner,
  PROJECT_MEMBER_REVIEW_OPTION as option,
  createProjectMemberReviewHandler,
} from "./project-member-review-fixture.mjs";
import { createFixtureSession, loadReviewPackage, FIXTURE_ORIGIN } from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";

const readNames = ["listProjects", "getProject", "listMembers", "listInvites", "listProjectChats"];
const names = new Map(
  [...readNames, "leaveProject", "deleteProject", "getMyProfile"].map((name) => [
    name,
    `${name}_hash`,
  ]),
);
const original = () => ({
  id: projectId,
  name: "Review project",
  description: "Synthetic project for local interface review.",
  system_prompt: "Keep project answers concise and cite the supplied material.",
  owner_id: owner,
  role: "owner",
  member_count: 1,
  chat_count: 0,
  file_count: 0,
  archived_at: null,
  deletion_requested_at: null,
  created_at: "2026-10-01T10:00:00Z",
});
function fixture() {
  const projects = [original()];
  let active = true;
  const handler = createProjectMemberReviewHandler(names, {
    isActive: () => active,
    getProjects: () => projects,
  });
  return {
    projects,
    stop: () => {
      active = false;
    },
    async request(name = "getProject", data = { id: projectId }, extra = {}) {
      const raw = data === undefined ? null : JSON.stringify(toJSON({ data, context: {} }));
      const method = extra.method ?? "GET";
      const path =
        extra.path ??
        `/_serverFn/${name}${method === "GET" && raw ? "?payload=" + encodeURIComponent(raw) : ""}`;
      let result;
      await handler({
        request: () => ({
          url: () => (extra.origin ?? FIXTURE_ORIGIN) + path,
          method: () => method,
          headers: () => ({ "x-kova-owner": owner, ...extra.headers }),
          postData: () => extra.raw ?? (method === "GET" ? undefined : raw),
          signal: () => extra.signal,
        }),
        fulfill: async (value) => {
          result = value;
        },
        fallback: async () => {
          result = { fallback: true };
        },
      });
      return result;
    },
  };
}

test("member projection is coherent, read-only, and never changes the owner sample", async () => {
  const f = fixture();
  const before = structuredClone(f.projects);
  const detail = (await f.request()).json.result;
  assert.equal(detail.id, projectId);
  assert.equal(detail.role, "viewer");
  assert.equal(detail.owner_id, projectOwner);
  assert.notEqual(detail.owner_id, owner);
  assert.equal(detail.member_count, 2);
  const members = (await f.request("listMembers", { project_id: projectId })).json.result;
  assert.deepEqual(
    members.map(({ user_id, role }) => ({ user_id, role })),
    [
      { user_id: projectOwner, role: "owner" },
      { user_id: owner, role: "viewer" },
    ],
  );
  for (const name of ["listInvites", "listProjectChats"])
    assert.deepEqual((await f.request(name, { project_id: projectId })).json.result, []);
  assert.deepEqual((await f.request("listProjects", {})).json.result, [detail]);
  detail.name = "Caller mutation";
  members[0].role = "viewer";
  assert.equal((await f.request()).json.result.name, before[0].name);
  assert.equal(
    (await f.request("listMembers", { project_id: projectId })).json.result[0].role,
    "owner",
  );
  assert.deepEqual(f.projects, before);
});

test("Leave, project APIs, all server writes and direct storage cannot fall through", async () => {
  const f = fixture(),
    before = structuredClone(f.projects);
  for (const path of [
    "/_serverFn/leaveProject",
    "/_serverFn/deleteProject",
    "/_serverFn/unknown",
    "/api/project-files",
    "/api/project-suggest",
    "/api/private-files",
    "/rest/v1/projects",
    "/rest/v1/project_members",
    "/rest/v1/rpc/update_project",
    "/storage/v1/object/project-files/sample",
  ])
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"])
      assert.equal((await f.request("", {}, { path, method })).status, 405, `${method} ${path}`);
  assert.equal((await f.request("leaveProject", { project_id: projectId })).status, 405);
  assert.deepEqual(f.projects, before);
  assert.deepEqual(await f.request("getMyProfile", {}), { fallback: true });
});

test("only exact identity reads in the active synthetic account are accepted", async () => {
  const f = fixture();
  assert.equal((await f.request("getProject", { id: "foreign" })).status, 404);
  for (const data of [{}, { id: projectId, extra: true }, { project_id: projectId }])
    assert.equal((await f.request("getProject", data)).status, 400);
  assert.equal(
    (await f.request("getProject", { id: projectId }, { headers: { "x-kova-owner": "foreign" } }))
      .status,
    401,
  );
  assert.equal(
    (await f.request("getProject", { id: projectId }, { signal: AbortSignal.abort() })).status,
    499,
  );
  assert.equal(
    (await f.request("getProject", { id: projectId }, { origin: "https://example.invalid" }))
      .status,
    400,
  );
  assert.equal(
    (await f.request("getProject", { id: projectId }, { raw: "body-on-get" })).status,
    400,
  );
  for (const path of [
    "/_serverFn/getProject?payload=%7B",
    "/_serverFn/getProject?payload=&payload=again",
    "/_serverFn/getProject?extra=1",
  ])
    assert.equal((await f.request("", {}, { path })).status, 400);
  f.stop();
  assert.equal((await f.request()).status, 401);
});

test("member fixture rejects missing contracts and changed owner baselines", () => {
  const options = { isActive: () => true, getProjects: () => [original()] };
  assert.throws(() => createProjectMemberReviewHandler(new Map(), options), /missing/);
  for (const patch of [
    { role: "viewer" },
    { owner_id: "foreign" },
    { deletion_requested_at: "scheduled" },
  ])
    assert.throws(
      () =>
        createProjectMemberReviewHandler(names, {
          ...options,
          getProjects: () => [{ ...original(), ...patch }],
        }),
      /unchanged existing owner sample/,
    );
  assert.throws(
    () => createProjectMemberReviewHandler(names, { ...options, isActive: () => false }),
    /unchanged/,
  );
});

test("catalog and registered adapter preserve default/Archive owner states and fence Leave", async () => {
  assert.ok(
    process.env.KOVA_REVIEW_PACKAGE,
    "Set KOVA_REVIEW_PACKAGE to an existing review package",
  );
  const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
  assert.deepEqual(
    catalog.REVIEW_STATE_OPTIONS.find(({ id }) => id === option.id),
    option,
  );
  const selection = {
    account: "pro",
    theme: "dark",
    state: "populated",
    size: "phone",
    path: "/",
    scenario: option.id,
  };
  await assert.rejects(createFixtureSession(pkg, { ...selection, account: "guest" }), /requires/);
  await assert.rejects(catalog.installReviewState({}, option.id, "pro"), /HTTP review adapter/);
  const invoke = async (session, name, data, method = "GET") => {
    const [id] = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name);
    const raw = data === undefined ? null : JSON.stringify(toJSON({ data, context: {} }));
    return session.registry.dispatch({
      url:
        FIXTURE_ORIGIN +
        "/_serverFn/" +
        id +
        (method === "GET" && raw ? "?payload=" + encodeURIComponent(raw) : ""),
      method,
      headers: { "x-kova-owner": owner },
      body: method === "GET" || raw === null ? Buffer.alloc(0) : Buffer.from(raw),
    });
  };
  for (const account of option.accounts) {
    const member = await createFixtureSession(pkg, { ...selection, account });
    assert.equal(member.selection.path, option.path);
    assert.equal(
      (await invoke(member, "getProject", { id: projectId })).json.result.role,
      "viewer",
    );
    assert.equal(
      (await invoke(member, "leaveProject", { project_id: projectId }, "POST")).status,
      405,
    );
    assert.equal(
      (await invoke(member, "getProject", { id: projectId })).json.result.role,
      "viewer",
    );
    member.dispose();
    assert.equal((await invoke(member, "getProject", { id: projectId })).status, 401);
  }
  for (const scenario of ["default", "project-archive-review"]) {
    const session = await createFixtureSession(pkg, { ...selection, scenario });
    const project = (await invoke(session, "getProject", { id: projectId })).json.result;
    assert.equal(project.role, "owner");
    assert.equal(project.owner_id, owner);
    session.dispose();
  }
});
