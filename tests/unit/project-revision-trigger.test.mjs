import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const original = readFileSync(
  "supabase/migrations/20260625132920_4b3ef37f-c0ab-4cf4-9255-d61a0848f198.sql",
  "utf8",
).match(/CREATE OR REPLACE FUNCTION public.touch_updated_at\(\)[\s\S]*?END \$\$;/)[0];
const proposal = readFileSync(
  "supabase/migrations/20261012013252_project_monotonic_revision.sql",
  "utf8",
);
const tokenSql = `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS token`;
async function setup(db) {
  await db.exec(`CREATE TABLE projects (id int PRIMARY KEY, updated_at timestamptz NOT NULL DEFAULT now(), name text); ${original}
  CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();`);
}
test("reproduction: original now() trigger preserves the CAS token within one transaction", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await db.exec("BEGIN; INSERT INTO projects(id,name) VALUES (1,'initial');");
    const first = (await db.query(`SELECT ${tokenSql} FROM projects`)).rows[0].token;
    const result = await db.query(
      `UPDATE projects SET name='first' WHERE updated_at=$1::timestamptz RETURNING ${tokenSql}`,
      [first],
    );
    assert.equal(result.rows[0].token, first);
    const stale = await db.query(
      "UPDATE projects SET name='stale' WHERE updated_at=$1::timestamptz RETURNING id",
      [first],
    );
    assert.equal(stale.rows.length, 1);
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});
test("unapplied proposal advances every revision, including repeated and future-dated updates", async () => {
  const db = new PGlite();
  try {
    await setup(db);
    await db.exec(proposal);
    await db.exec(
      "BEGIN; INSERT INTO projects(id,name,updated_at) VALUES (1,'initial','2099-01-01T00:00:00.123456Z');",
    );
    let previous = (await db.query(`SELECT ${tokenSql} FROM projects`)).rows[0].token;
    const seen = new Set([previous]);
    for (let i = 0; i < 8; i++) {
      const result = await db.query(
        `UPDATE projects SET name=$1 WHERE updated_at=$2::timestamptz RETURNING ${tokenSql}`,
        [String(i), previous],
      );
      const next = result.rows[0].token;
      assert.ok(next > previous);
      assert.equal(seen.has(next), false);
      assert.equal(
        (
          await db.query(
            "UPDATE projects SET name='stale' WHERE updated_at=$1::timestamptz RETURNING id",
            [previous],
          )
        ).rows.length,
        0,
      );
      seen.add(next);
      previous = next;
    }
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});
