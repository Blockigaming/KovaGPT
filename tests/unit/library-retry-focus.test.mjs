import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync("src/routes/library.tsx", "utf8");
const parsed = ts.createSourceFile(
  "library.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodes = [];
const visit = (node) => {
  nodes.push(node);
  ts.forEachChild(node, visit);
};
visit(parsed);
const compile = (code, deps) =>
  new Function(
    ...Object.keys(deps),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(deps));
const effect = (marker) =>
  nodes
    .find(
      (node) =>
        ts.isCallExpression(node) &&
        node.expression.getText(parsed) === "useEffect" &&
        node.arguments[0]?.getText(parsed).includes(marker),
    )
    .arguments[0].getText(parsed);
function fixture() {
  const focused = [],
    listeners = new Map();
  const target = {
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: () => focused.push("retry"),
  };
  const document = {
    body: {},
    activeElement: null,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  document.activeElement = document.body;
  const window = { location: { href: "https://local.invalid/library" } };
  const deps = {
    document,
    window,
    retryButtonRef: { current: target },
    retryReturnRef: { current: null },
    principal: "user:a",
    principalRef: { current: "user:a" },
    loadGenerationRef: { current: 1 },
    loading: false,
    loadError: "Unavailable",
    libraryCleared: false,
    folderBusy: false,
  };
  deps.restoreDialogFocus = compile(
    `${readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace("export function", "function")}; return restoreDialogFocus;`,
    { window },
  );
  const click = nodes.find(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === "onClick" &&
      node.getText(parsed).includes("retryReturnRef.current"),
  );
  return {
    deps,
    focused,
    target,
    listeners,
    start() {
      compile(`return (${click.initializer.expression.getText(parsed)});`, {
        ...deps,
        refreshLibrary() {
          deps.loadGenerationRef.current++;
        },
      })({ currentTarget: target });
    },
    finish() {
      compile(`return (${effect("if (!origin || !loadError) return")});`, deps)();
    },
    watch() {
      return compile(`return (${effect("const relinquishFocus")});`, { ...deps, loading: true })();
    },
  };
}
test("failed retry restores the replacement Retry after loading finishes, once", () => {
  const f = fixture();
  f.start();
  assert.equal(f.deps.retryReturnRef.current.generation, 2);
  f.deps.loading = true;
  f.finish();
  assert.deepEqual(f.focused, []);
  f.deps.loading = false;
  f.finish();
  f.finish();
  assert.deepEqual(f.focused, ["retry"]);
});
test("retry completion respects success, account, URL, request, cleared data and focused-control guards", () => {
  for (const change of [
    (d) => (d.loadError = null),
    (d) => (d.principalRef.current = "user:b"),
    (d) => (d.window.location.href += "?new"),
    (d) => d.loadGenerationRef.current++,
    (d) => (d.libraryCleared = true),
    (d) => (d.document.activeElement = {}),
    (d) => (d.retryButtonRef.current.isConnected = false),
  ]) {
    const f = fixture();
    f.start();
    change(f.deps);
    f.finish();
    assert.deepEqual(f.focused, []);
  }
});
test("later user focus or pointer interaction cancels restoration even if focus later returns to body", () => {
  for (const type of ["focusin", "pointerdown"]) {
    const f = fixture();
    f.start();
    const cleanup = f.watch();
    f.listeners.get(type)({ type, target: type === "pointerdown" ? f.deps.document.body : {} });
    f.finish();
    assert.deepEqual(f.focused, []);
    cleanup();
    assert.equal(f.listeners.size, 0);
  }
  assert.match(source, /retryReturnRef.current = null;\s*for \(const controller of requests\)/);
  assert.match(source, /lifecycleGenerationRef.current \+= 1;\s*retryReturnRef.current = null/);
});
