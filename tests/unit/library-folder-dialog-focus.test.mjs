import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/LibraryFolderOrganizer.tsx", "utf8");
const parsed = ts.createSourceFile(
  "folders.tsx",
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
const handler = (name, includes = "") => {
  const matches = nodes.filter(
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === name &&
      node.getText(parsed).includes(includes),
  );
  assert.equal(matches.length, 1);
  return matches[0].initializer.expression.getText(parsed);
};
const compile = (code, dependencies) =>
  new Function(
    ...Object.keys(dependencies),
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  )(...Object.values(dependencies));
function fixture() {
  const focused = [];
  const target = (name) => ({
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: () => focused.push(name),
  });
  const window = { location: { href: "https://local.invalid/library" } };
  const document = { body: {}, activeElement: null };
  document.activeElement = document.body;
  const editorReturnRef = { current: null };
  const editorContextRef = { current: { enabled: true, principalKey: "user:a", refreshKey: 1 } };
  const folderButtonsRef = { current: new Map([["created", target("created")]]) };
  const editorContentRef = { current: null };
  const restoreDialogFocus = compile(
    `${readFileSync("src/lib/dialog-return-focus.ts", "utf8").replace("export function", "function")}; return restoreDialogFocus;`,
    { window },
  );
  const dependencies = {
    editorReturnRef,
    editorContextRef,
    folderButtonsRef,
    editorContentRef,
    document,
    window,
    restoreDialogFocus,
    principalKey: "user:a",
    refreshKey: 1,
    activeFolder: { name: "Old" },
    setFolderName() {},
    setEditorError() {},
    setEditor() {},
  };
  const close = compile(
    `return (${handler("onCloseAutoFocus", "editorReturnRef")});`,
    dependencies,
  );
  return {
    ...dependencies,
    focused,
    target,
    open(mode) {
      compile(
        `return (${handler("onClick", `setEditor("${mode}")`)});`,
        dependencies,
      )({ currentTarget: target(mode) });
    },
    close() {
      let prevented = false;
      close({
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
    },
  };
}

test("create success targets the new folder; rename and cancellation restore their exact invoker", () => {
  for (const mode of ["create", "rename"]) {
    const f = fixture();
    f.open(mode);
    f.close();
    assert.deepEqual(f.focused, [mode]);
  }
  const f = fixture();
  f.open("create");
  f.editorReturnRef.current.folderId = "created";
  f.close();
  assert.deepEqual(f.focused, ["created"]);
  assert.equal(f.editorReturnRef.current, null);
  assert.match(
    source,
    /if \(!isCurrent\(\)\) return;\s*if \(editorReturnRef.current\) editorReturnRef.current.folderId = created.id/,
  );
});

test("close cannot steal focus across navigation, account/reset changes, disabled organizer or subsequent interaction", () => {
  const changes = [
    (f) => (f.window.location.href = "https://local.invalid/apps"),
    (f) => (f.editorContextRef.current.principalKey = "user:b"),
    (f) => f.editorContextRef.current.refreshKey++,
    (f) => (f.editorContextRef.current.enabled = false),
    (f) => (f.document.activeElement = f.target("later-input")),
    (f) => (f.editorReturnRef.current.trigger.isConnected = false),
    (f) => (f.editorReturnRef.current = null),
  ];
  for (const change of changes) {
    const f = fixture();
    f.open("rename");
    change(f);
    f.close();
    assert.deepEqual(f.focused, []);
  }
  assert.match(
    source,
    /return \(\) => \{[\s\S]*lifetime.dispose\(\);[\s\S]*editorReturnRef.current = null;\s*moveReturnRef.current = null/,
  );
});

test("successful move restores destination only while its request owns focus", () => {
  const effect = nodes.find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(parsed) === "useEffect" &&
      node.arguments[0]?.getText(parsed).includes("const origin = moveReturnRef.current"),
  );
  assert.ok(effect);
  for (const change of ["none", "unfiled", "later", "account", "navigation", "busy"]) {
    const f = fixture();
    const trigger = f.target("move");
    const moveReturnRef = {
      current: {
        trigger,
        url: f.window.location.href,
        principal: "user:a",
        refresh: 1,
        folderId: change === "unfiled" ? null : "created",
      },
    };
    if (change === "later") f.document.activeElement = f.target("later");
    if (change === "account") f.editorContextRef.current.principalKey = "user:b";
    if (change === "navigation") f.window.location.href += "?changed";
    compile(`return (${effect.arguments[0].getText(parsed)});`, {
      ...f,
      moveReturnRef,
      busy: change === "busy",
      unfiledButtonRef: { current: f.target("unfiled") },
    })();
    assert.deepEqual(
      f.focused,
      change === "none" ? ["created"] : change === "unfiled" ? ["unfiled"] : [],
    );
  }
  assert.match(
    source,
    /document.activeElement === trigger \|\| document.activeElement === document.body/,
  );
  assert.match(
    source,
    /if \(!isCurrent\(\)\) return;[\s\S]*moveReturnRef.current = origin;\s*onMoved/,
  );
});

test("editor request success sets the created target and failures keep the dialog open", async () => {
  const submit = nodes.find(
    (node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === "submitEditor",
  );
  assert.ok(submit);
  for (const result of ["success", "failure", "stale"]) {
    const f = fixture();
    f.open("create");
    const generationRef = { current: 0 };
    const closed = [],
      errors = [],
      scopes = [];
    const run = compile(`return (${submit.initializer.getText(parsed)});`, {
      ...f,
      folderName: "Created",
      busy: null,
      folderStateUnavailable: false,
      generationRef,
      requestControllerRef: { current: new AbortController() },
      ownerId: "a",
      editor: "create",
      activeFolder: null,
      setLoading() {},
      setBusy() {},
      setError() {},
      setEditorError(value) {
        errors.push(value);
      },
      setFolders() {},
      onScopeChange(value) {
        scopes.push(value);
      },
      toast: { success() {} },
      setEditor(value) {
        closed.push(value);
      },
      errorMessage: (error) => error.message,
      async createLibraryFolder() {
        if (result === "failure") throw new Error("Rejected");
        if (result === "stale") generationRef.current++;
        return { id: "created", name: "Created" };
      },
    });
    await run();
    if (result === "success") {
      assert.equal(f.editorReturnRef.current.folderId, "created");
      assert.deepEqual(closed, [null]);
      assert.deepEqual(scopes, ["created"]);
    } else {
      assert.equal(f.editorReturnRef.current.folderId, undefined);
      assert.deepEqual(closed, []);
      assert.deepEqual(scopes, []);
      if (result === "failure") assert.equal(errors.at(-1), "Rejected");
    }
  }
});
