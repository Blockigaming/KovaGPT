import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import { createHookHarness, deferred, loadUiModule, settle } from "../helpers/ui-state-harness.mjs";

const detail = loadUiModule("src/lib/library-detail.ts", {});
const owner = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const generation = "33333333-3333-4333-8333-333333333333";
const another = "44444444-4444-4444-8444-444444444444";
const search = { item: id, generation };
const record = {
  id,
  content_generation: generation,
  content_revision: 3,
  title: "Private saved file",
  content_text: "private body",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-10-18T11:12:13.123456+00:00",
  metadata: {},
};

function clientFixture() {
  const calls = [];
  const state = { record, status: 200, account: owner };
  const client = loadUiModule(
    "src/lib/library-items-client.ts",
    {
      "./library-detail": detail,
      "./endpoint-reliability.mjs": reliability,
      "./library-original-client": {
        originalLibraryHeaders: async (expected, signal) => {
          signal.throwIfAborted();
          if (state.account !== expected) throw Error("Your account changed.");
          return { "X-Kova-Owner": expected, Authorization: "Bearer fixture" };
        },
      },
    },
    {
      AbortSignal,
      TextDecoder,
      fetch: async (url, options) => {
        calls.push({ url, options });
        return Response.json(state.record, { status: state.status });
      },
    },
  );
  return { client, state, calls };
}

test("detail search accepts only canonical durable identity and retains an invalid-link state", () => {
  assert.equal(JSON.stringify(detail.validateLibraryDetailSearch(search)), JSON.stringify(search));
  assert.equal(JSON.stringify(detail.validateLibraryDetailSearch({})), "{}");
  for (const raw of [
    { item: id },
    { generation },
    { item: "", generation },
    { item: [id], generation },
    { item: `chat:${id}`, generation },
    { item: id, generation: "token" },
    { item: id.repeat(1000), generation },
  ]) {
    assert.equal(detail.validateLibraryDetailSearch(raw).invalidDetail, true);
    assert.equal(detail.libraryDetailKey(detail.validateLibraryDetailSearch(raw)), "invalid");
  }
  const uppercase = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  assert.equal(
    detail.validateLibraryDetailSearch({ item: uppercase, generation }).item,
    uppercase.toLowerCase(),
  );
});

test("Copy link contains only item and generation; synthetic and generationless rows get no link", () => {
  const path = detail.libraryItemDetailPath({
    ...record,
    query: "private search",
    token: "secret",
  });
  const url = new URL(path, "https://kova.test");
  assert.equal(url.pathname, "/library");
  assert.deepEqual([...url.searchParams.keys()], ["item", "generation"]);
  assert.equal(url.searchParams.get("item"), id);
  assert.equal(url.searchParams.get("generation"), generation);
  assert.doesNotMatch(path, /body|Private|secret|revision|token|share/);
  for (const value of [
    { id },
    { id: `chat:${id}`, content_generation: generation },
    { id: `work:${id}`, content_generation: generation },
    { id: `workspace:document:${id}`, content_generation: generation },
  ])
    assert.equal(detail.libraryItemDetailPath(value), null);
});

test("modified metadata uses only a valid supplied timestamp, never the saved date", () => {
  const { client } = clientFixture();
  assert.equal(client.libraryItemFromRow(record, true).updated_at, record.updated_at);
  for (const updated_at of [undefined, null, "", "invalid", 0, "0", "2026-20-99T10:00:00Z"])
    assert.equal(client.libraryItemFromRow({ ...record, updated_at }, true).updated_at, undefined);
  assert.notEqual(client.libraryItemFromRow(record, true).updated_at, record.created_at);
});

test("authenticated item links read the current revision of the exact generation; row handoffs stay revision-strict", async () => {
  const f = clientFixture();
  const signal = new AbortController().signal;
  const loaded = await f.client.readLibraryItemAtGeneration(owner, record, signal);
  assert.equal(loaded.content_revision, 3);
  assert.equal(loaded.content_text, "private body");
  assert.equal(loaded.updated_at, record.updated_at);
  assert.equal(f.calls[0].url, `/api/library/items?id=${id}&generation=${generation}`);
  const options = f.calls[0].options;
  assert.equal(options.headers["X-Kova-Owner"], owner);
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.mode, "same-origin");
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  await assert.rejects(
    f.client.readLibraryItem(owner, { ...record, content_revision: 2 }, signal),
    /changed/,
  );
  await assert.doesNotReject(f.client.readLibraryItem(owner, record, signal));
});

test("unknown/deleted/inaccessible links retain 404 and stale generations or malformed revisions cannot supply content", async () => {
  const f = clientFixture();
  const signal = new AbortController().signal;
  f.state.status = 404;
  f.state.record = { error: "This Library item is no longer available." };
  await assert.rejects(
    f.client.readLibraryItemAtGeneration(owner, record, signal),
    (error) => error instanceof f.client.LibraryItemsRequestError && error.status === 404,
  );
  f.state.status = 200;
  for (const overrides of [
    { id: another },
    { content_generation: another },
    { content_revision: undefined },
    { content_revision: 0 },
    { content_revision: "3" },
  ]) {
    f.state.record = { ...record, ...overrides };
    await assert.rejects(f.client.readLibraryItemAtGeneration(owner, record, signal), /changed/);
  }
});

test("malformed identity, aborted work, and switched authentication never send a detail fetch", async () => {
  const f = clientFixture();
  const signal = new AbortController().signal;
  await assert.rejects(
    f.client.readLibraryItemAtGeneration(owner, { ...record, id: `chat:${id}` }, signal),
    /invalid/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    f.client.readLibraryItemAtGeneration(owner, record, aborted.signal),
    /abort/i,
  );
  f.state.account = another;
  await assert.rejects(
    f.client.readLibraryItemAtGeneration(owner, record, signal),
    /account changed/,
  );
  assert.equal(f.calls.length, 0);
});

function hookFixture(read) {
  const hooks = createHookHarness();
  const { client } = clientFixture();
  const { useLibraryDetail } = loadUiModule(
    "src/hooks/use-library-detail.ts",
    {
      react: hooks.react,
      "@/lib/library-detail": detail,
      "@/lib/library-items-client": { ...client, readLibraryItemAtGeneration: read },
    },
    { AbortController },
  );
  const props = { search, ownerId: owner, accountLoaded: true, cleared: false };
  return { hooks, props, client, render: () => hooks.render(useLibraryDetail, props) };
}

test("direct detail works without loading list rows; sign-out, invalid, and unresolved account do not request data", async () => {
  const requests = [];
  const f = hookFixture(async (...args) => {
    requests.push(args);
    return record;
  });
  f.props.accountLoaded = false;
  assert.equal(f.render().status, "loading");
  f.props.accountLoaded = true;
  f.props.ownerId = null;
  assert.equal(f.render().status, "signed-out");
  f.props.ownerId = owner;
  f.props.search = { invalidDetail: true };
  assert.equal(f.render().status, "invalid");
  assert.equal(requests.length, 0);
  f.props.search = search;
  assert.equal(f.render().status, "loading");
  await settle();
  assert.equal(f.render().item.title, record.title);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], owner);
});

test("account transitions immediately conceal old detail and ignore out-of-order completion", async () => {
  const first = deferred(),
    second = deferred();
  const requests = [];
  const f = hookFixture((...args) => {
    requests.push(args);
    return requests.length === 1 ? first.promise : second.promise;
  });
  f.render();
  f.props.ownerId = another;
  assert.equal(f.render().item, null);
  assert.equal(requests[0][2].aborted, true);
  second.resolve({ ...record, title: "Second account item" });
  await settle();
  first.resolve(record);
  await settle();
  assert.equal(f.render().item.title, "Second account item");
  f.props.ownerId = null;
  assert.equal(f.render().item, null);
  assert.equal(f.render().status, "signed-out");
});

test("Back/newer link, account cleanup, and unmount abort and suppress pending detail", async () => {
  const pending = [];
  const signals = [];
  const f = hookFixture((_owner, _item, signal) => {
    const request = deferred();
    pending.push(request);
    signals.push(signal);
    return request.promise;
  });
  f.render();
  f.props.search = { item: another, generation };
  assert.equal(f.render().item, null);
  assert.equal(signals[0].aborted, true);
  f.props.search = {};
  assert.equal(f.render().status, "closed");
  assert.equal(signals[1].aborted, true);
  for (const request of pending) request.resolve(record);
  await settle();
  assert.equal(f.render().item, null);
  f.props.search = search;
  f.render();
  f.props.cleared = true;
  assert.equal(f.render().status, "cleared");
  assert.equal(signals[2].aborted, true);
  f.props.cleared = false;
  f.render();
  f.hooks.unmount();
  assert.equal(signals[3].aborted, true);
  pending[3].resolve(record);
  await settle();
  assert.equal(f.render().item, null);
});

test("404 is unavailable, retry loads afresh, and transport failures never look like an empty Library", async () => {
  let calls = 0;
  const f = hookFixture(async () => {
    calls++;
    if (calls === 1) throw new f.client.LibraryItemsRequestError("unavailable", 404);
    if (calls === 2) throw Error("network");
    return record;
  });
  f.render();
  await settle();
  let state = f.render();
  assert.equal(state.status, "unavailable");
  assert.equal(state.item, null);
  state.retry();
  assert.equal(f.render().status, "loading");
  await settle();
  state = f.render();
  assert.equal(state.status, "error");
  state.retry();
  f.render();
  await settle();
  assert.equal(f.render().status, "ready");
});

test("the route preserves list state, has a clickable parent, and integrates measured storage separately", () => {
  const source = readFileSync("src/routes/library.tsx", "utf8");
  const parsed = ts.createSourceFile(
    "library.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const functionText = (name) =>
    declarations.find((node) => node.name.getText(parsed) === name).initializer.getText(parsed);
  const opened = functionText("openItemPreview"),
    closed = functionText("closeItemPreview");
  assert.match(opened, /navigate\(\{ search, resetScroll: false \}\)/);
  assert.match(closed, /router.history.back\(\)/);
  assert.match(closed, /replace: true, resetScroll: false/);
  assert.doesNotMatch(
    opened + closed,
    /setQuery|setFilter|setSort|setFolderScope|setSourceFilter|setDateFilter/,
  );
  assert.match(source, /restoreDialogFocus\([\s\S]*?origin\?\.url/);
  assert.match(
    source,
    /aria-label="Breadcrumb"[\s\S]*?href="\/library"[\s\S]*?closeItemPreview\(\)/,
  );
  assert.match(source, /Account cloud storage/);
  assert.match(source, /<StorageDashboard/);
  assert.match(source, /Loaded file sizes cover this list only and are not account storage usage/);
  assert.match(source, /Last-modified sorting, project references, and processing status are not/);
  assert.match(source, /File Trash and moving files to projects are not supported/);
  assert.match(source, /Rename saved title\s+changes only the Library title/);
});

function routeCallbacks() {
  const source = readFileSync("src/routes/library.tsx", "utf8");
  const parsed = ts.createSourceFile(
    "library.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const dependencies = {
    ...detail,
    principalReady: true,
    libraryCleared: false,
    isSignedIn: true,
    principal: owner,
    principalRef: { current: owner },
    detailKey: detail.libraryDetailKey(search),
    detailKeyRef: { current: null },
    previewOriginRef: { current: null },
    detailHistoryRef: { current: null },
    previewReturnFocusRef: { current: null },
    librarySearchRef: { current: null },
    libraryRootRef: { current: null },
    window: { location: { href: "https://kova.test/library", origin: "https://kova.test" } },
    URL,
  };
  const calls = [];
  Object.assign(dependencies, {
    setPreviewView: (value) => calls.push(["view", value]),
    setPreviewItem: (value) => calls.push(["item", value]),
    setVersionItem: (value) => calls.push(["version", value]),
    navigate: (value) => calls.push(["navigate", value]),
    router: { history: { back: () => calls.push(["back"]) } },
    restoreDialogFocus: loadUiModule(
      "src/lib/dialog-return-focus.ts",
      {},
      { window: dependencies.window },
    ).restoreDialogFocus,
  });
  const execute = (text, ...args) =>
    new Function(
      ...Object.keys(dependencies),
      ts.transpileModule(`return (${text});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText,
    )(...Object.values(dependencies))(...args);
  return {
    calls,
    dependencies,
    run(name, ...args) {
      const node = nodes.find(
        (node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name,
      );
      return execute(node.initializer.getText(parsed), ...args);
    },
    restore() {
      const node = nodes.find(
        (node) =>
          ts.isJsxAttribute(node) &&
          node.name.getText(parsed) === "onCloseAutoFocus" &&
          node.getText(parsed).includes("previewOriginRef"),
      );
      execute(node.initializer.expression.getText(parsed), { preventDefault() {} });
    },
  };
}

test("row opening pushes one detail entry, Close returns in-place, and direct/foreign-account links close safely", () => {
  const f = routeCallbacks();
  f.run("openItemPreview", record);
  f.run("openItemPreview", record);
  assert.equal(f.calls.filter(([name]) => name === "navigate").length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(([name]) => name === "navigate")[1])), {
    search,
    resetScroll: false,
  });
  assert.equal(f.dependencies.previewOriginRef.current.url, "https://kova.test/library");
  f.run("closeItemPreview");
  assert.equal(f.calls.at(-1)[0], "back");
  f.run("closeItemPreview");
  assert.deepEqual(f.calls.at(-1), ["navigate", { search: {}, replace: true, resetScroll: false }]);
  f.dependencies.detailHistoryRef.current = {
    key: detail.libraryDetailKey(search),
    principal: another,
  };
  f.run("closeItemPreview");
  assert.equal(f.calls.at(-1)[0], "navigate");
  const local = routeCallbacks();
  local.run("openItemPreview", { ...record, id: `chat:${id}` });
  assert.equal(local.calls.filter(([name]) => name === "navigate").length, 0);
  assert.equal(local.calls.at(-1)[1].id, `chat:${id}`);
});

test("detail dismissal restores the invoker without scrolling; newer navigation and account changes keep focus", () => {
  const target = (calls, name) => ({
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: (options) => calls.push([name, options]),
  });
  const f = routeCallbacks();
  f.dependencies.previewReturnFocusRef.current = target(f.calls, "focus");
  f.dependencies.previewOriginRef.current = { url: "https://kova.test/library", principal: owner };
  f.restore();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [["focus", { preventScroll: true }]]);
  for (const change of [
    (deps) => {
      deps.detailKeyRef.current = "newer-item";
    },
    (deps) => {
      deps.principalRef.current = another;
    },
    (deps) => {
      deps.window.location.href = "https://kova.test/projects";
    },
    (deps) => {
      deps.libraryCleared = true;
    },
  ]) {
    const blocked = routeCallbacks();
    blocked.dependencies.previewReturnFocusRef.current = target(blocked.calls, "focus");
    blocked.dependencies.previewOriginRef.current = {
      url: "https://kova.test/library",
      principal: owner,
    };
    change(blocked.dependencies);
    blocked.restore();
    assert.equal(blocked.calls.length, 0);
  }
  const direct = routeCallbacks();
  direct.dependencies.librarySearchRef.current = target(direct.calls, "search");
  direct.restore();
  assert.equal(direct.calls[0][0], "search");
});
