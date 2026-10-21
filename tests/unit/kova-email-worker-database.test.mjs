import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const migration = await readFile(
  "supabase/migrations/20261021130544_production_owned_email_worker.sql",
  "utf8",
);
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema kova_private;create schema pgmq;
    create table pgmq.q_auth_emails(msg_id bigint primary key,vt timestamptz,enqueued_at timestamptz,message jsonb);
    create table kova_private.account_email_events(id uuid primary key,status text,recipient text,occurred_at timestamptz,expires_at timestamptz,
      event_type text default 'password_changed',metadata jsonb default '{}',lease_token uuid,lease_until timestamptz,updated_at timestamptz);
    create function public.account_email_purge_expired(integer) returns integer language sql as $$select 0$$;
    create function kova_private.account_email_dispatch_allowed(p_event kova_private.account_email_events)
      returns boolean language sql as $$select p_event.recipient is not null and p_event.event_type<>'disabled_fixture'$$;
    ${migration}`);
  return db;
}
const claim = async (db, id, at = new Date().toISOString()) =>
  (await db.query("select public.kova_email_claim_worker_run($1,$2) ok", [id, at])).rows[0].ok;
const finish = async (db, id) =>
  (await db.query("select public.kova_email_finish_worker_run($1) ok", [id])).rows[0].ok;
test("durable run serialization rejects overlap/replay and exact run alone may release", async () => {
  const db = await fixture();
  try {
    const first = randomUUID(),
      second = randomUUID();
    assert.equal(await claim(db, first), true);
    assert.equal(await claim(db, first), false);
    assert.equal(await claim(db, second), false);
    assert.equal(await finish(db, second), false);
    assert.equal(await finish(db, first), true);
    assert.equal(await claim(db, first), false);
    assert.equal(await claim(db, second), true);
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.email_worker_runs")).rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});
test("stale/invalid requests and lost invocation leases cannot select private scope", async () => {
  const db = await fixture();
  try {
    const id = randomUUID();
    await assert.rejects(
      claim(db, id, new Date(Date.now() - 61_000).toISOString()),
      /email_worker_request_invalid/,
    );
    await assert.rejects(
      claim(db, id, new Date(Date.now() + 6000).toISOString()),
      /email_worker_request_invalid/,
    );
    await assert.rejects(
      db.query("select public.kova_email_worker_scope($1)", [id]),
      /email_worker_lease_lost/,
    );
    assert.equal(await claim(db, id), true);
    await db.exec(
      "update kova_private.email_worker_state set lease_until=clock_timestamp()+interval '119 seconds'",
    );
    await assert.rejects(
      db.query("select public.kova_email_worker_scope($1)", [id]),
      /email_worker_lease_lost/,
    );
    await db.exec(
      "update kova_private.email_worker_state set lease_until=clock_timestamp()-interval '1 second'",
    );
    assert.equal(await finish(db, id), false);
  } finally {
    await db.close();
  }
});
test("scope picks only one current owned challenge and one pending notice, leaving other queues untouched", async () => {
  const db = await fixture();
  try {
    const id = randomUUID(),
      event = randomUUID();
    await db.exec(`insert into pgmq.q_auth_emails values
      (1,now(),now(),'{"purpose":"other","label":"kova-auth-verification","message_id":"${"x".repeat(43)}","to":"foreign@example.test"}'),
      (2,now(),now(),'{"purpose":"auth","label":"kova-auth-verification","message_id":"${"m".repeat(43)}","to":"owner@example.test"}'),
      (3,now(),now(),'{"purpose":"auth","label":"kova-auth-recovery","message_id":"${"n".repeat(43)}","to":"second@example.test"}');`);
    await db.query(
      "insert into kova_private.account_email_events(id,status,recipient,occurred_at,expires_at) values($1,'pending','owner@example.test',now(),now()+interval '1 hour')",
      [event],
    );
    await db.query(
      "insert into kova_private.account_email_events(id,status,recipient,occurred_at,expires_at) values($1,'sent',null,now()-interval '1 minute',now()+interval '1 hour')",
      [randomUUID()],
    );
    assert.equal(await claim(db, id), true);
    const scope = (await db.query("select public.kova_email_worker_scope($1) scope", [id])).rows[0]
      .scope;
    assert.deepEqual(scope.auth.messageIds, ["m".repeat(43)]);
    assert.deepEqual(scope.auth.recipients, ["owner@example.test"]);
    assert.deepEqual(scope.account.eventIds, [event]);
    assert.equal((await db.query("select count(*)::int n from pgmq.q_auth_emails")).rows[0].n, 3);
    assert.equal(
      (await db.query("select status from kova_private.account_email_events where id=$1", [event]))
        .rows[0].status,
      "pending",
    );
  } finally {
    await db.close();
  }
});
test("browser roles cannot call service RPCs or read worker state, and failed transactions leave no receipt", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      for (const fn of [
        "kova_email_claim_worker_run(uuid,timestamp with time zone)",
        "kova_email_worker_scope(uuid)",
        "kova_email_claim_account_dispatch(uuid)",
        "kova_email_finish_worker_run(uuid)",
      ])
        assert.equal(
          (
            await db.query("select has_function_privilege($1,$2,'execute') ok", [
              role,
              `public.${fn}`,
            ])
          ).rows[0].ok,
          false,
        );
      for (const table of ["email_worker_runs", "email_worker_state"])
        assert.equal(
          (
            await db.query("select has_table_privilege($1,$2,'select') ok", [
              role,
              `kova_private.${table}`,
            ])
          ).rows[0].ok,
          false,
        );
    }
    await db.exec("begin");
    assert.equal(await claim(db, randomUUID()), true);
    await db.exec("rollback");
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.email_worker_runs")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select run_id from kova_private.email_worker_state")).rows[0].run_id,
      null,
    );
  } finally {
    await db.close();
  }
});

test("worker account claim retains a delayed notice, rechecks preferences and requires its current exact invocation", async () => {
  const db = await fixture();
  try {
    const id = randomUUID(),
      event = randomUUID();
    await db.query(
      "insert into kova_private.account_email_events(id,status,recipient,occurred_at,expires_at) values($1,'pending','owner@example.test',now()-interval '2 hours',now()+interval '1 hour')",
      [event],
    );
    await assert.rejects(
      db.query("select * from public.kova_email_claim_account_dispatch($1)", [id]),
      /email_worker_lease_lost/,
    );
    assert.equal(await claim(db, id), true);
    const selected = (await db.query("select public.kova_email_worker_scope($1) scope", [id]))
      .rows[0].scope;
    assert.deepEqual(selected.account.eventIds, [event]);
    const leased = (
      await db.query("select * from public.kova_email_claim_account_dispatch($1)", [id])
    ).rows;
    assert.equal(leased.length, 1);
    assert.equal(leased[0].id, event);
    assert.ok(leased[0].lease_token);
    assert.equal(
      (await db.query("select * from public.kova_email_claim_account_dispatch($1)", [id])).rows
        .length,
      0,
    );
    assert.equal(await finish(db, id), true);
    const next = randomUUID(),
      optedOut = randomUUID();
    await db.query(
      "insert into kova_private.account_email_events(id,status,recipient,occurred_at,expires_at,event_type) values($1,'pending','owner@example.test',now()-interval '1 hour',now()+interval '1 hour','disabled_fixture')",
      [optedOut],
    );
    assert.equal(await claim(db, next), true);
    await db.query("select public.kova_email_worker_scope($1)", [next]);
    assert.equal(
      (await db.query("select * from public.kova_email_claim_account_dispatch($1)", [next])).rows
        .length,
      0,
    );
    const suppressed = (
      await db.query("select status,recipient from kova_private.account_email_events where id=$1", [
        optedOut,
      ])
    ).rows[0];
    assert.deepEqual(suppressed, { status: "suppressed", recipient: null });
  } finally {
    await db.close();
  }
});
