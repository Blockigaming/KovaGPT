import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toJSON } from "seroval";
import {
  createPinnedContextReviewHandler,
  PINNED_CONTEXT_REVIEW_OWNER as owner,
  PINNED_CONTEXT_REVIEW_CHAT_ID as chatId,
  PINNED_CONTEXT_REVIEW_SOURCE_ID as sourceId,
  PINNED_CONTEXT_REVIEW_PIN_ID as pinId,
} from "./pinned-context-review-fixture.mjs";
import {
  FIXTURE_ORIGIN as origin,
  createFixtureSession,
  loadReviewPackage,
  REVIEW_OUTPUT_CHAT_ID,
  REVIEW_OUTPUT_LIBRARY_ID,
} from "./private-http-review.mjs";
import * as sourceReviewState from "./review-state-fixtures.mjs";
import { budgetPinnedContext, describePinStatus } from "../src/lib/chat-workspace-contract.mjs";

// In-process route dispatch only: no browser, compilation, listener, provider or network.
const names = [
  "listChatPinnedFiles",
  "resolvePinnedContext",
  "listMyLibrary",
  "pinChatFile",
  "unpinChatFile",
  "setChatPinnedFileStatus",
  "getChatCustomRules",
];
const functionNames = new Map(
  names.map((name, i) => [String(i).padStart(64, "0"), `${name}_createServerFn_handler`]),
);
const idFor = (name, map = functionNames) =>
  [...map].find(([, value]) => value.split("_")[0] === name)[0];
const serialize = (data, context = {}) => JSON.stringify(toJSON({ data, context }));
const sample = (id = sourceId, title = "Sample notes") => ({
  id,
  user_id: owner,
  title,
  item_type: "document",
  source: "manual",
  content_text: "Synthetic review content. No account records are included.",
  file_url: null,
  file_name: "Notes.txt",
  file_type: "text/plain",
  file_size: 57,
  metadata: {},
  created_at: "2026-10-16T10:00:00Z",
});
function setup() {
  const state = {
    active: true,
    items: [sample(), sample("54444444-4444-4444-8444-444444444444", "Sample unpinned notes")],
  };
  const handler = createPinnedContextReviewHandler(functionNames, {
    isActive: () => state.active,
    getItems: () => state.items,
  });
  async function invoke(
    name,
    data = name === "listMyLibrary" ? undefined : { chatId },
    options = {},
  ) {
    const method =
      options.method ??
      (name === "resolvePinnedContext" ||
      name.endsWith("ChatFile") ||
      name === "setChatPinnedFileStatus"
        ? "POST"
        : "GET");
    const raw = Object.hasOwn(options, "raw") ? options.raw : serialize(data);
    const url = new URL(`${options.origin ?? origin}/_serverFn/${idFor(name)}`);
    if (method === "GET" && raw !== null) url.searchParams.set("payload", raw);
    if (options.duplicate) url.searchParams.append("payload", raw);
    if (options.query) url.searchParams.set("unexpected", "value");
    let response;
    await handler({
      request: () => ({
        url: () => url.href,
        method: () => method,
        headers: () => options.headers ?? {},
        postData: () => options.body ?? (method === "GET" ? null : raw),
        signal: () => ({ aborted: !!options.aborted }),
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

test("three mapped reads return the same existing sample identity and production-shaped bounded context", async () => {
  const view = setup();
  const rows = (await view.invoke("listChatPinnedFiles")).json.result;
  const resolved = await view.invoke("resolvePinnedContext");
  const choices = (await view.invoke("listMyLibrary")).json.result;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: pinId,
    chatId,
    sourceType: "library",
    sourceId,
    projectId: null,
    status: "active",
    createdAt: "2026-10-16T10:00:00Z",
  });
  const item = resolved.json.result.items[0];
  assert.equal(item.pinId, pinId);
  assert.equal(item.sourceId, choices[0].id);
  assert.equal(item.name, choices[0].title);
  assert.equal(item.content, choices[0].content_text);
  assert.equal(item.statusLabel, "available");
  assert.equal(resolved.json.result.usedChars, item.content.length);
  assert.equal(resolved.headers["Cache-Control"], "no-store");
  assert.equal(choices.filter((choice) => choice.id !== rows[0].sourceId).length, 1);
  assert.ok(
    choices.every(
      (choice) => !Object.hasOwn(choice, "user_id") && !Object.hasOwn(choice, "metadata"),
    ),
  );
  choices[0].title = "Injected";
  assert.equal(view.state.items[0].title, "Sample notes");
  assert.equal(
    (await view.invoke("resolvePinnedContext")).json.result.items[0].name,
    "Sample notes",
  );
});

test("large extracts, empty text and removed samples use the existing context budget/status contract", async () => {
  const view = setup();
  for (const totalChars of [undefined, 12, 24000]) {
    view.state.items[0].content_text = "Synthetic text. ".repeat(1000);
    const actual = (
      await view.invoke("resolvePinnedContext", { chatId, ...(totalChars ? { totalChars } : {}) })
    ).json.result;
    const item = actual.items[0];
    const { includedChars, truncated, ...base } = item;
    const expected = budgetPinnedContext([{ ...base, content: view.state.items[0].content_text }], {
      totalChars: totalChars ?? 24000,
      itemChars: 8000,
      maxItems: 25,
    });
    assert.deepEqual(actual, expected);
    assert.equal(actual.truncated, true);
    assert.equal(item.includedChars, Math.min(totalChars ?? 24000, 8000));
  }
  view.state.items[0].content_text = "";
  let item = (await view.invoke("resolvePinnedContext")).json.result.items[0];
  assert.equal(item.status, "indexing");
  assert.equal(item.statusLabel, describePinStatus("indexing"));
  assert.equal(item.content, "");
  view.state.items = view.state.items.slice(1);
  item = (await view.invoke("resolvePinnedContext")).json.result.items[0];
  assert.equal(item.name, "Removed item");
  assert.equal(item.statusLabel, describePinStatus("deleted"));
  assert.equal(item.content, "");
  assert.equal((await view.invoke("listChatPinnedFiles")).json.result[0].status, "deleted");
});

test("pin, unpin and status mutations never succeed or change sample state", async () => {
  const view = setup();
  const before = structuredClone(view.state.items);
  for (const name of ["pinChatFile", "unpinChatFile", "setChatPinnedFileStatus"]) {
    const response = await view.invoke(name, {
      chatId,
      pinId,
      sourceId,
      sourceType: "library",
      status: "deleted",
    });
    assert.equal(response.status, 503);
    assert.match(response.json.error, /Read-only synthetic/);
  }
  assert.deepEqual(view.state.items, before);
  assert.equal((await view.invoke("listChatPinnedFiles")).json.result[0].status, "active");
});

test("session lifetime, owner, cancellation and foreign chat bounds fail closed", async () => {
  const view = setup();
  for (const name of names.slice(0, 6)) {
    for (const headers of [{ "x-kova-owner": "other" }, { "x-kova-owner": "" }])
      assert.equal((await view.invoke(name, undefined, { headers })).status, 401);
    assert.equal((await view.invoke(name, undefined, { aborted: true })).status, 499);
  }
  for (const name of ["listChatPinnedFiles", "resolvePinnedContext"])
    assert.equal((await view.invoke(name, { chatId: "other-chat" })).status, 404);
  view.state.items.unshift({
    ...sample("foreign"),
    user_id: "another-owner",
    content_text: "Do not expose",
  });
  assert.equal((await view.invoke("listMyLibrary")).json.result.length, 2);
  view.state.active = false;
  for (const name of names.slice(0, 6)) assert.equal((await view.invoke(name)).status, 401);
});

test("unexpected method, query, body, envelope and budget inputs are rejected", async () => {
  const view = setup();
  for (const name of names.slice(0, 3)) {
    assert.equal((await view.invoke(name, undefined, { method: "DELETE" })).status, 405);
    for (const options of [
      { raw: "not-json" },
      { raw: "a".repeat(8193) },
      { raw: serialize({ chatId }, { owner: "foreign" }) },
      { raw: JSON.stringify(toJSON({ data: { chatId }, extra: true })) },
      { query: true },
    ])
      assert.equal((await view.invoke(name, undefined, options)).status, 400);
  }
  for (const name of ["listChatPinnedFiles", "listMyLibrary"]) {
    assert.equal((await view.invoke(name, undefined, { duplicate: true })).status, 400);
    assert.equal((await view.invoke(name, undefined, { body: "unexpected" })).status, 400);
  }
  for (const data of [
    {},
    { chatId, extra: true },
    { chatId, totalChars: 0 },
    { chatId, totalChars: 24001 },
    { chatId, totalChars: 1.5 },
  ])
    assert.equal((await view.invoke("resolvePinnedContext", data)).status, 400);
  assert.equal((await view.invoke("listMyLibrary", { chatId })).status, 400);
  assert.equal((await view.invoke("listMyLibrary", undefined, { raw: null })).status, 200);
  assert.deepEqual(await view.invoke("getChatCustomRules"), { fallback: true });
  assert.deepEqual(
    await view.invoke("resolvePinnedContext", { chatId }, { origin: "https://outside.invalid" }),
    { fallback: true },
  );
  assert.throws(
    () => createPinnedContextReviewHandler(new Map(), { isActive: () => true, getItems: () => [] }),
    /missing listChatPinnedFiles/,
  );
});

test("actual adapter maps read-only Context to the same HTTP Library samples for each signed-in tier", async () => {
  const root =
    process.env.KOVA_REVIEW_PACKAGE ||
    fileURLToPath(new URL("../../exports/KovaGPT-Recovery-Candidate-5502efb", import.meta.url));
  const loaded = await loadReviewPackage(root);
  const pkg = { ...loaded, state: sourceReviewState };
  assert.equal(chatId, REVIEW_OUTPUT_CHAT_ID);
  assert.equal(sourceId, REVIEW_OUTPUT_LIBRARY_ID);
  const selection = {
    account: "plus",
    theme: "dark",
    path: "/",
    size: "phone",
    state: "populated",
    scenario: "chat-outputs",
  };
  const invoke = (session, name, data = name === "listMyLibrary" ? undefined : { chatId }) => {
    const method =
      name === "resolvePinnedContext" ||
      ["pinChatFile", "unpinChatFile", "setChatPinnedFileStatus"].includes(name)
        ? "POST"
        : "GET";
    const raw = serialize(data);
    const url = new URL(`${origin}/_serverFn/${idFor(name, pkg.base.functionNames)}`);
    if (method === "GET") url.searchParams.set("payload", raw);
    return session.registry.dispatch({
      url: url.href,
      method,
      ...(method === "POST" ? { body: Buffer.from(raw) } : {}),
    });
  };
  for (const account of ["free", "plus", "pro"]) {
    const session = await createFixtureSession(pkg, { ...selection, account });
    try {
      const library = await session.registry.dispatch({
        url: `${origin}/api/library/items`,
        method: "POST",
        headers: { "x-kova-owner": owner },
        body: Buffer.from(JSON.stringify({ operation: "list" })),
      });
      const choices = (await invoke(session, "listMyLibrary")).json.result;
      assert.deepEqual(
        choices.map(({ id, title }) => ({ id, title })),
        library.json.items.map(({ id, title }) => ({ id, title })),
      );
      const source = library.json.items.find((item) => item.id === sourceId);
      const row = (await invoke(session, "listChatPinnedFiles")).json.result[0];
      const context = (await invoke(session, "resolvePinnedContext")).json.result;
      assert.equal(row.sourceId, source.id);
      assert.equal(context.items[0].name, source.title);
      assert.equal(context.items[0].content, source.content_text);
      assert.equal(context.items[0].statusLabel, "available");
      for (const name of ["pinChatFile", "unpinChatFile", "setChatPinnedFileStatus"])
        assert.equal((await invoke(session, name)).status, 503);
      session.dispose();
      assert.equal((await invoke(session, "resolvePinnedContext")).status, 401);
    } finally {
      session.dispose();
    }
  }
  for (const overrides of [{ scenario: "default" }, { state: "empty" }, { state: "error" }]) {
    const session = await createFixtureSession(pkg, { ...selection, ...overrides });
    try {
      assert.deepEqual((await invoke(session, "listMyLibrary")).json.result, []);
    } finally {
      session.dispose();
    }
  }
  assert.match(
    readFileSync(new URL("./package.mjs", import.meta.url), "utf8"),
    /"pinned-context-review-fixture\.mjs"/,
  );
});
