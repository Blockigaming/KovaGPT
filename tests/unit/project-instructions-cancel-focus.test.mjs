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
  const ast = ts.createSourceFile(
    "project.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const attribute = (element, name) =>
    element.openingElement.attributes.properties.find(
      (item) => ts.isJsxAttribute(item) && item.name.getText(ast) === name,
    )?.initializer;
  const find = (root, predicate) => {
    const matches = [];
    const visit = (node) => {
      if (ts.isJsxElement(node) && predicate(node)) matches.push(node);
      ts.forEachChild(node, visit);
    };
    visit(root);
    return matches;
  };
  const main = find(
    ast,
    (element) =>
      element.openingElement.tagName.getText(ast) === "main" &&
      attribute(element, "className")?.text?.split(/\s+/).includes("kova-project-workspace"),
  )[0];
  assert.ok(main, "The project workspace has its own main region");
  const header = find(
    main,
    (element) => attribute(element, "className")?.text === "kova-project-header",
  )[0];
  assert.ok(header, "Project identity and actions share one header");
  const breadcrumb = find(
    header,
    (element) => attribute(element, "aria-label")?.text === "Breadcrumb",
  )[0];
  const title = find(header, (element) => element.openingElement.tagName.getText(ast) === "h1")[0];
  const actions = find(
    header,
    (element) => attribute(element, "aria-label")?.text === "Project actions",
  )[0];
  assert.ok(breadcrumb && title && actions);
  assert.match(title.getText(ast), /\{project.name\}/);
  assert.ok(breadcrumb.pos < title.pos && title.pos < actions.pos);
  const detail = header.getText(ast);
  assert.match(detail, /aria-label="Search this project"/);
  assert.match(detail, /aria-label="More project actions"/);
  assert.match(detail, /aria-label="New chat in project"/);
  assert.match(detail, /isOwner && !archived \? "Share project" : "People"/);
  assert.match(
    detail,
    /<DropdownMenuItem onSelect=\{\(\) => openProjectSearch\(projectMoreRef.current\)\}>\s*<Search[^>]*\/>\s*Search this project/,
  );
  assert.match(detail, /setTab\("members"\)/);
  assert.match(detail, /setTab\("timers"\)/);
  assert.match(detail, /void toggleArchive\(\)/);
  assert.ok(
    ts.isJsxElement(main.parent) &&
      main.parent.openingElement.tagName.getText(ast) === "AppShell" &&
      main.parent.openingElement.attributes.properties.some(
        (item) => ts.isJsxAttribute(item) && item.name.getText(ast) === "hideUtilities",
      ),
    "The project header owns its actions without duplicate shell utilities",
  );
});

test("Files is directly discoverable while all project tools keep their existing targets", () => {
  const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
  const ast = ts.createSourceFile(
    "project.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const primaryTabs = [];
  const panels = new Map();
  let tools;
  const visit = (node) => {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(ast);
      const value = node.openingElement.attributes.properties.find(
        (item) => ts.isJsxAttribute(item) && item.name.getText(ast) === "value",
      )?.initializer?.text;
      if (tag === "TabsTrigger") primaryTabs.push(value);
      if (tag === "TabsContent") panels.set(value, node.getText(ast));
      if (
        tag === "div" &&
        node.openingElement.attributes.properties.some(
          (item) =>
            ts.isJsxAttribute(item) &&
            item.name.getText(ast) === "className" &&
            item.initializer?.text === "spec400-project-tools",
        )
      )
        tools = node.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.deepEqual(primaryTabs, ["chats", "files", "context"]);
  assert.match(
    panels.get("files"),
    /FilesTab projectId=\{projectId\} canEdit=\{canEdit\} kind="file"/,
  );
  assert.match(panels.get("chats"), /onMoveFocusRequest=\{beginChatMoveFocus\}/);
  assert.match(tools, /aria-label="More project tools"/);
  assert.match(tools, /DropdownMenuRadioGroup value=\{tab\} onValueChange=\{setTab\}/);
  assert.doesNotMatch(tools, /<select\b/);
  for (const value of [
    "overview",
    "timers",
    "files",
    "images",
    "notes",
    "tasks",
    "memory",
    "members",
    "collaboration",
    "settings",
  ]) {
    assert.ok(panels.has(value), `The ${value} panel remains available`);
    assert.ok(tools.includes(`value="${value}"`), `More tools retains the ${value} destination`);
  }
});
