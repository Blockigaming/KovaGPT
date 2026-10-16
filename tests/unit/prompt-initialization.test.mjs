import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
async function initialize({ projectFailure = false, packFailure = false, saved = null } = {}) {
  const source = ts.createSourceFile(
    "prompt.tsx",
    readFileSync(process.env.KOVA_PROMPT_SOURCE ?? "src/routes/prompt-studio.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let effect;
  function visit(node) {
    if (
      !effect &&
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0].getText(source).includes("loadPrincipalStoredRecord")
    )
      effect = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const code = ts.transpileModule("const fn=" + effect, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = [];
  const state = {};
  const env = {
    generationRef: { current: 0 },
    launchEpoch: { current: 0 },
    separateEvaluation: { current: false },
    evaluationPending: { current: false },
    launchAbort: { current: null },
    inspectionEpoch: { current: 0 },
    historyAbort: { current: null },
    historySequence: { current: 0 },
    principalRef: { current: "actor" },
    principal: "actor",
    draftKey: "draft",
    userKey: "actor",
    isSignedIn: true,
    loadPrincipalStoredRecord: () => null,
    WORKSPACE_DEFAULTS_KEY_BASE: "defaults",
    safeBrowserStorage: () => ({ getItem: () => JSON.stringify(saved) }),
    list: async () => {
      calls.push("prompts");
      return [];
    },
    getProjects: async () => {
      calls.push("projects");
      if (projectFailure) throw new Error("Projects unavailable");
      return [];
    },
    getPacks: async () => {
      calls.push("packs");
      if (packFailure) throw new Error("Packs unavailable");
      return [];
    },
  };
  for (const match of effect.matchAll(/\b(set[A-Z]\w*)\(/g))
    env[match[1]] = (value) => {
      state[match[1]] = value;
    };
  new Function(...Object.keys(env), code + ";return fn;")(...Object.values(env))();
  await new Promise((resolve) => setImmediate(resolve));
  return { calls, state };
}
test("a signed-in account without a stored draft still loads Prompt Studio", async () => {
  const { calls } = await initialize();
  assert.deepEqual(calls, ["prompts", "projects", "packs"]);
});
test("pack failure does not become a blocking route error or discard a restored draft", async () => {
  const { state } = await initialize({
    packFailure: true,
    saved: { name: "Recovered", body: "Draft", projectId: "selected" },
  });
  assert.equal(state.setName, "Recovered");
  assert.equal(state.setBody, "Draft");
  assert.equal(state.setLoading, false);
  assert.equal(state.setError ?? null, null);
  assert.deepEqual(state.setProjects, []);
});
test("Project failure is source scoped and preserves restored Project selection", async () => {
  const { state } = await initialize({
    projectFailure: true,
    saved: { name: "Recovered", body: "Draft", projectId: "selected" },
  });
  assert.equal(state.setProjectId, "selected");
  assert.equal(state.setLoading, false);
  assert.equal(state.setError ?? null, null);
  assert.equal(state.setProjectError, "Projects unavailable");
});

function projectRetry(env) {
  const source = ts.createSourceFile(
    "prompt.tsx",
    readFileSync("src/routes/prompt-studio.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "retryProjects")
      expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const code = ts.transpileModule("const fn=" + expression, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), code + ";return fn;")(...Object.values(env));
}
test("Project retry clears its own error and ignores an old account response", async () => {
  const state = {},
    principalRef = { current: "actor" };
  let resolve;
  const env = {
    projectsLoading: false,
    generationRef: { current: 1 },
    principal: "actor",
    principalRef,
    getProjects: async () => [{ id: "project" }],
    setProjects: (value) => (state.projects = value),
    setProjectError: (value) => (state.error = value),
    setProjectsLoading: (value) => (state.loading = value),
  };
  await projectRetry(env)();
  assert.deepEqual(state, { projects: [{ id: "project" }], error: null, loading: false });
  env.getProjects = () => new Promise((done) => (resolve = done));
  const pending = projectRetry(env)();
  principalRef.current = "replacement";
  resolve([{ id: "old-account" }]);
  await pending;
  assert.deepEqual(state.projects, [{ id: "project" }]);
});
