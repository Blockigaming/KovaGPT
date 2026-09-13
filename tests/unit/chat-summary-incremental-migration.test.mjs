import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const owner = "11111111-1111-4111-8111-111111111111";
const chat = "33333333-3333-4333-8333-333333333333";
const digest = (index) => index.toString(16).padStart(64, "0");
const turns = (count) =>
  Array.from({ length: count }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `New turn ${index}`,
  }));
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key);insert into auth.users values('${owner}');
    create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade);
    grant all on public.account_deletion_fences to service_role;grant usage on schema kova_private to service_role;`);
  await db.exec(
    await readFile(
      "supabase/migrations/20260624230040_7e466bca-9fb0-476f-8779-2788bec60e53.sql",
      "utf8",
    ),
  );
  await db.exec(
    await readFile("supabase/migrations/20260904233022_durable_chat_context_summaries.sql", "utf8"),
  );
  return db;
}
async function admission(db) {
  return (await db.query("select public.begin_chat_memory_write($1) epoch", [owner])).rows[0].epoch;
}
async function queue(db, { epoch, count, nextDigest, input, base }) {
  return (
    await db.query(
      "select public.queue_chat_context_summary($1,$2,$3,0,$4,$5,$6::jsonb,$7,$8,$9) value",
      [
        owner,
        epoch ?? (await admission(db)),
        chat,
        count,
        nextDigest,
        JSON.stringify(input),
        base?.completed_count ?? 0,
        base?.completed_digest ?? null,
        base?.id ?? null,
      ],
    )
  ).rows[0].value;
}
async function row(db) {
  return (
    await db.query("select * from public.chat_context_summaries where user_id=$1 and chat_id=$2", [
      owner,
      chat,
    ])
  ).rows[0];
}
async function claim(db) {
  return (await db.query("select * from public.claim_chat_context_summaries(2)")).rows[0];
}
async function settle(db, job, text) {
  return (
    await db.query("select public.settle_chat_context_summary($1,$2,$3,$4) value", [
      job.id,
      job.requested_revision,
      job.lease_token,
      text,
    ])
  ).rows[0].value;
}
async function rejectedOrNoop(run) {
  try {
    await run();
  } catch (error) {
    assert.match(error.message, /invalid|base|stale|superseded|epoch|revision|summary/i);
  }
}

test("incremental summaries pass 1,000 cumulative turns while every new provider input stays bounded", async () => {
  const db = await fixture();
  try {
    let base;
    for (let step = 1; step <= 13; step++) {
      await queue(db, { count: step * 88, nextDigest: digest(step), input: turns(88), base });
      const job = await claim(db);
      assert.equal(job.requested_count, step * 88);
      assert.equal(job.input_messages.length, 88);
      if (base) assert.equal(job.input_previous_summary, base.completed_summary);
      assert.equal(
        await settle(db, job, `Summary preserving earlier context through ${step * 88} turns`),
        true,
      );
      base = await row(db);
      assert.equal(base.completed_count, step * 88);
      assert.deepEqual(base.input_messages, []);
    }
    assert.equal(base.completed_count, 1144);
  } finally {
    await db.close();
  }
});

test("a stale incremental base cannot replace pending work or identify a deleted and recreated row", async () => {
  const db = await fixture();
  try {
    await queue(db, { count: 88, nextDigest: digest(1), input: turns(88) });
    await settle(db, await claim(db), "Original completed summary");
    const base = await row(db);
    await queue(db, { count: 176, nextDigest: digest(2), input: turns(88), base });
    const pending = await row(db);
    await rejectedOrNoop(() =>
      queue(db, {
        count: 176,
        nextDigest: digest(3),
        input: turns(88),
        base: { ...base, completed_digest: digest(9) },
      }),
    );
    assert.equal((await row(db)).requested_revision, pending.requested_revision);
    assert.equal((await row(db)).requested_digest, pending.requested_digest);
    await db.query("select public.delete_chat_memory($1,null)", [owner]);
    await queue(db, { count: 88, nextDigest: digest(1), input: turns(88) });
    await settle(db, await claim(db), "Recreated summary");
    const recreated = await row(db);
    assert.notEqual(recreated.id, base.id);
    await rejectedOrNoop(() =>
      queue(db, { count: 176, nextDigest: digest(4), input: turns(88), base }),
    );
    assert.equal((await row(db)).requested_revision, recreated.requested_revision);
    assert.equal((await row(db)).completed_summary, "Recreated summary");
  } finally {
    await db.close();
  }
});

test("revision and privacy epoch changes invalidate old work, and an edited-prefix restart clears previous summary input", async () => {
  const db = await fixture();
  try {
    const epoch = await admission(db);
    await queue(db, { epoch, count: 88, nextDigest: digest(1), input: turns(88) });
    await settle(db, await claim(db), "Previous context");
    const base = await row(db);
    await queue(db, { epoch, count: 176, nextDigest: digest(2), input: turns(88), base });
    const old = await claim(db);
    await queue(db, { epoch, count: 4, nextDigest: digest(3), input: turns(4) });
    assert.equal(await settle(db, old, "Must not be committed"), false);
    const restarted = await claim(db);
    assert.ok(restarted.input_previous_summary === null || restarted.input_previous_summary === "");
    await db.query("select public.delete_chat_memory($1,null)", [owner]);
    assert.equal(await settle(db, restarted, "Must remain deleted"), false);
    await rejectedOrNoop(() =>
      queue(db, { epoch, count: 4, nextDigest: digest(4), input: turns(4) }),
    );
    assert.equal(await row(db), undefined);
  } finally {
    await db.close();
  }
});

test("cumulative counters do not relax the 88-new-turn admission limit", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      queue(db, { count: 89, nextDigest: digest(1), input: turns(89) }),
      /invalid|summary/i,
    );
    assert.equal(await row(db), undefined);
  } finally {
    await db.close();
  }
});
