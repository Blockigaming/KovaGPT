import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/apps.tsx", "utf8");
const parsed = ts.createSourceFile(
  "apps.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declaration = (name) =>
  parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
const page = declaration("AppsPage");
const matching = (root, predicate) => {
  const results = [];
  const visit = (node) => {
    if (predicate(node)) results.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return results;
};
test("provider cards retain stable identity in the All and Connected directory", () => {
  assert.ok(declaration("AppCard"));
  assert.equal(
    matching(
      page,
      (node) => ts.isFunctionDeclaration(node) && node.name?.getText(parsed) === "AppCard",
    ).length,
    0,
  );
  assert.match(source, /connectionFilter === "connected" && !hasConnection/);
  assert.match(source, /<Input\s+ref=\{searchRef\}/);
});
