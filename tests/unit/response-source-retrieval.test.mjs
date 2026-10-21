import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { normalizeSourceRetrievedAt } from "../../src/lib/response-source-time.mjs";
import { normalizeResponseSources } from "../../src/lib/response-sources.ts";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";
import { loadConversations, saveConversations } from "../../src/lib/chat-store.ts";
import { consumeChatSse } from "../../src/lib/chat-sse-client.mjs";
import { formatDisplayDateTime } from "../../src/lib/time-format.ts";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const RETRIEVED = "2026-10-17T19:05:00.000Z";
const source = (extra = {}) => ({
  id: "sample-source",
  title: "Synthetic historical report",
  url: "https://example.test/report",
  domain: "example.test",
  snippet: "Synthetic supporting passage.",
  publishedAt: "2020-01-01",
  ...extra,
});
const conversation = (sources) => ({
  id: "source-history",
  title: "Synthetic retrieval provenance",
  mode: "instant",
  createdAt: 1,
  updatedAt: 2,
  messages: [{ id: "response", role: "assistant", content: "A sourced response.", sources }],
});

function parse(path) {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
function declarations(file, names) {
  return file.statements
    .filter(
      (node) =>
        (ts.isFunctionDeclaration(node) && names.includes(node.name?.getText(file))) ||
        (ts.isVariableStatement(node) &&
          node.declarationList.declarations.some((item) =>
            names.includes(item.name.getText(file)),
          )),
    )
    .map((node) => node.getText(file).replace(/^export\s+/, ""))
    .join("\n");
}
function compile(code, dependencies) {
  const javascript = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}

// Execute the route's real producer and envelope without starting a server,
// calling a provider, or touching accounting/database handlers.
const route = parse("src/routes/api/chat.ts");
const { responseSourcesDelta, sseEvent, sseDone } = compile(
  `${declarations(route, ["responseSourcesDelta", "sseEvent", "sseDone"])}
   return { responseSourcesDelta, sseEvent, sseDone };`,
  { normalizeSourceRetrievedAt },
);

// Exercise the exact project save validator and stored-snapshot reader. The
// server function builder captures validators but never runs database handlers.
const project = parse("src/lib/projects.functions.ts");
const { saveProjectChat, projectChatSnapshot } = compile(
  `${declarations(project, ["ResponseSourceSchema", "MessageSchema", "projectChatSnapshot", "saveProjectChat"])}
   return { saveProjectChat, projectChatSnapshot };`,
  {
    z,
    normalizeResponseSources,
    normalizeSourceRetrievedAt,
    requireSupabaseAuth: Symbol("auth"),
    createServerFn: () => ({
      middleware() {
        return this;
      },
      validator(validate) {
        this.validate = validate;
        return this;
      },
      handler() {
        return this;
      },
    }),
  },
);

const message = parse("src/components/ChatMessage.tsx");
let sourceList;
function findSourceList(node) {
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(message) === "ol" &&
    node.getText(message).includes("message.sources.map")
  )
    sourceList = node.getText(message);
  ts.forEachChild(node, findSourceList);
}
findSourceList(message);
assert.ok(sourceList, "The actual Sources inspector list must be available");
const renderSources = (sources, timeFormat = "system") =>
  renderToStaticMarkup(
    compile(`return (${sourceList});`, {
      React,
      message: { sources },
      activeSourceId: null,
      normalizeSourceRetrievedAt,
      formatDisplayDateTime,
      timeFormat,
    }),
  );

const INVALID_TIMES = [
  undefined,
  null,
  "",
  1792263900000,
  {},
  "2020-01-01",
  "2026-10-17T19:05:00",
  "October 17, 2026 19:05:00 UTC",
  "2026-02-29T19:05:00Z",
  "2026-04-31T19:05:00Z",
  "2026-13-01T19:05:00Z",
  "2026-10-17T24:05:00Z",
  "2026-10-17T19:60:00Z",
  "2026-10-17T19:05:00+24:00",
  `${RETRIEVED}\n`,
  ` ${RETRIEVED}`,
  `${RETRIEVED}<script>bad()</script>`,
  `2026-10-17T19:05:00.${"1".repeat(81)}Z`,
];

test("retrieval metadata preserves validated RFC3339 instants without reformatting", () => {
  for (const value of [
    RETRIEVED,
    "2026-10-17T19:05:00+05:45",
    "2026-10-17T19:05:00-07:00",
    "2024-02-29T19:05:00Z",
    "2000-02-29T19:05:00Z",
    "2026-10-17t19:05:00.123456z",
  ])
    assert.equal(normalizeSourceRetrievedAt(value), value);
  for (const value of INVALID_TIMES)
    assert.equal(normalizeSourceRetrievedAt(value), undefined, JSON.stringify(value));
  assert.equal(normalizeSourceRetrievedAt("1900-02-29T19:05:00Z"), undefined);
});

test("the real SSE producer and fragmented client stream preserve retrieval separately from publication", async () => {
  const frame = sseEvent(responseSourcesDelta([source({ retrievedAt: RETRIEVED })])) + sseDone();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (let index = 0; index < frame.length; index += 17)
        controller.enqueue(encoder.encode(frame.slice(index, index + 17)));
      controller.close();
    },
  });
  let sources;
  await consumeChatSse(stream, {
    onEvent(event) {
      const delta = event.choices[0].delta;
      assert.equal(delta.kind, "web_sources");
      sources = normalizeResponseSources(delta.sources);
    },
  });
  assert.equal(sources[0].retrievedAt, RETRIEVED);
  assert.equal(sources[0].publishedAt, "2020-01-01");
  assert.equal(responseSourcesDelta(Array.from({ length: 13 }, () => source())).sources.length, 12);
  for (const retrievedAt of INVALID_TIMES)
    assert.equal(
      Object.hasOwn(responseSourcesDelta([source({ retrievedAt })]).sources[0], "retrievedAt"),
      false,
    );
});

test("live source metadata roundtrips through durable history, local reload and project save/read", async () => {
  const sources = normalizeResponseSources(
    responseSourcesDelta([source({ retrievedAt: RETRIEVED })]).sources,
  );
  const durable = normalizeChatHistory(conversation(sources), OWNER);
  assert.deepEqual(normalizeChatHistory(JSON.parse(JSON.stringify(durable)), OWNER), durable);
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    assert.equal(await saveConversations(OWNER, [durable]), true);
    const reloaded = loadConversations(OWNER);
    assert.deepEqual(reloaded[0].messages[0].sources, sources);
    assert.deepEqual(loadConversations("other-owner"), []);
    const saved = saveProjectChat.validate({
      id: OWNER,
      messages: reloaded[0].messages.map(({ id, ...item }) => item),
    });
    const restored = projectChatSnapshot(JSON.parse(JSON.stringify({ messages: saved.messages })));
    assert.deepEqual(restored.messages[0].sources, sources);
    assert.equal(restored.messages[0].sources[0].publishedAt, "2020-01-01");
    assert.equal(restored.messages[0].sources[0].retrievedAt, RETRIEVED);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousStorage,
    });
  }
});

test("historical missing and invalid retrieval stay unknown at every read boundary", () => {
  for (const retrievedAt of INVALID_TIMES) {
    const raw = source({ retrievedAt });
    const normalized = normalizeResponseSources([raw])[0];
    const durable = normalizeChatHistory(conversation([raw]), OWNER).messages[0].sources[0];
    const restored = projectChatSnapshot({
      messages: [{ role: "assistant", content: "Historical response.", sources: [raw] }],
    });
    assert.equal(restored.messages.length, 1, "invalid optional metadata must not erase history");
    for (const value of [normalized, durable, restored.messages[0].sources[0]]) {
      assert.equal(Object.hasOwn(value, "retrievedAt"), false);
      assert.equal(value.publishedAt, "2020-01-01");
    }
    const html = renderSources([raw]);
    assert.match(html, /Published: 2020-01-01/);
    assert.match(html, /Retrieval time not provided/);
    assert.doesNotMatch(html, /<time|Retrieved:/);
  }
});

test("source normalization keeps safe links, deduplication, bounded fields and no private extras", () => {
  const sources = normalizeResponseSources([
    source({ url: "javascript:alert(1)", retrievedAt: RETRIEVED }),
    source({
      url: "https://reader:secret@example.test/report#private-fragment",
      domain: "spoofed.invalid",
      retrievedAt: RETRIEVED,
      connectorToken: "private-token",
      sourceKind: "invented-connector",
    }),
    source({ retrievedAt: RETRIEVED }),
    ...Array.from({ length: 14 }, (_, index) =>
      source({ url: `https://example.test/${index}`, retrievedAt: RETRIEVED }),
    ),
  ]);
  assert.equal(sources.length, 12);
  assert.equal(sources[0].url, "https://example.test/report");
  assert.equal(sources[0].domain, "example.test");
  assert.equal(sources[0].retrievedAt, RETRIEVED);
  assert.doesNotMatch(
    JSON.stringify(sources),
    /reader|secret|private|spoofed|connector|sourceKind/,
  );
});

test("history and project source bounds, assistant-only scope and temporary privacy are unchanged", () => {
  const sources = Array.from({ length: 13 }, () => source({ retrievedAt: RETRIEVED }));
  assert.throws(() => normalizeChatHistory(conversation(sources), OWNER), /invalid/);
  assert.throws(() =>
    saveProjectChat.validate({
      id: OWNER,
      messages: [{ role: "assistant", content: "", sources }],
    }),
  );
  const unsafe = [{ ...source(), url: "javascript:alert(1)", retrievedAt: RETRIEVED }];
  assert.throws(() => normalizeChatHistory(conversation(unsafe), OWNER), /invalid/);
  assert.throws(() =>
    saveProjectChat.validate({
      id: OWNER,
      messages: [{ role: "assistant", content: "", sources: unsafe }],
    }),
  );
  const userMessage = { role: "user", content: "", sources: [source({ retrievedAt: RETRIEVED })] };
  assert.throws(() => saveProjectChat.validate({ id: OWNER, messages: [userMessage] }));
  assert.throws(
    () =>
      normalizeChatHistory(
        { ...conversation([]), messages: [{ id: "user", ...userMessage }] },
        OWNER,
      ),
    /invalid/,
  );
  assert.throws(
    () => normalizeChatHistory({ ...conversation([source()]), temporary: true }, OWNER),
    /invalid/,
  );
});

test("Sources visibly separates old publication and new retrieval and honors all time preferences", () => {
  for (const preference of ["system", "12-hour", "24-hour"]) {
    const html = renderSources([source({ retrievedAt: RETRIEVED })], preference);
    assert.match(html, /Published: 2020-01-01/);
    assert.ok(
      html.includes(
        `Retrieved: <time dateTime="${RETRIEVED}">${formatDisplayDateTime(RETRIEVED, preference)}</time>`,
      ),
      html,
    );
    assert.match(html, /device time zone/);
    assert.doesNotMatch(html, /Retrieval time not provided/);
    assert.match(html, /Web page/);
    assert.match(html, /rel="noreferrer noopener"/);
  }
  assert.match(
    message.getText(),
    /useTimeFormatPreference\(userKey, principalResolved\)/,
    "the display uses the existing principal-aware preference hook",
  );
});

test("reopening a source without either date never creates evidence or a supporting passage", () => {
  const unknown = source({ publishedAt: undefined, snippet: undefined });
  for (let reopen = 0; reopen < 3; reopen++) {
    const html = renderSources(normalizeResponseSources([unknown]));
    assert.match(html, /Retrieval time not provided/);
    assert.match(html, /No supporting passage was provided/);
    assert.doesNotMatch(html, /Published:|Retrieved:|<time/);
  }
});
