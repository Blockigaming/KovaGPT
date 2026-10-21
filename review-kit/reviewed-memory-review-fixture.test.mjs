import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { toJSON } from "seroval";
import ts from "typescript";
import {
  REVIEWED_MEMORY_CHAT_ID as chatId,
  REVIEWED_MEMORY_OPTIONS,
  REVIEWED_MEMORY_RECORD_ID,
  REVIEWED_MEMORY_TIME,
  createReviewedMemoryReviewFixture,
  reviewedMemoryConversation,
} from "./reviewed-memory-review-fixture.mjs";
import {
  BACKEND_ORIGIN,
  FIXTURE_ORIGIN,
  REVIEW_OWNER,
  FixtureRegistry,
  createConversationFixture,
  createFixtureSession,
  initialStorage,
  loadReviewPackage,
  reviewConversations,
} from "./private-http-review.mjs";
import * as catalog from "./review-state-fixtures.mjs";
import { createChatHistoryController } from "../src/lib/chat-history-controller.mjs";
import {
  loadReviewedMemorySource,
  saveReviewedMemory,
} from "../src/lib/reviewed-memory-client.mjs";
import {
  allowMemoryWrites,
  blockMemoryWrites,
  configureMemoryWrites,
  resetMemoryWriteCoordinatorForTests,
} from "../src/lib/memory-write-coordinator.mjs";
assert.ok(process.env.KOVA_REVIEW_PACKAGE, "Set KOVA_REVIEW_PACKAGE to an existing review package");
const root = new URL("../", import.meta.url);
const pkg = { ...(await loadReviewPackage(process.env.KOVA_REVIEW_PACKAGE)), state: catalog };
const selection = {
  account: "pro",
  theme: "dark",
  path: "/",
  size: "laptop",
  state: "populated",
  scenario: "chat-reviewed-memory-save",
};
const headers = { "x-kova-owner": REVIEW_OWNER, "content-type": "application/json" };
const exactText = "  Fictional review only: use three short sample steps.\nKeep this spacing.  ";
const valid = (extra = {}) => ({
  operation: "save_reviewed_memory",
  chatId,
  expectedRevision: 1,
  memoryEnabled: true,
  temporary: false,
  confirmed: true,
  text: exactText,
  ...extra,
});
const create = (overrides = {}) => createFixtureSession(pkg, { ...selection, ...overrides });
const post = (session, body = valid(), extra = {}) =>
  session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/memory",
    method: "POST",
    headers,
    body: Buffer.from(JSON.stringify(body)),
    ...extra,
  });
const read = (session, extra = {}) =>
  session.registry.dispatch({ url: FIXTURE_ORIGIN + "/api/memory", headers, ...extra });
const functionUrl = (name) => {
  const entry = [...pkg.base.functionNames].find(([, value]) => value.split("_")[0] === name);
  assert.ok(entry, `Missing ${name} contract`);
  return FIXTURE_ORIGIN + "/_serverFn/" + entry[0];
};
const center = (session, extra = {}) =>
  session.registry.dispatch({ url: functionUrl("listMemoryCenter"), ...extra });
// Read the real default and execute the normal Settings callback, without
// mounting UI or replacing the product's consent coordinator.
function settingsMemoryOptIn() {
  const source = ts.createSourceFile(
    "SettingsDialog.tsx",
    readFileSync(new URL("src/components/SettingsDialog.tsx", root), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const defaults = [];
  const toggles = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "DEFAULT_SETTINGS")
      defaults.push(node.initializer);
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(source) === "ToggleRow" &&
      node.attributes.properties.some(
        (attribute) =>
          attribute.name?.getText(source) === "title" &&
          attribute.initializer?.text === "Use saved memory",
      )
    )
      toggles.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(defaults.length, 1);
  assert.equal(toggles.length, 1);
  const remember = defaults[0].properties.find(
    (property) => property.name?.getText(source) === "rememberAcross",
  );
  assert.equal(remember?.initializer.kind, ts.SyntaxKind.FalseKeyword);
  const attribute = (name) =>
    toggles[0].attributes.properties.find((item) => item.name?.getText(source) === name)
      ?.initializer.expression;
  assert.equal(attribute("checked")?.getText(source), "settings.rememberAcross");
  const callback = attribute("onCheckedChange");
  assert.ok(callback, "Use saved memory keeps its normal consent callback");
  let settings = { rememberAcross: false };
  return {
    get enabled() {
      return settings.rememberAcross;
    },
    change(value) {
      const dependencies = {
        settings,
        userKey: REVIEW_OWNER,
        isSignedIn: true,
        allowMemoryWrites,
        blockMemoryWrites,
        configureMemoryWrites,
        onChange: (next) => {
          settings = next;
        },
      };
      const code = ts.transpileModule(`return (${callback.getText(source)});`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))(value);
    },
  };
}
async function syncedDevice(session) {
  let device = null;
  const methods = [];
  const controller = createChatHistoryController({
    ownerId: REVIEW_OWNER,
    signal: new AbortController().signal,
    loadDevice: async () => device,
    commitDevice: async (_previous, next) => {
      device = structuredClone(next);
    },
    getLegacy: () => ({ active: reviewConversations(selection.scenario), archived: [] }),
    transport: async ({ method, cursor, epoch, signal }) => {
      methods.push(method);
      assert.equal(method, "GET");
      const output = await session.registry.dispatch({
        url: FIXTURE_ORIGIN + `/api/chat/history?cursor=${cursor}${epoch ? "&epoch=" + epoch : ""}`,
        headers,
        signal,
      });
      assert.equal(output.status, 200);
      return output.json;
    },
  });
  await controller.initialize();
  await controller.pump();
  return { device, methods };
}

test("paid explicit scenarios add one four-message sample, keep defaults unchanged and require normal Settings opt-in", async () => {
  for (const option of REVIEWED_MEMORY_OPTIONS) {
    assert.deepEqual(option.accounts, ["plus", "pro"]);
    await assert.rejects(catalog.installReviewState({}, option.id, "pro"), /private HTTP/);
    for (const account of ["guest", "free"])
      await assert.rejects(create({ account, scenario: option.id }), /requires/);
    for (const account of option.accounts) {
      const session = await create({ account, scenario: option.id });
      assert.equal(session.selection.path, "/");
      assert.deepEqual((await read(session)).json, { memories: [] });
      session.dispose();
      for (const theme of ["light", "dark"]) {
        const current = { ...selection, account, theme, scenario: option.id };
        const now = Date.parse(REVIEWED_MEMORY_TIME);
        const storage = initialStorage(current, now);
        const settingsKey = `nova-gpt-settings-v1:${REVIEW_OWNER}`;
        // The explicit review theme is allowed; memory consent and alternate
        // Settings/memory seeds are not. Paid memory still starts off.
        assert.deepEqual(JSON.parse(storage[settingsKey]), { mode: theme });
        assert.deepEqual(
          Object.keys(storage).filter((key) => /settings|memory|remember/i.test(key)),
          [settingsKey],
        );
        assert.deepEqual(storage, {
          ...initialStorage({ ...current, scenario: "default" }, now),
          [`nova-gpt-conversations-v3:user:${REVIEW_OWNER}`]: JSON.stringify(
            reviewConversations(option.id),
          ),
          [`nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`]: chatId,
        });
      }
    }
    const chats = reviewConversations(option.id);
    assert.deepEqual(chats.slice(0, 2), reviewConversations());
    assert.deepEqual(chats[2], reviewedMemoryConversation());
    assert.equal(chats[2].messages.length, 4);
    const storage = initialStorage({ ...selection, scenario: option.id });
    assert.equal(storage[`nova-gpt-pending-active:v2:user:${REVIEW_OWNER}`], chatId);
  }
  assert.equal(reviewConversations().length, 2);
  assert.equal(reviewConversations()[0].messages.length, 2);
  const code = readFileSync(new URL("review-kit/package.mjs", root), "utf8");
  assert.match(code, /"reviewed-memory-review-fixture.mjs"/);
});

test("ordinary history GETs establish actual clean revision 1; eligibility/open/cancel performs no memory write", async () => {
  const session = await create();
  const { device, methods } = await syncedDevice(session);
  assert.equal(methods.length, 3);
  const source = await loadReviewedMemorySource(REVIEW_OWNER, reviewedMemoryConversation(), {
    loadDevice: async () => device,
  });
  assert.equal(source.revision, 1);
  assert.equal(source.messageCount, 4);
  assert.equal(device.records[chatId].dirty, false);
  assert.deepEqual((await read(session)).json, { memories: [] });
  assert.deepEqual((await center(session)).json.result, []);
  await assert.rejects(
    loadReviewedMemorySource(REVIEW_OWNER, reviewConversations()[0], {
      loadDevice: async () => device,
    }),
    /four non-temporary messages/,
  );
  // Opening then abandoning review invokes only eligibility; actual dialog Cancel is
  // separately covered by tests/unit/reviewed-memory-dialog.test.mjs in this run.
  session.dispose();
});

test("actual confirmed-save client uses the real history revision and preserves exact text in both readback DTOs", async () => {
  const session = await create();
  const { device } = await syncedDevice(session);
  resetMemoryWriteCoordinatorForTests();
  const consent = settingsMemoryOptIn();
  assert.equal(consent.enabled, false);
  configureMemoryWrites({ principal: REVIEW_OWNER, enabled: consent.enabled });
  const posts = [];
  const input = {
    ownerId: REVIEW_OWNER,
    conversation: reviewedMemoryConversation(),
    revision: 1,
    text: exactText,
    isCurrent: () => true,
  };
  const dependencies = {
    loadDevice: async () => device,
    request: async (owner, path, init) => {
      assert.equal(owner, REVIEW_OWNER);
      assert.equal(path, "/api/memory");
      posts.push(JSON.parse(init.body));
      const output = await post(session, posts.at(-1), { signal: init.signal });
      assert.equal(output.status, 200);
      assert.deepEqual(output.json, { ok: true, saved: true, chatId });
      return Response.json(output.json, { status: output.status });
    },
  };
  await assert.rejects(
    saveReviewedMemory(input, dependencies),
    /turned off.*Nothing was submitted/,
  );
  assert.deepEqual(posts, []);
  assert.deepEqual((await read(session)).json, { memories: [] });
  consent.change(true);
  assert.equal(consent.enabled, true);
  assert.deepEqual(posts, [], "Settings opt-in alone does not save memory");
  assert.deepEqual((await read(session)).json, { memories: [] });
  await saveReviewedMemory(input, dependencies);
  assert.deepEqual(posts, [valid()]);
  const memory = {
    chat_id: chatId,
    title: reviewedMemoryConversation().messages[0].content,
    summary: exactText,
    updated_at: REVIEWED_MEMORY_TIME,
  };
  const listing = await read(session);
  assert.deepEqual(listing.json, { memories: [memory] });
  assert.equal(listing.headers["Cache-Control"], "no-store");
  listing.json.memories[0].summary = "mutated copy";
  assert.equal((await read(session)).json.memories[0].summary, exactText);
  const expected = {
    id: REVIEWED_MEMORY_RECORD_ID,
    content: exactText,
    title: memory.title,
    source: "conversation",
    category: "Conversation summary",
    updatedAt: REVIEWED_MEMORY_TIME,
  };
  assert.deepEqual((await center(session)).json, { result: [expected], context: {} });
  const raw = JSON.stringify(toJSON({ data: {}, context: {} }));
  assert.deepEqual(
    (
      await center(session, {
        url: functionUrl("listMemoryCenter") + "?payload=" + encodeURIComponent(raw),
      })
    ).json.result,
    [expected],
  );
  assert.equal((await post(session, valid({ text: "Replacement synthetic text" }))).status, 200);
  assert.equal((await read(session)).json.memories.length, 1);
  assert.equal((await read(session)).json.memories[0].summary, "Replacement synthetic text");
  session.dispose();
  resetMemoryWriteCoordinatorForTests();
});

test("strict confirmation, shape, media type, method and query guards cannot create memory", async () => {
  const session = await create();
  const invalid = [
    null,
    [],
    {},
    ...[
      "operation",
      "chatId",
      "expectedRevision",
      "memoryEnabled",
      "temporary",
      "confirmed",
      "text",
    ].map((key) => {
      const input = valid();
      delete input[key];
      return input;
    }),
    valid({ confirmed: false }),
    valid({ memoryEnabled: false }),
    valid({ temporary: true }),
    valid({ text: "   " }),
    valid({ text: "x".repeat(1501) }),
    valid({ expectedRevision: 0 }),
    valid({ expectedRevision: 1.5 }),
    valid({ summary: "extra" }),
    valid({ messages: [] }),
    valid({ count: 4 }),
    valid({ operation: "remember" }),
  ];
  for (const body of invalid)
    assert.equal((await post(session, body)).status, 400, JSON.stringify(body));
  assert.equal((await post(session, valid(), { body: Buffer.from("{") })).status, 400);
  assert.equal((await post(session, valid(), { body: Buffer.alloc(8193, "x") })).status, 413);
  for (const contentType of ["", "text/plain", "application/json-bogus"])
    assert.equal(
      (await post(session, valid(), { headers: { ...headers, "content-type": contentType } }))
        .status,
      415,
    );
  for (const method of ["PUT", "PATCH", "DELETE"])
    assert.equal((await post(session, valid(), { method })).status, 405);
  for (const query of ["?contextChatId=" + chatId, "?unknown=1"]) {
    assert.equal(
      (await post(session, valid(), { url: FIXTURE_ORIGIN + "/api/memory" + query })).status,
      400,
    );
    assert.equal(
      (await read(session, { url: FIXTURE_ORIGIN + "/api/memory" + query })).status,
      400,
    );
  }
  assert.deepEqual((await read(session)).json.memories, []);
  session.dispose();
});

test("missing, short, stale, wrong-account and canceled requests never save", async () => {
  const session = await create();
  for (const body of [
    valid({ chatId: "missing" }),
    valid({ chatId: reviewConversations()[0].id }),
    valid({ expectedRevision: 2 }),
  ])
    assert.equal((await post(session, body)).status, 409);
  for (const wrongHeaders of [{}, { ...headers, "x-kova-owner": "other" }]) {
    assert.equal((await post(session, valid(), { headers: wrongHeaders })).status, 401);
    assert.equal((await read(session, { headers: wrongHeaders })).status, 401);
  }
  assert.equal((await center(session, { headers: { "x-kova-owner": "other" } })).status, 401);
  const abort = new AbortController();
  abort.abort();
  assert.equal((await post(session, valid(), { signal: abort.signal })).status, 499);
  assert.deepEqual((await read(session)).json.memories, []);
  session.dispose();
});

test("history metadata revision is authoritative and old reviewed text cannot save after rename", async () => {
  const session = await create();
  const first = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history",
    headers,
  });
  const payload = { ...reviewedMemoryConversation(), title: "Renamed fictional sample" };
  const response = await session.registry.dispatch({
    url: FIXTURE_ORIGIN + "/api/chat/history",
    method: "POST",
    headers,
    body: Buffer.from(
      JSON.stringify({
        id: chatId,
        mutationId: randomUUID(),
        epoch: first.json.epoch,
        expectedRevision: 1,
        payload,
        archived: false,
      }),
    ),
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.revision, 2);
  assert.equal((await post(session)).status, 409);
  assert.deepEqual((await read(session)).json.memories, []);
  assert.equal((await post(session, valid({ expectedRevision: 2 }))).status, 200);
  session.dispose();
});

for (const [outcome, status] of [
  ["rejected", 400],
  ["uncertain", 503],
])
  test(`${outcome} remains explicit on acknowledged Retry and creates no local readback`, async () => {
    const session = await create({ scenario: `chat-reviewed-memory-${outcome}` });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await post(session);
      assert.equal(response.status, status);
      assert.equal(response.json.saved, undefined);
      assert.match(response.json.error, outcome === "rejected" ? /rejected/ : /Could not confirm/);
      assert.deepEqual((await read(session)).json.memories, []);
      assert.deepEqual((await center(session)).json.result, []);
    }
    session.dispose();
  });

test("fresh sessions, account replacement, logout and reset isolate or discard the local memory", async () => {
  const first = await create();
  const second = await create({ account: "plus" });
  assert.equal((await post(first)).status, 200);
  assert.deepEqual((await read(second)).json.memories, []);
  await first.registry.dispatch({ url: BACKEND_ORIGIN + "/auth/v1/logout", method: "POST" });
  assert.equal((await read(first)).status, 401);
  assert.equal((await post(first)).status, 401);
  assert.equal((await center(first)).status, 401);
  const fresh = await create();
  assert.deepEqual((await read(fresh)).json.memories, []);
  assert.equal((await post(second)).status, 200);
  second.dispose();
  assert.equal((await read(second)).status, 401);
  fresh.dispose();
});

test("read-only memory center and adjacent/provider writes stay closed; default has no save fixture", async () => {
  const session = await create();
  for (const name of ["updateMemoryRecord", "deleteMemoryRecord"])
    assert.equal(
      (
        await session.registry.dispatch({
          url: functionUrl(name),
          method: "POST",
          headers,
          body: Buffer.from(
            JSON.stringify(
              toJSON({
                data: {
                  id: REVIEWED_MEMORY_RECORD_ID,
                  source: "conversation",
                  content: "unexpected",
                },
                context: {},
              }),
            ),
          ),
        })
      ).status,
      503,
    );
  assert.equal((await center(session, { method: "POST" })).status, 405);
  for (const query of ["?page=1", "?payload=bad", "?payload={}&payload={}"])
    assert.equal(
      (await center(session, { url: functionUrl("listMemoryCenter") + query })).status,
      400,
    );
  for (const path of ["/api/chat", "/api/memory/extra"])
    assert.equal((await post(session, valid(), { url: FIXTURE_ORIGIN + path })).status, 503);
  assert.deepEqual((await read(session)).json.memories, []);
  const normal = await create({ scenario: "default" });
  assert.equal((await post(normal)).status, 503);
  session.dispose();
  normal.dispose();
});

test("helper uses a detached owned history read and fails closed on lost ownership/deletion/invalid content", async () => {
  const history = createConversationFixture(() => true, selection.scenario);
  const record = history.readRecord(chatId);
  record.payload.title = "external mutation";
  assert.equal(history.readRecord(chatId).payload.title, "Fictional reviewed-memory sample");
  for (const modified of [
    { ...record, ownerId: "other" },
    { ...record, deleted_at: REVIEWED_MEMORY_TIME },
    { ...record, payload: { ...record.payload, temporary: true } },
    { ...record, payload: { ...record.payload, memoryStartIndex: 2 } },
    { ...record, payload: { ...record.payload, id: "other" } },
  ]) {
    const registry = new FixtureRegistry();
    const fixture = createReviewedMemoryReviewFixture(selection.scenario, pkg.base.functionNames, {
      account: "pro",
      isActive: () => true,
      getHistoryRecord: () => modified,
    });
    await registry.route("**/*", fixture.handler);
    assert.equal((await post({ registry })).status, 409);
    assert.deepEqual((await read({ registry })).json.memories, []);
    fixture.dispose();
  }
  let fallbacks = 0;
  const fixture = createReviewedMemoryReviewFixture(selection.scenario, pkg.base.functionNames, {
    account: "plus",
    isActive: () => true,
    getHistoryRecord: () => record,
  });
  for (const url of [
    "https://outside.invalid/api/memory",
    FIXTURE_ORIGIN + "/api/memory/extra",
    functionUrl("listMemoryCenter").replace(FIXTURE_ORIGIN, "https://outside.invalid"),
  ])
    await fixture.handler({ request: () => ({ url: () => url }), fallback: () => fallbacks++ });
  assert.equal(fallbacks, 3);
  assert.throws(
    () =>
      createReviewedMemoryReviewFixture(selection.scenario, pkg.base.functionNames, {
        account: "free",
        isActive: () => true,
        getHistoryRecord: () => record,
      }),
    /Paid/,
  );
});
