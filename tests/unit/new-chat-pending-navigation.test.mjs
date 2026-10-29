import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const file = ts.createSourceFile(
  "index.tsx",
  readFileSync("src/routes/index.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handler;
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "startNewChat") {
    handler = node.initializer;
  }
  ts.forEachChild(node, visit);
};
visit(file);
assert.ok(handler, "The actual new-chat user action must exist");
const compiled = ts.transpileModule(`return (${handler.getText(file)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(pathname = "/") {
  const calls = [];
  const window = { location: { pathname } };
  const startNewChat = new Function("useCallback", "newChat", "navigate", "window", compiled)(
    (callback) => callback,
    () => calls.push("reset"),
    (destination) => calls.push(destination),
    window,
  );
  return { calls, window, startNewChat };
}

test("New chat on the chat route resets once without another route transition", () => {
  const f = fixture();
  f.startNewChat();
  assert.deepEqual(f.calls, ["reset"]);
});

test("New chat returns home when another destination starts before the chat shell unmounts", () => {
  const f = fixture();
  // The outgoing chat control was rendered on '/', but /work has since entered
  // browser history while its lazy route is still loading.
  f.window.location.pathname = "/work";
  f.startNewChat();
  assert.deepEqual(f.calls, ["reset", { to: "/" }]);
});
