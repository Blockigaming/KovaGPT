import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const routes = {
  projects: await readFile("src/routes/projects.tsx", "utf8"),
  project: await readFile("src/routes/projects.$projectId.tsx", "utf8"),
  files: await readFile("src/routes/files.tsx", "utf8"),
  memory: await readFile("src/routes/memory.tsx", "utf8"),
};
const projectSyntax = ts.createSourceFile(
  "projects.$projectId.tsx",
  routes.project,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nodesWithin = (root) => {
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return nodes;
};

test("workspace routes provide the shell skip-link target in every render branch", () => {
  for (const [name, source] of Object.entries(routes)) {
    assert.match(source, /<main[\s\S]{0,180}id="main-content"/, `${name} needs a main target`);
  }

  assert.match(routes.projects, /aria-busy=\{isLoading \|\| undefined\}/);
  assert.match(routes.projects, /id="projects-loading-title"/);
  assert.match(routes.project, /id="project-loading-title"/);
});

test("project and collection loaders reject stale principal responses and expose retries", () => {
  assert.match(routes.projects, /refreshSequenceRef/);
  assert.match(routes.projects, /currentUserKeyRef\.current !== requestUserKey/);
  assert.match(routes.project, /currentRequestKeyRef\.current !== loadRequestKey/);
  assert.match(routes.project, /Project could not be opened/);
  assert.doesNotMatch(routes.project, /if \(loading \|\| !project\)/);

  for (const source of [routes.files, routes.memory]) {
    assert.match(source, /let active = true/);
    assert.match(source, /active = false/);
    assert.match(source, /resolvedUserKey/);
    assert.match(source, />\s*Try again\s*</);
  }
});

test("workspace route error panels never expose raw backend messages", () => {
  for (const routeName of ["files", "memory", "projects", "project"]) {
    const source = routes[routeName];
    assert.doesNotMatch(source, /description=\{loadError\}/, routeName);
    if (routeName !== "project")
      assert.doesNotMatch(source, />\s*\{(?:error|loadError)(?:\s*\?\?[^}]*)?\}\s*</, routeName);
  }

  // These tabs now render literal recovery messages. Keep the existing guards
  // elsewhere; this check does not attempt whole-file backend-error taint analysis.
  const tabs = projectSyntax.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && ["TasksTab", "MemoryTab"].includes(node.name?.text),
  );
  assert.equal(tabs.length, 2);
  const otherProjectSource = tabs.reduce(
    (source, tab) => source.replace(tab.getText(projectSyntax), ""),
    routes.project,
  );
  assert.doesNotMatch(otherProjectSource, />\s*\{(?:error|loadError)(?:\s*\?\?[^}]*)?\}\s*</);
  const safeCopy = (node) =>
    ts.isStringLiteral(node) ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isConditionalExpression(node) && safeCopy(node.whenTrue) && safeCopy(node.whenFalse));
  for (const component of tabs) {
    const nodes = nodesWithin(component);
    for (const name of ["error", "loadError", "addError", "deleteError"]) {
      const rendered = nodes.some(
        (node) =>
          ts.isJsxExpression(node) &&
          ts.isJsxElement(node.parent) &&
          node.expression?.getText(projectSyntax) === name,
      );
      if (!rendered) continue;
      const setter = `set${name[0].toUpperCase()}${name.slice(1)}`;
      const writes = nodes.filter(
        (node) => ts.isCallExpression(node) && node.expression.getText(projectSyntax) === setter,
      );
      assert.ok(writes.length, `${component.name.text}.${name} must have inspectable assignments`);
      for (const write of writes)
        assert.ok(
          write.arguments.length === 1 && safeCopy(write.arguments[0]),
          `${component.name.text}.${setter} must use safe UI copy: ${write.getText(projectSyntax)}`,
        );
    }
  }
});

test("file sizes and memory identities preserve their edge-case invariants", () => {
  assert.match(routes.files, /if \(n === 0\) return "0 B"/);
  assert.match(routes.files, /if \(n === null\) return "Size unavailable"/);

  assert.match(routes.memory, /function memoryRecordKey/);
  assert.match(routes.memory, /memoryRecordKey\(value\) === memoryRecordKey\(item\)/);
  assert.match(routes.memory, /memoryRecordKey\(duplicate\) === memoryRecordKey\(item\)/);
  assert.match(routes.memory, /editing === memoryRecordKey\(item\)/);
});

test("signed-out workspace states offer real authentication and hide data-only controls", () => {
  for (const source of [routes.projects, routes.project, routes.files, routes.memory]) {
    assert.match(source, /<SignInButton mode="modal">/);
  }

  assert.match(routes.files, /!isSignedIn \? \(/);
  assert.match(routes.memory, /isSignedIn && !isLoading && !error/);
});
