import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const { PROJECT_CHAT_DELETE_UNAVAILABLE } = loadUiModule("src/lib/project-chat-deletion.ts", {});
const source = readFileSync("src/lib/projects.functions.ts", "utf8");
const file = ts.createSourceFile("projects.functions.ts", source, ts.ScriptTarget.Latest, true);
const declaration = file.statements.find(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(
      (item) => item.name.getText(file) === "deleteProjectChat",
    ),
);
assert.ok(declaration);
const fragment = declaration.getText(file);
const javascript = ts.transpileModule(
  fragment.replace(/^export\s+/, "") + "\nreturn deleteProjectChat;",
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  },
).outputText;

function fixture() {
  let validator, handler;
  const requiredAuth = Symbol("required authentication");
  const config = {};
  const builder = {
    middleware(values) {
      config.middleware = values;
      return this;
    },
    validator(fn) {
      validator = fn;
      return this;
    },
    handler(fn) {
      handler = fn;
      return fn;
    },
  };
  new Function(
    "createServerFn",
    "requireSupabaseAuth",
    "z",
    "PROJECT_CHAT_DELETE_UNAVAILABLE",
    javascript,
  )(
    (options) => {
      config.options = options;
      return builder;
    },
    requiredAuth,
    z,
    PROJECT_CHAT_DELETE_UNAVAILABLE,
  );
  return { validator, handler, config, requiredAuth };
}

test("project chat deletion retains POST, authenticated middleware and UUID input validation", () => {
  const f = fixture();
  assert.equal(f.config.options.method, "POST");
  assert.deepEqual(f.config.middleware, [f.requiredAuth]);
  assert.equal(
    f.validator({ id: "11111111-1111-4111-8111-111111111111" }).id,
    "11111111-1111-4111-8111-111111111111",
  );
  assert.throws(() => f.validator({ id: "invalid" }));
});

for (const role of ["owner", "editor", "viewer"]) {
  test(`project chat deletion fails closed for ${role} before any database access`, async () => {
    const f = fixture();
    const accesses = [];
    const supabase = new Proxy(
      {},
      {
        get(_target, key) {
          accesses.push(key);
          throw new Error("Database access must not occur");
        },
      },
    );
    await assert.rejects(
      f.handler({
        data: { id: "11111111-1111-4111-8111-111111111111" },
        context: { supabase, userId: "synthetic-user", role },
      }),
      (error) => error.message === PROJECT_CHAT_DELETE_UNAVAILABLE,
    );
    assert.deepEqual(accesses, []);
  });
}

test("unavailable deletion neither hard-deletes nor invents local recovery for server project records", () => {
  assert.doesNotMatch(
    fragment,
    /\.delete\(|\.from\(|\.rpc\(|writeChatTrash|moveChatToTrash|localStorage/,
  );
  assert.match(fragment, /throw new Error\(PROJECT_CHAT_DELETE_UNAVAILABLE\)/);
  assert.match(PROJECT_CHAT_DELETE_UNAVAILABLE, /recoverable Trash.*unchanged/);
});
