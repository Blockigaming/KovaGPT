import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { deferred } from "../helpers/ui-state-harness.mjs";
import { readFileSync } from "node:fs";
const source = ts.createSourceFile(
  "prompt.tsx",
  readFileSync(process.env.KOVA_PROMPT_LAUNCH_SOURCE ?? "src/routes/prompt-studio.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let launch, cancel, cleanup;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "launch")
    launch = node.initializer.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "cancelLaunch")
    cancel = node.initializer.getText(source);
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "useEffect" &&
    node.arguments[0].getText(source).includes("mounted.current")
  )
    cleanup = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const compiled = ts.transpileModule("const fn=" + launch, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(read) {
  const effects = [];
  const handoffs = [],
    principalRef = { current: "actor" },
    notices = [];
  const env = {
    mounted: { current: true },
    launchEpoch: { current: 0 },
    launchAbort: { current: null },
    historyAbort: { current: null },
    AbortController,
    dataReady: true,
    dataGeneration: 1,
    generationRef: { current: 1 },
    principalRef,
    principal: "actor",
    isLoaded: true,
    userKey: "actor",
    values: {},
    getPack: (options) => read(options, principalRef),
    writePrincipalHandoff: (...args) => {
      handoffs.push(args.at(-1));
      return { ok: true };
    },
    safeBrowserStorage: () => null,
    update: async () => {
      effects.push("usage");
      return {};
    },
    navigate: () => {
      effects.push("navigate");
    },
    toast: {
      error: (message) => notices.push(message),
      warning: (message) => notices.push(message),
    },
  };
  const run = new Function(...Object.keys(env), compiled + ";return fn;")(...Object.values(env));
  return {
    handoffs,
    effects,
    cancel: cancel
      ? new Function(
          ...Object.keys(env),
          "return (" +
            ts
              .transpileModule(cancel, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
              .outputText.trim()
              .replace(/;$/, "") +
            ");",
        )(...Object.values(env))
      : () => {},
    unmount: cleanup
      ? new Function(...Object.keys(env), "return (" + cleanup + ")();")(...Object.values(env))
      : () => {},
    notices,
    run: () =>
      run({ id: "prompt", body: "Prompt body", variables: [], context_pack_id: "off-page-pack" }),
  };
}
test("prompt launch hydrates its authorized linked pack independently of picker page", async () => {
  const f = fixture(async ({ data }) => {
    assert.equal(data.id, "off-page-pack");
    return { id: data.id, items: [{ content: "real selected pack body" }] };
  });
  await f.run();
  assert.equal(f.handoffs[0].pack.items[0].content, "real selected pack body");
});
test("missing linked pack or changed account prevents incomplete or cross-scope handoff", async () => {
  for (const read of [
    async () => {
      throw Error("Pack unavailable");
    },
    async (_, principal) => {
      principal.current = "other";
      return { id: "off-page-pack" };
    },
  ]) {
    const f = fixture(read);
    await f.run();
    assert.equal(f.handoffs.length, 0);
  }
});

test("Cancel and unmount during linked-pack hydration prevent every later side effect", async () => {
  for (const transition of [(f) => f.cancel(), (f) => f.unmount()]) {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    const run = f.run();
    transition(f);
    pending.resolve({ id: "off-page-pack", items: [] });
    await run;
    assert.equal(f.handoffs.length, 0);
    assert.deepEqual(f.effects, []);
  }
});
test("replacement launch invalidates the older hydration even when transport ignores abort", async () => {
  const pending = [deferred(), deferred()];
  let count = 0;
  const f = fixture(() => pending[count++].promise);
  const older = f.run(),
    newer = f.run();
  pending[1].resolve({ id: "newer", items: [] });
  await newer;
  pending[0].resolve({ id: "older", items: [] });
  await older;
  assert.equal(f.handoffs.length, 1);
  assert.equal(f.handoffs[0].pack.id, "newer");
  assert.deepEqual(f.effects, ["usage", "navigate"]);
});
