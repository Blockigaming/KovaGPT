import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const section = source.slice(
  source.indexOf("function FilesTab("),
  source.indexOf("// =====================", source.indexOf("function FilesTab(")),
);
const file = ts.createSourceFile(
  "files.tsx",
  section,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handler, uploadButton, refreshCallback;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleFiles")
    handler = node.getText(file);
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "refresh")
    refreshCallback = node.initializer.arguments[0].getText(file);
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(file) === "Button" &&
    node.children.some((child) => ts.isJsxText(child) && child.text.trim() === "Upload")
  )
    uploadButton = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(handler && uploadButton && refreshCallback);
function compile(code, dependencies) {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
}

function fixture() {
  const uploading = [],
    messages = [],
    requests = [],
    refreshes = [];
  const operation = { current: null },
    context = { current: "owner:project:file" },
    input = { current: { value: "selected-file" } };
  const deps = {
    canEdit: true,
    projectId: "project",
    kind: "file",
    uploadOperationRef: operation,
    currentUploadContextRef: context,
    uploadContextKey: context.current,
    inputRef: input,
    setUploading: (value) => uploading.push(value),
    crypto: { randomUUID: () => "idempotency-key" },
    projectFileRequest: (args) =>
      new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
    toast: { success: (value) => messages.push(value), error: (value) => messages.push(value) },
    responseError: async () => "Upload failed",
    refresh: async (isCurrent) => {
      if (isCurrent()) refreshes.push("refresh");
    },
  };
  return {
    handle: compile(`${handler}; return handleFiles;`, deps),
    uploading,
    messages,
    requests,
    refreshes,
    operation,
    context,
    input,
  };
}
const files = [{ name: "review.txt", size: 32 }];

test("busy Upload remains mounted and focusable while repeat activation is blocked", () => {
  let clicks = 0;
  const operation = { current: Symbol() };
  const button = compile(`return (${uploadButton});`, {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Button: "button",
    Upload: "icon",
    Loader2: "spinner",
    uploading: true,
    inputRef: { current: { click: () => clicks++ } },
    uploadOperationRef: operation,
  });
  assert.equal(button.props.disabled, undefined);
  assert.equal(button.props["aria-disabled"], true);
  assert.equal(button.props["aria-busy"], true);
  button.props.onClick();
  assert.equal(clicks, 0);
  operation.current = null;
  button.props.onClick();
  assert.equal(clicks, 1);
  assert.doesNotMatch(handler, /\.focus\(|setTimeout\(/);
});

test("completed upload refreshes once, clears the file input, and ignores duplicate uploads", async () => {
  const f = fixture();
  const result = f.handle(files);
  await f.handle(files);
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ ok: true });
  await result;
  assert.deepEqual(f.uploading, [true, false]);
  assert.deepEqual(f.messages, ["review.txt uploaded"]);
  assert.deepEqual(f.refreshes, ["refresh"]);
  assert.equal(f.input.current.value, "");
  assert.equal(f.operation.current, null);
});

test("account/project changes or tab unmount suppress obsolete upload completion", async () => {
  for (const invalidate of [
    (f) => {
      f.context.current = "other:project:file";
    },
    (f) => {
      f.operation.current = null;
    },
  ]) {
    const f = fixture();
    const result = f.handle([...files, { name: "second.txt", size: 12 }]);
    invalidate(f);
    f.requests[0].resolve({ ok: true });
    await result;
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.messages, []);
    assert.deepEqual(f.refreshes, []);
    assert.deepEqual(f.uploading, [true]);
    assert.equal(f.input.current.value, "selected-file");
  }
  assert.match(
    section,
    /return \(\) => \{\s*uploadOperationRef.current = null;\s*};\s*}, \[uploadContextKey\]\)/,
  );
});

test("upload list refresh ignores results when navigation occurs during the list request", async () => {
  let complete,
    current = true;
  const updates = [];
  const refresh = compile(`return (${refreshCallback});`, {
    setLoading: (value) => updates.push(["loading", value]),
    setLoadError: (value) => updates.push(["error", value]),
    refreshedImageUrlsRef: { current: new Set() },
    fnList: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    projectId: "project",
    kind: "file",
    setItems: (value) => updates.push(["items", value]),
  });
  const result = refresh(() => current);
  current = false;
  complete(files);
  await result;
  assert.deepEqual(updates, [
    ["loading", true],
    ["error", null],
  ]);
});
