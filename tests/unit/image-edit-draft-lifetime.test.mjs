import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/components/ChatInput.tsx", "utf8");
const ast = ts.createSourceFile(
  "ChatInput.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let effect;
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === "useEffect" &&
    node.arguments[0]
      ?.getText(ast)
      .includes('window.addEventListener("kova:prepare-chat-image-attachment", prepare)')
  )
    effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect);
const code = ts.transpileModule(`return (${effect})();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  let prepare, attach, resolveUpload;
  const container = {},
    changes = [],
    notices = [];
  const context = { current: {} },
    scope = { current: {} },
    state = { current: { value: "Original draft" } };
  const upload = new Promise((resolve) => {
    resolveUpload = resolve;
  });
  const cleanup = new Function(
    "window",
    "ref",
    "attachmentContextRef",
    "attachmentScopeRef",
    "externalImageFiles",
    "externalImageChange",
    "composerStateRef",
    "toast",
    "document",
    code,
  )(
    {
      addEventListener: (_, fn) => {
        prepare = fn;
      },
      removeEventListener() {},
    },
    { current: { closest: () => container } },
    context,
    scope,
    { current: () => upload },
    { current: (value) => changes.push(value) },
    state,
    { success: (value) => notices.push(value) },
    { activeElement: { closest: () => null }, body: {} },
  );
  prepare({
    target: container,
    detail: {
      accept: (fn) => {
        attach = fn;
      },
    },
  });
  return {
    attach,
    context,
    scope,
    state,
    changes,
    notices,
    cleanup,
    finish: (accepted = true) => resolveUpload(accepted),
  };
}
test("image instructions append to the latest draft only after attachment acceptance", async () => {
  const f = fixture();
  const pending = f.attach({}, () => true, "  Edit the background  ");
  f.state.current.value = "Text typed during upload";
  f.finish();
  await pending;
  assert.deepEqual(f.changes, ["Text typed during upload\nEdit the background"]);
  assert.equal(f.notices.length, 1);
  f.cleanup();
});
for (const interruption of ["owner", "chat", "unmount", "caller cancellation"]) {
  test(`image instructions cannot cross ${interruption}`, async () => {
    const f = fixture();
    let allowed = true;
    const pending = f.attach({}, () => allowed, "Private instructions");
    if (interruption === "owner") f.context.current = {};
    if (interruption === "chat") f.scope.current = {};
    if (interruption === "unmount") f.cleanup();
    if (interruption === "caller cancellation") allowed = false;
    f.finish();
    await assert.rejects(pending, { name: "AbortError" });
    assert.deepEqual(f.changes, []);
    assert.deepEqual(f.notices, []);
    assert.equal(f.state.current.value, "Original draft");
    f.cleanup();
  });
}

test("a rejected attachment cannot consume its editing instructions", async () => {
  const f = fixture();
  const pending = f.attach({}, () => true, "Keep these instructions");
  f.finish(false);
  await assert.rejects(pending, /could not be added/);
  assert.deepEqual(f.changes, []);
  assert.deepEqual(f.notices, []);
  f.cleanup();
});
