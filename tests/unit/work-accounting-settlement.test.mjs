import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const id = (n) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const [owner, other, run, step] = [1, 2, 3, 4].map(id);
const hash = "a".repeat(64),
  receiptHash = "b".repeat(64);
const canonical = await readFile(
  new URL("../../supabase/migrations/20260803130000_ai_usage_accounting.sql", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260905005310_work_accounting_reconciliation.sql",
    import.meta.url,
  ),
  "utf8",
);
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema kova_private;create table auth.users(id uuid primary key,deleted_at timestamptz);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create function kova_private.auth_user_exists(p_id uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=p_id and deleted_at is null)$$;
      revoke all on function kova_private.auth_user_exists(uuid) from public;
      grant usage on schema auth,kova_private to service_role;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
      create table account_deletion_fences(user_id uuid primary key);
      create table work_execution_runs(id uuid primary key,owner_id uuid,state jsonb);
      grant select,update on work_execution_runs to service_role;grant select on account_deletion_fences to service_role;
      insert into auth.users(id) values('${owner}'),('${other}');`);
    await db.exec(canonical);
    await db.exec(migration);
    await db.exec("set role service_role");
    const acquired = (
      await db.query(
        `select * from acquire_ai_generation('request',$1,$2,null,null,'medium','plus',false,'gpt-5.6-luna',100,200,.01,false,10000,100000,10,10,10,10,30,now(),now()+interval '1 month')`,
        [`work:${run}:1:${step}`, owner],
      )
    ).rows[0];
    assert.equal(acquired.decision, "acquired");
    await db.exec("reset role");
    await db.query("insert into work_execution_runs values($1,$2,$3)", [
      run,
      owner,
      {
        model: "gpt-5.6-luna",
        epoch: 1,
        status: "running",
        step: { id: step, reservationId: acquired.event_id, inputHash: hash, epoch: 1 },
      },
    ]);
    await db.exec("set role service_role");
    return { db, event: acquired.event_id };
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function settle(f, overrides = {}) {
  const value = {
    owner,
    run,
    step,
    epoch: 1,
    event: f.event,
    hash,
    receiptHash,
    model: "gpt-5.6-luna",
    input: 80,
    cached: 20,
    output: 10,
    reasoning: 5,
    cost: 0.003,
    latency: 1200,
    ...overrides,
  };
  return (
    await f.db.query(
      "select settle_work_accounting($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ok",
      Object.values(value),
    )
  ).rows[0].ok;
}
test("canonical settlement crash/retry is idempotent even after the run clears its step", async () => {
  const f = await fixture();
  try {
    assert.equal(await settle(f), true);
    await f.db.query(
      'update work_execution_runs set state=state||\'{"step":null,"status":"completed"}\'::jsonb',
    );
    const results = await Promise.all([settle(f), settle(f)]);
    assert.deepEqual(results, [true, true]);
    assert.equal(
      (await f.db.query("select count(*)::int n from work_accounting_settlements")).rows[0].n,
      1,
    );
    const actual = (
      await f.db.query(
        "select status,actual_billable_tokens::int tokens,actual_cost_usd::float8 cost from ai_usage_events",
      )
    ).rows[0];
    assert.deepEqual(actual, { status: "completed", tokens: 90, cost: 0.003 });
    await assert.rejects(settle(f, { receiptHash: "c".repeat(64) }), /receipt_conflict/);
    await assert.rejects(settle(f, { output: 11 }), /receipt_conflict/);
  } finally {
    await f.db.close();
  }
});
test("a lost response from canonical finalize is reconciled only with identical totals", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.db.query(
          "select finalize_ai_generation($1,'completed',80::bigint,20::bigint,10::bigint,5::bigint,.003,1200,'{}',null) ok",
          [f.event],
        )
      ).rows[0].ok,
      true,
    );
    assert.equal(
      (
        await f.db.query(
          "select finalize_ai_generation($1,'completed',80::bigint,20::bigint,10::bigint,5::bigint,.003,1200,'{}',null) ok",
          [f.event],
        )
      ).rows[0].ok,
      false,
    );
    await assert.rejects(settle(f, { cost: 0.002 }), /receipt_conflict/);
    assert.equal(await settle(f), true);
  } finally {
    await f.db.close();
  }
});
test("canonical admission expiry and cancellation keep late receipts reconcilable without a new provider call", async () => {
  const f = await fixture();
  try {
    await f.db.query("update ai_usage_events set lease_expires_at=now()-interval '1 second'");
    await f.db.query(
      "select * from acquire_ai_generation('another','another',$1,null,null,'medium','plus',false,'gpt-5.6-luna',10,20,.01,false,10000,100000,10,10,10,10,30,now(),now()+interval '1 month')",
      [owner],
    );
    assert.equal(
      (await f.db.query("select status from ai_usage_events where id=$1", [f.event])).rows[0]
        .status,
      "stale",
    );
    await f.db.query(
      'update work_execution_runs set state=state||\'{"status":"cancelled","epoch":2}\'::jsonb',
    );
    assert.equal(await settle(f), true);
    assert.equal(
      (
        await f.db.query(
          "select count(*)::int n from ai_usage_events where idempotency_key like 'work:%'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await f.db.close();
  }
});
test("recorded stale actual costs and tokens cannot be reduced by a late receipt", async () => {
  const f = await fixture();
  try {
    await f.db.query(
      "update ai_usage_events set status='stale',actual_cost_usd=.004,actual_billable_tokens=100",
    );
    await assert.rejects(settle(f), /receipt_conflict/);
    assert.equal(await settle(f, { input: 90, cost: 0.005 }), true);
  } finally {
    await f.db.close();
  }
});
test("owner, input, original epoch, reservation and model bind the accounting write", async () => {
  const f = await fixture();
  try {
    for (const patch of [
      { owner: other },
      { hash: "d".repeat(64) },
      { epoch: 2 },
      { step: id(8) },
      { event: id(9) },
      { model: "gpt-5.6-sol" },
    ])
      await assert.rejects(settle(f, patch), /binding_invalid/);
    assert.equal(
      (await f.db.query("select count(*)::int n from work_accounting_settlements")).rows[0].n,
      0,
    );
    assert.equal(await settle(f), true);
  } finally {
    await f.db.close();
  }
});
test("receipt bounds reject malformed usage and released terminal reservations", async () => {
  const f = await fixture();
  try {
    for (const patch of [
      { input: -1 },
      { cached: 81 },
      { reasoning: 11 },
      { cost: "NaN" },
      { latency: -1 },
    ])
      await assert.rejects(settle(f, patch), /receipt_invalid/);
    await f.db.query(
      "select finalize_ai_generation($1,'aborted',0::bigint,0::bigint,0::bigint,0::bigint,0,0,'{}',null)",
      [f.event],
    );
    await assert.rejects(settle(f), /terminal_conflict/);
  } finally {
    await f.db.close();
  }
});
test("deletion fences stop writes and unprivileged roles cannot forge settlement evidence", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.db.query("select has_table_privilege('service_role','auth.users','select') ok"))
        .rows[0].ok,
      false,
    );
    await f.db.exec("reset role");
    await f.db.query("insert into account_deletion_fences values($1)", [owner]);
    await f.db.exec("set role service_role");
    await assert.rejects(settle(f), /account_unavailable/);
    await f.db.exec("reset role;delete from account_deletion_fences;set role authenticated");
    await assert.rejects(settle(f), /permission denied/);
    await assert.rejects(
      f.db.query("insert into work_accounting_settlements(event_id) values($1)", [f.event]),
      /permission denied/,
    );
    await f.db.exec("reset role;set role service_role");
    assert.equal(await settle(f), true);
    await assert.rejects(
      f.db.query("update work_accounting_settlements set receipt_hash=$1", [hash]),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});
