import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  "supabase/migrations/20260904100000_agent_team_atomic_terminal_controls.sql",
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111";
const run = "22222222-2222-4222-8222-222222222222";

async function fixture(status = "cancelled") {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${owner}'::uuid $$;
    create table public.agent_runs(id uuid primary key, owner_id uuid, status text,
      cancellation_category text, lease_owner text, lease_expires_at timestamptz, cancelled_at timestamptz, updated_at timestamptz);
    create table public.agent_run_tasks(id uuid primary key default gen_random_uuid(), run_id uuid, owner_id uuid, status text,
      lease_owner text, lease_expires_at timestamptz, completed_at timestamptz, updated_at timestamptz);
    create table public.agent_run_events(id int generated always as identity primary key, run_id uuid, owner_id uuid, kind text, safe_payload jsonb);
    insert into public.agent_runs(id,owner_id,status) values('${run}','${owner}','${status}');
    insert into public.agent_run_tasks(run_id,owner_id,status,lease_owner) values('${run}','${owner}','running','old-worker');
  `);
  await db.exec(migration);
  return db;
}

test("repeated cancellation heals legacy tasks and creates the missing event once", async () => {
  const db = await fixture();
  try {
    for (let i = 0; i < 2; i++) {
      const result = await db.query(
        "select public.control_disabled_agent_team_run($1,'cancel') result",
        [run],
      );
      assert.equal(result.rows[0].result.idempotent, true);
    }
    assert.deepEqual(
      (await db.query("select status,lease_owner from public.agent_run_tasks")).rows,
      [{ status: "cancelled", lease_owner: null }],
    );
    assert.equal(
      (await db.query("select count(*)::int count from public.agent_run_events")).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});

test("audit failure rolls back both task and run cancellation", async () => {
  const db = await fixture("running");
  try {
    await db.exec("alter table public.agent_run_events add constraint fail_audit check (false)");
    await assert.rejects(
      db.query("select public.control_disabled_agent_team_run($1,'cancel')", [run]),
      /fail_audit/,
    );
    assert.equal(
      (await db.query("select status from public.agent_runs")).rows[0].status,
      "running",
    );
    assert.equal(
      (await db.query("select status from public.agent_run_tasks")).rows[0].status,
      "running",
    );
  } finally {
    await db.close();
  }
});

test("disabled team controls preserve owner and terminal-state boundaries", async () => {
  const db = await fixture("completed");
  try {
    await assert.rejects(
      db.query("select public.control_disabled_agent_team_run($1,'cancel')", [run]),
      /invalid_agent_state_transition/,
    );
    await assert.rejects(
      db.query("select public.control_disabled_agent_team_run($1,'resume')", [run]),
      /agent_team_execution_unavailable/,
    );
    await db.exec(
      "create or replace function auth.uid() returns uuid language sql as $$ select '33333333-3333-4333-8333-333333333333'::uuid $$",
    );
    await assert.rejects(
      db.query("select public.control_disabled_agent_team_run($1,'cancel')", [run]),
      /agent_run_not_found/,
    );
  } finally {
    await db.close();
  }
});
