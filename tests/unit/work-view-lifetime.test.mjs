import assert from "node:assert/strict";
import test from "node:test";
import { createWorkViewLifetime } from "../../src/lib/work-view-lifetime.mjs";
import { dispatchPrincipalBrowserStorageCleared } from "../../src/lib/principal-browser-storage.mjs";
const OWNER = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222";

test("principal reset aborts before clearing and suppresses a deferred Work result", async () => {
  const target = new EventTarget();
  target.CustomEvent = CustomEvent;
  let privateState = { objective: "Old task", pending: "Old request" },
    resolveResult;
  const view = createWorkViewLifetime(
    OWNER,
    () => {
      assert.equal(view.controller.signal.aborted, true);
      privateState = null;
    },
    target,
  );
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  }).then((value) => {
    if (!view.controller.signal.aborted) privateState = value;
  });
  dispatchPrincipalBrowserStorageCleared(OTHER, target);
  assert.equal(view.controller.signal.aborted, false);
  dispatchPrincipalBrowserStorageCleared(OWNER, target);
  assert.equal(privateState, null);
  resolveResult({ objective: "Late private result", pending: "Old request" });
  await result;
  assert.equal(privateState, null);
  view.dispose();
});

test("disposing an old view removes its reset handler and leaves a newly opened view independently bound", () => {
  const target = new EventTarget();
  target.CustomEvent = CustomEvent;
  let old = 0,
    current = 0;
  const first = createWorkViewLifetime(OWNER, () => old++, target);
  first.dispose();
  const next = createWorkViewLifetime(OWNER, () => current++, target);
  dispatchPrincipalBrowserStorageCleared(OWNER, target);
  dispatchPrincipalBrowserStorageCleared(OWNER, target);
  assert.equal(old, 0);
  assert.equal(current, 1);
  next.dispose();
});
