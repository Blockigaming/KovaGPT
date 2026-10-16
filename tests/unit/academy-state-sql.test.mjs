import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AcademyBody } from "../../src/lib/academy-state-policy.mjs";
import { PGlite } from "@electric-sql/pglite";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create schema kova_private;create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function kova_private.auth_user_exists(id uuid)returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users u where u.id=$1)$$;create table public.account_deletion_fences(user_id uuid primary key);grant usage on schema public,auth,kova_private to authenticated;`,
  );
  const workflow = await readFile(
    "supabase/migrations/20260910210000_workflow_skill_packages.sql",
    "utf8",
  );
  await db.exec(workflow.slice(0, workflow.indexOf("create table public.workflow_skills")));
  await db.exec(
    await readFile(
      process.env.KOVA_ACADEMY_MIGRATION ??
        "docs/release-proposals/deferred-interface/20261012052309_academy_learning_state.sql",
      "utf8",
    ),
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${A}'`);
  return db;
}
const body = { notes: "Private notes", completed: false, checked: ["Practice"] };
const save = (db, revision, mutation = crypto.randomUUID(), value = body) =>
  db.query("select public.save_academy_learning_state($1,$2,$3,$4::jsonb) as row", [
    "writing",
    revision,
    mutation,
    JSON.stringify(value),
  ]);
test("Academy CAS, retry identity, competing drafts and reversible completion preserve data", async () => {
  const db = await fixture();
  try {
    const id = crypto.randomUUID();
    await save(db, 0, id);
    assert.equal((await save(db, 0, id)).rows[0].row.revision, 1);
    await assert.rejects(save(db, 0, id, { ...body, notes: "changed retry" }), /academy_conflict/);
    const results = await Promise.allSettled([
      save(db, 1, crypto.randomUUID(), { ...body, completed: true }),
      save(db, 1, crypto.randomUUID(), { ...body, notes: "other tab" }),
    ]);
    assert.equal(results.filter((v) => v.status === "fulfilled").length, 1);
    await save(db, 2, crypto.randomUUID(), { ...body, completed: false });
    assert.equal(
      (await db.query("select body from academy_learning_state")).rows[0].body.completed,
      false,
    );
    await assert.rejects(
      save(db, 3, crypto.randomUUID(), { ...body, notes: null }),
      /academy_invalid/,
    );
    assert.equal(
      (await db.query("select revision from academy_learning_state")).rows[0].revision,
      3,
    );
  } finally {
    await db.close();
  }
});
test("Academy owner isolation, direct write denial, anonymous and deletion fence boundaries", async () => {
  const db = await fixture();
  try {
    await save(db, 0);
    await db.exec(`set request.jwt.claim.sub='${B}'`);
    assert.equal((await db.query("select * from academy_learning_state")).rows.length, 0);
    await save(db, 0, crypto.randomUUID(), { ...body, notes: "B only" });
    await assert.rejects(
      db.query("update academy_learning_state set owner_id=$1", [A]),
      /permission denied/,
    );
    await db.exec(
      `reset role;insert into account_deletion_fences values('${B}');set role authenticated`,
    );
    await assert.rejects(save(db, 1), /academy_denied/);
    await db.exec("set role anon");
    await assert.rejects(save(db, 0), /permission denied/);
  } finally {
    await db.close();
  }
});

test("direct Academy RPC and reader agree on compact byte and UTF-16 boundaries", async () => {
  const db = await fixture();
  try {
    let revision = 0;
    const boundary = { notes: "", completed: false, checked: Array(44).fill("x".repeat(2000)) };
    boundary.checked.push(
      "x".repeat(90000 - new TextEncoder().encode(JSON.stringify(boundary)).length - 3),
    );
    assert.equal(new TextEncoder().encode(JSON.stringify(boundary)).length, 90000);
    const cases = [
      [boundary, true],
      [
        { ...boundary, checked: [...boundary.checked.slice(0, -1), boundary.checked.at(-1) + "x"] },
        false,
      ],
      [{ notes: "😀".repeat(10000), completed: false, checked: [] }, true],
      [{ notes: "😀".repeat(10001), completed: false, checked: [] }, false],
      [{ notes: '\\"\n\t café', completed: false, checked: ["😀".repeat(1000)] }, true],
      [{ notes: "", completed: false, checked: ["😀".repeat(1001)] }, false],
    ];
    for (const [value, accepted] of cases) {
      assert.equal(AcademyBody.safeParse(value).success, accepted);
      if (accepted) {
        const result = await save(db, revision, crypto.randomUUID(), value);
        revision++;
        assert.equal(result.rows[0].row.revision, revision);
        assert.ok(AcademyBody.safeParse(result.rows[0].row.body).success);
      } else
        await assert.rejects(save(db, revision, crypto.randomUUID(), value), /academy_invalid/);
    }
  } finally {
    await db.close();
  }
});
