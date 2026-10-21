import assert from "node:assert/strict";
import test from "node:test";
import { toJSON } from "seroval";
import { z } from "zod";
import { createCollaborationClient } from "../src/lib/collaboration-client.mjs";
import {
  PROJECT_POPULATED_ARCHIVE_REVIEW_OPTION as option,
  PROJECT_POPULATED_ARCHIVE_CHAT_ID as chatId,
  createProjectPopulatedArchiveReviewHandler,
} from "./project-populated-archive-review-fixture.mjs";
import {
  PROJECT_ARCHIVE_REVIEW_ID as projectId,
  PROJECT_ARCHIVE_REVIEW_TIME as archivedAt,
} from "./project-archive-review-fixture.mjs";
import {
  createFixtureSession,
  loadReviewPackage,
  FIXTURE_ORIGIN,
  BACKEND_ORIGIN,
  REVIEW_OWNER,
  syntheticSession,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";

assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const selection = {
  account: "pro",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario: option.id,
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
const create = (overrides = {}) => createFixtureSession(pkg, { ...selection, ...overrides });
const detail = async (session) =>
  (await invoke(session, "getProject", { id: projectId })).json.result;
const readFiles = (session) =>
  invoke(session, "listFiles", { project_id: projectId, kind: "file" });
const restore = (session, extra = {}) =>
  invoke(session, "setProjectArchived", { id: projectId, archived: false }, "POST", extra);
const collaboration = (session, operation, data = { projectId }, extra = {}) =>
  session.registry.dispatch({
    url: BACKEND_ORIGIN + "/rest/v1/rpc/collaboration_rpc",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${syntheticSession(selection.account, session.authIssuedAt).access_token}`,
    },
    body: Buffer.from(JSON.stringify({ p_operation: operation, p_data: data })),
    ...extra,
  });

test("populated archive is a separate explicit signed-in scenario and does not replace the sealed owner fixture", async () => {
  assert.equal(option.path, `/projects/${projectId}`);
  assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
  await assert.rejects(create({ account: "guest" }), /requires/);
  await assert.rejects(catalog.installReviewState({}, option.id, "pro"), /private HTTP/);
  for (const account of option.accounts) {
    const session = await create({ account });
    assert.equal(session.selection.path, option.path);
    const current = await detail(session);
    assert.equal(current.archived_at, archivedAt);
    assert.equal(current.owner_id, REVIEW_OWNER);
    assert.equal(current.role, "owner");
    assert.ok(current.name.length > 80);
    assert.ok(current.description.length > 150);
    const original = await create({ account, scenario: "project-archive-review" });
    assert.equal((await detail(original)).name, "Review project");
    assert.equal((await detail(original)).archived_at, null);
    session.dispose();
    original.dispose();
  }
});

test("same project, long identity, Context, nonempty chat and original bundled file survive Restore unchanged", async () => {
  const session = await create();
  const before = await detail(session);
  const chats = await invoke(session, "listProjectChats", { project_id: projectId });
  assert.equal(chats.json.result.length, 1);
  assert.equal(chats.json.result[0].id, chatId);
  const chat = await invoke(session, "getProjectChat", { id: chatId });
  assert.equal(chat.json.result.project_id, before.id);
  assert.equal(chat.json.result.snapshot.messages.length, 2);
  assert.match(chat.json.result.snapshot.messages[1].content, /bundled project notes readable/);
  const files = await readFiles(session);
  assert.equal(files.json.result.length, 1);
  assert.equal(before.file_count, files.json.result.length);
  assert.equal(before.chat_count, chats.json.result.length);
  const file = files.json.result[0];
  assert.equal(file.project_id, before.id);
  const fileRead = () =>
    session.registry.dispatch({ url: file.signed_url, headers: { "x-kova-owner": REVIEW_OWNER } });
  const bytes = await fileRead();
  assert.equal(bytes.body.length, file.size_bytes);
  assert.ok(bytes.body.length > 0);
  for (let retry = 0; retry < 2; retry++) {
    assert.deepEqual((await restore(session)).json, { result: { ok: true }, context: {} });
    assert.deepEqual(await detail(session), { ...before, archived_at: null });
    assert.deepEqual(await invoke(session, "listProjectChats", { project_id: projectId }), chats);
    assert.deepEqual(await invoke(session, "getProjectChat", { id: chatId }), chat);
    assert.deepEqual(await readFiles(session), files);
    assert.deepEqual(await fileRead(), bytes);
  }
  const callerCopy = await detail(session);
  callerCopy.system_prompt = "must not mutate projection";
  assert.equal((await detail(session)).system_prompt, before.system_prompt);
  session.dispose();
  const reset = await create();
  assert.deepEqual(await detail(reset), before);
  reset.dispose();
});

test("only exact Restore is writable and every other server, project API and storage mutation stays fenced after Restore", async () => {
  const session = await create();
  const before = await detail(session);
  for (const restored of [false, true]) {
    if (restored) await restore(session);
    for (const name of [
      "createProject",
      "updateProject",
      "deleteProject",
      "createProjectChat",
      "saveProjectChat",
      "deleteProjectChat",
      "leaveProject",
      "inviteMember",
      "saveProjectNote",
    ])
      assert.equal((await invoke(session, name, { id: projectId }, "POST")).status, 405, name);
    assert.equal(
      (await invoke(session, "setProjectArchived", { id: projectId, archived: true }, "POST"))
        .status,
      400,
    );
    for (const path of ["/api/project-files", "/api/project-suggest", "/api/project-templates"])
      for (const method of ["POST", "PUT", "PATCH", "DELETE"])
        assert.equal(
          (await session.registry.dispatch({ url: FIXTURE_ORIGIN + path, method })).status,
          405,
        );
    for (const path of [
      "/rest/v1/projects",
      "/rest/v1/project_files",
      "/storage/v1/object/anything",
    ])
      assert.equal(
        (await session.registry.dispatch({ url: BACKEND_ORIGIN + path, method: "POST" })).status,
        405,
      );
    assert.deepEqual(await detail(session), {
      ...before,
      archived_at: restored ? null : archivedAt,
    });
  }
  session.dispose();
});

test("account, origin, identity, method, payload and cancellation errors cannot restore or cross the synthetic sample", async () => {
  const session = await create();
  const before = await detail(session);
  for (const headers of [{ "x-kova-owner": "foreign" }, { "x-kova-owner": "" }])
    assert.equal((await restore(session, { headers })).status, 401);
  assert.equal(
    (
      await restore(session, {
        url: functionUrl("setProjectArchived").replace(FIXTURE_ORIGIN, "https://foreign.invalid"),
      })
    ).status,
    400,
  );
  for (const name of ["getProject", "getProjectChat"])
    assert.equal((await invoke(session, name, { id: "foreign" })).status, 404);
  assert.equal((await invoke(session, "listProjectChats", { project_id: "foreign" })).status, 404);
  for (const data of [
    { id: "foreign", archived: false },
    { id: projectId, archived: false, unexpected: true },
    { id: projectId, archived: 0 },
    { id: projectId },
  ])
    assert.ok(
      [400, 404].includes((await invoke(session, "setProjectArchived", data, "POST")).status),
    );
  for (const raw of ["malformed", "x".repeat(8193)])
    assert.equal((await restore(session, { body: Buffer.from(raw) })).status, 400);
  assert.equal(
    (await invoke(session, "setProjectArchived", { id: projectId, archived: false })).status,
    405,
  );
  const abort = new AbortController();
  abort.abort();
  assert.equal((await restore(session, { signal: abort.signal })).status, 499);
  assert.deepEqual(await detail(session), before);
  session.authActive = false;
  assert.equal((await restore(session)).status, 401);
  session.dispose();
});

test("factory rejects altered baseline ownership/archive and missing packaged read contracts", () => {
  const project = { id: projectId, owner_id: REVIEW_OWNER, role: "owner", archived_at: null };
  for (const baseline of [
    { ...project, owner_id: "foreign" },
    { ...project, role: "viewer" },
    { ...project, archived_at: archivedAt },
    { ...project, deletion_requested_at: archivedAt },
  ])
    assert.throws(() =>
      createProjectPopulatedArchiveReviewHandler(pkg.base.functionNames, {
        isActive: () => true,
        getProjects: () => [baseline],
        expectedAccessToken: "synthetic-test-token",
      }),
    );
  assert.throws(() =>
    createProjectPopulatedArchiveReviewHandler(new Map(), {
      isActive: () => true,
      getProjects: () => [project],
      expectedAccessToken: "synthetic-test-token",
    }),
  );
});

test("actual collaboration client reads fixed valid empty notes/comments before and after Restore", async () => {
  const Note = z.object({
    project_id: z.string().uuid(),
    content: z.string().max(400000),
    revision: z.number().int().nonnegative(),
  });
  const Comments = z.array(
    z.object({
      id: z.string().uuid(),
      project_id: z.string().uuid(),
      author_id: z.string().uuid(),
      body: z.string().max(8000),
      anchor: z.string().max(400).nullable(),
      mentions: z.array(z.string().uuid()).max(20),
      created_at: z.string(),
      updated_at: z.string(),
    }),
  );
  for (const account of option.accounts) {
    const session = await create({ account });
    const before = await detail(session);
    const request = createCollaborationClient({
      config: { url: BACKEND_ORIGIN, publishableKey: "private-review-public-placeholder" },
      getSession: async () => ({
        data: { session: syntheticSession(account, session.authIssuedAt) },
      }),
      fetchImpl: async (url, init) => {
        const output = await session.registry.dispatch({
          url,
          method: init.method,
          headers: Object.fromEntries(new Headers(init.headers)),
          body: Buffer.from(init.body),
          signal: init.signal,
        });
        assert.equal(output.status, 200);
        assert.equal(output.headers["Cache-Control"], "no-store");
        return new Response(JSON.stringify(output.json), { status: output.status });
      },
    });
    for (const restored of [false, true]) {
      if (restored) await restore(session);
      const note = Note.parse(await request(REVIEW_OWNER, "note_get", { projectId }));
      assert.deepEqual(note, { project_id: projectId, content: "", revision: 0 });
      assert.deepEqual(
        Comments.parse(await request(REVIEW_OWNER, "project_comments", { projectId })),
        [],
      );
      note.content = "must not save or mutate the fixture";
      assert.equal((await request(REVIEW_OWNER, "note_get", { projectId })).content, "");
      assert.deepEqual(await detail(session), {
        ...before,
        archived_at: restored ? null : archivedAt,
      });
    }
    session.dispose();
  }
});

test("collaboration reads bind exact endpoint, owner/token, payload and cancellation without allowing writes", async () => {
  const session = await create();
  const before = await detail(session);
  const validHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${syntheticSession(selection.account, session.authIssuedAt).access_token}`,
  };
  for (const restored of [false, true]) {
    if (restored) await restore(session);
    for (const operation of [
      "note_save",
      "project_comment",
      "project_comment_delete",
      "open",
      "save",
      "comment",
      "presence",
      "leave",
      "unknown",
    ])
      assert.equal((await collaboration(session, operation)).status, 405, operation);
    for (const operation of ["note_get", "project_comments"]) {
      assert.equal((await collaboration(session, operation, { projectId: "foreign" })).status, 404);
      for (const data of [{}, { projectId, extra: true }, null, []])
        assert.equal((await collaboration(session, operation, data)).status, 400);
    }
    assert.deepEqual(await detail(session), {
      ...before,
      archived_at: restored ? null : archivedAt,
    });
  }
  for (const method of ["GET", "PUT", "PATCH", "DELETE"])
    assert.equal((await collaboration(session, "note_get", { projectId }, { method })).status, 405);
  for (const authorization of [undefined, "Bearer foreign"])
    assert.equal(
      (
        await collaboration(
          session,
          "note_get",
          { projectId },
          { headers: { ...validHeaders, authorization } },
        )
      ).status,
      401,
    );
  assert.equal(
    (
      await collaboration(
        session,
        "note_get",
        { projectId },
        { headers: { ...validHeaders, "x-kova-owner": "foreign" } },
      )
    ).status,
    401,
  );
  for (const url of [
    "https://foreign.invalid/rest/v1/rpc/collaboration_rpc",
    BACKEND_ORIGIN + "/rest/v1/rpc/collaboration_rpc?extra=1",
  ])
    assert.equal((await collaboration(session, "note_get", { projectId }, { url })).status, 400);
  assert.equal(
    (
      await collaboration(
        session,
        "note_get",
        { projectId },
        { headers: { ...validHeaders, "content-type": "text/plain" } },
      )
    ).status,
    415,
  );
  for (const body of [
    "malformed",
    "null",
    "[]",
    JSON.stringify({ p_operation: "note_get", p_data: { projectId }, extra: true }),
  ])
    assert.equal(
      (await collaboration(session, "note_get", { projectId }, { body: Buffer.from(body) })).status,
      400,
    );
  assert.equal(
    (
      await collaboration(
        session,
        "note_get",
        { projectId },
        { body: Buffer.from("x".repeat(8193)) },
      )
    ).status,
    413,
  );
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    (await collaboration(session, "note_get", { projectId }, { signal: abort.signal })).status,
    499,
  );
  session.authActive = false;
  assert.equal((await collaboration(session, "note_get")).status, 401);
  session.dispose();
});

test("default and sealed archive RPC fallbacks stay unchanged; only populated projection supplies collaboration reads", async () => {
  for (const scenario of ["default", "project-archive-review"]) {
    const session = await create({ scenario });
    for (const operation of ["note_get", "project_comments"]) {
      const result = await collaboration(session, operation);
      assert.equal(result.status, 200);
      assert.equal(result.body, "null");
    }
    session.dispose();
  }
});
