import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import * as seroval from "seroval";
import * as crypto from "node:crypto";
import * as filePolicy from "../../src/lib/project-files-policy.mjs";
const owner = "22222222-2222-4222-8222-222222222222";
const functionNames = new Map();
function load(path, imports) {
  const code = transformSync(readFileSync(path, "utf8"), {
    loader: "ts",
    format: "cjs",
    target: "es2022",
  }).code;
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, (id) => {
    assert.ok(id in imports, id);
    return imports[id];
  });
  return module.exports;
}
const core = load("tests/e2e/core-app-fixture.ts", {
  "./actual-app-fixture": { owner, functionNames, fixture: async () => {} },
});
const fixture = load("tests/e2e/recovery-crud-fixture.ts", {
  seroval,
  "node:crypto": crypto,
  "../../src/lib/project-files-policy.mjs": filePolicy,
  "./core-app-fixture": { ...core, coreFixture: async () => {} },
  "./actual-app-fixture": { owner, functionNames },
});
async function setup() {
  const handlers = new Map();
  const state = await fixture.recoveryCrudFixture({
    route: async (path, handler) => handlers.set(path, handler),
    context: () => ({ route: async (path, handler) => handlers.set(path, handler) }),
  });
  async function call(pattern, method, data, query = "", requestOwner = owner, options = {}) {
    let response;
    const server = pattern.includes("_serverFn");
    const request = {
      method: () => method,
      headers: () => ({ "x-kova-owner": requestOwner, ...options.headers }),
      postDataBuffer: () => options.bytes ?? null,
      url: () =>
        `http://fixture.invalid${server ? "/_serverFn/" + query : pattern.replaceAll("**", "").replace(/\?$/, "") + query}`,
      postDataJSON: () => data,
      postData: () => JSON.stringify(seroval.toJSON({ data })),
    };
    await handlers.get(pattern)({
      request: () => request,
      fulfill: async (value) => {
        response = structuredClone(value);
      },
      fallback: async () => {
        response = { fallback: true };
      },
    });
    return response;
  }
  state.uploadDelayMs = 0;
  const server = (name, data) => {
    functionNames.set(name, `${name}_fixture`);
    return call("**/_serverFn/**", "POST", data, name);
  };
  return { state, call, server };
}

test("local folder CRUD and moves respect conflict, hierarchy and root restoration", async () => {
  const { state, call } = await setup();
  const create = async (name, parentId = null) =>
    (await call("**/api/library/folders", "POST", { name, parentId })).json.folder;
  const parent = await create("Sample folder");
  const child = await create("Nested", parent.id);
  assert.equal(
    (await call("**/api/library/folders", "POST", { name: "Sample folder", parentId: null }))
      .status,
    409,
  );
  await call("**/api/library/folders", "PATCH", { id: child.id, name: "Renamed nested" });
  assert.equal(state.folders[1].name, "Renamed nested");
  const ids = [state.items[0].id];
  state.failNext.add("moveItems");
  assert.equal(
    (await call("**/api/library/bulk-move", "POST", { itemIds: ids, folderId: child.id })).status,
    503,
  );
  assert.equal(state.items[0].folder_id, null);
  assert.equal(
    (await call("**/api/library/bulk-move", "POST", { itemIds: ids, folderId: child.id })).json
      .movedCount,
    1,
  );
  assert.equal(state.items[0].folder_id, child.id);
  const deleted = await call("**/api/library/folders", "DELETE", { id: parent.id });
  assert.deepEqual(deleted.json, { deletedFolderCount: 2, movedToRootCount: 1 });
  assert.equal(state.items[0].folder_id, null);
  assert.equal(state.folders.length, 0);
});

test("version fixture retains historical text, enforces revision conflict and supports retry", async () => {
  const { state, call } = await setup();
  const original = structuredClone(state.items[0]);
  const body = {
    operation: "replace_text",
    id: original.id,
    generation: original.content_generation,
    revision: original.content_revision,
    text: "New sample revision",
  };
  state.failNext.add("replaceText");
  assert.equal((await call("**/api/library/items**", "POST", body)).status, 503);
  assert.equal(state.items[0].content_revision, 1);
  assert.equal((await call("**/api/library/items**", "POST", body)).json.revision, 2);
  assert.equal((await call("**/api/library/items**", "POST", body)).status, 409);
  const query = `?id=${original.id}&generation=${original.content_generation}`;
  const history = await call("**/api/library/items**", "GET", null, query + "&history=1");
  assert.deepEqual(
    history.json.versions.map((item) => [item.revision, item.current]),
    [
      [2, true],
      [1, false],
    ],
  );
  const previous = await call("**/api/library/items**", "GET", null, query + "&revision=1");
  assert.equal(previous.json.content_text, original.content_text);
});

test("membership changes stay local, reject real addresses, and preserve owner membership", async () => {
  const { state, server } = await setup();
  const project_id = core.reviewProject.id;
  assert.equal(
    (await server("inviteMember", { project_id, email: "person@example.com", role: "viewer" }))
      .status,
    400,
  );
  const invited = await server("inviteMember", {
    project_id,
    email: "sample@example.invalid",
    role: "viewer",
  });
  assert.equal(invited.json.result.auto_accepted, false);
  assert.equal((await server("listInvites", { project_id })).json.result.length, 1);
  await server("revokeInvite", { id: invited.json.result.id });
  assert.equal((await server("listInvites", { project_id })).json.result.length, 0);
  assert.equal((await server("removeMember", { project_id, user_id: owner })).status, 400);
  const member = state.members.find((member) => member.role === "viewer");
  await server("updateMemberRole", { project_id, user_id: member.user_id, role: "editor" });
  assert.equal(member.role, "editor");
  await server("removeMember", { project_id, user_id: member.user_id });
  assert.equal(state.members.length, 1);
});

test("instructions-only project updates match the real optional patch contract", async () => {
  const { state, server } = await setup();
  await server("updateProject", {
    id: core.reviewProject.id,
    system_prompt: "Sample instructions",
  });
  assert.equal(state.projects[0].system_prompt, "Sample instructions");
  assert.equal(state.projects[0].name, core.reviewProject.name);
});

test("Library review rejects mismatched owner before reads or mutation and isolates contexts", async () => {
  const first = await setup(),
    second = await setup();
  const other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const body = { name: "Private sample folder", parentId: null };
  assert.equal((await first.call("**/api/library/folders", "POST", body, "", other)).status, 401);
  assert.equal(first.state.folders.length, 0);
  await first.call("**/api/library/folders", "POST", body);
  assert.equal(first.state.folders.length, 1);
  assert.equal(second.state.folders.length, 0);
  const item = first.state.items[0];
  const replacement = {
    operation: "replace_text",
    id: item.id,
    generation: item.content_generation,
    revision: item.content_revision,
    text: "Wrong owner",
  };
  assert.equal(
    (await first.call("**/api/library/items**", "POST", replacement, "", other)).status,
    401,
  );
  assert.equal(item.content_revision, 1);
  assert.equal(
    (await first.call("**/api/library/items**", "GET", null, `?id=${item.id}&generation=${other}`))
      .status,
    404,
  );
  assert.equal(
    (
      await first.call(
        "**/api/library/bulk-move",
        "POST",
        { itemIds: [item.id], folderId: first.state.folders[0].id },
        "",
        other,
      )
    ).status,
    401,
  );
  assert.equal(item.folder_id, null);
});

test("project file review uses real metadata validation, local bytes, idempotency and download revocation", async () => {
  const { state, call, server } = await setup();
  const bytes = Buffer.from("Synthetic upload only\n");
  const options = {
    bytes,
    headers: {
      "content-type": "application/octet-stream",
      "x-kova-project-id": core.reviewProject.id,
      "x-kova-file-name": encodeURIComponent("Sample upload.txt"),
      "x-kova-file-kind": "file",
      "x-kova-idempotency-key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  };
  state.failNext.add("uploadFile");
  assert.equal(
    (await call("**/api/project-files**", "POST", null, "", owner, options)).status,
    503,
  );
  assert.equal(state.files.length, 1);
  const uploaded = await call("**/api/project-files**", "POST", null, "", owner, options);
  assert.equal(uploaded.status, 201);
  const id = uploaded.json.file.id;
  await call("**/api/project-files**", "POST", null, "", owner, options);
  assert.equal(state.files.length, 2, "retry with the same idempotency key does not duplicate");
  assert.equal(
    (await server("listFiles", { project_id: core.reviewProject.id, kind: "file" })).json.result
      .length,
    2,
  );
  const signed = await call("**/api/project-files**", "GET", null, `?id=${id}`);
  const url = new URL(signed.json.url);
  assert.equal(url.origin, "http://127.0.0.1:4189");
  assert.equal(url.pathname, "/api/private-files");
  const downloaded = await call("**/api/private-files?**", "GET", null, url.search);
  assert.deepEqual(Buffer.from(downloaded.body), bytes);
  assert.match(downloaded.headers["Content-Disposition"], /^attachment;/);
  state.failNext.add("deleteFile");
  assert.equal((await call("**/api/project-files**", "DELETE", { id })).status, 503);
  assert.equal(state.files.length, 2);
  assert.equal((await call("**/api/project-files**", "DELETE", { id })).status, 204);
  assert.equal((await call("**/api/private-files?**", "GET", null, url.search)).status, 404);
});

test("project file fixture rejects unsafe bytes, foreign owners and invented project identities", async () => {
  const { state, call } = await setup();
  const options = {
    bytes: Buffer.from("not an image"),
    headers: {
      "content-type": "application/octet-stream",
      "x-kova-project-id": core.reviewProject.id,
      "x-kova-file-name": "Sample.png",
      "x-kova-file-kind": "image",
      "x-kova-idempotency-key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  };
  assert.equal(
    (await call("**/api/project-files**", "POST", null, "", owner, options)).json.error,
    "image_signature_required",
  );
  assert.equal(
    (await call("**/api/project-files**", "POST", null, "", "other", options)).status,
    401,
  );
  options.headers["x-kova-project-id"] = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.equal(
    (await call("**/api/project-files**", "POST", null, "", owner, options)).status,
    404,
  );
  assert.equal(state.files.length, 1);
});

test("saved-title rename fixture preserves file and content identity with owner/title/generation checks", async () => {
  const { state, server, call } = await setup();
  const before = structuredClone(state.items[0]);
  const data = {
    expectedOwnerId: owner,
    id: before.id,
    generation: before.content_generation,
    previousTitle: before.title,
    title: "  Renamed synthetic notes  ",
  };
  const wrong = await server("renameLibrarySavedItem", {
    ...data,
    expectedOwnerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(wrong.status, 409);
  assert.deepEqual(state.items[0], before);
  state.failNext.add("renameLibrarySavedItem");
  assert.equal((await server("renameLibrarySavedItem", data)).status, 503);
  assert.deepEqual(state.items[0], before);
  const result = await server("renameLibrarySavedItem", data);
  assert.equal(result.json.result.title, "Renamed synthetic notes");
  assert.equal(state.items[0].file_name, before.file_name);
  assert.equal(state.items[0].content_text, before.content_text);
  assert.equal(state.items[0].content_generation, before.content_generation);
  assert.equal((await server("renameLibrarySavedItem", data)).status, 409);
  const reread = await call(
    "**/api/library/items**",
    "GET",
    null,
    `?id=${before.id}&generation=${before.content_generation}`,
  );
  assert.equal(reread.json.title, "Renamed synthetic notes");
});
