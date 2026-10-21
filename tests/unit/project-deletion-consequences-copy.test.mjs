import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { elements, text } from "../helpers/ui-state-harness.mjs";

function parse(path) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { source, nodes };
}

function compile(source, deps) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(deps), js)(...Object.values(deps));
}

function assertConsequences(copy) {
  assert.match(copy, /saved Results \(including their versions and comments\)/);
  for (const consequence of ["chats", "tasks", "notes", "memberships"]) {
    assert.ok(copy.includes(consequence), `Missing consequence: ${consequence}`);
  }
  assert.doesNotMatch(copy, /Library|Work history/);
}

test("saved project Results, versions and comments follow the declared project deletion cascades", () => {
  const sql = readFileSync(
    "supabase/migrations/20260905000905_project_canvas_collaboration.sql",
    "utf8",
  );
  const table = (name) =>
    sql.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.match(
    table("canvas_documents"),
    /project_id uuid REFERENCES public\.projects\(id\) ON DELETE CASCADE/,
  );
  for (const name of ["canvas_revisions", "canvas_comments"]) {
    assert.match(
      table(name),
      /document_id uuid NOT NULL REFERENCES public\.canvas_documents\(id\) ON DELETE CASCADE/,
    );
  }
});

const list = parse("src/routes/projects.tsx");
const confirmation = list.nodes.find(
  (node) =>
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(list.source) === "ConfirmActionDialog" &&
    node.attributes.getText(list.source).includes('title="Delete this project?"'),
);
const description = confirmation.attributes.properties.find(
  (attribute) => attribute.name?.getText(list.source) === "description",
).initializer.expression;

for (const [state, deletingProject] of [
  ["ordinary", { name: "Research", deletion_requested_at: null }],
  ["incomplete cleanup", { name: "Research", deletion_requested_at: "2026-10-19" }],
  ["empty selection", null],
]) {
  test(`Projects ${state} deletion confirmation includes saved Result consequences`, () => {
    const copy = compile(`return (${description.getText(list.source)});`, { deletingProject });
    assertConsequences(copy);
    assert.match(copy, /permanently delete/);
    if (deletingProject) assert.match(copy, /Research/);
    if (deletingProject?.deletion_requested_at) {
      assert.match(copy, /Retry the bounded stored-file cleanup/);
    } else {
      assert.match(copy, /stored file copies/);
    }
  });
}

test("project Settings danger and route confirmation disclose saved Results and preserve explicit deletion", async () => {
  const detail = parse("src/routes/projects.$projectId.tsx");
  const settings = detail.nodes.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsTab",
  );
  const requested = [];
  const onDelete = (trigger) => requested.push(trigger);
  const render = compile(`${settings.getText(detail.source)}; return SettingsTab;`, {
    React: {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    },
    useState: (value) => [value, () => {}],
    ...Object.fromEntries(
      ["Input", "Textarea", "Button", "Loader2", "Save", "Trash2", "ConfirmDialog"].map((name) => [
        name,
        name,
      ]),
    ),
  });
  const tree = render({ project: { name: "Research" }, onSave() {}, onDelete });
  const danger = elements(
    tree,
    (node) => node.type === "p" && text(node).includes("Deleting a project"),
  )[0];
  const dialog = detail.nodes.find(
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(detail.source) === "ConfirmDialog" &&
      node.attributes.properties.some(
        (attribute) =>
          attribute.name?.getText(detail.source) === "open" &&
          attribute.initializer?.expression?.getText(detail.source) === "deleteOpen",
      ),
  );
  assert.ok(dialog, "the shared route owns the deletion confirmation");
  const attribute = (name) =>
    dialog.attributes.properties.find((item) => item.name?.getText(detail.source) === name);
  const value = (name) => {
    const initial = attribute(name)?.initializer;
    return initial
      ? compile(`return (${(initial.expression ?? initial).getText(detail.source)});`, {
          project: { name: "Research" },
        })
      : true;
  };
  for (const copy of [text(danger), value("message")]) {
    assertConsequences(copy.replace(/\s+/g, " "));
    assert.match(copy, /stored file\s+copies/i);
    assert.match(copy, /retry/);
  }
  assert.equal(value("title"), "Delete “Research”?");
  assert.equal(value("confirmLabel"), "Delete forever");
  assert.equal(value("destructive"), true);
  const deleteButton = elements(
    tree,
    (node) => node.type === "Button" && text(node).includes("Delete project"),
  )[0];
  const trigger = {};
  deleteButton.props.onClick({ currentTarget: trigger });
  assert.deepEqual(
    requested,
    [trigger],
    "Settings forwards the actual invoker, not an immediate deletion",
  );
  const mounted = detail.nodes.find(
    (node) =>
      ts.isJsxSelfClosingElement(node) && node.tagName.getText(detail.source) === "SettingsTab",
  );
  assert.equal(
    mounted.attributes.properties
      .find((item) => item.name?.getText(detail.source) === "onDelete")
      .initializer.expression.getText(detail.source),
    "openProjectDelete",
  );
  const opener = detail.nodes.find(
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText(detail.source) === "openProjectDelete",
  );
  assert.doesNotMatch(opener.initializer.getText(detail.source), /fnDelete|navigate\(/);
  assert.match(opener.initializer.getText(detail.source), /setDeleteOpen\(true\)/);
  for (const isOwner of [true, false]) {
    const calls = [];
    const confirm = compile(
      `return (${attribute("onConfirm").initializer.expression.getText(detail.source)});`,
      {
        isOwner,
        requestKey: "owner:project",
        projectId: "project",
        currentRequestKeyRef: { current: "owner:project" },
        setDeleteError: (error) => calls.push(["error", error]),
        fnDelete: async (input) => calls.push(["delete", input]),
        toast: { success: (message) => calls.push(["success", message]) },
        navigate: async (input) => calls.push(["navigate", input]),
        refresh: () => assert.fail("successful deletion must not run recovery refresh"),
      },
    );
    assert.equal(calls.length, 0);
    await confirm();
    if (isOwner) {
      assert.deepEqual(
        calls.find(([kind]) => kind === "delete"),
        ["delete", { data: { id: "project" } }],
      );
      assert.deepEqual(calls.at(-1), ["navigate", { to: "/projects" }]);
    } else assert.deepEqual(calls, [], "a non-owner cannot execute the route confirmation");
  }
});
