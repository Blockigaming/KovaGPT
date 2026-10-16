import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { deferred } from "../helpers/ui-state-harness.mjs";
function callback(name, env) {
  const source = ts.createSourceFile(
    "prompt.tsx",
    readFileSync(process.env.KOVA_PROMPT_DRAFT_SOURCE ?? "src/routes/prompt-studio.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const code = ts.transpileModule("const fn=" + expression, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), code + ";return fn;")(...Object.values(env));
}
test("create acknowledgement preserves newer name/body draft instead of clearing it", async () => {
  const pending = deferred(),
    cleared = [],
    createDraft = { current: "submitted snapshot" };
  const run = callback("create", {
    dataReady: true,
    dataGeneration: 1,
    generationRef: { current: 1 },
    principalRef: { current: "actor" },
    principal: "actor",
    mutationScope: { current: { pending: false } },
    name: "Original",
    body: "Body",
    category: "General",
    folder: "Unfiled",
    projectId: "",
    packId: "",
    createDraft,
    draftKey: "draft",
    variables: () => [],
    setCreating() {},
    save: () => pending.promise,
    setItems() {},
    setName: (value) => cleared.push(value),
    setBody: (value) => cleared.push(value),
    safeBrowserStorage: () => ({ removeItem: () => cleared.push("removed") }),
    toast: { success() {}, error() {} },
  });
  const saving = run();
  createDraft.current = "new typing";
  pending.resolve({ id: "saved" });
  await saving;
  assert.deepEqual(cleared, []);
});
test("explicit saved-prompt review adopts a new revision while preserving editor text", async () => {
  const adopted = [],
    epoch = { current: 1 };
  const run = callback("reviewSavedPrompt", {
    inspecting: { id: "prompt" },
    mutationScope: { current: { pending: false } },
    reviewingPrompt: false,
    generationRef: { current: 1 },
    inspectionEpoch: epoch,
    principalRef: { current: "actor" },
    principal: "actor",
    setReviewingPrompt() {},
    getSavedPrompt: async () => ({ id: "prompt", body: "remote", updated_at: "revision" }),
    setInspecting: (value) => adopted.push(value),
    setItems() {},
    toast: { success() {}, error() {} },
  });
  await run();
  assert.equal(adopted[0].body, "remote");
  assert.equal(adopted[0].updated_at, "revision");
});
