import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
const source = readFileSync("src/components/ChatMessage.tsx", "utf8");
const ast = ts.createSourceFile(
  "message.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function attribute(name, includes) {
  let found;
  function visit(n) {
    if (ts.isJsxAttribute(n) && n.name.getText(ast) === name && n.getText(ast).includes(includes))
      found = n.initializer.expression.getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  assert.ok(found);
  return found;
}
function compile(code, deps) {
  return new Function(
    ...Object.keys(deps),
    ts.transpileModule(`return (${code});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
      .outputText,
  )(...Object.values(deps));
}
test("change-response submission preserves deliberate send and hands focus back after dismissal", () => {
  const drafts = [];
  let focused = 0,
    closed = false,
    cleared = false;
  const retryFocusRef = { current: undefined };
  const submit = compile(attribute("onSubmit", "Change the previous response:"), {
    retryInstruction: "Make it shorter",
    retryFocusRef,
    onDraftPrompt: (text) => {
      drafts.push(text);
      return () => focused++;
    },
    setRetryInstruction: (value) => (cleared = value === ""),
    setRetryMenuOpen: (value) => (closed = !value),
  });
  submit({ preventDefault() {} });
  assert.deepEqual(drafts, ["Change the previous response: Make it shorter"]);
  assert.equal(focused, 0);
  assert.ok(closed && cleared);
  const close = compile(attribute("onCloseAutoFocus", "retryFocusRef"), { retryFocusRef });
  let prevented = false;
  close({
    preventDefault() {
      prevented = true;
    },
  });
  assert.ok(prevented);
  assert.equal(focused, 1);
  assert.equal(retryFocusRef.current, undefined);
});
test("empty response-change instructions do not create a draft or close the menu", () => {
  const submit = compile(attribute("onSubmit", "Change the previous response:"), {
    retryInstruction: " ",
    retryFocusRef: {},
    onDraftPrompt: () => assert.fail("unexpected draft"),
    setRetryInstruction: () => assert.fail("unexpected clear"),
    setRetryMenuOpen: () => assert.fail("unexpected close"),
  });
  submit({ preventDefault() {} });
});
