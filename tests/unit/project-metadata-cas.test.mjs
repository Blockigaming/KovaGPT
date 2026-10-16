import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
function boundary(path, name) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  let handler, validator;
  function visit(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === name) {
      handler = n.initializer.arguments[0].getText(source);
      validator = n.initializer.expression.expression.arguments[0].getText(source);
    }
    ts.forEachChild(n, visit);
  }
  visit(source);
  const compile = (body) =>
    ts.transpileModule(`const value=${body}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText + ";return value;";
  return {
    handler: new Function("console", "logActivity", compile(handler))(
      { error() {} },
      async () => {},
    ),
    validate: new Function("z", compile(validator))(z),
  };
}
const update = boundary("src/lib/projects.functions.ts", "updateProject").handler;
for (const [name, path, flag] of [
  ["pinProject", "src/lib/projects.functions.ts", "pinned"],
  ["setProjectArchived", "src/lib/project-workspace.functions.ts", "archived"],
]) {
  const metadata = boundary(path, name);
  test(`${name}: concurrent content update cannot give stale content a fresh revision`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE projects(id text PRIMARY KEY,owner_id text,name text,system_prompt text,pinned_at timestamptz,archived_at timestamptz,updated_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00.123456Z');
    CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now();RETURN NEW;END $$;
    CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();`);
      await db.exec(
        readFileSync("supabase/migrations/20261012013252_project_monotonic_revision.sql", "utf8"),
      );
      const adapter = {
        from(table) {
          assert.equal(table, "projects");
          let values;
          const predicates = [];
          let columns;
          const query = {
            update(v) {
              values = v;
              return query;
            },
            eq(k, v) {
              assert.ok(["id", "owner_id", "updated_at"].includes(k));
              predicates.push([k, v]);
              return query;
            },
            select(v) {
              columns = v;
              return query;
            },
            async maybeSingle() {
              const params = Object.values(values);
              const set = Object.keys(values)
                .map((k, i) => {
                  assert.ok(["name", "system_prompt", "pinned_at", "archived_at"].includes(k));
                  return `${k}=$${i + 1}`;
                })
                .join(",");
              const where = predicates
                .map(([k, v]) => {
                  params.push(v);
                  return `${k}=$${params.length}${k === "updated_at" ? "::timestamptz" : ""}`;
                })
                .join(" AND ");
              const fields = columns
                .split(",")
                .map((k) => k.trim())
                .map((k) =>
                  k === "updated_at"
                    ? `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`
                    : k,
                )
                .join(",");
              const result = await db.query(
                `UPDATE projects SET ${set} WHERE ${where} RETURNING ${fields}`,
                params,
              );
              return { data: result.rows[0] ?? null, error: null };
            },
          };
          return query;
        },
      };
      const context = { userId: "actor", supabase: adapter };
      const r0 = "2026-01-01T00:00:00.123456Z";
      for (const field of ["system_prompt", "name"]) {
        const id = field;
        await db.query(
          "INSERT INTO projects(id,owner_id,name,system_prompt) VALUES ($1,'actor','p0','p0')",
          [id],
        );
        // Session B saves after session A captured p0/r0.
        const b = await update({ context, data: { id, expectedUpdatedAt: r0, [field]: "p1" } });
        await assert.rejects(
          metadata.handler({ context, data: { id, expectedUpdatedAt: r0, [flag]: true } }),
          /changed|permission|not found/,
        );
        // Reusing A's old snapshot is still rejected. No r2 was attached to p0.
        await assert.rejects(
          update({ context, data: { id, expectedUpdatedAt: r0, [field]: "stale p0 edit" } }),
          /Project changed/,
        );
        assert.equal(
          (await db.query(`SELECT ${field} FROM projects WHERE id=$1`, [id])).rows[0][field],
          "p1",
        );
        // After an actual refreshed p1/r1 snapshot, metadata and a subsequent edit work.
        const ack = await metadata.handler({
          context,
          data: { id, expectedUpdatedAt: b.updatedAt, [flag]: true },
        });
        const saved = await update({
          context,
          data: { id, expectedUpdatedAt: ack.updatedAt, [field]: "edited p1" },
        });
        assert.ok(saved.ok);
        assert.notEqual(saved.updatedAt, ack.updatedAt);
      }
    } finally {
      await db.close();
    }
  });
  test(`${name} requires an exact revision token from the caller`, () => {
    const base = { id: "00000000-0000-4000-8000-000000000001", [flag]: true };
    assert.throws(() => metadata.validate(base));
    const token = "2026-10-12T00:00:00.123456Z";
    assert.equal(metadata.validate({ ...base, expectedUpdatedAt: token }).expectedUpdatedAt, token);
  });
}
