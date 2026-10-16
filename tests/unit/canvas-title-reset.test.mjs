import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { deferred, settle } from "../helpers/ui-state-harness.mjs";
const path = `${process.env.KOVA_REVIEW_SOURCE_DIR ?? "."}/src/components/ArtifactEditor.tsx`,
  source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
let save, reset;
function visit(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(source) === "saveAccountTitle")
    save = n.initializer.getText(source);
  if (
    ts.isCallExpression(n) &&
    n.expression.getText(source) === "useEffect" &&
    n.arguments[0]?.getText(source).includes("librarySavePendingRef.current = false")
  )
    reset = n;
  ts.forEachChild(n, visit);
}
visit(source);
assert.ok(save && reset);
// Execute the production reset's request-boundary statements; body/presentation
// resets are irrelevant to this pending-title ordering fixture.
const statements = reset.arguments[0].body.statements
  .filter((n) =>
    /^(?:autosaveGenerationRef|titlePendingRef|titleAttemptRef|titleRequestRef|setTitleSaving|setTitleError)/.test(
      n.getText(source),
    ),
  )
  .map((n) => n.getText(source))
  .join("\n");
for (const prop of ["initialContent", "initialMode", "kind"])
  test(`pending title save → ${prop} reset → new save cannot be unlocked by old completion`, async () => {
    assert.match(reset.arguments[1].getText(source), new RegExp(`\\b${prop}\\b`));
    const requests = [],
      saving = [];
    const env = {
      titlePendingRef: { current: false },
      titleRequestRef: { current: 0 },
      titleAttemptRef: { current: null },
      autosaveGenerationRef: { current: 1 },
      titleRecovery: { value: { title: "old title" } },
      accountTitle: "initial",
      collaboration: {
        snapshot: { canEdit: true },
        conflict: false,
        saveTitle: (title, id) => {
          const d = deferred();
          requests.push({ ...d, title, id });
          return d.promise;
        },
      },
      autosaveQueueRef: { current: { enqueue: (fn) => fn() } },
      setTitleSaving: (v) => saving.push(v),
      setTitleError() {},
      crypto: webcrypto,
    };
    const compile = (text) =>
      new Function(
        ...Object.keys(env),
        ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
          .outputText,
      );
    const invoke = () => compile(`return (${save})();`)(...Object.values(env));
    const one = invoke();
    assert.equal(requests.length, 1);
    compile(statements)(...Object.values(env));
    assert.equal(env.titlePendingRef.current, false);
    assert.equal(saving.at(-1), false);
    env.titleRecovery.value = { title: "new title" };
    const two = invoke();
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].id, requests[1].id);
    requests[0].resolve();
    await one;
    await settle();
    assert.equal(env.titlePendingRef.current, true);
    assert.equal(saving.at(-1), true);
    requests[1].resolve();
    await two;
    assert.equal(env.titlePendingRef.current, false);
    assert.equal(saving.at(-1), false);
  });
