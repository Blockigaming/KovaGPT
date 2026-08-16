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
    row("index-home-route.js", 50_000, 16_000, markedHomeText),
    row("index-main-entry.js", 620_000, 179_000),
    row("omega-workspace.js", 30_000, 10_000),
    row("ChatChart-lazy.js", 440_000, 120_000),
    row("index-small-route.js", 2_000, 900),
  ];
}

function validManifest() {
  return {
    "virtual:kova-client-entry": {
      file: "assets/index-main-entry.js",
      isEntry: true,
    },
    "src/routes/index.tsx": {
      file: "assets/index-home-route.js",
      isDynamicEntry: true,
    },
  };
}

test("bundle budgets select route and shared entry independently of their sizes", () => {
  const selection = identifyBudgetChunks(validRows(), validManifest());
  assert.deepEqual(selection.errors, []);
  assert.equal(selection.chunks.initial.file, "index-home-route.js");
  assert.equal(selection.chunks.main.file, "index-main-entry.js");
  assert.equal(selection.entryManifestKey, "virtual:kova-client-entry");
  assert.notEqual(selection.chunks.initial.file, selection.chunks.main.file);

  const evaluation = evaluateBundleChecks(selection.chunks);
  assert.deepEqual(evaluation.failures, []);
});

test("bundle budgets fail closed when home-route evidence is missing or ambiguous", () => {
  const missing = identifyBudgetChunks(
    validRows().map((item) => ({ ...item, text: "" })),
    validManifest(),
  );
  assert.equal(missing.chunks.initial, undefined);
  assert.match(missing.errors[0], /no JavaScript chunk/u);
  assert.match(evaluateBundleChecks(missing.chunks).failures.join("\n"), /initial/u);

  const ambiguous = identifyBudgetChunks(
    [...validRows(), row("other-home.js", 10_000, 4_000, markedHomeText)],
    validManifest(),
  );
  assert.equal(ambiguous.chunks.initial, undefined);
  assert.match(ambiguous.errors[0], /2 JavaScript chunks/u);
});

test("bundle budgets fail closed when Vite entry metadata is missing or ambiguous", () => {
  const missing = identifyBudgetChunks(validRows(), {});
  assert.equal(missing.chunks.main, undefined);
  assert.match(missing.errors.join("\n"), /exactly one JavaScript entry/u);

  const ambiguous = identifyBudgetChunks(validRows(), {
    ...validManifest(),
    "virtual:second-entry": {
      file: "assets/index-home-route.js",
      isEntry: true,
    },
  });
  assert.equal(ambiguous.chunks.main, undefined);
  assert.match(ambiguous.errors.join("\n"), /found 2/u);

  const absentAsset = identifyBudgetChunks(validRows(), {
    "virtual:kova-client-entry": {
      file: "assets/not-emitted.js",
      isEntry: true,
    },
  });
  assert.equal(absentAsset.chunks.main, undefined);
  assert.match(absentAsset.errors.join("\n"), /was not found/u);
});

test("the shared entry raw and gzip ceilings are enforced after selection", () => {
  const rawOverflow = identifyBudgetChunks(
    validRows().map((item) =>
      item.file === "index-main-entry.js" ? { ...item, raw: BUNDLE_BUDGETS.main.raw + 1 } : item,
    ),
    validManifest(),
  );
  assert.match(evaluateBundleChecks(rawOverflow.chunks).failures.join("\n"), /main: raw bytes/u);

  const gzipOverflow = identifyBudgetChunks(
    validRows().map((item) =>
      item.file === "index-main-entry.js" ? { ...item, gzip: BUNDLE_BUDGETS.main.gzip + 1 } : item,
    ),
    validManifest(),
  );
  assert.match(evaluateBundleChecks(gzipOverflow.chunks).failures.join("\n"), /main: gzip bytes/u);
});
