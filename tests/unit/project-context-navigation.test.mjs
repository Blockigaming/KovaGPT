import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { loadUiModule, elements, text } from "../helpers/ui-state-harness.mjs";
const tabs = loadUiModule("src/lib/project-tab-search.ts", {});
const projectSource = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const ast = ts.createSourceFile(
  "project.tsx",
  projectSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const find = (predicate) => {
  let result;
  const visit = (n) => {
    if (predicate(n)) result = n;
    ts.forEachChild(n, visit);
  };
  visit(ast);
  return result;
};
test("Project tab deep links, unknown values, query/history state and back/forward use actual router", async () => {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/projects/$projectId",
    validateSearch: tabs.projectTabSearch,
  });
  const history = createMemoryHistory({
    initialEntries: ["/projects/demo?tab=instructions&filter=retained"],
  });
  const router = createRouter({ routeTree: root.addChildren([route]), history });
  const unsubscribe = history.subscribe(() => {
    void router.load();
  });
  await router.load();
  assert.equal(router.state.matches.at(-1).search.tab, "instructions");
  const declaration = find((n) => ts.isVariableDeclaration(n) && n.name.getText(ast) === "setTab");
  const setTab = vm.runInNewContext(
    ts.transpileModule(`(${declaration.initializer.getText(ast)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { navigate: router.navigate, projectId: "demo", projectTab: tabs.projectTab },
  );
  await router.navigate({
    to: "/projects/$projectId",
    params: { projectId: "demo" },
    search: { tab: "instructions", filter: "retained" },
    state: { review: "unchanged" },
    replace: true,
  });
  setTab("members");
  await router.load();
  assert.equal(router.state.matches.at(-1).search.tab, "members");
  assert.equal(router.state.location.search.filter, "retained");
  assert.equal(router.state.location.state.review, "unchanged");
  history.back();
  await router.load();
  assert.equal(router.state.matches.at(-1).search.tab, "instructions");
  history.forward();
  await router.load();
  assert.equal(router.state.matches.at(-1).search.tab, "members");
  for (const value of ["unknown", ["tasks"], null, 123])
    assert.equal(tabs.projectTabSearch({ tab: value, filter: "kept" }).tab, "overview");
  assert.equal(tabs.projectTabSearch({ filter: "kept" }).filter, "kept");
  assert.equal(tabs.projectTabSearch({}).tab, undefined);
  unsubscribe();
});
test("All Project text/date/file/select fields have explicit accessible names or associated labels", () => {
  const fields = [],
    labels = new Set();
  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const attrs = Object.fromEntries(
        n.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((p) => [
            p.name.getText(ast),
            p.initializer?.text ?? p.initializer?.getText(ast) ?? true,
          ]),
      );
      if (n.tagName.getText(ast) === "label" && attrs.htmlFor) labels.add(attrs.htmlFor);
      if (
        ["Input", "Textarea", "SelectTrigger", "input", "textarea", "select"].includes(
          n.tagName.getText(ast),
        )
      )
        fields.push(attrs);
    }
    ts.forEachChild(n, visit);
  };
  visit(ast);
  assert.equal(fields.length, 13);
  for (const field of fields)
    assert.ok(
      field["aria-label"] || field["aria-labelledby"] || labels.has(field.id),
      JSON.stringify(field),
    );
});
test("Context routes chat rules/pins to existing dialog and reports actual rules state", () => {
  const { ComposerContextPanel } = loadUiModule("src/components/ComposerContextPanel.tsx", {});
  let opened = 0;
  const tree = ComposerContextPanel({
    attachments: [],
    disabled: false,
    library: null,
    chatRulesActive: true,
    onOpenChatContext: () => opened++,
  });
  assert.match(text(tree), /Chat rules are active/);
  elements(
    tree,
    (n) => n.type === "button" && text(n).includes("Chat rules and pinned files"),
  )[0].props.onClick();
  assert.equal(opened, 1);
});
test("Shared dialog return focus skips hidden, inert, disabled, detached and changed-URL targets", () => {
  const window = { location: { href: "http://local/chat" } };
  const { restoreDialogFocus } = loadUiModule("src/lib/dialog-return-focus.ts", {}, { window });
  let focused = 0;
  const target = {
    isConnected: true,
    getClientRects: () => [{}],
    closest: () => null,
    matches: () => false,
    focus: () => focused++,
  };
  restoreDialogFocus(target, window.location.href);
  assert.equal(focused, 1);
  for (const overrides of [
    { isConnected: false },
    { getClientRects: () => [] },
    { closest: () => ({}) },
    { matches: () => true },
  ])
    restoreDialogFocus({ ...target, ...overrides }, window.location.href);
  restoreDialogFocus(target, "http://local/other");
  restoreDialogFocus(target, window.location.href, true);
  assert.equal(focused, 1);
});
test("Chat settings close handler uses same safe restoration guard", () => {
  const source = readFileSync("src/components/ChatWorkspaceDialog.tsx", "utf8");
  const file = ts.createSourceFile(
    "dialog.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let fn;
  const visit = (n) => {
    if (ts.isJsxOpeningElement(n) && n.tagName.getText(file) === "DialogContent")
      fn = n.attributes.properties.find((p) => p.name?.getText(file) === "onCloseAutoFocus")
        .initializer.expression;
    ts.forEachChild(n, visit);
  };
  visit(file);
  let prevented = 0,
    calls = [];
  const target = {};
  const close = vm.runInNewContext(
    ts.transpileModule(`(${fn.getText(file)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      restoreDialogFocus: (...args) => calls.push(args),
      returnFocusTarget: target,
      returnFocusUrl: "http://local/chat",
    },
  );
  close({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 1);
  assert.deepEqual(calls, [[target, "http://local/chat"]]);
});
