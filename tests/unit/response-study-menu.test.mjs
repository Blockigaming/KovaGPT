import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
const parsed = ts.createSourceFile(
  "ChatMessage.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const matching = (root, predicate) => {
  const results = [];
  const visit = (node) => {
    if (predicate(node)) results.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return results;
};
function compile(expression, dependencies) {
  const js = ts.transpileModule(`return (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
}
function attribute(name, includes) {
  return matching(
    parsed,
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(parsed) === name &&
      node.getText(parsed).includes(includes),
  )[0].initializer.expression.getText(parsed);
}
function opening(overrides = {}) {
  const sessions = [];
  const dependencies = {
    principalResolved: true,
    isUser: false,
    streaming: false,
    message: { id: "response-1", content: "The selected response, including its own context." },
    studyContextKey: '["owner-a","chat-a","response-1",true]',
    responseMoreRef: { current: { id: "response-more" } },
    studyReturnFocusRef: { current: null },
    studyReturnUrlRef: { current: undefined },
    studyOpeningRef: { current: false },
    setStudySession: (value) => sessions.push(value),
    window: { location: { href: "https://local.invalid/" } },
    ...overrides,
  };
  const expression = matching(
    parsed,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === "openStudy",
  )[0].initializer.getText(parsed);
  return { dependencies, sessions, open: compile(expression, dependencies) };
}

test("study snapshots the selected response and remembers its More button", () => {
  const f = opening();
  f.open();
  assert.deepEqual(f.sessions, [
    { key: f.dependencies.studyContextKey, source: f.dependencies.message.content },
  ]);
  assert.equal(f.dependencies.studyReturnFocusRef.current, f.dependencies.responseMoreRef.current);
  assert.equal(f.dependencies.studyReturnUrlRef.current, "https://local.invalid/");
  assert.equal(f.dependencies.studyOpeningRef.current, true);
});

test("unresolved, user, streaming and empty messages cannot open practice", () => {
  for (const overrides of [
    { principalResolved: false },
    { isUser: true },
    { streaming: true },
    { message: { content: "  " } },
  ]) {
    const f = opening(overrides);
    f.open();
    assert.deepEqual(f.sessions, []);
    assert.equal(f.dependencies.studyOpeningRef.current, false);
  }
});

test("study stays inside response More, with no standalone workspace chip", () => {
  const item = matching(
    parsed,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(parsed) === "DropdownMenuItem" &&
      node.getText(parsed).includes("Practice this explanation"),
  );
  assert.equal(item.length, 1);
  assert.match(item[0].getText(parsed), /onSelect=\{openStudy\}/);
  assert.match(item[0].getText(parsed), /min-h-11/);
  let parent = item[0].parent;
  while (
    parent &&
    !(
      ts.isJsxElement(parent) &&
      parent.openingElement.tagName.getText(parsed) === "DropdownMenuContent"
    )
  )
    parent = parent.parent;
  assert.ok(parent, "Study action belongs to the response dropdown");
  const workspace = readFileSync("src/components/ChatWorkspaceControls.tsx", "utf8");
  assert.doesNotMatch(workspace, /StudyControl|Practice this explanation/);
  for (const existing of ["HistoryStatus", "Custom Kova"]) assert.ok(workspace.includes(existing));
  assert.doesNotMatch(workspace, /Find images or products by description/);
  assert.doesNotMatch(
    readFileSync("src/components/ConversationHeaderActions.tsx", "utf8"),
    /Find similar images/,
  );
});

test("dropdown focus does not compete with study dialog, while normal dismissal remains unchanged", () => {
  const studyOpeningRef = { current: true };
  const close = compile(attribute("onCloseAutoFocus", "studyOpeningRef"), {
    studyOpeningRef,
    responseDraftFocusRef: { current: null },
    memoryReviewOpeningRef: { current: false },
  });
  let prevented = 0;
  close({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 1);
  assert.equal(studyOpeningRef.current, false);
  close({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 1);
});

test("dialog restores More focus only within the same owner, response, and temporary context", () => {
  const calls = [];
  const studySession = { key: "context-a" };
  const studyContextRef = { current: "context-a" };
  const studyReturnFocusRef = { current: { id: "more-a" } };
  const studyReturnUrlRef = { current: "https://local.invalid/" };
  const restore = compile(attribute("onRestoreFocus", "studyContextRef"), {
    studySession,
    studyContextRef,
    studyReturnFocusRef,
    studyReturnUrlRef,
    restoreDialogFocus: (...args) => calls.push(args),
  });
  restore();
  assert.deepEqual(calls, [[studyReturnFocusRef.current, studyReturnUrlRef.current]]);
  studyContextRef.current = "context-b";
  restore();
  assert.equal(calls.length, 1);
  assert.match(source, /JSON.stringify\(\[principal, chatId, message.id, temporary\]\)/);
  assert.match(source, /studySession\?\.key === studyContextKey/);
  assert.match(
    source,
    /setStudySession\(null\);\s+studyReturnFocusRef.current = null;\s+studyOpeningRef.current = false;\s+\}, \[studyContextKey\]\)/,
  );
  assert.match(
    source,
    /ownerId=\{userKey\}[\s\S]*?temporary=\{temporary\}[\s\S]*?source=\{studySession.source\}/,
  );
});

test("existing StudyPanel receives the source and privacy scope in a controlled focus-managed dialog", () => {
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const modules = {
    react: { lazy: () => "StudyPanel", Suspense: "Suspense" },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/components/ui/dialog": Object.fromEntries(
      ["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"].map(
        (name) => [name, name],
      ),
    ),
  };
  const code = ts.transpileModule(readFileSync("src/components/ChatStudyControl.tsx", "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in modules);
    return modules[name];
  });
  const nodes = (node) =>
    !node || typeof node !== "object"
      ? []
      : Array.isArray(node)
        ? node.flatMap(nodes)
        : [node, ...nodes(node.props?.children)];
  let focus = 0,
    prevented = false;
  const onOpenChange = () => {};
  const root = exports.ChatStudyControl({
    ownerId: "owner-a",
    temporary: true,
    source: "This exact response",
    open: true,
    onOpenChange,
    onRestoreFocus: () => focus++,
  });
  assert.equal(root.props.onOpenChange, onOpenChange);
  assert.deepEqual(nodes(root).find((node) => node.type === "StudyPanel").props, {
    ownerId: "owner-a",
    temporary: true,
    source: "This exact response",
  });
  nodes(root)
    .find((node) => node.type === "DialogContent")
    .props.onCloseAutoFocus({
      preventDefault() {
        prevented = true;
      },
    });
  assert.equal(prevented, true);
  assert.equal(focus, 1);
  assert.equal(
    nodes(root).some((node) => node.type === "DialogTrigger" || node.type === "button"),
    false,
  );
});
