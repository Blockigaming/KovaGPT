import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { z } from "zod";
import { parseCustomRulesInput, parseChatId } from "../../src/lib/chat-workspace-contract.mjs";
const migration = readFileSync(
  "supabase/migrations/20261012022135_chat_rules_revision_boundary.sql",
  "utf8",
);
const legacy = readFileSync(
  "supabase/migrations/20260904230332_canonical_chat_workspace_lineage_reconciliation.sql",
  "utf8",
).match(/create or replace function public\.save_chat_custom_rules\([\s\S]*?\n\$\$;/)[0];
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub',true)::uuid $$;
CREATE TABLE public.chat_custom_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,chat_id text NOT NULL,instructions text NOT NULL,enabled boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(owner_id,chat_id));
ALTER TABLE chat_custom_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rules ON chat_custom_rules FOR ALL TO authenticated USING(owner_id=auth.uid()) WITH CHECK(owner_id=auth.uid());
GRANT USAGE ON SCHEMA auth,public TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON chat_custom_rules TO authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);`);
  return db;
}
async function save(db, revision, text, operation = "save") {
  return (
    await db.query(
      "SELECT r.*,r.updated_at::text AS revision FROM public.compare_and_save_chat_rules($1,$2,$3,$4,true) r",
      ["chat-a", revision, operation, text],
    )
  ).rows[0];
}
test("real legacy SQL permits reverse-completion overwrite; revision SQL rejects stale save and clear", async () => {
  const db = await setup();
  try {
    await db.exec(legacy);
    await db.query("SELECT public.save_chat_custom_rules('chat-a','Newer',true)");
    await db.query("SELECT public.save_chat_custom_rules('chat-a','Older delayed',true)");
    assert.equal(
      (await db.query("SELECT instructions FROM chat_custom_rules")).rows[0].instructions,
      "Older delayed",
    );
    await db.exec(migration);
    await db.exec("SET ROLE authenticated");
    const original = (await db.query("SELECT updated_at::text revision FROM chat_custom_rules"))
      .rows[0].revision;
    const newer = await save(db, original, "Newer saved first");
    await assert.rejects(save(db, original, "Older delayed"), /Rules changed/);
    await assert.rejects(save(db, original, "", "clear"), /Rules changed/);
    assert.equal(
      (await db.query("SELECT instructions FROM chat_custom_rules")).rows[0].instructions,
      "Newer saved first",
    );
    const cleared = await save(db, newer.revision, "", "clear");
    assert.equal(cleared.instructions, "");
    assert.notEqual(cleared.revision, newer.revision);
    await assert.rejects(save(db, null, "Old absent-record save"), /Rules changed/);
    await db.query(
      "SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false)",
    );
    await assert.rejects(save(db, cleared.revision, "Other actor"), /Rules changed/);
    const other = await save(db, null, "Other actor own rules");
    assert.equal(other.owner_id, "00000000-0000-4000-8000-000000000002");
  } finally {
    await db.close();
  }
});
test("new rules preserve explicit absent revision and advance even within one transaction", async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await db.exec("BEGIN");
    const one = await save(db, null, "First");
    const two = await save(db, one.revision, "Second");
    assert.notEqual(one.revision, two.revision);
    await assert.rejects(save(db, one.revision, "Stale"), /Rules changed/);
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});
const path = "src/lib/chat-workspace.functions.ts";
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
const helper = source.statements
  .find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "mutateRulesWithRevision")
  .getText(source);
const revision = source.statements
  .find(
    (n) =>
      ts.isVariableStatement(n) &&
      n.declarationList.declarations.some((d) => d.name.getText(source) === "RulesRevision"),
  )
  .getText(source);
const compile = (body) =>
  ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const name of ["saveChatCustomRules", "resetChatCustomRules", "setChatCustomRulesEnabled"]) {
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((n) => [...n.declarationList.declarations])
    .find((n) => n.name.getText(source) === name);
  const validator = declaration.initializer.expression.expression.arguments[0].getText(source);
  const parse = new Function(
    "z",
    "parseCustomRulesInput",
    "parseChatId",
    compile(revision + "\nconst parse=" + validator) + ";return parse;",
  )(z, parseCustomRulesInput, parseChatId);
  test(`${name} requires an explicit nullable captured revision`, () => {
    assert.throws(() => parse({ chatId: "chat-a" }));
    assert.equal(parse({ chatId: "chat-a", expectedUpdatedAt: null }).expectedUpdatedAt, null);
  });
}
test("server helper forwards revision and refuses missing RPC or uncertain acknowledgement without fallback", async () => {
  const run = new Function("loose", compile(helper) + ";return mutateRulesWithRevision;")(
    (client) => client,
  );
  for (const outcome of [
    { data: null, error: { code: "42883" } },
    { data: null, error: null },
    { data: null, error: { code: "40001" } },
  ]) {
    let calls = 0;
    const client = {
      rpc: async (name, args) => {
        calls++;
        assert.equal(name, "compare_and_save_chat_rules");
        assert.equal(args.p_expected_updated_at, "2026-10-12T00:00:00.000001Z");
        return outcome;
      },
    };
    await assert.rejects(
      run(client, {
        chatId: "chat-a",
        expectedUpdatedAt: "2026-10-12T00:00:00.000001Z",
        operation: "save",
        instructions: "Draft",
      }),
      /Review/,
    );
    assert.equal(calls, 1);
  }
});
