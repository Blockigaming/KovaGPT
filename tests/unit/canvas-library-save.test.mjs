import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

// Execute the production handler; service responses are controlled fault fixtures,
// not live Library acceptance. The server ownership/idempotency contract is retained.
const source = ts.createSourceFile(
  "ArtifactEditor.tsx",
  readFileSync(
    `${process.env.KOVA_REVIEW_SOURCE_DIR ?? "."}/src/components/ArtifactEditor.tsx`,
    "utf8",
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "save")
    handler = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
function fixture() {
  const calls = [],
    notices = [],
    saved = [],
    saving = [],
    timers = [];
  const bindings = {
    isSignedIn: true,
    userKey: "00000000-0000-4000-8000-000000000001",
    clerk: null,
    value: "Original private draft",
    kind: "document",
    artifactTitle: "Current document title",
    currentDraftRef: {
      current: { title: "Current document title", body: "Original private draft" },
    },
    autosaveGenerationRef: { current: 1 },
    localEditRevisionRef: { current: 0 },
    exportActorRef: { current: "00000000-0000-4000-8000-000000000001" },
    librarySavePendingRef: { current: false },
    librarySaveAttemptRef: { current: null },
    setSaving: (value) => saving.push(value),
    setSaved: (value) => saved.push(value),
    saveFn: (request) => new Promise((resolve, reject) => calls.push({ request, resolve, reject })),
    toast: { success: (value) => notices.push(value), error: (value) => notices.push(value) },
    setTimeout: (fn) => timers.push(fn),
    crypto: { randomUUID },
  };
  return {
    bindings,
    calls,
    notices,
    saved,
    saving,
    timers,
    run: () =>
      new Function(...Object.keys(bindings), `return (${handler})();`)(...Object.values(bindings)),
  };
}
test("duplicate activation dispatches once with owner and idempotency identity", async () => {
  const f = fixture();
  const one = f.run();
  await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].request.data.expectedOwnerId, f.bindings.userKey);
  assert.match(f.calls[0].request.data.idempotencyKey, /^[a-f0-9-]{36}$/);
  f.calls[0].resolve({ id: "saved" });
  await one;
  assert.deepEqual(f.saved, [true]);
});
test("unknown save outcome retry retains identity; a changed draft gets a new identity", async () => {
  const f = fixture();
  const one = f.run();
  f.calls[0].reject(new Error("Response lost"));
  await one;
  const retry = f.run();
  assert.equal(f.calls[1].request.data.idempotencyKey, f.calls[0].request.data.idempotencyKey);
  f.calls[1].resolve({ id: "original-item" });
  await retry;
  f.bindings.value = "Changed draft";
  const next = f.run();
  assert.notEqual(f.calls[2].request.data.idempotencyKey, f.calls[0].request.data.idempotencyKey);
  assert.equal(f.calls[2].request.data.content_text, "Changed draft");
  f.calls[2].resolve({ id: "new-item" });
  await next;
});
for (const transition of ["account", "artifact", "failure"]) {
  test(`late ${transition} result cannot change the next editor`, async () => {
    const f = fixture();
    const one = f.run();
    if (transition === "account") f.bindings.exportActorRef.current = "another-account";
    else f.bindings.autosaveGenerationRef.current += 1;
    if (transition === "failure") f.calls[0].reject(new Error("Old failure"));
    else f.calls[0].resolve({ id: "old-item" });
    await one;
    assert.deepEqual(f.saved, []);
    assert.deepEqual(f.notices, []);
    assert.deepEqual(f.saving, [true]);
  });
}
test("saving an older snapshot does not label newer edits saved", async () => {
  const f = fixture();
  const one = f.run();
  f.bindings.localEditRevisionRef.current += 1;
  f.calls[0].resolve({ id: "older-snapshot" });
  await one;
  assert.deepEqual(f.saved, [false]);
  f.bindings.autosaveGenerationRef.current += 1;
  f.timers.forEach((timer) => timer());
  assert.deepEqual(f.saved, [false]);
});
test("unresolved owner, changed account, and oversized draft do not dispatch", async () => {
  for (const changes of [
    { userKey: null },
    { value: "x".repeat(200001) },
    { exportActorRef: { current: "different" } },
  ]) {
    const f = fixture();
    Object.assign(f.bindings, changes);
    await f.run();
    assert.equal(f.calls.length, 0);
  }
});
test("current title is included in Library save and changes retry identity independently of body", async () => {
  const f = fixture();
  const first = f.run();
  assert.equal(f.calls[0].request.data.title, "Current document title");
  f.calls[0].reject(new Error("unknown"));
  await first;
  f.bindings.artifactTitle = "New title";
  const next = f.run();
  assert.equal(f.calls[1].request.data.title, "New title");
  assert.notEqual(f.calls[1].request.data.idempotencyKey, f.calls[0].request.data.idempotencyKey);
  f.calls[1].resolve({ id: "new" });
  await next;
});

test("title recovery during delayed Library save cannot acknowledge a different displayed draft", async () => {
  const f = fixture();
  const pending = f.run();
  f.bindings.currentDraftRef.current = { title: "Recovered title", body: f.bindings.value };
  f.calls[0].resolve({ id: "saved-old-title" });
  await pending;
  assert.deepEqual(f.saved, [false]);
});

test("even identical title recovery advances the acknowledgement boundary", async () => {
  const f = fixture();
  f.bindings.currentDraftRef.current.recoveryEpoch = 1;
  const pending = f.run();
  f.bindings.currentDraftRef.current = { ...f.bindings.currentDraftRef.current, recoveryEpoch: 2 };
  f.calls[0].resolve({ id: "saved-before-recovery" });
  await pending;
  assert.deepEqual(f.saved, [false]);
});
