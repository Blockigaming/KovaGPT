import assert from "node:assert/strict";
import test from "node:test";

import {
  BUNDLE_BUDGETS,
  HOME_ROUTE_MARKERS,
  evaluateBundleChecks,
  identifyBudgetChunks,
} from "../../scripts/release/bundle-budget.mjs";

const row = (file, raw, gzip, text = "") => ({ file, raw, gzip, text });
const markedHomeText = HOME_ROUTE_MARKERS.join(" :: ");

function validRows() {
  return [
    row("index-bootstrap.js", 50_000, 16_000),
    row("index-home.js", 620_000, 179_000, markedHomeText),
    row("omega-workspace.js", 30_000, 10_000),
    row("ChatChart-lazy.js", 440_000, 120_000),
    row("index-small-route.js", 2_000, 900),
  ];
}

test("bundle budgets identify the home route by stable source markers", () => {
  const selection = identifyBudgetChunks(validRows());
  assert.deepEqual(selection.errors, []);
  assert.equal(selection.chunks.initial.file, "index-bootstrap.js");
  assert.equal(selection.chunks.homeRoute.file, "index-home.js");
  assert.notEqual(selection.chunks.initial.file, selection.chunks.homeRoute.file);

  const evaluation = evaluateBundleChecks(selection.chunks);
  assert.deepEqual(evaluation.failures, []);
});

test("bundle budgets fail closed when home-route evidence is missing or ambiguous", () => {
  const missing = identifyBudgetChunks(validRows().map((item) => ({ ...item, text: "" })));
  assert.equal(missing.chunks.homeRoute, undefined);
  assert.match(missing.errors[0], /no JavaScript chunk/u);
  assert.match(evaluateBundleChecks(missing.chunks).failures.join("\n"), /homeRoute/u);

  const ambiguous = identifyBudgetChunks([
    ...validRows(),
    row("other-home.js", 10_000, 4_000, markedHomeText),
  ]);
  assert.equal(ambiguous.chunks.homeRoute, undefined);
  assert.match(ambiguous.errors[0], /2 JavaScript chunks/u);
});

test("bundle budgets enforce raw and gzip ceilings independently", () => {
  const rawOverflow = identifyBudgetChunks(
    validRows().map((item) =>
      item.file === "index-home.js"
        ? { ...item, raw: BUNDLE_BUDGETS.homeRoute.raw + 1 }
        : item,
    ),
  );
  assert.match(evaluateBundleChecks(rawOverflow.chunks).failures.join("\n"), /raw bytes/u);

  const gzipOverflow = identifyBudgetChunks(
    validRows().map((item) =>
      item.file === "index-home.js"
        ? { ...item, gzip: BUNDLE_BUDGETS.homeRoute.gzip + 1 }
        : item,
    ),
  );
  assert.match(evaluateBundleChecks(gzipOverflow.chunks).failures.join("\n"), /gzip bytes/u);
});
