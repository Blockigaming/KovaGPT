import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { eventAttributes } from "../helpers/workspace-layout-preservation.mjs";
const base = "9b4a0dc8762562391b8c5b7b8709611404b1f173";
const settingsPath = "src/components/SettingsDialog.tsx";
const editorPath = "src/components/ScheduledTaskEditor.tsx";
const read = (path) =>
  process.env.KOVA_REGRESSION_BASE
    ? execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" })
    : readFileSync(path, "utf8");
const settings = read(settingsPath),
  editor = read(editorPath);
const parse = (source) =>
  ts.createSourceFile("test.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(root, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}
function render(source, globals) {
  return vm.runInNewContext(
    ts.transpileModule(`(${source})`, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        jsxFactory: "element",
      },
    }).outputText,
    { ...globals, element: (type, props, ...children) => ({ type, props: props ?? {}, children }) },
  );
}
function elements(node, type) {
  if (!node || typeof node !== "object") return [];
  return [
    ...(node.type === type ? [node] : []),
    ...(node.children ?? []).flat(Infinity).flatMap((child) => elements(child, type)),
  ];
}
const text = (node) =>
  typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const ast = parse(settings);
const header = find(
  ast,
  (n) =>
    ts.isJsxElement(n) &&
    n.openingElement.tagName.getText(ast) === "header" &&
    n.openingElement.getText(ast).includes("kova-settings-content-header"),
)[0];
const props = (node, source) =>
  Object.fromEntries(
    node.properties
      .filter(ts.isPropertyAssignment)
      .map((p) => [p.name.getText(source), p.initializer]),
  );
const tabs = find(ast, ts.isObjectLiteralExpression)
  .map((n) => props(n, ast))
  .filter((p) => p.v && p.label);
for (const [value, label] of [
  ["report", "Report an issue"],
  ["help", "Help center"],
  ["about", "About"],
  ["logout", "Log out"],
  ["general", "General"],
]) {
  test(`${label}: actual header retains accessible title and only appropriate settings subtitle`, () => {
    const tab = tabs.find((p) => p.v.text === value);
    const activeTab = {
      label: tab.label.text,
      showSettingsSubtitle: tab.showSettingsSubtitle
        ? render(tab.showSettingsSubtitle.getText(ast), {})
        : undefined,
    };
    const tree = render(header.getText(ast), {
      activeTab,
      contentHeadingRef: {},
      savedPulse: false,
      ArrowLeft: "ArrowLeft",
      Check: "Check",
    });
    const headings = elements(tree, "h2");
    assert.equal(headings.length, 1);
    assert.equal(text(headings[0]), label);
    assert.equal(headings[0].props.tabIndex, -1);
    assert.equal(elements(tree, "p").length, value === "general" ? 1 : 0);
    if (value === "general") assert.match(text(tree), /Manage your KovaGPT general settings/);
  });
}
test("Support panels retain explanations and actions without duplicating the header title", () => {
  for (const value of ["report", "help", "about", "logout"]) {
    const panel = find(
      ast,
      (n) =>
        ts.isJsxElement(n) &&
        n.openingElement.tagName.getText(ast) === "TabsContent" &&
        n.openingElement.getText(ast).includes(`value="${value}"`),
    )[0];
    assert.equal(
      find(panel, (n) => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "h3")
        .length,
      0,
    );
    assert.ok(
      find(panel, (n) => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "p")
        .length,
    );
  }
  assert.match(settings, /Found a bug or something off/);
  assert.match(settings, /Get help, contact support, or browse common questions/);
  assert.match(settings, /You'll be signed out of KovaGPT on this device/);
  assert.match(settings, /KovaGPT is built by Zachary Block/);
});
for (const task of [null, { id: "read-only-example" }])
  test(`Task editor ${task ? "existing" : "new"}: title can wrap and Close cannot shrink or wrap`, () => {
    const ast = parse(editor);
    const header = find(
      ast,
      (n) =>
        ts.isJsxElement(n) &&
        n.openingElement.tagName.getText(ast) === "div" &&
        n.openingElement.getText(ast).includes("justify-between gap-3"),
    )[0];
    let closed = 0;
    for (const busy of [false, true]) {
      const tree = render(header.getText(ast), {
        task,
        busy,
        button: "existing-button",
        onClose: () => closed++,
      });
      const close = elements(tree, "button")[0],
        title = elements(tree, "h2")[0];
      assert.match(close.props.className, /shrink-0/);
      assert.match(close.props.className, /whitespace-nowrap/);
      assert.match(close.props.className, /min-h-11/);
      assert.match(close.props.className, /min-w-11/);
      assert.match(title.props.className, /min-w-0/);
      assert.match(title.props.className, /flex-1/);
      assert.match(title.props.className, /break-words/);
      assert.equal(text(close).trim(), "Close");
      assert.equal(close.props.disabled, busy);
      if (!busy) close.props.onClick();
    }
    assert.equal(closed, 1);
  });
for (const path of [settingsPath, editorPath])
  test(`${path}: all event handlers preserved exactly`, () => {
    const before = execFileSync("git", ["show", base + ":" + path], { encoding: "utf8" });
    assert.deepEqual(eventAttributes(read(path)), eventAttributes(before));
  });
