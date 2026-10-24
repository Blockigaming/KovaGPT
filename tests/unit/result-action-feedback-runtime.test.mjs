import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, loadUiModule } from "../helpers/ui-state-harness.mjs";

function fixture(scope = "owner-a:document-a") {
  const harness = createHookHarness();
  const { useScopedActionFeedback } = loadUiModule("src/lib/use-scoped-action-feedback.ts", {
    react: harness.react,
  });
  let feedback;
  const render = (next = scope) => {
    scope = next;
    feedback = harness.render(useScopedActionFeedback, scope);
    return feedback;
  };
  return {
    render,
    unmount: harness.unmount,
    get feedback() {
      return feedback;
    },
  };
}

test("Result feedback holds errors until explicit dismissal, same-action retry or success", () => {
  const f = fixture();
  let feedback = f.render();
  const save = feedback.begin("save");
  assert.ok(save);
  assert.equal(feedback.begin("save"), null, "double click is latched synchronously");
  feedback.finish(save, "Save unconfirmed; draft preserved");
  feedback = f.render();
  assert.equal(feedback.errors.save, "Save unconfirmed; draft preserved");
  const version = feedback.begin("version");
  feedback.finish(version, "Version read failed");
  feedback = f.render();
  assert.equal(
    feedback.errors.save,
    "Save unconfirmed; draft preserved",
    "unrelated operations do not clear it",
  );
  const retry = feedback.begin("save");
  feedback = f.render();
  assert.equal(feedback.errors.save, undefined);
  assert.equal(feedback.errors.version, "Version read failed");
  feedback.finish(retry);
  feedback.clear("version");
  assert.deepEqual(JSON.parse(JSON.stringify(f.render().errors)), {});
});

test("Result feedback rejects previous actor, document and unmounted completions", () => {
  const f = fixture();
  let feedback = f.render();
  const old = feedback.begin("save");
  feedback.finish(old, "Private old error");
  const pending = feedback.begin("export");
  const oldActions = feedback;
  feedback = f.render("owner-b:document-a");
  assert.equal(Object.keys(feedback.errors).length, 0);
  assert.equal(oldActions.finish(pending, "Private old completion"), false);
  assert.equal(oldActions.begin("save"), null);
  const current = feedback.begin("version");
  feedback = f.render("owner-b:document-b");
  assert.equal(feedback.finish(current, "Wrong document"), false);
  const unmount = feedback.begin("save");
  f.unmount();
  assert.equal(feedback.current(unmount), false);
  assert.equal(feedback.finish(unmount, "Late unmount error"), false);
});

test("finished/retried tickets cannot replace newer operation feedback", () => {
  const f = fixture();
  let feedback = f.render();
  const first = feedback.begin("version");
  feedback.finish(first, "First failure");
  feedback = f.render();
  const next = feedback.begin("version");
  assert.equal(feedback.finish(first, "Late first result"), false);
  feedback.finish(next, "Current failure");
  assert.equal(f.render().errors.version, "Current failure");
});
