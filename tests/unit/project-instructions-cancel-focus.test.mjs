import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
test("canceling instruction edits restores saved text and focuses the editor", () => {
  const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
  const fragment = source.slice(
    source.indexOf("function ProjectInstructionsTab("),
    source.indexOf("// ===================== NOTES"),
  );
  const ast = ts.createSourceFile(
    "instructions.tsx",
    fragment,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let handler;
  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(ast) === "onClick" &&
      node.initializer?.getText(ast).includes("setDraft(lastSaved)")
    )
      handler = node.initializer.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler);
  const effects = [];
  const drafts = new Map([["owner:project", "Edited"]]);
  const callback = new Function(
    "setDraft",
    "lastSaved",
    "projectInstructionDrafts",
    "draftKey",
    "setError",
    "instructionsInputRef",
    `return ${handler}`,
  )(
    (text) => effects.push(text),
    "Saved",
    drafts,
    "owner:project",
    (error) => effects.push(error),
    { current: { focus: () => effects.push("editor focused") } },
  );
  callback();
  assert.deepEqual(effects, ["Saved", null, "editor focused"]);
  assert.equal(drafts.has("owner:project"), false);
  assert.match(fragment, /<Textarea\s+ref=\{instructionsInputRef\}/);
});

test("project detail puts identity before a compact primary action row", () => {
  const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
  const start = source.indexOf(
    '<main id="main-content" tabIndex={-1} className="spec400-management spec400-project-detail">',
  );
  const detail = source.slice(start, source.indexOf("<Tabs value={tab}", start));
  assert.ok(detail.indexOf('aria-label="Breadcrumb"') < detail.indexOf("{project.name}</h1>"));
  assert.ok(detail.indexOf("{project.name}</h1>") < detail.indexOf('aria-label="Project actions"'));
  assert.match(detail, /aria-label="Search this project"/);
  assert.match(detail, /aria-label="More project actions"/);
  assert.match(detail, /setTab\("members"\)/);
  assert.match(detail, /setTab\("timers"\)/);
  assert.match(detail, /void toggleArchive\(\)/);
  assert.match(source.slice(start - 40, start), /<AppShell hideUtilities>/);
});
