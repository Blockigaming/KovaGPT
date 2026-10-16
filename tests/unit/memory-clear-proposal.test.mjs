import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema kova_private;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade);
    grant all on public.account_deletion_fences to service_role; grant usage on schema kova_private to service_role;`);
  for (const path of [
    "supabase/migrations/20260624230040_7e466bca-9fb0-476f-8779-2788bec60e53.sql",
    "supabase/migrations/20260904233022_durable_chat_context_summaries.sql",
    "docs/release-proposals/memory-clear-restore.sql",
  ])
    await db.exec(await readFile(path, "utf8"));
  await db.exec("set role service_role");
  return db;
}
const add = (db, chat, summary = "duplicate text", user = owner) =>
  db.query(
    "insert into public.chat_memories(user_id,chat_id,summary) values($1,$2,$3) returning *",
    [user, chat, summary],
  );
const rows = async (db, user = owner) =>
  (
    await db.query(
      "select id,chat_id,summary from public.chat_memories where user_id=$1 order by chat_id",
      [user],
    )
  ).rows;
const operation = async (
  db,
  id,
  action = "clear",
  { user = owner, keep = false, token = null, ttl = 600 } = {},
) =>
  (
    await db.query("select public.memory_clear_operation($1,$2,$3,$4,$5,$6) value", [
      user,
      id,
      action,
      ttl,
      keep,
      token,
    ])
  ).rows[0].value;

test("scoped inverse restores duplicate text by identity and preserves later additions and other accounts", async () => {
  const db = await fixture();
  try {
    await add(db, "a");
    await add(db, "b");
    await add(db, "other", "private", other);
    const before = await rows(db),
      otherBefore = await rows(db, other),
      id = randomUUID();
    assert.equal((await operation(db, id)).removedCount, 2);
    await add(db, "new", "newer addition");
    const newer = (await rows(db))[0];
    assert.equal((await operation(db, id)).removedCount, 2); // retry does not clear again
    assert.deepEqual(await rows(db), [newer]);
    assert.equal((await operation(db, id, "restore")).restoredCount, 2);
    assert.deepEqual(await rows(db), [...before, newer]);
    assert.deepEqual(await rows(db, other), otherBefore);
    assert.equal((await operation(db, id, "restore")).restoredCount, 2);
    assert.equal((await rows(db)).length, 3);
  } finally {
    await db.close();
  }
});
test("conflict cancellation and stale review preserve all records; explicit keep-newer restores only unaffected targets", async () => {
  const db = await fixture();
  try {
    await add(db, "a");
    await add(db, "b");
    const id = randomUUID();
    await operation(db, id);
    await add(db, "a", "new revision");
    let before = await rows(db);
    const conflict = await operation(db, id, "restore");
    assert.equal(conflict.state, "conflict");
    assert.equal(conflict.conflictCount, 1);
    assert.deepEqual(await rows(db), before);
    await db.query("update public.chat_memories set summary='newer again' where user_id=$1", [
      owner,
    ]);
    before = await rows(db);
    const stale = await operation(db, id, "restore", { keep: true, token: conflict.conflictToken });
    assert.equal(stale.state, "conflict");
    assert.notEqual(stale.conflictToken, conflict.conflictToken);
    assert.deepEqual(await rows(db), before);
    const restored = await operation(db, id, "restore", { keep: true, token: stale.conflictToken });
    assert.equal(restored.restoredCount, 1);
    assert.equal(restored.skippedCount, 1);
    assert.equal((await rows(db))[0].summary, "newer again");
  } finally {
    await db.close();
  }
});
test("newer insert/delete cannot disappear from conflict detection, and out-of-order inverses preserve both batches", async () => {
  const db = await fixture();
  try {
    await add(db, "a");
    const first = randomUUID();
    await operation(db, first);
    await add(db, "b");
    const second = randomUUID();
    await operation(db, second);
    assert.equal((await operation(db, first, "restore")).restoredCount, 1);
    assert.equal((await operation(db, second, "restore")).restoredCount, 1);
    const third = randomUUID();
    await operation(db, third);
    await add(db, "a", "replacement");
    await db.exec("delete from public.chat_memories where chat_id='a'");
    assert.equal((await operation(db, third, "restore")).conflictCount, 1);
    assert.equal((await rows(db)).length, 0);
  } finally {
    await db.close();
  }
});
test("privacy deletion retires recovery, rejected account access and failed transactions retain the inverse", async () => {
  const db = await fixture();
  try {
    await add(db, "a");
    const id = randomUUID();
    await operation(db, id);
    await assert.rejects(
      operation(db, id, "restore", { user: other }),
      /memory_operation_unavailable/,
    );
    await db.exec("begin");
    assert.equal((await operation(db, id, "restore")).restoredCount, 1);
    await db.exec("rollback");
    assert.equal((await rows(db)).length, 0);
    assert.equal((await operation(db, id, "restore")).restoredCount, 1);
    const next = randomUUID();
    await operation(db, next);
    await db.query("select public.delete_chat_memory($1)", [owner]);
    assert.equal((await operation(db, next, "restore")).state, "retired");
    await add(db, "new");
    await operation(db, next);
    assert.equal((await rows(db)).length, 1);
    assert.equal(
      (await db.query("select count(*)::int count from kova_private.memory_clear_items")).rows[0]
        .count,
      0,
    );
    await db.exec("set role authenticated");
    await assert.rejects(operation(db, randomUUID()), /permission denied/);
    await assert.rejects(
      db.exec("select * from kova_private.memory_clear_items"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("unconfigured clear is inert; expired recovery cannot restore and cleanup removes payloads", async () => {
  const db = await fixture();
  try {
    await add(db, "a");
    await assert.rejects(operation(db, randomUUID(), "clear", { ttl: null }), /unconfigured/);
    assert.equal((await rows(db)).length, 1);
    const id = randomUUID();
    await operation(db, id);
    await db.exec(
      "update kova_private.memory_clear_operations set expires_at=now()-interval '1 second'",
    );
    await db.exec("select public.purge_expired_memory_inverses()");
    assert.equal((await operation(db, id, "restore")).state, "expired");
    assert.equal((await rows(db)).length, 0);
  } finally {
    await db.close();
  }
});

test("clear fences an admitted old writer, preserves same-chat context, and account deletion prevents resurrection", async () => {
  const db = await fixture();
  try {
    const chat = randomUUID();
    await add(db, chat);
    const epoch = (await db.query("select public.begin_chat_memory_write($1) epoch", [owner]))
      .rows[0].epoch;
    await db.query(
      "insert into public.chat_context_summaries(user_id,chat_id,requested_digest,requested_start,requested_count) values($1,$2,$3,0,4)",
      [owner, chat, "a".repeat(64)],
    );
    const id = randomUUID();
    await operation(db, id);
    assert.equal(
      (
        await db.query(
          "select public.persist_chat_memory($1,$2,$3,'Title','Old admitted write',4) ok",
          [owner, epoch, chat],
        )
      ).rows[0].ok,
      false,
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.chat_context_summaries")).rows[0].n,
      1,
    );
    await db.query("insert into public.account_deletion_fences values($1)", [owner]);
    await assert.rejects(operation(db, id, "restore"), /account_deletion_pending/);
    await db.query("delete from public.account_deletion_fences where user_id=$1", [owner]);
    assert.equal((await operation(db, id, "restore")).state, "retired");
    assert.equal((await rows(db)).length, 0);
    assert.equal(
      (await db.query("select count(*)::int n from public.chat_context_summaries")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
