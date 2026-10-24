import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync, buildSync } from "esbuild";
const source = readFileSync(
  new URL("../../review-kit/components/TrialPreview.tsx", import.meta.url),
  "utf8",
);
const pure = source.slice(
  source.indexOf("export type TrialSampleStage"),
  source.indexOf("export function TrialPreview("),
);
const module = { exports: {} };
new Function("module", "exports", transformSync(pure, { loader: "ts", format: "cjs" }).code)(
  module,
  module.exports,
);
const { createTrialPreviewState: create, trialPreviewReducer: reduce } = module.exports;

test("all six required trial scenarios are independently selectable and reset consent", () => {
  for (const stage of ["eligible", "start", "active", "ending", "expired", "ineligible"]) {
    const result = reduce({ ...create(), reviewed: true }, { type: "select", stage });
    assert.equal(result.stage, stage);
    assert.equal(result.reviewed, false);
  }
});

test("trial start requires eligible scenario and explicit sample acknowledgment", () => {
  const start = reduce(create(), { type: "start" });
  assert.equal(start.stage, "start");
  assert.equal(reduce(start, { type: "confirmStart" }), start);
  const reviewed = reduce(start, { type: "reviewed", value: true });
  assert.equal(reduce(reviewed, { type: "confirmStart" }).stage, "active");
  assert.deepEqual(reduce(start, { type: "return" }), create());
  for (const stage of ["ineligible", "expired", "canceled"]) {
    const state = { ...create(), stage, reviewed: true };
    assert.equal(reduce(state, { type: "start" }), state);
    assert.equal(reduce(state, { type: "confirmStart" }), state);
  }
});

test("cancellation must be confirmed and return preserves active or ending state", () => {
  for (const stage of ["active", "ending"]) {
    const state = { ...create(), stage };
    assert.equal(reduce(state, { type: "confirmCancel" }), state);
    const confirming = reduce(state, { type: "cancel" });
    assert.equal(confirming.stage, "cancel");
    assert.equal(reduce(confirming, { type: "return" }).stage, stage);
    assert.equal(reduce(confirming, { type: "confirmCancel" }).stage, "canceled");
    assert.equal(reduce(state, { type: "expire" }).stage, "expired");
  }
  assert.equal(reduce({ ...create(), stage: "active" }, { type: "ending" }).stage, "ending");
  assert.deepEqual(reduce({ ...create(), stage: "expired" }, { type: "reset" }), create());
});

test("trial preview bundles without billing calls or invented numeric commercial facts", () => {
  assert.match(source, /Owner decision required/);
  assert.match(source.replace(/\s+/g, " "), /not an actual offer or eligibility decision/);
  assert.doesNotMatch(
    source,
    /\b(?:fetch|useServerFn|localStorage|sessionStorage|window\.open)\s*\(/,
  );
  assert.doesNotMatch(source, /\$\d|\b\d+[- ]day|\b\d+ days/);
  const result = buildSync({
    entryPoints: ["review-kit/components/TrialPreview.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    logLevel: "silent",
  });
  assert.ok(result.outputFiles[0].text.length);
});
