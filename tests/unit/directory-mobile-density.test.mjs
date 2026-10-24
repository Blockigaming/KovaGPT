import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { nodes, text } from "../helpers/kova-react-fixture.mjs";

// Render the real route's header action expression without fetching account data.
function headerActions(route, state) {
  const source = ts.createSourceFile(
    route,
    readFileSync(`src/routes/${route}.tsx`, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  let createHelper = "";
  const visit = (node) => {
    if (
      route !== "library" &&
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(source) === "WorkspacePageHeader"
    ) {
      expression = node.attributes.properties.find(
        (attribute) => attribute.name?.getText(source) === "actions",
      )?.initializer?.expression;
    }
    if (
      route === "library" &&
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(source) === "aria-label" &&
          attr.initializer?.text === "Refresh Library",
      )
    ) {
      // Refresh moved below the list; execute its real principal-guarded expression.
      let parent = node.parent;
      while (parent && !ts.isConditionalExpression(parent)) parent = parent.parent;
      assert.ok(parent, "Refresh must retain its principal guard");
      expression = parent;
    }
    if (route === "projects" && ts.isFunctionDeclaration(node) && node.name?.text === "openCreate")
      createHelper = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(expression, `Missing ${route} header actions`);
  const jsx = ts.createPrinter().printNode(ts.EmitHint.Expression, expression, source);
  const compiled = ts.transpileModule(`${createHelper}\nexport const actions = (${jsx});`, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  const element = (type, props) => ({ type, props });
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      assert.equal(name, "react/jsx-runtime");
      return { jsx: element, jsxs: element };
    },
    Button: "button",
    RefreshCw: "refresh-icon",
    LayoutTemplate: "template-icon",
    Plus: "plus-icon",
    ...state,
  });
  return nodes(exports.actions);
}

test("compact Library refresh keeps its name, loading guard, and both refresh actions", () => {
  const called = [];
  const state = {
    principalReady: true,
    loading: false,
    folderBusy: false,
    sharesLoading: false,
    refreshLibrary: () => called.push("library"),
    loadShares: () => called.push("shares"),
  };
  const refresh = headerActions("library", state).find((node) => node.type === "button");
  assert.equal(refresh.props["aria-label"], "Refresh Library");
  assert.equal(refresh.props.title, "Refresh Library");
  assert.match(text(refresh), /Refresh/);
  assert.equal(refresh.props.disabled, false);
  refresh.props.onClick();
  assert.deepEqual(called, ["library", "shares"]);
  for (const flag of ["loading", "folderBusy", "sharesLoading"]) {
    assert.equal(
      headerActions("library", { ...state, [flag]: true }).find((node) => node.type === "button")
        .props.disabled,
      true,
    );
  }
  assert.equal(headerActions("library", { ...state, principalReady: false }).length, 0);
});

test("Projects keeps full-label creation, dialog return focus, and named templates action", () => {
  const opened = [];
  const returnFocus = { current: null };
  const templatesReturnFocus = { current: null };
  const templatesOpenedUrl = { current: null };
  const actions = headerActions("projects", {
    isSignedIn: true,
    isLoading: false,
    userKey: "owner-a",
    createContextRef: { current: { isLoaded: true, isSignedIn: true, userKey: "owner-a" } },
    createActiveRef: { current: true },
    createBusyRef: { current: false },
    createEpochRef: { current: 1 },
    createSessionRef: { current: null },
    createOriginRef: { current: null },
    createFailureFocusRef: { current: null },
    setCreateError: () => {},
    createReturnFocusRef: returnFocus,
    templatesReturnFocusRef: templatesReturnFocus,
    templatesOpenedUrlRef: templatesOpenedUrl,
    window: { location: { href: "https://review.invalid/projects" } },
    setCreateOpen: (open) => opened.push(["create", open]),
    setTemplatesOpen: (open) => opened.push(["templates", open]),
  });
  const create = actions.find((node) => node.type === "button" && /New project/.test(text(node)));
  assert.ok(create);
  const trigger = {};
  create.props.onClick({ currentTarget: trigger });
  assert.equal(returnFocus.current, trigger);
  const templates = actions.find((node) => node.props?.["aria-label"] === "Project templates");
  assert.ok(templates);
  templates.props.onClick({ currentTarget: trigger });
  assert.equal(templatesReturnFocus.current, trigger);
  assert.equal(templatesOpenedUrl.current, "https://review.invalid/projects");
  assert.deepEqual(opened, [
    ["create", true],
    ["templates", true],
  ]);
});

test("density changes stay mobile-scoped and preserve touch targets and the active timer", () => {
  const css = readFileSync("src/styles/file-directories.css", "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 767px)"));
  assert.match(phone, /--page-padding: 16px 20px 40px;/);
  assert.match(phone, /grid-template-columns: minmax\(0, 1fr\) 140px;/);
  assert.match(phone, /\.kova-project-create\s*\{[^}]*width: 140px;/);
  assert.match(phone, /\.kova-project-templates\s*\{[^}]*min-height: 44px;/);
  assert.match(phone, /button\[aria-controls="kova-timers-panel"\]\s*\{[^}]*min-height: 44px;/);
  assert.match(phone, /:has\(\.tabular-nums\)\s*> span:last-child/);
  assert.match(phone, /\.kova-project-file-link\s*\{[^}]*min-height: 0;/);
  assert.match(css, /\.kova-project-file-link\s*\{[^}]*min-height: 190px;/);
  for (const route of ["library", "projects"]) {
    const source = readFileSync(`src/routes/${route}.tsx`, "utf8");
    assert.match(source, /aria-label="(?:Sort Library|Sort projects)"/);
    assert.match(source, /aria-label="Grid view"/);
    assert.match(source, /aria-label="List view"/);
    assert.match(source, /aria-pressed=/);
  }
});
