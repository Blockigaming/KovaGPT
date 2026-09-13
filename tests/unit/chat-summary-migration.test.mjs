import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  "supabase/migrations/20260904233022_durable_chat_context_summaries.sql",
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const chat = "33333333-3333-4333-8333-333333333333";
const transcript = Array.from({ length: 4 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  content: `Turn ${index}`,
}));

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema kova_private;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade);
    grant all on public.account_deletion_fences to service_role; grant usage on schema kova_private to service_role;`);
  await db.exec(
    await readFile(
      "supabase/migrations/20260624230040_7e466bca-9fb0-476f-8779-2788bec60e53.sql",
      "utf8",
    ),
  );
  await db.exec(migration);
  return db;
}
async function admission(db, user = owner) {
  return (await db.query("select public.begin_chat_memory_write($1) epoch", [user])).rows[0].epoch;
}
async function enqueue(db, digest = "a".repeat(64), user = owner, epoch = undefined) {
  epoch ??= await admission(db, user);
  return (
    await db.query("select public.queue_chat_context_summary($1,$2,$3,0,4,$4,$5::jsonb) value", [
      user,
      epoch,
      chat,
      digest,
      JSON.stringify(transcript),
    ])
  ).rows[0].value;
}
async function claim(db) {
  return (await db.query("select * from public.claim_chat_context_summaries(2)")).rows[0];
}
async function settle(db, job, summary = "A completed summary") {
  return (
    await db.query("select public.settle_chat_context_summary($1,$2,$3,$4) value", [
      job.id,
      job.requested_revision,
      job.lease_token,
      summary,
    ])
  ).rows[0].value;
}

test("a superseded summary lease cannot overwrite a newer request, and completion clears raw input", async () => {
  const db = await fixture();
  try {
    await enqueue(db);
    const first = await claim(db);
    await enqueue(db, "b".repeat(64));
    const second = await claim(db);
    assert.equal(await settle(db, first), false);
    assert.equal(await settle(db, second), true);
    const row = (await db.query("select * from public.chat_context_summaries")).rows[0];
    assert.equal(row.completed_digest, "b".repeat(64));
    assert.deepEqual(row.input_messages, []);
    assert.equal(row.status, "completed");
    const duplicate = await enqueue(db, "b".repeat(64));
    assert.equal(duplicate.completed_summary, "A completed summary");
    assert.equal(await claim(db), undefined);
  } finally {
    await db.close();
  }
});

test("deletion and recreation cannot be reversed by an old worker or account cascade", async () => {
  const db = await fixture();
  try {
    await enqueue(db);
    const first = await claim(db);
    await db.query("delete from public.chat_context_summaries where user_id=$1", [owner]);
    await enqueue(db);
    const replacement = await claim(db);
    assert.notEqual(replacement.id, first.id);
    assert.equal(await settle(db, first), false);
    await db.query("delete from auth.users where id=$1", [owner]);
    assert.equal(await settle(db, replacement), false);
    assert.equal(
      (await db.query("select count(*)::int count from public.chat_context_summaries")).rows[0]
        .count,
      0,
    );
  } finally {
    await db.close();
  }
});

test("worker failure and abandoned leases exhaust a bounded retry budget and clear expired raw input", async () => {
  const db = await fixture();
  try {
    await enqueue(db);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const job = await claim(db);
      assert.equal(job.attempts, attempt);
      assert.equal(await settle(db, job, null), true);
      await db.exec(
        "update public.chat_context_summaries set next_attempt_at=now()-interval '1 minute'",
      );
    }
    assert.equal(await claim(db), undefined);
    let row = (await db.query("select * from public.chat_context_summaries")).rows[0];
    assert.equal(row.status, "failed");
    assert.deepEqual(row.input_messages, []);
    await enqueue(db, "b".repeat(64));
    await claim(db);
    await db.exec(
      "update public.chat_context_summaries set input_expires_at=now()-interval '1 second'",
    );
    assert.equal(await claim(db), undefined);
    await db.query("select public.purge_expired_chat_context_inputs()");
    row = (await db.query("select * from public.chat_context_summaries")).rows[0];
    assert.equal(row.status, "failed");
    assert.deepEqual(row.input_messages, []);
  } finally {
    await db.close();
  }
});

test("owners can inspect only their summaries and cannot mutate or invoke privileged RPCs", async () => {
  const db = await fixture();
  try {
    await enqueue(db);
    await enqueue(db, "b".repeat(64), other);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    const rows = (await db.query("select user_id from public.chat_context_summaries")).rows;
    assert.deepEqual(rows, [{ user_id: owner }]);
    await assert.rejects(enqueue(db), /permission denied/);
    await assert.rejects(db.exec("delete from public.chat_context_summaries"), /permission denied/);
  } finally {
    await db.close();
  }
});

test("admission enforces the per-owner pending bound without displacing existing work", async () => {
  const db = await fixture();
  try {
    for (let index = 0; index < 9; index++) {
      const chatId = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
      const result = (
        await db.query(
          "select public.queue_chat_context_summary($1,$2,$3,0,4,$4,$5::jsonb) value",
          [owner, await admission(db), chatId, "a".repeat(64), JSON.stringify(transcript)],
        )
      ).rows[0].value;
      assert.equal(Boolean(result), index < 8);
    }
    assert.equal(
      (await db.query("select count(*)::int count from public.chat_context_summaries")).rows[0]
        .count,
      8,
    );
  } finally {
    await db.close();
  }
});

test("privacy deletion fences admitted writes on other devices and clears both stores atomically", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    const before = await admission(db);
    await enqueue(db, "a".repeat(64), owner, before);
    const claimed = await claim(db);
    const persist = (epoch) =>
      db.query("select public.persist_chat_memory($1,$2,$3,'Chat','Facts',4) value", [
        owner,
        epoch,
        chat,
      ]);
    assert.equal((await persist(before)).rows[0].value, true);
    await db.query("select public.delete_chat_memory($1,$2)", [owner, chat]);
    assert.equal(await enqueue(db, "b".repeat(64), owner, before), null);
    assert.equal((await persist(before)).rows[0].value, false);
    assert.equal(await settle(db, claimed), false);
    assert.equal(
      (await db.query("select count(*)::int count from public.chat_memories")).rows[0].count,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int count from public.chat_context_summaries")).rows[0]
        .count,
      0,
    );
    const after = await admission(db);
    assert.ok(after > before);
    assert.equal((await persist(after)).rows[0].value, true);
  } finally {
    await db.close();
  }
});

test("account deletion retires leases permanently even when its outer fence is released", async () => {
  const db = await fixture();
  try {
    const epoch = await admission(db);
    await enqueue(db, "a".repeat(64), owner, epoch);
    const job = await claim(db);
    await db.query("insert into public.account_deletion_fences values($1)", [owner]);
    await assert.rejects(admission(db), /account_deletion_pending/);
    assert.equal(await enqueue(db, "b".repeat(64), owner, epoch), null);
    assert.equal(await claim(db), undefined);
    await db.query("delete from public.account_deletion_fences where user_id=$1", [owner]);
    assert.equal(await settle(db, job), false);
    assert.equal(await enqueue(db, "b".repeat(64), owner, epoch), null);
  } finally {
    await db.close();
  }
});

test("retention-only cleanup removes expired inputs without claiming provider work", async () => {
  const db = await fixture();
  try {
    await enqueue(db);
    await db.exec(
      "update public.chat_context_summaries set input_expires_at=now()-interval '1 minute'",
    );
    assert.equal(
      (await db.query("select public.purge_expired_chat_context_inputs() count")).rows[0].count,
      1,
    );
    const row = (await db.query("select * from public.chat_context_summaries")).rows[0];
    assert.deepEqual(row.input_messages, []);
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 0);
  } finally {
    await db.close();
  }
});
