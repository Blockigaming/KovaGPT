import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = ts.createSourceFile(
  "usage.ts",
  readFileSync("src/utils/usage.functions.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let handler;
function visit(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(source) === "getMyDailyUsage")
    handler = n.initializer.arguments[0].getText(source);
  ts.forEachChild(n, visit);
}
visit(source);
const js = ts.transpileModule(`const handler=${handler}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const run = new Function("console", js + ";return handler;")({ error() {} });
function context(result) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => result };
  return { context: { userId: "actor", supabase: { from: () => query } } };
}
test("daily usage storage failure is unavailable, never a fabricated zero balance", async () => {
  await assert.rejects(
    run(context({ data: null, error: { message: "private detail" } })),
    /Usage could not be loaded/,
  );
});
test("successful missing usage record is distinct from failure and returns genuine zero", async () => {
  const result = await run(context({ data: null, error: null }));
  assert.equal(result.chats, 0);
  assert.equal(result.images, 0);
  assert.equal(result.uploads, 0);
});
