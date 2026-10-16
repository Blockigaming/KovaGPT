import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { deferred } from "../helpers/ui-state-harness.mjs";
const source = ts.createSourceFile(
  "prompt.tsx",
  readFileSync("src/routes/prompt-studio.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let expression;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "loadHistoryPage")
    expression = node.initializer.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const code = ts.transpileModule("const fn=" + expression, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  const calls = [],
    versions = [],
    evaluations = [],
    errors = [],
    epoch = { current: 1 },
    generation = { current: 1 };
  const env = {
    inspecting: { id: "prompt" },
    inspectionEpoch: epoch,
    evaluationPending: { current: false },
    historySequence: { current: 0 },
    historyAbort: { current: null },
    generationRef: generation,
    principalRef: { current: "actor" },
    principal: "actor",
    mounted: { current: true },
    AbortController,
    setHistoryLoading() {},
    setHistoryError: (value) => errors.push(value),
    setVersions: (value) => versions.push(value),
    setEvaluations: (value) => evaluations.push(value),
    setVersionCursor() {},
    setEvaluationCursor() {},
    setVersionsKnown() {},
    setEvaluationsKnown() {},
    getHistory: (options) => {
      const call = deferred();
      calls.push({ ...options, ...call });
      return call.promise;
    },
  };
  const run = new Function(...Object.keys(env), code + ";return fn;")(...Object.values(env));
  return { run, calls, versions, evaluations, errors, epoch, generation, env };
}
test("a history page replaces only its source and a failed page retains previous content", async () => {
  const f = fixture();
  const first = f.run("versions", "cursor");
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({
    versions: [{ id: "v" }],
    evaluations: [],
    versionCursor: "next",
    evaluationCursor: null,
  });
  await first;
  assert.equal(f.versions.length, 1);
  assert.equal(f.evaluations.length, 0);
  const second = f.run("versions", "next");
  f.calls[1].reject(Error("history offline"));
  await second;
  assert.equal(f.versions.length, 1);
  assert.match(f.errors.at(-1), /offline/);
});
test("replacement, close, unmount and account generation fence history acknowledgements", async () => {
  for (const cancel of [
    (f) => f.epoch.current++,
    (f) => (f.env.mounted.current = false),
    (f) => f.generation.current++,
  ]) {
    const f = fixture(),
      read = f.run("versions", null);
    cancel(f);
    f.calls[0].resolve({ versions: [{ id: "stale" }], versionCursor: null });
    await read;
    assert.equal(f.versions.length, 0);
  }
  const f = fixture(),
    old = f.run("versions", null),
    next = f.run("versions", "new");
  assert.equal(f.calls[0].signal.aborted, true);
  f.calls[1].resolve({ versions: [{ id: "new" }], versionCursor: null });
  await next;
  f.calls[0].resolve({ versions: [{ id: "old" }], versionCursor: null });
  await old;
  assert.equal(f.versions.length, 1);
  assert.equal(f.versions[0][0].id, "new");
});
