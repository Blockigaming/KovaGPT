import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { createHookHarness, loadUiModule, deferred } from "../helpers/ui-state-harness.mjs";

const source = ts.createSourceFile(
  "ArtifactEditor.tsx",
  readFileSync("src/components/ArtifactEditor.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let saveExpression;
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "save")
    saveExpression = node.initializer.getText(source);
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(saveExpression);
function fixture() {
  const harness = createHookHarness();
  const { useScopedActionFeedback } = loadUiModule("src/lib/use-scoped-action-feedback.ts", {
    react: harness.react,
  });
  let feedback = harness.render(useScopedActionFeedback, "owner-a:doc-a");
  const request = deferred(),
    sent = [],
    state = [],
    notices = [];
  const bindings = {
    isSignedIn: true,
    clerk: null,
    actionFeedback: feedback,
    value: "The whole unchanged draft",
    kind: "writing",
    artifactTitle: "Result title",
    savedTimerRef: { current: null },
    librarySavedValue: { current: null },
    clearTimeout() {},
    setTimeout() {
      return 0;
    },
    setSaved: (value) => state.push(["saved", value]),
    setSaving: (value) => state.push(["saving", value]),
    saveFn: (payload) => {
      sent.push(payload);
      return request.promise;
    },
    toast: { success: (message) => notices.push(message) },
    Error,
  };
  const callback = new Function(...Object.keys(bindings), `return (${saveExpression});`)(
    ...Object.values(bindings),
  );
  return {
    callback,
    request,
    sent,
    state,
    notices,
    bindings,
    render(scope = "owner-a:doc-a") {
      feedback = harness.render(useScopedActionFeedback, scope);
      return feedback;
    },
  };
}

test("actual Result Library save reports uncertainty persistently and blocks duplicate activation", async () => {
  const f = fixture();
  const pending = f.callback();
  await f.callback();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].data.content_text, "The whole unchanged draft");
  assert.equal(f.bindings.librarySavedValue.current, null);
  f.request.reject(new Error("Response unavailable"));
  await pending;
  assert.match(f.render().errors.save, /may already have succeeded/);
  assert.match(f.render().errors.save, /Check Library before saving again/);
  assert.deepEqual(f.notices, []);
});

test("actual Result save updates confirmed value only after success and ignores old-scope results", async () => {
  const f = fixture();
  const pending = f.callback();
  f.render("owner-b:doc-a");
  const before = f.state.length;
  f.request.resolve({});
  await pending;
  assert.equal(f.state.length, before);
  assert.equal(f.bindings.librarySavedValue.current, null);
  assert.deepEqual(f.notices, []);
  const fresh = fixture();
  const next = fresh.callback();
  fresh.request.resolve({});
  await next;
  assert.equal(fresh.bindings.librarySavedValue.current, "The whole unchanged draft");
  assert.deepEqual(fresh.notices, ["Saved to Library"]);
});
