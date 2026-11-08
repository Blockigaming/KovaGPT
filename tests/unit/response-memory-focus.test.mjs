import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
const ast = ts.createSourceFile(
  "ChatMessage.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function expression(name, needle) {
  let found;
  function visit(n) {
    if (ts.isJsxAttribute(n) && n.name.getText(ast) === name && n.getText(ast).includes(needle))
      found = n.initializer.expression.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.ok(found);
  return found;
}
function compile(value, deps) {
  return new Function(
    ...Object.keys(deps),
    ts.transpileModule(`return (${value});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(...Object.values(deps));
}
test("response memory dismissal restores focus with a stale-account guard", () => {
  for (const current of ["owner:message", "other:message"]) {
    let prevented = false,
      args;
    const target = { id: "memory-button" };
    const close = compile(expression("onCloseAutoFocus", "memoryReturnFocusRef"), {
      memoryReturnFocusRef: { current: target },
      memoryReturnUrlRef: { current: "https://review.invalid/chat" },
      memoryContextRef: { current },
      memoryKey: "owner:message",
      restoreDialogFocus: (...values) => (args = values),
    });
    close({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.deepEqual(args, [target, "https://review.invalid/chat", current !== "owner:message"]);
  }
});
