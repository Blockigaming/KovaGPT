import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const migration = readFileSync(
  "supabase/migrations/20261012021000_project_atomic_capacity.sql",
  "utf8",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE public.test_plans(owner_id uuid PRIMARY KEY,tier text);
 CREATE FUNCTION public.effective_user_plan_tier(who uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT tier FROM public.test_plans WHERE owner_id=who $$;
 CREATE TABLE public.projects(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES auth.users(id),archived_at timestamptz,name text,updated_at timestamptz DEFAULT now());`);
  for (const [n, tier] of [
    [1, "free"],
    [2, "plus"],
    [3, "pro"],
    [4, null],
  ]) {
    await db.query("INSERT INTO auth.users VALUES ($1)", [id(n)]);
    await db.query("INSERT INTO test_plans VALUES ($1,$2)", [id(n), tier]);
  }
  return db;
}
const insert = (db, n, owner = 1, archived = null) =>
  db.query("INSERT INTO projects(id,owner_id,archived_at) VALUES ($1,$2,$3)", [
    id(n),
    id(owner),
    archived,
  ]);
test("unapplied base permits two stale quota approvals; capacity trigger rejects the second activation", async () => {
  const db = await setup();
  try {
    await insert(db, 10);
    await insert(db, 11);
    // Two callers both observe 2/3 before either sends its insert.
    assert.equal((await db.query("SELECT count(*)::int n FROM projects")).rows[0].n, 2);
    await insert(db, 12);
    await insert(db, 13);
    assert.equal((await db.query("SELECT count(*)::int n FROM projects")).rows[0].n, 4);
    await db.exec("DELETE FROM projects WHERE id IN ('" + id(12) + "','" + id(13) + "')");
    await db.exec(migration);
    await insert(db, 12);
    await assert.rejects(insert(db, 13), /active project limit/);
    assert.equal((await db.query("SELECT count(*)::int n FROM projects")).rows[0].n, 3);
    await insert(db, 14, 1, "2026-10-12T00:00:00Z");
    await assert.rejects(
      db.query("UPDATE projects SET archived_at=NULL WHERE id=$1", [id(14)]),
      /active project limit/,
    );
    await db.query("UPDATE projects SET archived_at=now() WHERE id=$1", [id(12)]);
    await db.query("UPDATE projects SET archived_at=NULL WHERE id=$1", [id(14)]);
    await db.query("UPDATE projects SET name='Allowed edit' WHERE id=$1", [id(14)]);
  } finally {
    await db.close();
  }
});
test("capacity uses existing effective plan tiers, checks owner transfer, fails closed on unknown tier", async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    for (const [owner, cap] of [
      [1, 3],
      [2, 25],
      [3, 200],
    ]) {
      for (let i = 0; i < cap; i++) await insert(db, owner * 1000 + i, owner);
      await assert.rejects(insert(db, owner * 1000 + cap, owner), /active project limit/);
    }
    await assert.rejects(insert(db, 4000, 4), /could not be verified/);
    await assert.rejects(
      db.query("UPDATE projects SET owner_id=$1 WHERE id=$2", [id(1), id(2000)]),
      /active project limit/,
    );
    await db.query("UPDATE projects SET archived_at=now() WHERE id=$1", [id(1000)]);
    await db.query("UPDATE projects SET owner_id=$1 WHERE id=$2", [id(1), id(2000)]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM projects WHERE owner_id=$1 AND archived_at IS NULL",
          [id(1)],
        )
      ).rows[0].n,
      3,
    );
  } finally {
    await db.close();
  }
});
test("migration preserves over-cap existing projects and denies direct access to capacity guard", async () => {
  const db = await setup();
  try {
    for (let i = 0; i < 4; i++) await insert(db, 100 + i);
    await db.exec(migration);
    await db.query("UPDATE projects SET name='Preserved' WHERE id=$1", [id(100)]);
    assert.equal((await db.query("SELECT count(*)::int n FROM projects")).rows[0].n, 4);
    await assert.rejects(insert(db, 110), /active project limit/);
    await db.exec(
      "GRANT USAGE ON SCHEMA public TO authenticated; GRANT INSERT ON public.projects TO authenticated; SET ROLE authenticated;",
    );
    await assert.rejects(insert(db, 111), /active project limit/);
    await insert(db, 112, 2);
    await assert.rejects(db.query("SELECT * FROM project_capacity_guards"), /permission denied/);
    await db.exec("RESET ROLE");
    for (const role of ["anon", "authenticated", "service_role"]) {
      const row = (
        await db.query(
          "SELECT has_table_privilege($1,'public.project_capacity_guards','SELECT') r,has_table_privilege($1,'public.project_capacity_guards','INSERT') w,has_function_privilege($1,'public.enforce_project_capacity()','EXECUTE') x",
          [role],
        )
      ).rows[0];
      assert.deepEqual(row, { r: false, w: false, x: false });
    }
  } finally {
    await db.close();
  }
});
