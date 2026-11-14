import test from "node:test";
import assert from "node:assert/strict";
import {
  validateInteractiveBlock,
  validateFormValues,
  initialFormValues,
  formatSubmission,
  splitInteractiveContent,
} from "../../src/lib/interactive-ui.mjs";

const form = {
  version: 1,
  type: "form",
  id: "trip",
  title: "Trip",
  fields: [
    { id: "budget", label: "Budget", kind: "slider", min: 0, max: 10, default: 5 },
    {
      id: "style",
      label: "Style",
      kind: "radio",
      required: true,
      options: [
        { value: "a", label: "Relaxed" },
        { value: "b", label: "Adventure" },
      ],
    },
    { id: "start", label: "Start", kind: "date", min: "2026-01-01" },
  ],
  actions: [{ id: "skip", label: "Skip" }],
};

test("accepts a valid form and normalizes it", () => {
  const v = validateInteractiveBlock(form);
  assert.equal(v.type, "form");
  assert.equal(v.actions[0].style, "secondary");
});

test("rejects unknown keys, html-ish handlers and bad kinds", () => {
  assert.equal(validateInteractiveBlock({ ...form, onClick: "alert(1)" }), null);
  assert.equal(
    validateInteractiveBlock({ ...form, fields: [{ id: "x", label: "X", kind: "html" }] }),
    null,
  );
  assert.equal(validateInteractiveBlock({ ...form, version: 2 }), null);
  assert.equal(
    validateInteractiveBlock({ ...form, fields: [{ id: "s", label: "S", kind: "slider" }] }),
    null,
  );
});

test("required and range validation of submitted values", () => {
  const v = validateInteractiveBlock(form);
  const errors = validateFormValues(v, { ...initialFormValues(v), start: "2025-12-31" });
  assert.ok(errors.style);
  assert.ok(errors.start);
  assert.deepEqual(validateFormValues(v, { budget: 5, style: "a", start: "2026-02-01" }), {});
});

test("submission becomes a readable message with option labels", () => {
  const v = validateInteractiveBlock(form);
  const msg = formatSubmission(v, { values: { budget: 3, style: "b", start: "" } });
  assert.match(msg, /Style: Adventure/);
  assert.match(msg, /Budget: 3/);
});

test("table selection modes and row shape", () => {
  const t = {
    version: 1,
    type: "table",
    id: "p",
    title: "Plans",
    columns: [{ id: "n", label: "Name" }],
    rows: [{ id: "r1", cells: ["Basic"] }],
    selection: "single",
  };
  assert.equal(validateInteractiveBlock(t).selection, "single");
  assert.equal(validateInteractiveBlock({ ...t, rows: [{ id: "r1", cells: ["a", "b"] }] }), null);
});

test("splits fenced blocks and leaves invalid ones as text", () => {
  const good = "Hi\n```kova-interactive\n" + JSON.stringify(form) + "\n```\nBye";
  const parts = splitInteractiveContent(good);
  assert.deepEqual(
    parts.map((p) => p.kind),
    ["text", "interactive", "text"],
  );
  const bad = "```kova-interactive\n{not json}\n```";
  assert.deepEqual(splitInteractiveContent(bad), [{ kind: "text", text: bad }]);
});

test("study decks render only bounded text and valid answer options", () => {
  const deck = {
    version: 1,
    type: "quiz",
    id: "practice",
    title: "Practice",
    cards: [
      {
        front: "What is 2 + 2?",
        back: "Four.",
        options: [
          { value: "a", label: "3" },
          { value: "b", label: "4" },
        ],
        answer: "b",
      },
    ],
  };
  assert.equal(validateInteractiveBlock(deck)?.cards[0].answer, "b");
  assert.equal(
    validateInteractiveBlock({ ...deck, cards: [{ ...deck.cards[0], answer: "x" }] }),
    null,
  );
  assert.equal(
    validateInteractiveBlock({ ...deck, cards: [{ ...deck.cards[0], onClick: "x" }] }),
    null,
  );
  assert.equal(
    splitInteractiveContent(
      "Before\n\`\`\`kova-interactive\n" + JSON.stringify(deck) + "\n\`\`\`\nAfter",
    )[1].kind,
    "interactive",
  );
  assert.equal(
    validateInteractiveBlock({
      ...deck,
      type: "flashcards",
      cards: [{ front: "2 + 2", back: "4" }],
    })?.type,
    "flashcards",
  );
});

test("simulation schemas accept bounded controls and reject formulas or unsafe ranges", () => {
  const range = { min: 1, max: 20, step: 1, value: 5 };
  const block = {
    version: 1,
    type: "simulation",
    id: "area",
    title: "Area",
    model: "rectangle",
    inputs: { width: range, height: range },
  };
  assert.equal(validateInteractiveBlock(block)?.type, "simulation");
  assert.equal(validateInteractiveBlock({ ...block, formula: "width * height" }), null);
  assert.equal(validateInteractiveBlock({ ...block, model: "custom" }), null);
  assert.equal(
    validateInteractiveBlock({ ...block, inputs: { width: range, height: { ...range, step: 0 } } }),
    null,
  );
});

test("diagram schemas require unique nodes, real endpoints and inert labels", () => {
  const block = {
    version: 1,
    type: "diagram",
    id: "flow",
    title: "Flow",
    nodes: [
      { id: "a", label: "Start", x: 5, y: 10 },
      { id: "b", label: "Finish", x: 80, y: 70 },
    ],
    edges: [{ from: "a", to: "b", label: "Then" }],
  };
  assert.equal(validateInteractiveBlock(block)?.nodes[0].shape, "box");
  assert.equal(validateInteractiveBlock({ ...block, edges: [{ from: "a", to: "c" }] }), null);
  assert.equal(
    validateInteractiveBlock({ ...block, nodes: [...block.nodes, block.nodes[0]] }),
    null,
  );
  assert.equal(
    validateInteractiveBlock({
      ...block,
      edges: [{ ...block.edges[0], url: "https://example.com" }],
    }),
    null,
  );
});

test("pattern previews only accept a named pattern and two literal colors", () => {
  const block = {
    version: 1,
    type: "pattern",
    id: "palette",
    title: "Pattern",
    pattern: "checks",
    colors: ["#123456", "#abcdef"],
  };
  assert.equal(validateInteractiveBlock(block)?.pattern, "checks");
  assert.equal(
    validateInteractiveBlock({ ...block, colors: ["url(https://example.com)", "#abcdef"] }),
    null,
  );
  assert.equal(validateInteractiveBlock({ ...block, pattern: "custom" }), null);
});

test("file bundles preserve the payload and reject unsafe, duplicate or nested names", () => {
  const file = { name: "report.md", content: "# Results\n" };
  const block = { version: 1, type: "files", id: "report", title: "Report", files: [file] };
  assert.deepEqual(validateInteractiveBlock(block)?.files, [file]);
  assert.equal(
    validateInteractiveBlock({ ...block, files: [{ ...file, name: "../report.md" }] }),
    null,
  );
  assert.equal(validateInteractiveBlock({ ...block, files: [{ ...file, name: "CON.md" }] }), null);
  assert.equal(
    validateInteractiveBlock({ ...block, files: [file, { ...file, name: "REPORT.MD" }] }),
    null,
  );
  assert.equal(
    validateInteractiveBlock({ ...block, files: [{ ...file, name: "index.html" }] }),
    null,
  );
});

test("speech blocks carry only a bounded transcript and no provider instructions", () => {
  const speech = { version: 1, type: "speech", id: "speech", title: "Narration", script: "Hello." };
  assert.equal(validateInteractiveBlock(speech)?.script, "Hello.");
  assert.equal(validateInteractiveBlock({ ...speech, voiceId: "unapproved" }), null);
  assert.equal(validateInteractiveBlock({ ...speech, url: "https://example.com/audio.mp3" }), null);
  assert.equal(validateInteractiveBlock({ ...speech, script: "x".repeat(5001) }), null);
});

test("time, search, and color controls validate and format local input", () => {
  const block = validateInteractiveBlock({
    ...form,
    fields: [
      { id: "time", label: "Time", kind: "time", min: "08:00", max: "18:00", required: true },
      { id: "color", label: "Color", kind: "color", default: "#008844" },
      { id: "term", label: "Search", kind: "search" },
    ],
  });
  assert.ok(block);
  assert.equal(initialFormValues(block).color, "#008844");
  assert.ok(validateFormValues(block, { time: "25:10", color: "url(x)" }).time);
  assert.ok(validateFormValues(block, { time: "07:59", color: "#008844" }).time);
  assert.deepEqual(
    validateFormValues(block, { time: "12:30", color: "#008844", term: "coffee" }),
    {},
  );
  assert.match(
    formatSubmission(block, { values: { time: "12:30", color: "#008844", term: "coffee" } }),
    /Time: 12:30\n- Color: #008844\n- Search: coffee/,
  );
});
