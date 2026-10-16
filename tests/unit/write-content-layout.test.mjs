import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const source = readFileSync("src/routes/write.tsx", "utf8");
const sourceAst = ts.createSourceFile(
  "write.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const changes = [
  [
    "mx-auto flex h-full w-full max-w-4xl flex-col",
    "mx-auto flex min-h-full w-full max-w-4xl shrink-0 flex-col",
  ],
  [
    "min-h-11 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40",
    "min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40",
  ],
  [
    "inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50",
    "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50",
  ],
];
test(
  "Write correction changes only three declared layout class strings against an explicit archived baseline",
  { skip: !process.env.KOVA_WRITE_BASE_SOURCE },
  () => {
    let expected = readFileSync(process.env.KOVA_WRITE_BASE_SOURCE, "utf8");
    for (const [before, after] of changes) {
      assert.equal(expected.split(before).length, 2);
      expected = expected.replace(before, after);
    }
    assert.equal(
      source,
      expected,
      "All handlers, autosave, selection, text and keyboard focus remain byte-identical",
    );
  },
);
// Actual component with synthetic state; effects and external services are unavailable.
function renderWrite(text) {
  const stateNames = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sourceAst) === "useState"
    )
      stateNames.push(node.name.elements[0].getText(sourceAst));
    ts.forEachChild(node, visit);
  };
  visit(sourceAst);
  let stateIndex = 0;
  const principal = "synthetic-write-layout";
  const state = {
    title: "Synthetic long draft",
    text,
    custom: "Keep the original meaning and all examples",
    documentPrincipal: principal,
  };
  const unavailable = () => {
    throw new Error("External actions are unavailable in this render-only test");
  };
  const icon = () => runtime.jsx("svg", { "aria-hidden": true });
  const hooks = {
    useState(initial) {
      const name = stateNames[stateIndex++];
      return [Object.hasOwn(state, name) ? state[name] : initial, unavailable];
    },
    useEffect() {},
    useMemo(fn) {
      return fn();
    },
    useRef(current) {
      return { current };
    },
    useCallback(fn) {
      return fn;
    },
  };
  const imports = {
    "react/jsx-runtime": runtime,
    react: hooks,
    "@tanstack/react-router": { createFileRoute: () => (route) => route },
    "@tanstack/react-start": { useServerFn: () => unavailable },
    "lucide-react": Object.fromEntries(
      ["Bookmark", "Check", "Copy", "Download", "Eraser", "Loader2", "Sparkles", "Wand2"].map(
        (name) => [name, icon],
      ),
    ),
    sonner: { toast: { error: unavailable, success: unavailable } },
    "@/components/AppShell": {
      AppShell: ({ children }) => runtime.jsx("div", { "data-test-shell": true, children }),
    },
    "@/components/ConfirmActionDialog": { ConfirmActionDialog: () => null },
    "@/components/auth/ClerkSafe": {
      useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
      useClerkSafe: () => null,
    },
    "@/lib/principal-browser-storage.mjs": {
      browserStoragePrincipal: () => principal,
      principalScopedStorageKey: (key) => `${key}:${principal}`,
    },
    "@/lib/dialog-return-focus": { restoreDialogFocus: unavailable },
    "@/lib/auth-fetch": { authFetch: unavailable },
    "@/lib/library.functions": { saveToLibrary: unavailable },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require(id) {
        assert.ok(Object.hasOwn(imports, id), `Unmocked dependency: ${id}`);
        return imports[id];
      },
    },
  );
  return renderToStaticMarkup(runtime.jsx(module.exports.Route.component, {}));
}
for (const text of ["", "Synthetic long paragraph with exact local draft content.\n".repeat(80)]) {
  test(`Actual Write component keeps all footer actions inside its focusable, content-height main (${text.length} characters)`, () => {
    const html = renderWrite(text);
    const main = html.match(/<main[^>]*>([\s\S]*)<\/main>/);
    assert.ok(main);
    assert.match(html, /<main id="main-content" tabindex="-1" class="[^"]*min-h-full/);
    assert.ok(
      !html
        .match(/<main[^>]*class="([^"]+)"/)[1]
        .split(" ")
        .includes("h-full"),
    );
    for (const label of [
      "Copy",
      "Download .md",
      "Save to Library",
      "Clear",
      "Save version",
      "Restore latest",
      "Download DOCX",
      "Download PDF",
      "Download XLSX",
      "Download PPTX",
      "Download HTML",
    ])
      assert.ok(main[1].includes(label), label);
    assert.match(main[1], /aria-label="Document content"/);
    assert.ok(main[1].includes(text));
    assert.match(main[1], /aria-label="Custom instruction"[^>]*class="[^"]*min-w-0/);
    assert.match(
      main[1],
      /class="[^"]*shrink-0[^\"]*whitespace-nowrap[^\"]*">[\s\S]*?Apply<\/button>/,
    );
    assert.doesNotMatch(main[1], /position:\s*absolute|overflow-hidden|display:\s*none/);
  });
}
