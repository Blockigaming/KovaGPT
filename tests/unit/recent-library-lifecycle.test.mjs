import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
const source = readFileSync("src/components/ChatWorkspace.tsx", "utf8");
const ast = ts.createSourceFile(
  "workspace.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let loader, reset, loadEffect;
const visit = (n) => {
  if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "loadRecentLibraryFiles")
    loader = n.initializer;
  if (ts.isCallExpression(n) && n.expression.getText(ast) === "useEffect") {
    const body = n.arguments[0].getText(ast);
    if (
      body.includes("const loaded = loadSettings(userKey") &&
      body.includes("storageGenerationRef.current += 1")
    )
      reset = n;
    if (body.includes("void loadRecentLibraryFiles();")) loadEffect = n;
  }
  ts.forEachChild(n, visit);
};
visit(ast);
assert.ok(loader && reset && loadEffect);
const compile = (node, g) =>
  vm.runInNewContext(
    ts.transpileModule(
      "(" +
        node.getText(ast).replace('import("@/lib/library-items-client")', "loadLibraryModule()") +
        ")",
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    g,
  );
function fixture() {
  const state = { files: [], loading: false, error: null },
    refs = { storageGenerationRef: { current: 0 }, storagePrincipalRef: { current: null } },
    requests = [],
    tasks = [];
  for (const name of [
    "lastRouteRef",
    "historyMutationRef",
    "abortRef",
    "inFlightTargetRef",
    "inFlightRef",
    "retryTimerRef",
    "lastLoadedDraftRef",
  ])
    refs[name] = { current: null };
  const defaults = {
    ...refs,
    useCallback: (fn) => fn,
    AbortController,
    console: { warn() {} },
    clearRetryTimer() {},
    loadSettings: () => ({ mode: "dark" }),
    loadThemeMode: () => "dark",
    applyThemeMode() {},
    loadConversations: () => [],
    loadPendingActive: () => null,
    clearPendingActive() {},
    loadLibraryModule: async () => ({
      listLibraryPage: (actor) =>
        new Promise((resolve, reject) => requests.push({ actor, resolve, reject })),
    }),
  };
  for (const [name] of reset.arguments[0].getText(ast).matchAll(/\b(set\w+)\(/g))
    defaults[name.slice(0, -1)] = () => {};
  defaults.setRecentLibraryFiles = (v) => (state.files = v);
  defaults.setRecentLibraryLoading = (v) => (state.loading = v);
  defaults.setRecentLibraryError = (v) => (state.error = v);
  async function render(actor, isLoaded = true) {
    refs.storagePrincipalRef.current = actor ?? "guest";
    const g = {
      ...defaults,
      isLoaded,
      isSignedIn: !!actor,
      userKey: actor,
      storagePrincipal: actor ?? "guest",
    };
    const load = compile(loader, g);
    g.loadRecentLibraryFiles = () => {
      const promise = load();
      tasks.push(promise);
      return promise;
    };
    for (const effect of [reset, loadEffect].sort((a, b) => a.pos - b.pos))
      compile(effect.arguments[0], g)();
    await Promise.resolve();
    await Promise.resolve();
    return { completion: tasks.at(-1) };
  }
  return { state, requests, refs, render };
}
const row = (id) => ({
  id,
  title: "Saved " + id,
  item_type: "document",
  text_available: true,
  source: "chat",
});
test("fresh signed-in mount loads text-available Library files after principal reset", async () => {
  const f = fixture(),
    run = await f.render("alice");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].actor, "alice");
  assert.equal(f.state.loading, true);
  f.requests[0].resolve({ items: [row("alice-file")] });
  await run.completion;
  assert.equal(f.state.files[0]?.id, "alice-file");
  assert.equal(f.state.loading, false);
  assert.equal(f.state.error, null);
});
test("unresolved auth then signed-in readiness starts one current-principal initial load", async () => {
  const f = fixture();
  await f.render(null, false);
  assert.equal(f.requests.length, 0);
  const run = await f.render("alice");
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ items: [row("ready-file")] });
  await run.completion;
  assert.equal(f.state.files[0]?.id, "ready-file");
});
for (const late of ["success", "error"])
  test(`account switch keeps new files despite late prior-account ${late}`, async () => {
    const f = fixture(),
      a = await f.render("alice"),
      b = await f.render("bob");
    assert.equal(f.requests.length, 2);
    assert.equal(f.state.files.length, 0);
    assert.equal(f.state.loading, true);
    f.requests[1].resolve({ items: [row("bob-file")] });
    await b.completion;
    assert.equal(f.state.files[0]?.id, "bob-file");
    if (late === "success") f.requests[0].resolve({ items: [row("alice-file")] });
    else f.requests[0].reject(new Error("old actor"));
    await a.completion;
    assert.equal(f.state.files[0]?.id, "bob-file");
    assert.equal(f.state.error, null);
    assert.equal(f.state.loading, false);
  });
test("same-principal generation invalidation still rejects a late response", async () => {
  const f = fixture(),
    run = await f.render("alice");
  f.refs.storageGenerationRef.current++;
  f.requests[0].resolve({ items: [row("stale")] });
  await run.completion;
  assert.equal(f.state.files.length, 0);
});
test("sign-out clears account files and fences an outstanding account response", async () => {
  const f = fixture(),
    run = await f.render("alice");
  await f.render(null);
  assert.equal(f.state.files.length, 0);
  assert.equal(f.state.loading, false);
  f.requests[0].resolve({ items: [row("private")] });
  await run.completion;
  assert.equal(f.state.files.length, 0);
  assert.equal(f.state.error, null);
});
