import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
const body = {
  version: 1,
  deck: {
    title: "Private arithmetic",
    goal: "Add",
    cards: [
      { question: "2+2?", choices: ["3", "4"], answer: 1, hint: "Pairs", explanation: "Four" },
    ],
  },
  attempts: [],
};
const creationTokens = new WeakMap();
async function fixture() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create schema kova_private;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function kova_private.auth_user_exists(id uuid)returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users u where u.id=$1)$$;create table public.account_deletion_fences(user_id uuid primary key);grant usage on schema public,auth to authenticated;grant execute on function auth.uid()to authenticated;`,
  );
  await db.exec(
    await readFile("supabase/migrations/20260905024500_private_study_progress.sql", "utf8"),
  );
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}'`);
  creationTokens.set(db, new Date(Date.now() - 1000).toISOString());
  return db;
}
const mutate = (
  db,
  revision,
  mutation,
  content = body,
  remove = false,
  creationToken = creationTokens.get(db),
) =>
  db.query("select public.save_study_set($1,$2,$3,$4::jsonb,$5,$6) as row", [
    id,
    revision,
    mutation,
    JSON.stringify(content),
    creationToken,
    remove,
  ]);

test("direct authenticated RPC writes are limited in SQL while exact retries remain idempotent", async () => {
  const db = await fixture();
  try {
    let last;
    for (let revision = 0; revision < 20; revision++) {
      last = crypto.randomUUID();
      await mutate(db, revision, last);
    }
    assert.equal((await mutate(db, 19, last)).rows[0].row.revision, 20);
    await assert.rejects(mutate(db, 20, crypto.randomUUID()), /study_write_limited/);
    await assert.rejects(db.exec("delete from study_write_windows"), /permission denied/);
    await db.exec(
      "reset role;update study_write_windows set window_started_at=now()-interval '61 seconds';set role authenticated",
    );
    assert.equal((await mutate(db, 20, crypto.randomUUID())).rows[0].row.revision, 21);
  } finally {
    await db.close();
  }
});

test("expired tombstones are swept without reviving an old create or deleting a reused identity", async () => {
  const db = await fixture();
  try {
    const oldMutation = crypto.randomUUID(),
      oldToken = new Date(Date.now() - 72 * 3600000).toISOString();
    await mutate(db, 0, oldMutation);
    await mutate(db, 1, crypto.randomUUID(), null, true);
    await db.exec("reset role");
    await db.query(
      "update study_sets set creation_token=$1,deleted_at=now()-interval '25 hours' where id=$2",
      [oldToken, id],
    );
    await db.exec("set role authenticated");
    const secondId = crypto.randomUUID();
    await db.query("select save_study_set($1,0,$2,$3::jsonb,$4,false)", [
      secondId,
      crypto.randomUUID(),
      JSON.stringify(body),
      creationTokens.get(db),
    ]);
    assert.equal((await db.query("select id from study_sets where id=$1", [id])).rows.length, 0);
    await assert.rejects(
      mutate(db, 0, oldMutation, body, false, oldToken),
      /study_creation_expired/,
    );
    assert.notEqual(
      (await mutate(db, 1, crypto.randomUUID(), null, true, oldToken)).rows[0].row.deleted_at,
      null,
    );
    const fresh = await mutate(db, 0, crypto.randomUUID());
    assert.equal(fresh.rows[0].row.revision, 1);
    await assert.rejects(
      mutate(db, 1, crypto.randomUUID(), null, true, oldToken),
      /study_conflict/,
    );
    assert.notEqual(
      (await db.query("select body from study_sets where id=$1", [id])).rows[0].body,
      null,
    );
    // Existing live sets remain editable even when their creation token is old.
    await db.exec("reset role");
    await db.query("update study_sets set creation_token=$1 where id=$2", [oldToken, id]);
    await db.exec("set role authenticated");
    assert.equal(
      (await mutate(db, 1, crypto.randomUUID(), body, false, oldToken)).rows[0].row.revision,
      2,
    );
    // One mutation sweeps at most 500 old tombstones, always for this owner.
    await db.exec("reset role");
    await db.query(
      "insert into study_sets(id,owner_id,creation_token,body,deleted_at,last_mutation_id,last_mutation_hash) select gen_random_uuid(),$1,$2,null,now()-interval '25 hours',gen_random_uuid(),'fixture' from generate_series(1,501)",
      [owner, oldToken],
    );
    await db.query(
      "insert into study_sets(id,owner_id,creation_token,body,deleted_at,last_mutation_id,last_mutation_hash) values(gen_random_uuid(),$1,$2,null,now()-interval '25 hours',gen_random_uuid(),'fixture')",
      [other, oldToken],
    );
    await db.exec("set role authenticated");
    await mutate(db, 2, crypto.randomUUID(), body, false, oldToken);
    assert.equal(
      (await db.query("select count(*)::int n from study_sets where deleted_at is not null"))
        .rows[0].n,
      1,
    );
    await mutate(db, 3, crypto.randomUUID(), body, false, oldToken);
    assert.equal(
      (await db.query("select count(*)::int n from study_sets where deleted_at is not null"))
        .rows[0].n,
      0,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from study_sets where owner_id=$1", [other])).rows[0]
        .n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("owner-scoped Study CAS keeps exact retries and rejects lost updates or changed replay bodies", async () => {
  const db = await fixture();
  try {
    const mutation = crypto.randomUUID();
    const first = (await mutate(db, 0, mutation)).rows[0].row;
    assert.equal(first.revision, 1);
    assert.deepEqual((await mutate(db, 0, mutation)).rows[0].row, first);
    await assert.rejects(
      mutate(db, 0, mutation, { ...body, deck: { ...body.deck, title: "Changed" } }),
      /study_conflict/,
    );
    await mutate(db, 1, crypto.randomUUID());
    await assert.rejects(mutate(db, 1, crypto.randomUUID()), /study_conflict/);
    assert.equal((await db.query("select revision from public.study_sets")).rows[0].revision, 2);
  } finally {
    await db.close();
  }
});
test("another principal cannot read or overwrite a saved practice set", async () => {
  const db = await fixture();
  try {
    await mutate(db, 0, crypto.randomUUID());
    await db.exec(`set request.jwt.claim.sub='${other}'`);
    assert.equal((await db.query("select * from public.study_sets")).rows.length, 0);
    await assert.rejects(mutate(db, 1, crypto.randomUUID()), /study_unavailable/);
    await assert.rejects(db.exec("delete from public.study_sets"), /permission denied/);
  } finally {
    await db.close();
  }
});
test("deletion redacts all study content and blocks resurrection; account deletion cascades replay identity", async () => {
  const db = await fixture();
  try {
    await mutate(db, 0, crypto.randomUUID());
    const mutation = crypto.randomUUID();
    await mutate(db, 1, mutation, null, true);
    assert.equal((await mutate(db, 1, mutation, null, true)).rows[0].row.body, null);
    await assert.rejects(mutate(db, 2, crypto.randomUUID()), /study_conflict/);
    await db.exec(`reset role;delete from auth.users where id='${owner}'`);
    assert.equal((await db.query("select * from public.study_sets")).rows.length, 0);
  } finally {
    await db.close();
  }
});
test("account deletion fence and malformed stored bodies fail before persistence", async () => {
  const db = await fixture();
  try {
    await assert.rejects(mutate(db, 0, crypto.randomUUID(), null), /study_body_bound/);
    await db.exec(
      `reset role;insert into public.account_deletion_fences values('${owner}');set role authenticated`,
    );
    await assert.rejects(mutate(db, 0, crypto.randomUUID()), /study_unavailable/);
    assert.equal((await db.query("select * from public.study_sets")).rows.length, 0);
  } finally {
    await db.close();
  }
});
