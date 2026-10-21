import assert from "node:assert/strict";
import test from "node:test";
import { createCollaborationClient } from "../src/lib/collaboration-client.mjs";
import { readResponseBytesBounded } from "../src/lib/endpoint-reliability.mjs";
import {
  createHookHarness,
  elements,
  loadUiModule,
  settle,
  text,
} from "../tests/helpers/ui-state-harness.mjs";
import {
  createVersionConflictReviewFixture,
  installLibraryVersionConflictSample,
  versionConflictConversation,
  versionConflictLibraryItem,
  VERSION_CONFLICT_REVIEW_OPTIONS,
  VERSION_CONFLICT_REVIEW_DISCLOSURE,
  VERSION_CONFLICT_REVIEW_OWNER as owner,
  VERSION_CONFLICT_CHAT_ID as chatId,
  VERSION_CONFLICT_MESSAGE_ID as messageId,
  VERSION_CONFLICT_DOCUMENT_ID as documentId,
  VERSION_CONFLICT_LIBRARY_ID as libraryId,
  VERSION_CONFLICT_LIBRARY_GENERATION as generation,
  VERSION_CONFLICT_INITIAL_CONTENT as initialContent,
  VERSION_CONFLICT_CURRENT_CONTENT as currentContent,
  VERSION_CONFLICT_LIBRARY_CURRENT_CONTENT as currentLibraryContent,
} from "./version-conflict-review-fixture.mjs";

const token = "synthetic-conflict-test-token";
const backend = "https://mfbycmbjygcfkrsuepxf.supabase.co";
function fixture(scenario = "result-version-conflict") {
  let active = true;
  const items = [{ id: "unrelated", content_text: "Unchanged unrelated item" }];
  const installedLibraryItem =
    scenario === "library-version-conflict"
      ? installLibraryVersionConflictSample(items)
      : undefined;
  const runtime = createVersionConflictReviewFixture(scenario, {
    isActive: () => active,
    expectedAccessToken: token,
    installedLibraryItem,
  });
  const request = async ({
    method = "POST",
    path = `${backend}/rest/v1/rpc/collaboration_rpc`,
    body,
    raw,
    headers = {},
    signal,
  } = {}) => {
    let output;
    await runtime.handler({
      request: () => ({
        url: () => path,
        method: () => method,
        headers: () => ({
          authorization: `Bearer ${token}`,
          "x-kova-owner": owner,
          "content-type": "application/json",
          ...headers,
        }),
        postData: () => raw ?? (body === undefined ? null : JSON.stringify(body)),
        signal: () => signal,
      }),
      fulfill: async (value) => {
        output = value;
      },
      fallback: async () => {
        output = { fallback: true };
      },
    });
    return output;
  };
  return {
    ...runtime,
    items,
    installedLibraryItem,
    request,
    stop: () => {
      active = false;
    },
    rpc: (operation, data, options = {}) =>
      request({ ...options, body: { p_operation: operation, p_data: data } }),
  };
}
const open = { chatId, messageId, projectId: null, content: initialContent };
const save = {
  documentId,
  expectedRevision: 1,
  content: "My fictional local draft must not be stored or echoed.",
};
const libraryPath = `http://127.0.0.1:4189/api/library/items`;
const itemQuery = `?id=${libraryId}&generation=${generation}`;

test("conflict scenarios expose fixed owner-scoped samples and disclose inert save behavior", () => {
  assert.deepEqual(
    VERSION_CONFLICT_REVIEW_OPTIONS.map(({ id }) => id),
    ["result-version-conflict", "library-version-conflict"],
  );
  for (const option of VERSION_CONFLICT_REVIEW_OPTIONS)
    assert.deepEqual(option.accounts, ["free", "plus", "pro"]);
  assert.match(VERSION_CONFLICT_REVIEW_DISCLOSURE, /No authored draft is saved or echoed/);
  assert.match(VERSION_CONFLICT_REVIEW_DISCLOSURE, /Refresh Library, then reopen Versions/);
  const chat = versionConflictConversation();
  assert.equal(chat.id, chatId);
  assert.equal(chat.messages[1].content, initialContent);
  assert.ok(initialContent.length >= 600, "The real artifact detector exposes a writing Result");
  const items = [];
  installLibraryVersionConflictSample(items);
  assert.equal(items[0].id, libraryId);
  assert.equal(items[0].user_id, owner);
  assert.throws(() => installLibraryVersionConflictSample(items), /Fresh/);
  items[0].content_text = "external mutation";
  assert.notEqual(versionConflictLibraryItem().content_text, "external mutation");
});

test("Result exact 409/40001 advances only the fixed read snapshot and never accepts a draft", async () => {
  const f = fixture();
  const first = await f.rpc("open", open);
  assert.equal(first.json.document.revision, 1);
  assert.equal(first.json.document.content, initialContent);
  assert.equal(first.headers["Cache-Control"], "no-store");
  const failed = await f.rpc("save", save);
  assert.equal(failed.status, 409);
  assert.equal(failed.json.code, "40001");
  assert.doesNotMatch(JSON.stringify(failed), /My fictional local draft/);
  const current = await f.rpc("get", { documentId });
  assert.equal(current.json.document.revision, 2);
  assert.equal(current.json.document.content, currentContent);
  assert.equal(current.json.document.private_owner_id, owner);
  assert.deepEqual(
    current.json.versions.map(({ revision }) => revision),
    [2, 1],
  );
  assert.equal((await f.rpc("save", { ...save, expectedRevision: 2 })).status, 409);
  assert.equal((await f.rpc("get", { documentId })).json.document.revision, 2);
  assert.equal(
    (await f.rpc("get_version", { documentId, revision: 1 })).json.content,
    initialContent,
  );
  assert.equal(
    (await f.rpc("get_version", { documentId, revision: 2 })).json.content,
    currentContent,
  );
  assert.equal((await fixture().rpc("open", open)).json.document.revision, 1);
});

test("Result invalid, foreign, aborted and stale requests cannot arm the conflict", async () => {
  const f = fixture();
  for (const data of [
    { ...save, documentId: libraryId },
    { ...save, expectedRevision: 0 },
    { ...save, extra: true },
    { ...save, content: "x".repeat(400001) },
  ])
    assert.equal((await f.rpc("save", data)).status, 400);
  assert.equal(
    (await f.rpc("save", save, { headers: { authorization: "Bearer other" } })).status,
    401,
  );
  assert.equal((await f.rpc("save", save, { signal: AbortSignal.abort() })).status, 499);
  assert.equal((await f.request({ method: "GET" })).status, 405);
  assert.equal((await f.request({ raw: "{" })).status, 400);
  assert.equal((await f.request({ raw: "x".repeat(2_000_001) })).status, 413);
  assert.equal(
    (await f.rpc("save", save, { path: `${backend}/rest/v1/rpc/collaboration_rpc?extra=1` }))
      .status,
    400,
  );
  assert.equal((await f.rpc("open", { ...open, projectId: documentId })).status, 400);
  assert.equal((await f.rpc("comment", {})).status, 503);
  assert.equal((await f.rpc("get", { documentId })).json.document.revision, 1);
  assert.deepEqual(
    await f.request({ path: "https://example.invalid/rest/v1/rpc/collaboration_rpc" }),
    { fallback: true },
  );
  f.stop();
  assert.equal((await f.rpc("get", { documentId })).status, 401);
  const disposed = fixture();
  disposed.dispose();
  assert.equal((await disposed.rpc("open", open)).status, 401);
});

test("real collaboration client receives the precise conflict error from the local fixture", async () => {
  const f = fixture();
  const client = createCollaborationClient({
    config: { url: backend, publishableKey: "synthetic-public-key" },
    getSession: async () => ({ data: { session: { user: { id: owner }, access_token: token } } }),
    fetchImpl: async (path, init) => {
      const output = await f.request({
        path,
        method: init.method,
        raw: init.body,
        headers: Object.fromEntries(
          Object.entries(init.headers).map(([key, value]) => [key.toLowerCase(), value]),
        ),
        signal: init.signal,
      });
      return Response.json(output.json, { status: output.status });
    },
  });
  assert.equal((await client(owner, "open", open)).document.revision, 1);
  await assert.rejects(client(owner, "save", save), {
    code: "40001",
    message: "This draft changed elsewhere. Your edits are preserved.",
  });
  assert.equal((await client(owner, "get", { documentId })).document.revision, 2);
});

test("Library rejected replacement exposes only fixed stored revision 2 while preserving revision 1", async () => {
  const f = fixture("library-version-conflict");
  const body = {
    operation: "replace_text",
    id: libraryId,
    generation,
    revision: 1,
    text: "My unsaved Library draft",
  };
  const read = (suffix = "") =>
    f.request({ method: "GET", path: libraryPath + itemQuery + suffix });
  const original = await read();
  assert.equal((await read("&history=1")).json.versions[0].revision, 1);
  assert.equal(
    (await f.request({ path: libraryPath, body: { ...body, revision: 2 } })).status,
    400,
  );
  assert.equal(f.installedLibraryItem.content_revision, 1);
  for (let attempt = 0; attempt < 2; attempt++) {
    const output = await f.request({ path: libraryPath, body });
    assert.equal(output.status, 409);
    assert.deepEqual(output.json, {
      error: "Library could not confirm this request. Refresh and try again.",
    });
    assert.doesNotMatch(JSON.stringify(output), /My unsaved Library draft/);
  }
  const current = (await read()).json;
  assert.equal(current.content_revision, 2);
  assert.equal(current.content_text, currentLibraryContent);
  assert.deepEqual((await read("&revision=2")).json, current);
  assert.deepEqual((await read("&revision=1")).json, original.json);
  assert.deepEqual(
    (await read("&history=1")).json.versions.map(({ revision, current }) => ({
      revision,
      current,
    })),
    [
      { revision: 2, current: true },
      { revision: 1, current: false },
    ],
  );
  assert.deepEqual(
    f.installedLibraryItem,
    current,
    "The existing list row reflects the fixed current revision",
  );
  assert.equal(f.items[0].content_text, "Unchanged unrelated item");
  assert.notEqual(
    current,
    f.installedLibraryItem,
    "Detail responses are detached from shared state",
  );
  current.content_text = "Tampered response";
  assert.equal((await read()).json.content_text, currentLibraryContent);
  assert.equal(
    (await f.request({ path: libraryPath, body: { ...body, revision: 2 } })).status,
    409,
  );
  assert.equal(f.installedLibraryItem.content_revision, 2);
  for (const patch of [
    { id: documentId },
    { generation: documentId },
    { revision: 3 },
    { extra: true },
    { text: "é".repeat(150001) },
  ])
    assert.equal((await f.request({ path: libraryPath, body: { ...body, ...patch } })).status, 400);
  assert.equal((await read("&history=1&revision=1")).status, 400);
  assert.equal((await read("&id=" + libraryId)).status, 400);
  assert.equal(
    (await f.request({ path: libraryPath, body, headers: { "x-kova-owner": "other" } })).status,
    401,
  );
  assert.equal(
    (await f.request({ path: libraryPath, body, signal: AbortSignal.abort() })).status,
    499,
  );
  assert.equal(
    (await f.request({ path: libraryPath, body: { ...body, operation: "delete_text" } })).status,
    503,
  );
  assert.deepEqual(await f.request({ path: libraryPath, body: { operation: "list" } }), {
    fallback: true,
  });
  f.dispose();
  assert.equal((await read()).status, 401);
  assert.equal(fixture("library-version-conflict").installedLibraryItem.content_revision, 1);
});

test("Library conflict setup pins the installed synthetic item and invalid writes cannot advance it", async () => {
  const options = { isActive: () => true, expectedAccessToken: token };
  assert.throws(
    () => createVersionConflictReviewFixture("library-version-conflict", options),
    /freshly installed/,
  );
  for (const patch of [
    { id: documentId },
    { user_id: "other" },
    { content_generation: documentId },
    { content_revision: 2 },
    { content_text: "Other content" },
  ])
    assert.throws(
      () =>
        createVersionConflictReviewFixture("library-version-conflict", {
          ...options,
          installedLibraryItem: { ...versionConflictLibraryItem(), ...patch },
        }),
      /freshly installed/,
    );
  const f = fixture("library-version-conflict");
  const body = {
    operation: "replace_text",
    id: libraryId,
    generation,
    revision: 1,
    text: "Never stored",
  };
  assert.equal(
    (await f.request({ path: libraryPath, body, headers: { authorization: "Bearer other" } }))
      .status,
    401,
  );
  assert.equal(
    (await f.request({ path: libraryPath, body, signal: AbortSignal.abort() })).status,
    499,
  );
  assert.equal(
    (await f.request({ path: libraryPath, body: { ...body, generation: documentId } })).status,
    400,
  );
  assert.equal(f.installedLibraryItem.content_revision, 1);
  f.installedLibraryItem.id = documentId;
  assert.equal((await f.request({ path: libraryPath, body })).status, 409);
  assert.equal(f.installedLibraryItem.content_revision, 1);
});

test("actual Library client and Versions dialog retain draft and dirty-close protection after fixture 409", async () => {
  const f = fixture("library-version-conflict");
  const hooks = createHookHarness();
  const callbacks = [];
  const requests = [];
  const client = loadUiModule(
    "src/lib/library-items-client.ts",
    {
      "./library-original-client": {
        originalLibraryHeaders: async () => ({
          authorization: `Bearer ${token}`,
          "x-kova-owner": owner,
        }),
      },
      "./endpoint-reliability.mjs": { readResponseBytesBounded },
      "./library-detail": loadUiModule("src/lib/library-detail.ts", {}),
    },
    {
      AbortSignal,
      Error,
      TextDecoder,
      fetch: async (path, init) => {
        requests.push(init.body ? JSON.parse(init.body) : path);
        const output = await f.request({
          method: init.method,
          path: `http://127.0.0.1:4189${path}`,
          raw: init.body,
          headers: init.headers,
          signal: init.signal,
        });
        if (output.fallback) {
          // The separate CRUD list route serializes the shared stored items.
          // Its registered handler is covered by version-conflict-adapter.test.mjs.
          assert.equal(JSON.parse(init.body).operation, "list");
          return Response.json({
            items: f.items.filter((item) => item.id === libraryId),
            cursor: null,
          });
        }
        return Response.json(output.json, { status: output.status });
      },
    },
  );
  const query = { query: "", sort: "newest", filter: "all", folder: "all", favorites: "" };
  const list = () => client.listLibraryPage(owner, query, new AbortController().signal);
  const initialRow = (await list()).items[0];
  assert.equal(initialRow.content_loaded, false);
  assert.equal(initialRow.content_revision, 1);
  const primitives = new Proxy({}, { get: (_target, name) => name });
  const createDialog = (harness) =>
    loadUiModule(
      "src/components/LibraryVersionsDialog.tsx",
      {
        react: harness.react,
        "@/components/ui/dialog": primitives,
        "@/components/ui/alert-dialog": primitives,
        "@/components/ui/button": { Button: "button" },
        "@/lib/dialog-return-focus": {},
        "@/lib/work-view-lifetime.mjs": {
          createWorkViewLifetime: () => {
            const controller = new AbortController();
            return { controller, dispose: () => controller.abort() };
          },
        },
        "@/lib/library-items-client": client,
        "@/lib/library-original-client": {},
      },
      {
        Error,
        HTMLElement: class {},
        window: { location: { href: "http://127.0.0.1:4189/library" } },
      },
    );
  const { LibraryVersionsDialog } = createDialog(hooks);
  const props = {
    ownerId: owner,
    item: await client.readLibraryItem(owner, initialRow, new AbortController().signal),
    onUpdated: () => callbacks.push("updated"),
    onClose: () => callbacks.push("closed"),
  };
  const render = () => hooks.render(LibraryVersionsDialog, props);
  const flush = async () => {
    for (let i = 0; i < 5; i++) {
      render();
      await settle();
    }
    return render();
  };
  let tree = await flush();
  elements(tree, (n) => n.type === "textarea")[0].props.onChange({
    target: { value: "Fictional unsaved local change" },
  });
  tree = render();
  elements(
    tree,
    (n) => n.type === "button" && text(n) === "Save text as new version",
  )[0].props.onClick();
  tree = await flush();
  assert.match(text(tree), /Library could not confirm this request/);
  assert.match(text(tree), /Your unsaved text is still here/);
  assert.match(text(tree), /Refresh Library, then reopen Versions/);
  assert.equal(
    elements(tree, (n) => n.type === "textarea")[0].props.value,
    "Fictional unsaved local change",
  );
  assert.deepEqual(callbacks, []);
  assert.deepEqual(requests.at(-1), {
    operation: "replace_text",
    id: libraryId,
    generation,
    revision: 1,
    text: "Fictional unsaved local change",
  });
  elements(tree, (n) => n.type === "Dialog")[0].props.onOpenChange(false);
  assert.equal(elements(render(), (n) => n.type === "AlertDialog")[0].props.open, true);
  assert.equal(
    props.item.content_revision,
    1,
    "A stored revision change must not mutate the open dialog's loaded item",
  );
  assert.equal(f.installedLibraryItem.content_revision, 2);
  hooks.unmount();

  // withItem deliberately pins the list row's revision. Reopening without an
  // explicit list refresh must reject the fixed newer detail, not bypass it.
  await assert.rejects(
    client.readLibraryItem(owner, initialRow, new AbortController().signal),
    /This item changed\. Refresh Library to open its current version/,
  );
  assert.equal(initialRow.content_revision, 1, "The stale list row remains detached");
  const refreshedRow = (await list()).items[0];
  assert.equal(refreshedRow.content_loaded, false);
  assert.equal(refreshedRow.content_revision, 2);
  const freshItem = await client.readLibraryItem(owner, refreshedRow, new AbortController().signal);
  assert.equal(freshItem.content_revision, refreshedRow.content_revision);
  const reopenedHooks = createHookHarness();
  const { LibraryVersionsDialog: ReopenedDialog } = createDialog(reopenedHooks);
  const reopen = () => reopenedHooks.render(ReopenedDialog, { ...props, item: freshItem });
  for (let i = 0; i < 5; i++) {
    reopen();
    await settle();
  }
  const reopened = reopen();
  assert.match(text(reopened), /Text from version\s+2/);
  assert.equal(
    elements(reopened, (n) => n.type === "textarea")[0].props.value,
    currentLibraryContent,
  );
  assert.ok(elements(reopened, (n) => n.props["aria-label"] === "Read version 1").length);
  assert.deepEqual(callbacks, [], "Reopening a fixed newer version is not a save-success callback");
  reopenedHooks.unmount();
});
