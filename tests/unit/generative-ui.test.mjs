import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATIVE_UI_INSTRUCTIONS,
  splitGenerativeContent,
  validateGenerativeWidget,
} from "../../src/lib/generative-ui.mjs";

const document = { version: 1, type: "document", title: "Draft", content: "First\nSecond\n" };
const date = { version: 1, type: "date", title: "Date", value: "2028-02-29" };
const timeline = {
  version: 1,
  type: "timeline",
  title: "Plan",
  items: [
    { id: "step-1", title: "First", start: "2026-10-21", end: "2026-10-22", status: "planned" },
  ],
};
const board = {
  version: 1,
  type: "board",
  title: "Ideas",
  columns: [{ id: "new", title: "New" }],
  cards: [{ id: "card-1", title: "First idea", columnId: "new", body: "Exact detail\n" }],
};
const fenced = (value, language = "kova-ui") =>
  `\`\`\`${language}\n${JSON.stringify(value)}\n\`\`\`\n`;

test("all five widgets normalize into detached data and preserve editable content", () => {
  for (const widget of [
    document,
    { ...document, type: "code", language: "c++" },
    date,
    timeline,
    board,
  ]) {
    const result = validateGenerativeWidget(widget);
    assert.deepEqual(result, widget);
    assert.notEqual(result, widget);
    if (result.items) {
      assert.notEqual(result.items, widget.items);
      assert.notEqual(result.items[0], widget.items[0]);
    }
    if (result.cards) assert.notEqual(result.cards[0], widget.cards[0]);
  }
  assert.equal(validateGenerativeWidget({ ...document, title: "  Draft  " }).title, "Draft");
  assert.equal(validateGenerativeWidget({ ...document, content: "" }).content, "");
});

test("extra keys, active payloads, object tricks and non-data properties fail closed", () => {
  for (const input of [
    null,
    [],
    { ...document, version: 2 },
    { ...document, type: "html" },
    { ...document, action: "send" },
    { ...document, script: "alert(1)" },
    { ...document, title: " " },
    { ...document, title: 3 },
    { ...document, content: {} },
    { ...document, content: () => "code" },
    Object.assign(Object.create({ privileged: true }), document),
    { ...board, cards: [{ ...board.cards[0], href: "https://outside.invalid" }] },
    { ...timeline, items: [{ ...timeline.items[0], url: "https://outside.invalid" }] },
  ])
    assert.equal(validateGenerativeWidget(input), null);
  assert.equal(
    validateGenerativeWidget(
      JSON.parse('{"version":1,"type":"document","title":"x","content":"x","__proto__":{}}'),
    ),
    null,
  );
  let invoked = false;
  const accessor = { ...document };
  Object.defineProperty(accessor, "content", {
    enumerable: true,
    get() {
      invoked = true;
      return "bad";
    },
  });
  assert.equal(validateGenerativeWidget(accessor), null);
  assert.equal(invoked, false);
  const symbol = { ...document, [Symbol("action")]: "send" };
  assert.equal(validateGenerativeWidget(symbol), null);
});

test("picker accepts a blank selection while rejecting impossible or out-of-range dates", () => {
  assert.deepEqual(validateGenerativeWidget({ ...date, value: "" }), { ...date, value: "" });
  assert.ok(validateGenerativeWidget({ ...date, min: "2028-02-01", max: "2028-03-01" }));
  for (const input of [
    { ...date, value: "2027-02-29" },
    { ...date, value: "2026-04-31" },
    { ...date, value: "0000-01-01" },
    { ...date, value: "2026-2-01" },
    { ...date, value: "2026-10-21T00:00:00Z" },
    { ...date, value: null },
    { ...date, min: "bad" },
    { ...date, min: "2029-01-01" },
    { ...date, max: "2028-02-28" },
    { ...date, value: "", min: "2028-03-01", max: "2028-02-01" },
  ])
    assert.equal(validateGenerativeWidget(input), null);
});

test("timeline rejects reversed dates, duplicate IDs, unknown states and missing fields", () => {
  for (const changes of [
    { start: "2026-10-23" },
    { end: "2026-02-30" },
    { status: "running" },
    { id: "../step" },
    { title: "" },
  ])
    assert.equal(
      validateGenerativeWidget({ ...timeline, items: [{ ...timeline.items[0], ...changes }] }),
      null,
    );
  assert.equal(
    validateGenerativeWidget({ ...timeline, items: [timeline.items[0], timeline.items[0]] }),
    null,
  );
  assert.equal(validateGenerativeWidget({ ...timeline, items: [] }), null);
  const item = { ...timeline.items[0] };
  delete item.status;
  assert.equal(validateGenerativeWidget({ ...timeline, items: [item] }), null);
});

test("board enforces stable card/column identities and existing column references", () => {
  assert.ok(validateGenerativeWidget({ ...board, cards: [] }));
  for (const changes of [
    { columns: [] },
    { columns: [board.columns[0], board.columns[0]] },
    { cards: [board.cards[0], board.cards[0]] },
    { cards: [{ ...board.cards[0], columnId: "missing" }] },
    { cards: [{ ...board.cards[0], id: "" }] },
    { cards: [{ ...board.cards[0], body: 6 }] },
  ])
    assert.equal(validateGenerativeWidget({ ...board, ...changes }), null);
});

test("bounded collections, payload bytes and text sizes limit renderer work", () => {
  assert.equal(validateGenerativeWidget({ ...document, title: "x".repeat(161) }), null);
  assert.equal(validateGenerativeWidget({ ...document, content: "x".repeat(64_001) }), null);
  assert.equal(validateGenerativeWidget({ ...document, content: "😀".repeat(32_000) }), null);
  assert.equal(
    validateGenerativeWidget({
      ...board,
      columns: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, title: "Column" })),
    }),
    null,
  );
  assert.equal(
    validateGenerativeWidget({
      ...board,
      cards: Array.from({ length: 65 }, (_, i) => ({ ...board.cards[0], id: `card${i}` })),
    }),
    null,
  );
  assert.equal(
    validateGenerativeWidget({
      ...timeline,
      items: Array.from({ length: 65 }, (_, i) => ({ ...timeline.items[0], id: `step${i}` })),
    }),
    null,
  );
  assert.equal(
    validateGenerativeWidget({ ...board, cards: [{ ...board.cards[0], body: "x".repeat(4001) }] }),
    null,
  );
  const cards = [...board.cards];
  Object.defineProperty(cards, "extra", { value: "action", enumerable: true });
  assert.equal(validateGenerativeWidget({ ...board, cards }), null);
});

test("complete explicit fences split into widgets while every source byte remains reconstructable", () => {
  const source = `Before\n\n${fenced(document)}Between\n${fenced(board)}After`;
  const parts = splitGenerativeContent(source);
  assert.deepEqual(
    parts.map((part) => part.kind),
    ["text", "widget", "text", "widget", "text"],
  );
  assert.equal(
    parts.map((part) => (part.kind === "text" ? part.text : part.source)).join(""),
    source,
  );
  assert.deepEqual(parts[1].widget, document);
  assert.deepEqual(splitGenerativeContent(fenced(date))[0].widget, date);
  const crlf = fenced(document).replaceAll("\n", "\r\n");
  assert.equal(splitGenerativeContent(crlf)[0].source, crlf);
});

test("invalid, partial, unlabeled or unsupported JSON stays ordinary exact text", () => {
  for (const source of [
    JSON.stringify(document),
    fenced(document, "json"),
    fenced(document, "KOVA-UI"),
    fenced(document, "kova-ui action"),
    "```kova-ui\n{bad json}\n```\n",
    "```kova-ui\n" + JSON.stringify(document),
    fenced({ ...document, action: "send" }),
    "```kova-ui\n" + JSON.stringify(document) + "\n``\n",
  ])
    assert.deepEqual(splitGenerativeContent(source), [{ kind: "text", text: source }]);
  assert.deepEqual(splitGenerativeContent(""), []);
});

test("nested fence examples do not become live widgets", () => {
  const nested = "````markdown\n" + fenced(document) + "````\n";
  assert.deepEqual(splitGenerativeContent(nested), [{ kind: "text", text: nested }]);
  const mixed = "~~~text\n" + fenced(board) + "~~~\n" + fenced(date);
  const parts = splitGenerativeContent(mixed);
  assert.equal(parts.filter((part) => part.kind === "widget").length, 1);
  assert.equal(parts.at(-1).widget.type, "date");
});

test("message byte and widget-count bounds preserve excess source as text", () => {
  const nine = Array.from({ length: 9 }, () => fenced(document)).join("");
  const parts = splitGenerativeContent(nine);
  assert.equal(parts.filter((part) => part.kind === "widget").length, 8);
  assert.equal(parts.at(-1).text, fenced(document));
  const oversized = "x".repeat(128 * 1024) + fenced(date);
  assert.deepEqual(splitGenerativeContent(oversized), [{ kind: "text", text: oversized }]);
  const unicode = "😀".repeat(40_000) + fenced(date);
  assert.deepEqual(splitGenerativeContent(unicode), [{ kind: "text", text: unicode }]);
});

test("code/markup content stays data and the model contract cannot imply execution", () => {
  const html = {
    ...document,
    content: '<script>alert(1)</script><button onclick="send()">Send</button>',
  };
  assert.equal(validateGenerativeWidget(html).content, html.content);
  assert.equal(
    validateGenerativeWidget({
      ...document,
      type: "code",
      language: "javascript",
      content: "fetch('/api/delete')",
    }).content,
    "fetch('/api/delete')",
  );
  assert.match(GENERATIVE_UI_INSTRUCTIONS, /editable drafts only/);
  assert.match(
    GENERATIVE_UI_INSTRUCTIONS,
    /never claim.*booked, sent, saved, scheduled or executed/,
  );
  assert.match(GENERATIVE_UI_INSTRUCTIONS, /not fabricated thinking/);
});
