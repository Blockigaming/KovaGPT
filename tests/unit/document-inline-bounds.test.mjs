import test from "node:test";
import assert from "node:assert/strict";
import { load } from "../helpers/document-writers.mjs";
const { documentInlineRuns, MAX_DOCUMENT_CHARS, INLINE_DOCUMENT_WORK_BOUND } = load(
  "src/lib/writing-export/common.ts",
);
const raw = (runs) => runs.map((run) => run.text).join("");
test("maximum-size adversarial delimiters have deterministic linear parser work and preserve literal text", () => {
  const cases = [
    "[".repeat(MAX_DOCUMENT_CHARS),
    "(".repeat(MAX_DOCUMENT_CHARS),
    "](".repeat(MAX_DOCUMENT_CHARS / 2),
    "\\[".repeat(MAX_DOCUMENT_CHARS / 2),
    "[label](https://invalid%host)".repeat(6000),
    "[".repeat(190000) + "](https://invalid%host)",
  ];
  for (const text of cases) {
    const stats = { workUnits: 0, urlParses: 0 };
    const runs = documentInlineRuns(text, stats);
    assert.equal(raw(runs), text);
    assert.ok(stats.workUnits >= text.length);
    assert.ok(
      stats.workUnits <= INLINE_DOCUMENT_WORK_BOUND * text.length + 32,
      `${stats.workUnits} units for ${text.length} characters`,
    );
    assert.ok(stats.urlParses <= text.length / 8);
  }
  assert.throws(() => documentInlineRuns("x".repeat(MAX_DOCUMENT_CHARS + 1)), /limit/);
});
test("supported inline formatting remains intact and escaped or unsafe links stay literal", () => {
  const runs = documentInlineRuns(
    "A **bold** and *italic* with `code` [site](https://example.test/a%28b%29).",
  );
  assert.ok(runs.some((r) => r.bold && r.text === "bold"));
  assert.ok(runs.some((r) => r.italics && r.text === "italic"));
  assert.ok(runs.some((r) => r.code && r.text === "code"));
  assert.ok(runs.some((r) => r.link === "https://example.test/a%28b%29" && r.text === "site"));
  for (const text of [
    "\\[site](https://example.test)",
    "![image](https://example.test)",
    "[private](https://user:secret@example.test)",
    "[bad](javascript:alert(1))",
    "\\*escaped\\*",
    "[long](https://example.test/" + "x".repeat(8192) + ")",
  ])
    assert.equal(raw(documentInlineRuns(text)), text);
});
