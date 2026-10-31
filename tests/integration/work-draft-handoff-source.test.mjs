import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  consumePrincipalHandoff,
  writePrincipalHandoff,
} from "../../src/lib/principal-browser-storage.mjs";

const source = readFileSync("src/lib/workspace-handoffs.ts", "utf8");
const home = readFileSync("src/routes/index.tsx", "utf8");

test("legacy Work actions write a one-time owner-scoped chat handoff and return to chat", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const exports = {},
    browser = { location: { href: "" } };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "exports", "window", code)(
    () => ({ safeBrowserStorage: () => storage, writePrincipalHandoff }),
    exports,
    browser,
  );
  assert.equal(
    exports.openInWork(
      { type: "artifact", id: "a", title: "Release notes", content: "Keep the complete context" },
      "owner-a",
    ),
    true,
  );
  assert.equal(browser.location.href, "/");
  assert.equal(consumePrincipalHandoff(storage, "kova-app-chat-context", "owner-b").ok, false);
  const actual = consumePrincipalHandoff(storage, "kova-app-chat-context", "owner-a");
  assert.equal(actual.ok, true);
  assert.match(actual.value, /Release notes[\s\S]*Keep the complete context/);
  assert.equal(consumePrincipalHandoff(storage, "kova-app-chat-context", "owner-a").ok, false);
  assert.ok([...values.keys()].every((key) => !key.includes("kova-work-draft")));
});

test("chat recovers both legacy task and prepared drafts without starting background execution", () => {
  const ast = ts.createSourceFile(
    "index.tsx",
    home,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "consume" &&
      node.arguments[0]?.getText(ast) === "key"
    )
      callback = node.arguments[1];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(callback);
  let draft = "";
  const code = ts.transpileModule(`exports.prepare = ${callback.getText(ast)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("exports", "setInput", code)(exports, (value) => {
    draft = value;
  });
  for (const value of [
    {
      objective: "Review a report",
      context: "Private owner context",
      plan: ["Read it", "Summarize it"],
    },
    {
      objective: "Review a report",
      context: "Private owner context",
      steps: [{ text: "Read it", done: true }, { text: "Summarize it" }],
    },
  ]) {
    draft = "";
    const apply = exports.prepare(value);
    assert.equal(draft, "");
    apply();
    assert.match(
      draft,
      /Review a report[\s\S]*Private owner context[\s\S]*Read it[\s\S]*Summarize it/,
    );
  }
  for (const value of [null, {}, { objective: "x", context: "y", plan: [42] }])
    assert.throws(() => exports.prepare(value));
  assert.match(home, /for \(const key of \["kova-work-context", "kova-work-draft"\]\)/);
  assert.match(home, /if \(!principalReady\) return;/);
  assert.match(home, /consumePrincipalHandoff<T>\(storage, baseKey, userKey\)/);
  assert.doesNotMatch(callback.getText(ast), /fetch\(|\.rpc\(|\.send\(/);
});
