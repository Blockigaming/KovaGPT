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

test("project Settings danger and confirmation copy both disclose saved Results without changing deletion callbacks", () => {
  const detail = parse("src/routes/projects.$projectId.tsx");
  const settings = detail.nodes.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsTab",
  );
  const onDelete = () => assert.fail("Copy inspection must never request deletion");
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
  const dialog = elements(tree, (node) => node.type === "ConfirmDialog")[0];
  for (const copy of [text(danger), dialog.props.message]) {
    assertConsequences(copy.replace(/\s+/g, " "));
    assert.match(copy, /stored file\s+copies/i);
    assert.match(copy, /retry/);
  }
  assert.equal(dialog.props.title, "Delete “Research”?");
  assert.equal(dialog.props.confirmLabel, "Delete forever");
  assert.equal(dialog.props.destructive, true);
  assert.equal(dialog.props.onConfirm, onDelete);
});
