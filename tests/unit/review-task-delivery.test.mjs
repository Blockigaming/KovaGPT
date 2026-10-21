import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync, buildSync } from "esbuild";
import { taskTimezone } from "../../src/lib/scheduled-task-policy.mjs";
const source = readFileSync(
  new URL("../../review-kit/components/TaskDeliveryPreview.tsx", import.meta.url),
  "utf8",
);
const pure = source.slice(
  source.indexOf("export type DeliveryDraft"),
  source.indexOf("export function TaskDeliveryPreview("),
);
const module = { exports: {} };
new Function(
  "module",
  "exports",
  "taskTimezone",
  transformSync(pure, { loader: "ts", format: "cjs" }).code,
)(module, module.exports, taskTimezone);
const {
  createDeliveryPreviewState: create,
  validateDeliveryDraft: validate,
  taskDeliveryPreviewReducer: reduce,
} = module.exports;

test("delivery draft needs a channel and uses real task IANA validation", () => {
  assert.match(validate({ inApp: false, email: false, timezone: "UTC" }), /at least one/);
  for (const timezone of ["UTC", "Europe/London", "America/New_York", "Asia/Kolkata"])
    assert.equal(validate({ inApp: true, email: false, timezone }), "");
  for (const timezone of ["", "Mars/Olympus", "not a zone"])
    assert.match(validate({ inApp: true, email: false, timezone }), /IANA/);
  const invalid = reduce(create(), { type: "edit", patch: { timezone: "wrong" } });
  assert.equal(reduce(invalid, { type: "review" }).stage, "editing");
});

test("sample save requires review and failure preserves every draft choice", () => {
  let state = reduce(create(), {
    type: "edit",
    patch: { inApp: false, email: true, timezone: " Europe/London " },
  });
  assert.equal(reduce(state, { type: "save" }), state);
  state = reduce(state, { type: "review" });
  assert.equal(state.stage, "review");
  assert.equal(state.draft.timezone, "Europe/London");
  const failed = reduce(state, { type: "fail" });
  assert.deepEqual(failed.draft, state.draft);
  assert.equal(failed.saved, null);
  assert.match(failed.error, /draft is still here/);
  const saved = reduce(reduce(failed, { type: "review" }), { type: "save" });
  assert.deepEqual(saved.saved, state.draft);
  assert.match(saved.status, /No notification was scheduled or sent/);
});

test("cancel returns to last saved sample choices and reset removes them", () => {
  const saved = reduce(reduce(create(), { type: "review" }), { type: "save" });
  const edited = reduce(saved, { type: "edit", patch: { timezone: "Asia/Kolkata", email: true } });
  const canceled = reduce(edited, { type: "cancel" });
  assert.deepEqual(canceled.draft, saved.saved);
  assert.equal(canceled.stage, "editing");
  assert.deepEqual(reduce(canceled, { type: "reset" }), create());
});

test("delivery proposal bundles without service calls and makes its boundary explicit", () => {
  assert.match(source.replace(/\s+/g, " "), /owner and provider must decide/);
  assert.match(source, /preview@example\.invalid/);
  assert.doesNotMatch(
    source,
    /\b(?:fetch|useServerFn|localStorage|sessionStorage|window\.open)\s*\(/,
  );
  const result = buildSync({
    entryPoints: ["review-kit/components/TaskDeliveryPreview.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    logLevel: "silent",
  });
  assert.ok(result.outputFiles[0].text.length);
});
