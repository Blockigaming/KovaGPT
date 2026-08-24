import assert from "node:assert/strict";
import test from "node:test";

import {
  applySelectionEdit,
  buildRewriteInstruction,
  describeRewriteFailure,
  fenceCount,
  locateSelection,
  normalizeRewrite,
  selectionContext,
  validateSelectionRange,
  MAX_SELECTION_CHARS,
} from "../../src/lib/selection-edit.mjs";

const SOURCE = "Intro paragraph.\n\nThe middle sentence needs work.\n\nClosing paragraph.";

test("locates a unique selection in the markdown source", () => {
  const range = locateSelection(SOURCE, "The middle sentence needs work.");
  assert.equal(SOURCE.slice(range.start, range.end), "The middle sentence needs work.");
});

test("rejects an ambiguous selection instead of guessing", () => {
  assert.throws(() => locateSelection("same same", "same"), /appears more than once/);
});

test("rejects a selection that is not in the source", () => {
  assert.throws(() => locateSelection(SOURCE, "not present at all"), /could not be matched/);
});

test("rejects empty and oversized selections", () => {
  assert.throws(() => locateSelection(SOURCE, "   "), /Select some text/);
  assert.throws(
    () =>
      locateSelection("a".repeat(MAX_SELECTION_CHARS + 10), "a".repeat(MAX_SELECTION_CHARS + 5)),
    /characters or fewer/,
  );
});

test("validates explicit ranges and exposes untouched prefix/suffix", () => {
  const range = validateSelectionRange(SOURCE, 18, 49);
  assert.equal(range.prefix + range.selected + range.suffix, SOURCE);
  assert.throws(() => validateSelectionRange(SOURCE, 10, 10), /not valid/);
  assert.throws(() => validateSelectionRange(SOURCE, -1, 5), /not valid/);
  assert.throws(() => validateSelectionRange(SOURCE, 5, SOURCE.length + 3), /not valid/);
});

test("applying an edit preserves everything outside the selection", () => {
  const range = locateSelection(SOURCE, "The middle sentence needs work.");
  const next = applySelectionEdit(SOURCE, range.start, range.end, "The middle sentence is sharp.");
  assert.ok(next.startsWith("Intro paragraph."));
  assert.ok(next.endsWith("Closing paragraph."));
  assert.ok(next.includes("The middle sentence is sharp."));
  assert.ok(!next.includes("needs work"));
});

test("an empty rewrite never overwrites the response", () => {
  const range = locateSelection(SOURCE, "The middle sentence needs work.");
  assert.throws(() => applySelectionEdit(SOURCE, range.start, range.end, "   "), /came back empty/);
});

test("a rewrite that would unbalance code fences is rejected", () => {
  const source = "before\n\n```js\nconst a = 1;\n```\n\nafter";
  const range = locateSelection(source, "```js\nconst a = 1;\n```");
  assert.equal(fenceCount(range ? source.slice(range.start, range.end) : ""), 2);
  assert.throws(
    () => applySelectionEdit(source, range.start, range.end, "```js\nconst a = 2;"),
    /unbalanced code block/,
  );
  const ok = applySelectionEdit(source, range.start, range.end, "```js\nconst a = 2;\n```");
  assert.ok(ok.includes("const a = 2;"));
});

test("model preamble and stray fences are stripped for prose selections", () => {
  assert.equal(
    normalizeRewrite("Here is the rewrite: Cleaner text.", "Old text."),
    "Cleaner text.",
  );
  assert.equal(normalizeRewrite("```\nCleaner text.\n```", "Old text."), "Cleaner text.");
  // A fenced selection keeps its fences.
  assert.equal(normalizeRewrite("```js\nx\n```", "```js\ny\n```"), "```js\nx\n```");
});

test("rewrite instruction is bounded and carries surrounding context", () => {
  const context = selectionContext(SOURCE, 18, 49, 10);
  const prompt = buildRewriteInstruction(
    "make it punchier",
    "The middle sentence needs work.",
    context,
  );
  assert.ok(prompt.includes("make it punchier"));
  assert.ok(prompt.includes("Do not wrap the result in a code fence."));
  assert.throws(() => buildRewriteInstruction("   ", "x"), /Describe how/);
});

test("failures are described honestly and never claim a change", () => {
  for (const [status, expected] of [
    [0, /offline/],
    [401, /session expired/i],
    [429, /limit/],
    [503, /unavailable/],
    [500, /failed upstream/],
  ]) {
    assert.match(describeRewriteFailure(status), expected);
  }
  assert.match(describeRewriteFailure(0), /not changed/);
});
