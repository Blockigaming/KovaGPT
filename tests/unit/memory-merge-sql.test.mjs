import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const migration = readFileSync(
  "supabase/migrations/20261012022740_atomic_memory_merge.sql",
  "utf8",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.sub',true)::uuid $$;
CREATE TABLE chat_memories(id uuid PRIMARY KEY,user_id uuid,summary text,updated_at timestamptz);
CREATE TABLE project_memory(id uuid PRIMARY KEY,project_id uuid,content text,created_by uuid,created_at timestamptz);
ALTER TABLE chat_memories ENABLE ROW LEVEL SECURITY;ALTER TABLE project_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_chat ON chat_memories FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY read_project ON project_memory FOR SELECT TO authenticated USING(created_by=auth.uid());
CREATE POLICY update_project ON project_memory FOR UPDATE TO authenticated USING(created_by=auth.uid()) WITH CHECK(created_by=auth.uid());
CREATE POLICY delete_project ON project_memory FOR DELETE TO authenticated USING(created_by=auth.uid() AND content<>'undeletable');
GRANT USAGE ON SCHEMA auth,public TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON chat_memories,project_memory TO authenticated;
SELECT set_config('request.jwt.claim.sub','${id(1)}',false);`);
  await db.exec(migration);
  return db;
}
const merge = (db, source, items) =>
  db.query("SELECT public.merge_memory_records($1,$2::jsonb) result", [
    source,
    JSON.stringify(items),
  ]);
test("memory merge rolls back keep update and every deletion when one selected deletion is denied", async () => {
  const db = await setup();
  try {
    for (const [n, content] of [
      [10, "first"],
      [11, "second"],
      [12, "undeletable"],
    ])
      await db.query("INSERT INTO project_memory VALUES($1,$2,$3,$4,now())", [
        id(n),
        id(99),
        content,
        id(1),
      ]);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      merge(
        db,
        "project",
        [10, 11, 12].map((n, i) => ({ id: id(n), content: ["first", "second", "undeletable"][i] })),
      ),
      /rolled back/,
    );
    const rows = (await db.query("SELECT content FROM project_memory ORDER BY id")).rows;
    assert.deepEqual(
      rows.map((row) => row.content),
      ["first", "second", "undeletable"],
    );
  } finally {
    await db.close();
  }
});
test("memory merge rejects stale snapshots and cross-project selection then atomically merges authorized conversation snapshots", async () => {
  const db = await setup();
  try {
    for (const [n, p] of [
      [10, 90],
      [11, 91],
    ])
      await db.query("INSERT INTO project_memory VALUES($1,$2,'text',$3,now())", [
        id(n),
        id(p),
        id(1),
      ]);
    for (const [n, content] of [
      [20, "one"],
      [21, "two"],
      [22, "private"],
    ])
      await db.query("INSERT INTO chat_memories VALUES($1,$2,$3,now())", [
        id(n),
        id(n === 22 ? 2 : 1),
        content,
      ]);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      merge(
        db,
        "project",
        [10, 11].map((n) => ({ id: id(n), content: "text" })),
      ),
      /same project/,
    );
    await assert.rejects(
      merge(db, "conversation", [
        { id: id(20), content: "stale" },
        { id: id(21), content: "two" },
      ]),
      /Memories changed/,
    );
    await assert.rejects(
      merge(db, "conversation", [
        { id: id(20), content: "one" },
        { id: id(22), content: "private" },
      ]),
      /Memories changed/,
    );
    const result = (
      await merge(db, "conversation", [
        { id: id(20), content: "one" },
        { id: id(21), content: "two" },
      ])
    ).rows[0].result;
    assert.equal(result.content, "one\n\ntwo");
    assert.deepEqual(result.removedIds, [id(21)]);
    assert.deepEqual((await db.query("SELECT summary FROM chat_memories")).rows, [
      { summary: "one\n\ntwo" },
    ]);
  } finally {
    await db.close();
  }
});
