import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

const source = ts.createSourceFile(
  "projects.functions.ts",
  readFileSync("src/lib/projects.functions.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let handlerSource;
let validatorSource;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "updateProject") {
    handlerSource = node.initializer.arguments[0].getText(source);
    validatorSource = node.initializer.expression.expression.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handlerSource);
const compiled = ts.transpileModule(`const handler = ${handlerSource}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const handler = new Function("console", `${compiled}; return handler;`)({ error: () => {} });

// An isolated PostgreSQL query exercises zero-row RLS results. This is not
// deployment, PostgREST, or two-user live integration acceptance.
test("project update acknowledges an actual row and rejects missing or RLS-hidden targets", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE project_editor;
      CREATE TABLE projects(id text PRIMARY KEY, owner_id text NOT NULL, system_prompt text, updated_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00.123456Z');
      CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
      CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
      INSERT INTO projects(id,owner_id,system_prompt) VALUES ('own-project', 'actor', 'original'), ('private-project', 'other', 'private');
      ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
      GRANT SELECT, UPDATE ON projects TO project_editor;
      CREATE POLICY own_projects ON projects TO project_editor USING (owner_id = 'actor') WITH CHECK (owner_id = 'actor');
      SET ROLE project_editor;
    `);
    const adapter = {
      from(table) {
        assert.equal(table, "projects");
        let values, id, revision;
        const query = {
          update(value) {
            values = value;
            return query;
          },
          eq(column, value) {
            if (column === "id") id = value;
            else {
              assert.equal(column, "updated_at");
              revision = value;
            }
            return query;
          },
          select(columns) {
            assert.equal(columns, "id, updated_at");
            return query;
          },
          async maybeSingle() {
            const result = await database.query(
              "UPDATE projects SET system_prompt = $1 WHERE id = $2 AND updated_at = $3::timestamptz RETURNING id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated_at",
              [values.system_prompt, id, revision],
            );
            return { data: result.rows[0] ?? null, error: null };
          },
        };
        return query;
      },
    };
    const initial = "2026-01-01T00:00:00.123456Z";
    const save = (id, content = "edited", expectedUpdatedAt = initial) =>
      handler({
        data: { id, system_prompt: content, expectedUpdatedAt },
        context: { supabase: adapter },
      });
    const competing = await Promise.allSettled([
      save("own-project", "winner-one"),
      save("own-project", "winner-two"),
    ]);
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(competing.filter((r) => r.status === "rejected").length, 1);
    const winner = competing.find((r) => r.status === "fulfilled").value;
    assert.equal(winner.ok, true);
    assert.notEqual(winner.updatedAt, initial);
    await assert.rejects(save("own-project", "stale retry"), /Project changed/);
    const edited = await save("own-project", "edited", winner.updatedAt);
    assert.equal(edited.ok, true);
    for (const id of ["missing-project", "private-project"])
      await assert.rejects(save(id), /Project changed|editable/);
    await database.exec("RESET ROLE");
    assert.deepEqual(
      (await database.query("SELECT id, system_prompt FROM projects ORDER BY id")).rows,
      [
        { id: "own-project", system_prompt: "edited" },
        { id: "private-project", system_prompt: "private" },
      ],
    );
  } finally {
    await database.close();
  }
});

test("an error or unexpected returned identity cannot become a success acknowledgement", async () => {
  for (const result of [
    { data: null, error: { message: "unavailable" } },
    { data: { id: "wrong-id" }, error: null },
  ]) {
    const query = {
      update: () => query,
      eq: () => query,
      select: () => query,
      maybeSingle: async () => result,
    };
    await assert.rejects(
      handler({
        data: { id: "requested", name: "New title", expectedUpdatedAt: "2026-01-01T00:00:00Z" },
        context: { supabase: { from: () => query } },
      }),
    );
  }
});

test("project writes require the exact timestamp token without reducing its precision", async () => {
  const { z } = await import("zod");
  const compiledValidator = ts.transpileModule(`const validator = ${validatorSource}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const validate = new Function("z", `${compiledValidator}; return validator;`)(z);
  const id = "00000000-0000-4000-8000-000000000001";
  assert.throws(() => validate({ id, system_prompt: "new" }));
  assert.throws(() => validate({ id, expectedUpdatedAt: "invalid", system_prompt: "new" }));
  const token = "2026-01-01T00:00:00.123456Z";
  assert.equal(
    validate({ id, expectedUpdatedAt: token, system_prompt: "new" }).expectedUpdatedAt,
    token,
  );
});
