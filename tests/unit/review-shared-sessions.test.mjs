import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync, buildSync } from "esbuild";
function load(name, start, end) {
  const source = readFileSync(
    new URL(`../../review-kit/components/${name}.tsx`, import.meta.url),
    "utf8",
  );
  const code = transformSync(source.slice(source.indexOf(start), source.indexOf(end)), {
    loader: "ts",
    format: "cjs",
  }).code;
  const module = { exports: {} };
  new Function("module", "exports", code)(module, module.exports);
  return { ...module.exports, source };
}
const shared = load(
  "SharedConversationPreview",
  "export type SharedPreviewMode",
  "export function SharedConversationPreview(",
);
const sessions = load(
  "SessionsPreview",
  "export type SessionPreviewState",
  "export function SessionsPreview(",
);

test("shared proposal clears copy feedback and hides interaction when access state changes", () => {
  const reduce = shared.sharedPreviewReducer;
  const copied = reduce({ mode: "available", copy: "idle" }, { type: "copy" });
  assert.equal(copied.copy, "previewed");
  for (const mode of ["private", "deleted", "unavailable"]) {
    const state = reduce(copied, { type: "mode", mode });
    assert.deepEqual(state, { mode, copy: "idle" });
    assert.equal(reduce(state, { type: "copy" }), state);
    assert.equal(reduce(state, { type: "copyFailure" }), state);
    assert.deepEqual(reduce(state, { type: "reset" }), { mode: "available", copy: "idle" });
  }
  assert.equal(reduce(copied, { type: "copyFailure" }).copy, "failed");
});

test("session proposal refuses current/unknown devices and requires explicit confirmation", () => {
  const state = sessions.createSessionPreviewState();
  const reduce = sessions.sessionsPreviewReducer;
  assert.equal(reduce(state, { type: "request", id: "current" }), state);
  assert.equal(reduce(state, { type: "request", id: "unknown" }), state);
  assert.equal(reduce(state, { type: "confirm" }), state);
  const pending = reduce(state, { type: "request", id: "phone" });
  assert.equal(pending.pending, "phone");
  assert.deepEqual(pending.revoked, []);
  assert.equal(reduce(pending, { type: "request", id: "tablet" }), pending);
  assert.deepEqual(reduce(pending, { type: "cancel" }), state);
  const done = reduce(pending, { type: "confirm" });
  assert.deepEqual(done.revoked, ["phone"]);
  assert.equal(done.pending, null);
  assert.equal(done.result, "phone");
  assert.equal(reduce(done, { type: "request", id: "phone" }), done);
});

test("session failures preserve devices, retry confirms only selected device, reset restores samples", () => {
  const reduce = sessions.sessionsPreviewReducer;
  const initial = sessions.createSessionPreviewState();
  const failed = reduce(reduce(initial, { type: "request", id: "tablet" }), { type: "fail" });
  assert.equal(failed.error, true);
  assert.deepEqual(failed.revoked, []);
  const retried = reduce(failed, { type: "confirm" });
  assert.deepEqual(retried.revoked, ["tablet"]);
  assert.equal(retried.error, false);
  assert.deepEqual(reduce(retried, { type: "reset" }), initial);
});

test("both proposal components bundle locally and cannot call account or sharing services", () => {
  for (const [name, source] of [
    ["SharedConversationPreview", shared.source],
    ["SessionsPreview", sessions.source],
  ]) {
    assert.match(source, /Proposal · private review · sample data/);
    assert.doesNotMatch(
      source,
      /\b(?:fetch|useServerFn|localStorage|sessionStorage|writeText|window\.open)\s*\(/,
    );
    const result = buildSync({
      entryPoints: [`review-kit/components/${name}.tsx`],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      logLevel: "silent",
    });
    assert.ok(result.outputFiles[0].text.length);
  }
});
