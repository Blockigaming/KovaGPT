import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../../src/routes/index.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let retryCallback;
const visit = (node) => {
  if (
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        p.name.getText(ast) === "label" &&
        p.initializer.getText(ast) === '"Retry"',
    )
  ) {
    retryCallback = node.properties.find(
      (p) => ts.isPropertyAssignment(p) && p.name.getText(ast) === "onClick",
    )?.initializer;
  }
  ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(retryCallback, "Expected the actual Retry toast callback");
const compiled = ts.transpileModule(`globalThis.retry = ${retryCallback.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  let generation = 0;
  const issuedGeneration = generation;
  const calls = [];
  const timers = [];
  const context = {
    isCurrentRequest: () => generation === issuedGeneration,
    activeIdRef: { current: "chat" },
    nextConvId: "chat",
    inFlightRef: { current: false },
    retryTimerRef: { current: null },
    setConversations: () => calls.push("edited"),
    window: {
      setTimeout: (callback) => {
        timers.push(callback);
        return 1;
      },
    },
    send: () => calls.push("sent"),
    text: "temporary prompt",
    atts: [],
    priorMessages: [],
  };
  vm.runInNewContext(compiled, context);
  return {
    context,
    calls,
    timers,
    convert: () => {
      generation += 1;
    },
  };
}

test("an old Retry toast cannot edit a converted temporary chat", () => {
  const f = fixture();
  f.convert();
  f.context.retry();
  assert.deepEqual(f.calls, []);
  assert.equal(f.timers.length, 0);
});

test("conversion also invalidates a retry that was queued immediately before it", () => {
  const f = fixture();
  f.context.retry();
  assert.deepEqual(f.calls, ["edited"]);
  f.convert();
  f.timers[0]();
  assert.deepEqual(f.calls, ["edited"]);
});

test("a current Retry action still executes and conversion advances its generation", () => {
  const f = fixture();
  f.context.retry();
  f.timers[0]();
  assert.deepEqual(f.calls, ["edited", "sent"]);
  const conversion = source.slice(
    source.indexOf("const saveTemporaryChat"),
    source.indexOf("const openCommandPalette"),
  );
  assert.match(
    conversion,
    /retryGenerationRef\.current \+= 1;\s+setConversations\(nextConversations\)/,
  );
  assert.match(source, /requestRetryGeneration === retryGenerationRef\.current/);
});
