import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync("src/routes/index.tsx", "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let retry;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onRetry")
    retry = node.initializer.expression.whenTrue.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
function callback(tool) {
  const sent = [];
  const dependencies = {
    nextPromptMountedRef: { current: true },
    sameNextPromptScope: () => true,
    nextPromptScope: {},
    nextPromptScopeRef: { current: {} },
    active: {
      id: "chat",
      messages: [
        { role: "user", content: "Find news" },
        { role: "assistant", content: "News" },
      ],
    },
    send: (...args) => sent.push(args),
    priorUser: { id: "prompt", content: "Find news", attachments: [] },
    pendingMessageAttachments: () => [],
    m: { requestedTool: tool },
    storagePrincipal: "owner",
  };
  const compiled = ts.transpileModule(`return (${retry});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  return { run, sent };
}
test("Don't search the web clears an explicit search tool and disables search only for this request", () => {
  const f = callback("web_search");
  f.run({ webSearch: false });
  assert.equal(f.sent[0][2], null);
  assert.equal(f.sent[0][10], false);
});
test("ordinary retry preserves the response's chosen tool", () => {
  for (const tool of ["web_search", "image", undefined]) {
    const f = callback(tool);
    f.run();
    assert.equal(f.sent[0][2], tool ?? null);
    assert.equal(f.sent[0][10], undefined);
  }
});
