import assert from "node:assert/strict";
import test from "node:test";
import { toJSON } from "seroval";
import {
  createProjectMoveReviewHandler,
  PROJECT_MOVE_REVIEW_OWNER as owner,
  PROJECT_MOVE_REVIEW_SOURCE_ID as sourceId,
  PROJECT_MOVE_REVIEW_DESTINATION_ID as destinationId,
  PROJECT_MOVE_REVIEW_CHAT_ID as chatId,
} from "./project-move-review-fixture.mjs";

// Mock routes only: no packaged app, compilation, browser, HTTP listener, or network.
const origin = "http://127.0.0.1:4189";
const names = [
  "listProjectChats",
  "getProjectChat",
  "moveChatToProject",
  "getProject",
  "listProjects",
  "listFiles",
  "updateProject",
];
const functionNames = new Map(
  names.map((name, index) => [String(index).padStart(64, "0"), `${name}_createServerFn_handler`]),
);
const functionId = (name) =>
  [...functionNames].find(([, value]) => value.startsWith(name + "_"))[0];
const originalProject = () => ({
  id: sourceId,
  name: "Review project",
  description: "Synthetic project for local interface review.",
  system_prompt: "Keep project answers concise and cite the supplied material.",
  color: null,
  owner_id: owner,
  role: "owner",
  member_count: 1,
  chat_count: 0,
  file_count: 0,
  pinned_at: null,
  archived_at: null,
  deletion_requested_at: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-16T10:00:00Z",
});
const serialize = (data, context = {}) => JSON.stringify(toJSON({ data, context }));
function setup() {
  const state = { active: true, projects: [originalProject()] };
  const handler = createProjectMoveReviewHandler(functionNames, {
    isActive: () => state.active,
    getProjects: () => state.projects,
  });
  async function invoke(name, data = {}, options = {}) {
    const method = options.method ?? (name === "moveChatToProject" ? "POST" : "GET");
    const raw = Object.hasOwn(options, "raw") ? options.raw : serialize(data);
    const url = new URL(`${options.origin ?? origin}/_serverFn/${functionId(name)}`);
    if (method === "GET" && raw !== null) url.searchParams.set("payload", raw);
    if (options.duplicatePayload) url.searchParams.append("payload", raw);
    let response;
    await handler({
      request: () => ({
        url: () => url.href,
        method: () => method,
        headers: () => options.headers ?? {},
        postData: () => (method === "GET" ? null : raw),
      }),
      fulfill: async (result) => {
        response = result;
      },
      fallback: async () => {
        response = { fallback: true };
      },
    });
    return response;
  }
  return { state, invoke };
}
const result = async (fixture, name, data) => (await fixture.invoke(name, data)).json.result;
const chats = (fixture, id) => result(fixture, "listProjectChats", { project_id: id });
const move = (fixture, id) =>
  fixture.invoke("moveChatToProject", { chat_id: chatId, project_id: id });

test("destination shares the existing CRUD state and Context operations remain fallback", async () => {
  const fixture = setup();
  const [source, destination] = fixture.state.projects;
  assert.deepEqual(source, { ...originalProject(), chat_count: 1 });
  assert.equal(destination.id, destinationId);
  assert.equal(destination.owner_id, owner);
  assert.equal(destination.role, "owner");
  assert.equal(destination.chat_count, 0);
  assert.match(destination.name, /Sample/);
  assert.match(destination.system_prompt, /Synthetic/);
  for (const name of ["getProject", "listProjects", "listFiles", "updateProject"])
    assert.deepEqual(await fixture.invoke(name, { id: sourceId }), { fallback: true });
  source.system_prompt = "Edited through the existing Context fixture.";
  destination.name = "Renamed using existing project settings";
  await move(fixture, destinationId);
  assert.equal(source.system_prompt, "Edited through the existing Context fixture.");
  assert.equal(destination.name, "Renamed using existing project settings");
});

test("chat list/detail DTOs match production and reads cannot mutate session state", async () => {
  const fixture = setup();
  const rows = await chats(fixture, sourceId);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["created_by", "id", "title", "updated_at"]);
  assert.equal(rows[0].id, chatId);
  assert.equal(rows[0].created_by, owner);
  assert.deepEqual(await chats(fixture, destinationId), []);
  const detail = await result(fixture, "getProjectChat", { id: chatId });
  assert.deepEqual(Object.keys(detail).sort(), [
    "created_by",
    "id",
    "project_id",
    "snapshot",
    "title",
    "updated_at",
  ]);
  assert.equal(detail.project_id, sourceId);
  assert.deepEqual(
    detail.snapshot.messages.map(({ role }) => role),
    ["user", "assistant"],
  );
  rows[0].title = "Injected title";
  detail.snapshot.messages[0].content = "Injected content";
  assert.notEqual((await chats(fixture, sourceId))[0].title, "Injected title");
  assert.notEqual(
    (await result(fixture, "getProjectChat", { id: chatId })).snapshot.messages[0].content,
    "Injected content",
  );
});

test("confirmed moves update both lists, detail and shared project counts; reset is isolated", async () => {
  const fixture = setup();
  const another = setup();
  const response = await move(fixture, destinationId);
  assert.deepEqual(response.json, { result: { ok: true }, context: {} });
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(await chats(fixture, sourceId), []);
  assert.equal((await chats(fixture, destinationId))[0].id, chatId);
  assert.equal((await result(fixture, "getProjectChat", { id: chatId })).project_id, destinationId);
  assert.deepEqual(
    fixture.state.projects.map(({ chat_count }) => chat_count),
    [0, 1],
  );
  assert.equal((await move(fixture, destinationId)).status, 409);
  assert.deepEqual((await move(fixture, sourceId)).json, { result: { ok: true }, context: {} });
  assert.deepEqual(
    fixture.state.projects.map(({ chat_count }) => chat_count),
    [1, 0],
  );
  assert.equal((await chats(another, sourceId)).length, 1);
  assert.deepEqual(await chats(another, destinationId), []);
  assert.deepEqual(setup().state.projects, another.state.projects);
});

test("inactive, foreign and malformed account headers cannot read or move the sample", async () => {
  const fixture = setup();
  for (const headers of [{ "x-kova-owner": "other-account" }, { "x-kova-owner": "" }])
    for (const [name, data] of [
      ["listProjectChats", { project_id: sourceId }],
      ["getProjectChat", { id: chatId }],
      ["moveChatToProject", { chat_id: chatId, project_id: destinationId }],
    ])
      assert.equal((await fixture.invoke(name, data, { headers })).status, 401);
  assert.equal(
    (await fixture.invoke("getProjectChat", { id: chatId }, { headers: { "x-kova-owner": owner } }))
      .json.result.id,
    chatId,
  );
  fixture.state.active = false;
  assert.equal((await move(fixture, destinationId)).status, 401);
  assert.equal((await fixture.invoke("getProjectChat", { id: chatId })).status, 401);
  assert.deepEqual(
    fixture.state.projects.map(({ chat_count }) => chat_count),
    [1, 0],
  );
});

test("foreign rows and changed project permissions fail closed without mutating the chat", async () => {
  const fixture = setup();
  assert.equal(
    (
      await fixture.invoke("listProjectChats", {
        project_id: "44444444-4444-4444-8444-444444444444",
      })
    ).status,
    404,
  );
  assert.equal(
    (await fixture.invoke("getProjectChat", { id: "44444444-4444-4444-8444-444444444444" })).status,
    404,
  );
  assert.equal(
    (
      await fixture.invoke("moveChatToProject", {
        chat_id: "44444444-4444-4444-8444-444444444444",
        project_id: destinationId,
      })
    ).status,
    404,
  );
  assert.equal((await move(fixture, "44444444-4444-4444-8444-444444444444")).status, 404);
  const destination = fixture.state.projects[1];
  destination.role = "viewer";
  assert.equal((await move(fixture, destinationId)).status, 403);
  destination.role = "owner";
  destination.owner_id = "another-account";
  assert.equal((await move(fixture, destinationId)).status, 404);
  destination.owner_id = owner;
  destination.deletion_requested_at = "2026-10-16T10:00:00Z";
  assert.equal((await move(fixture, destinationId)).status, 404);
  destination.deletion_requested_at = null;
  fixture.state.projects[0].role = "viewer";
  assert.equal((await move(fixture, destinationId)).status, 403);
  fixture.state.projects[0].role = "owner";
  assert.equal((await result(fixture, "getProjectChat", { id: chatId })).project_id, sourceId);
  fixture.state.projects = fixture.state.projects.filter(({ id }) => id !== destinationId);
  assert.equal((await move(fixture, destinationId)).status, 404);
  assert.equal(fixture.state.projects.length, 1);
  fixture.state.projects = [];
  assert.equal((await fixture.invoke("getProjectChat", { id: chatId })).status, 404);
});

test("wrong methods, malformed or unbounded payloads and ambiguous transport are rejected", async () => {
  const fixture = setup();
  for (const method of ["POST", "DELETE", "HEAD"])
    assert.equal(
      (await fixture.invoke("listProjectChats", { project_id: sourceId }, { method })).status,
      405,
    );
  for (const method of ["GET", "DELETE", "HEAD"])
    assert.equal(
      (
        await fixture.invoke(
          "moveChatToProject",
          { chat_id: chatId, project_id: destinationId },
          { method },
        )
      ).status,
      405,
    );
  for (const raw of [
    null,
    "",
    "{invalid",
    "{}",
    serialize(null),
    serialize([]),
    serialize({}),
    serialize({ id: 7 }),
    serialize({ id: chatId, ownerId: owner }),
    serialize({ id: chatId }, { userId: owner }),
    " ".repeat(32769),
  ])
    assert.equal(
      (await fixture.invoke("getProjectChat", {}, { raw })).status,
      400,
      String(raw).slice(0, 60),
    );
  for (const data of [
    { chat_id: chatId },
    { project_id: destinationId },
    { chat_id: chatId, project_id: destinationId, owner_id: owner },
  ])
    assert.equal((await fixture.invoke("moveChatToProject", data)).status, 400);
  assert.equal(
    (await fixture.invoke("getProjectChat", { id: chatId }, { duplicatePayload: true })).status,
    400,
  );
  assert.equal(
    (
      await fixture.invoke(
        "moveChatToProject",
        { chat_id: chatId, project_id: destinationId },
        { duplicatePayload: true },
      )
    ).status,
    400,
  );
  assert.equal((await result(fixture, "getProjectChat", { id: chatId })).project_id, sourceId);
});

test("nonlocal functions fall back and setup requires the verified existing fixture contract", async () => {
  const fixture = setup();
  assert.deepEqual(
    await fixture.invoke("getProjectChat", { id: chatId }, { origin: "https://example.invalid" }),
    { fallback: true },
  );
  const projects = [originalProject()];
  const options = { isActive: () => true, getProjects: () => projects };
  assert.throws(() => createProjectMoveReviewHandler(new Map(), options), /missing/);
  assert.equal(projects.length, 1);
  assert.throws(
    () => createProjectMoveReviewHandler(functionNames, { ...options, isActive: () => false }),
    /active synthetic project owner/,
  );
  assert.equal(projects.length, 1);
  assert.throws(
    () => createProjectMoveReviewHandler(functionNames, { ...options, getProjects: () => [] }),
    /active synthetic project owner/,
  );
  assert.throws(
    () =>
      createProjectMoveReviewHandler(functionNames, {
        ...options,
        getProjects: () => [{ ...originalProject(), owner_id: "another-account" }],
      }),
    /active synthetic project owner/,
  );
  createProjectMoveReviewHandler(functionNames, options);
  assert.throws(() => createProjectMoveReviewHandler(functionNames, options), /already exists/);
  assert.equal(projects.length, 2);
});
