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
