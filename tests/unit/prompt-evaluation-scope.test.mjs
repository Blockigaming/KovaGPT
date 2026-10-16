import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { deferred, settle } from "../helpers/ui-state-harness.mjs";
import { promptEvaluationIdentity } from "../../src/lib/prompt-evaluation-identity.mjs";
import { pathToFileURL } from "node:url";
const { clearPrincipalBrowserStorage, principalScopedStorageKey, browserStoragePrincipal } =
  await import(
    process.env.KOVA_STORAGE_MODULE
      ? pathToFileURL(process.env.KOVA_STORAGE_MODULE).href
      : "../../src/lib/principal-browser-storage.mjs"
  );
import { webcrypto } from "node:crypto";
function expression(kind, env) {
  const source = ts.createSourceFile(
    "prompt.tsx",
    readFileSync(process.env.KOVA_EVAL_SCOPE_SOURCE ?? "src/routes/prompt-studio.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found;
  function visit(n) {
    if (ts.isCallExpression(n) && n.expression.getText(source) === "useEffect") {
      const body = n.arguments[0].getText(source);
      if (kind === "initialize" && body.includes("loadPrincipalStoredRecord")) found = body;
      if (kind === "clear" && body.includes("isPrincipalBrowserStorageClearedEvent")) found = body;
    }
    if (ts.isJsxAttribute(n) && n.name.getText(source) === "onClick" && n.initializer?.expression) {
      const body = n.initializer.expression.getText(source);
      if (kind === "save" && body.includes("await evaluate(")) found = body;
      if (kind === "open" && body.includes("setInspecting(item)")) found = body;
    }
    ts.forEachChild(n, visit);
  }
  visit(source);
  assert.ok(found, kind);
  const code = ts.transpileModule("const fn=" + found, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(env), code + ";return fn;")(...Object.values(env));
}
function fixture() {
  const state = { notes: "A private notes", rating: 2, savingEvaluation: false },
    env = {
      generationRef: { current: 1 },
      principalRef: { current: "user:A" },
      principal: "user:A",
      userKey: "A",
      draftKey: "draft",
      isSignedIn: true,
      isLoaded: true,
      launchEpoch: { current: 0 },
      launchAbort: { current: null },
      inspectionEpoch: { current: 1 },
      historySequence: { current: 0 },
      historyAbort: { current: null },
      evaluationPending: { current: false },
      separateEvaluation: { current: false },
      editRevision: { current: 0 },
      loadPrincipalStoredRecord: () => null,
      WORKSPACE_DEFAULTS_KEY_BASE: "defaults",
      safeBrowserStorage: () => ({ getItem: () => null }),
      list: async () => [],
      getProjects: async () => [],
      getPacks: async () => [],
      promptEvaluationIdentity: async (_storage, actor) => {
        state.retryActor = actor;
        return "request-A";
      },
      inspecting: { id: "prompt-A" },
      rating: 2,
      notes: "A private notes",
      toast: { success() {}, error() {} },
      item: { id: "prompt-B", body: "B body" },
      loadHistoryPage() {},
      PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT: "clear",
      isPrincipalBrowserStorageClearedEvent: () => true,
    };
  const source = readFileSync("src/routes/prompt-studio.tsx", "utf8");
  for (const [, setter] of source.matchAll(/\b(set[A-Z]\w*)\(/g))
    env[setter] = (value) => {
      const key = setter[3].toLowerCase() + setter.slice(4);
      state[key] = typeof value === "function" ? value(state[key] ?? []) : value;
    };
  env.window = {
    addEventListener: (_name, cb) => {
      env.clear = cb;
    },
    removeEventListener() {},
  };
  return { env, state };
}
test("A to B transition and logout clear private inspector fields and pending state; late A save cannot unlock B", async () => {
  const { env, state } = fixture(),
    pending = deferred();
  env.evaluate = () => pending.promise;
  const saveA = expression("save", env)();
  await settle();
  assert.equal(state.savingEvaluation, true);
  env.principal = env.principalRef.current = "user:B";
  env.userKey = "B";
  expression("initialize", env)();
  assert.equal(state.notes, "");
  assert.equal(state.rating, 5);
  assert.equal(state.savingEvaluation, false);
  assert.equal(env.evaluationPending.current, false);
  expression("open", env)();
  assert.equal(state.notes, "");
  assert.equal(state.rating, 5);
  state.notes = "B private notes";
  state.savingEvaluation = true;
  env.evaluationPending.current = true;
  pending.resolve({ id: "A-evaluation" });
  await saveA;
  assert.equal(state.notes, "B private notes");
  assert.equal(state.savingEvaluation, true);
  assert.equal(env.evaluationPending.current, true);
  assert.equal(state.retryActor, "A");
  env.principal = env.principalRef.current = "guest";
  env.userKey = null;
  env.isSignedIn = false;
  expression("initialize", env)();
  assert.equal(state.notes, "");
  assert.equal(state.rating, 5);
  assert.equal(state.savingEvaluation, false);
});
test("Clear local recovery clears inspector state and invalidates in-flight history", async () => {
  const { env, state } = fixture();
  let aborted = false;
  env.historyAbort.current = {
    abort: () => {
      aborted = true;
    },
  };
  env.evaluationPending.current = true;
  state.savingEvaluation = true;
  expression("clear", env)();
  env.clear({});
  assert.equal(state.notes, "");
  assert.equal(state.rating, 5);
  assert.equal(state.savingEvaluation, false);
  assert.equal(env.evaluationPending.current, false);
  assert.equal(aborted, true);
  assert.equal(env.historyAbort.current, null);
});
test("Recovery clear removes current and prior double-scoped retry IDs for A, preserves B, and creates a new A ID", async () => {
  const entries = new Map();
  const storage = {
    getItem: (k) => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, v),
    removeItem: (k) => entries.delete(k),
    key: (i) => [...entries.keys()][i] ?? null,
    get length() {
      return entries.size;
    },
  };
  const payload = { prompt_id: "prompt", rating: 4, notes: "private" };
  const make = (actor) =>
    promptEvaluationIdentity(storage, actor, payload, () => true, false, webcrypto);
  const first = await make("A"),
    other = await make("B");
  const legacy = principalScopedStorageKey(
    "kova-prompt-evaluation-retries",
    browserStoragePrincipal("A"),
  );
  storage.setItem(legacy, "legacy-cache");
  const result = await clearPrincipalBrowserStorage("A", {
    locks: { request: async (_key, fn) => fn() },
    localStorage: storage,
    sessionStorage: storage,
  });
  assert.equal(result.session.failures.length, 0);
  assert.equal(storage.getItem(legacy), null);
  assert.notEqual(await make("A"), first);
  assert.equal(await make("B"), other);
});

test("account transition render hides the old inspector before reset effects execute", async () => {
  const source = ts.createSourceFile(
    "prompt.tsx",
    readFileSync(process.env.KOVA_EVAL_SCOPE_SOURCE ?? "src/routes/prompt-studio.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let condition;
  function visit(n) {
    if (
      ts.isConditionalExpression(n) &&
      n.condition.getText(source).includes("inspecting") &&
      n.whenTrue.getText(source).includes("aria-label={`Inspect")
    )
      condition = n.condition.getText(source);
    ts.forEachChild(n, visit);
  }
  visit(source);
  assert.ok(condition);
  const visible = new Function("dataReady", "inspecting", "return Boolean(" + condition + ")");
  assert.equal(visible(false, { id: "A", name: "private" }), false);
  assert.equal(visible(true, { id: "B", name: "current" }), true);
});
