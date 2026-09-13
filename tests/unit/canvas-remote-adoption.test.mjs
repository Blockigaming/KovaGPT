import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { canApplyLoadedArtifactHistory } from "../../src/lib/canvas-autosave-policy.mjs";

// Execute the production adoption effect, including its condition, so a string
// equality shortcut cannot bypass the edit-generation guard unnoticed.
const source = ts.createSourceFile(
  "ArtifactEditor.tsx",
  readFileSync("src/components/ArtifactEditor.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let effect;
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "useEffect" &&
    node.arguments[0]?.getText(source).includes("const content = adoptRemote()")
  )
    effect = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(effect, "production collaboration adoption effect exists");
function apply(localEditRevision, acknowledgedEditRevision = 0, pendingWrites = 0) {
  const writes = [];
  const remoteSnapshot = {
    document: { revision: 2, content: "Remote accepted text" },
    versions: [{ revision: 2, created_at: "2026-09-05T00:00:00Z" }],
  };
  const bindings = {
    open: true,
    remoteSnapshot,
    canApplyLoadedArtifactHistory,
    localEditRevisionRef: { current: localEditRevision },
    acknowledgedEditRevision,
    pendingAutosavesRef: { current: pendingWrites },
    value: "Opening text",
    lastRecordedValueRef: { current: "Opening text" },
    lastScheduledValueRef: { current: "Opening text" },
    adoptRemote: () => remoteSnapshot.document.content,
    setVersions: () => {},
    setValue: (value) => writes.push(value),
    setSaveState: () => {},
  };
  new Function(...Object.keys(bindings), `return (${effect})();`)(...Object.values(bindings));
  return { writes, bindings };
}
test("late Canvas open adopts only when no edit occurred, including intentional reverts", async () => {
  let complete;
  const delayed = new Promise((resolve) => {
    complete = resolve;
  });
  let revision = 0;
  const result = delayed.then(() => apply(revision));
  revision++; // User types a different value.
  revision++; // User intentionally returns to the exact opening string.
  complete();
  assert.deepEqual((await result).writes, []);
  assert.deepEqual(apply(0).writes, ["Remote accepted text"]);
});

test("acknowledged edits permit later remote adoption only after every queued write settles", () => {
  assert.deepEqual(apply(2, 2).writes, ["Remote accepted text"]);
  assert.deepEqual(apply(3, 2).writes, []); // Later edit is not acknowledged.
  assert.deepEqual(apply(2, 2, 1).writes, []); // Even a matching value is still pending.
  assert.deepEqual(apply(4, 2).writes, []); // Intentional revert preserves its new generation.
});

test("unconfirmed comment retry retains its original epoch after remote compaction", async () => {
  const comments = ts.createSourceFile(
    "CanvasComments.tsx",
    readFileSync("src/components/CanvasComments.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  const find = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(comments) === "run" &&
      node.arguments[0]?.getText(comments).includes("await onComment")
    )
      callback = node.arguments[0].getText(comments);
    ts.forEachChild(node, find);
  };
  find(comments);
  assert.ok(callback);
  const attempt = { current: null },
    sent = [];
  const invoke = (epoch) => {
    const bindings = {
      draft: "Unconfirmed comment",
      selection: () => null,
      snapshot: { document: { revision: 1, comment_epoch: epoch } },
      attempt,
      onComment: async (payload) => {
        sent.push(payload);
        throw new Error("response lost");
      },
      setDraft: () => {},
    };
    return new Function(...Object.keys(bindings), `return (${callback})();`)(
      ...Object.values(bindings),
    );
  };
  await assert.rejects(invoke(0), /response lost/);
  // Its initial write was accepted, then deleted and compacted elsewhere.
  // A refreshed snapshot must not upgrade the authority of the pending retry.
  await assert.rejects(invoke(1), /response lost/);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].commentId, sent[1].commentId);
  assert.equal(sent[0].commentEpoch, 0);
  assert.equal(sent[1].commentEpoch, 0);
});
