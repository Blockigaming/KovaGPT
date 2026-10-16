import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { deferred } from "../helpers/ui-state-harness.mjs";
function saveCallback(env) {
  const source = ts.createSourceFile(
    "prompt.tsx",
    readFileSync(
      process.env.KOVA_PROMPT_EVALUATION_SOURCE ?? "src/routes/prompt-studio.tsx",
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "onClick" &&
      node.initializer?.expression?.getText(source).includes("await evaluate(")
    )
      expression = node.initializer.expression.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const code = ts.transpileModule("const fn=" + expression, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), code + ";return fn;")(...Object.values(env));
}
test("evaluation acknowledgement preserves newer notes and clears only the submitted notes", async () => {
  for (const newer of [true, false]) {
    const request = deferred();
    let notes = "submitted";
    const run = saveCallback({
      evaluationPending: { current: false },
      separateEvaluation: { current: false },
      safeBrowserStorage: () => null,
      promptEvaluationIdentity: async () => "request",
      historyAbort: { current: null },
      setSavingEvaluation() {},
      inspectionEpoch: { current: 1 },
      generationRef: { current: 1 },
      principalRef: { current: "actor" },
      principal: "actor",
      userKey: "actor",
      inspecting: { id: "prompt" },
      rating: 3,
      notes,
      evaluate: () => request.promise,
      setEvaluations() {},
      setNotes: (value) => {
        notes = typeof value === "function" ? value(notes) : value;
      },
      toast: { success() {}, error() {} },
    });
    const pending = run();
    if (newer) notes = "new draft";
    request.resolve({ id: "evaluation" });
    await pending;
    assert.equal(notes, newer ? "new draft" : "");
  }
});
