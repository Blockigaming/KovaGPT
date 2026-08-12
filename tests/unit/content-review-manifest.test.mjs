import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const review = JSON.parse(readFileSync("docs/page-parity/content-review-manifest.json", "utf8"));

test("all 105 public noindex routes have an individual content decision", () => {
  assert.equal(review.count, 105);
  assert.equal(review.routes.length, 105);
  assert.equal(new Set(review.routes.map((row) => row.route)).size, 105);
  for (const row of review.routes) {
    for (const field of [
      "route",
      "templateFamily",
      "h1",
      "wordCount",
      "uniqueContentScore",
      "duplicateContentMatches",
      "decision",
      "reason",
    ])
      assert.ok(Object.hasOwn(row, field), `${row.route}: ${field}`);
  }
});

test("no reviewed thin or unresolved page was promoted", () => {
  assert.equal(review.decisions.remain_noindex, 105);
  assert.equal(
    review.routes.some((row) => row.decision === "index"),
    false,
  );
});
