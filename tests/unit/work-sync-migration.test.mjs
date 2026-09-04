import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = "supabase/migrations/20260903213000_work_cross_device_sync.sql";
const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT null::uuid $$;
    CREATE TABLE public.account_audit_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id),
      event_type text NOT NULL,
      safe_description text NOT NULL,
      actor_id uuid,
      target_id text,
      result text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.agent_jobs (
      id uuid PRIMARY KEY,
      owner_id uuid NOT NULL REFERENCES auth.users(id)
    );
    INSERT INTO auth.users(id) VALUES ('${userId}'), ('${otherUserId}');
    INSERT INTO public.agent_jobs(id,owner_id) VALUES ('${runId}','${userId}');
  `);
  await database.exec(await readFile(migrationPath, "utf8"));
  return database;
}

test("saved Work changes are versioned, conflict-safe, and idempotent", async () => {
  const database = await createDatabase();
  try {
    const firstMutation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'template','Weekly review',$4,0) result`,
      [userId, firstMutation, recordId, { objective: "Review the week" }],
    );
    assert.equal(first.rows[0].result.revision, 1);
    assert.equal(first.rows[0].result.syncVersion, 1);

    const replay = await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'template','Changed title',$4,0) result`,
      [userId, firstMutation, recordId, { objective: "This replay must not overwrite" }],
    );
    assert.deepEqual(replay.rows[0].result, first.rows[0].result);

    const updated = await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'template','Monthly review',$4,1) result`,
      [userId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", recordId, { objective: "Review the month" }],
    );
    assert.equal(updated.rows[0].result.revision, 2);
    assert.equal(updated.rows[0].result.syncVersion, 2);
    await assert.rejects(
      () =>
        database.query(`select public.upsert_work_saved_record($1,$2,$3,'template','Stale',$4,1)`, [
          userId,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          recordId,
          { objective: "stale" },
        ]),
      /work_revision_conflict/u,
    );

    const state = await database.query(
      "select title,payload,revision,sync_version from public.work_saved_records where owner_id=$1 and id=$2",
      [userId, recordId],
    );
    assert.deepEqual(state.rows, [
      {
        title: "Monthly review",
        payload: { objective: "Review the month" },
        revision: 2,
        sync_version: 2,
      },
    ]);
    const audit = await database.query(
      "select count(*)::integer count from public.account_audit_entries where event_type='work_sync'",
    );
    assert.equal(audit.rows[0].count, 2);
  } finally {
    await database.close();
  }
});

test("deletion creates a durable tombstone and never removes the payload", async () => {
  const database = await createDatabase();
  try {
    await database.query(`select public.upsert_work_saved_record($1,$2,$3,'task','Task',$4,0)`, [
      userId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recordId,
      { objective: "Preserve me" },
    ]);
    const deleted = await database.query(
      "select public.delete_work_saved_record($1,$2,$3,1) result",
      [userId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", recordId],
    );
    assert.equal(deleted.rows[0].result.revision, 2);
    assert.equal(deleted.rows[0].result.syncVersion, 2);
    assert.ok(deleted.rows[0].result.deletedAt);
    const stored = await database.query(
      "select payload,deleted_at is not null deleted from public.work_saved_records where owner_id=$1 and id=$2",
      [userId, recordId],
    );
    assert.deepEqual(stored.rows, [{ payload: { objective: "Preserve me" }, deleted: true }]);
  } finally {
    await database.close();
  }
});

test("Recents pins reference owned resources and use the same conflict clock", async () => {
  const database = await createDatabase();
  try {
    const opened = await database.query(
      "select public.mutate_work_recent_item($1,$2,'run',$3,'keep',null) result",
      [userId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runId],
    );
    assert.equal(opened.rows[0].result.revision, 1);
    assert.equal(opened.rows[0].result.syncVersion, 1);
    const pinned = await database.query(
      "select public.mutate_work_recent_item($1,$2,'run',$3,'pin',1) result",
      [userId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", runId],
    );
    assert.equal(pinned.rows[0].result.revision, 2);
    assert.ok(pinned.rows[0].result.pinnedAt);
    await assert.rejects(
      () =>
        database.query("select public.mutate_work_recent_item($1,$2,'run',$3,'unpin',1)", [
          userId,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          runId,
        ]),
      /work_revision_conflict/u,
    );
    await assert.rejects(
      () =>
        database.query("select public.mutate_work_recent_item($1,$2,'run',$3,'keep',null)", [
          otherUserId,
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          runId,
        ]),
      /work_resource_not_found/u,
    );
  } finally {
    await database.close();
  }
});

test("a recent item can be forgotten after its saved resource is deleted", async () => {
  const database = await createDatabase();
  try {
    await database.query(`select public.upsert_work_saved_record($1,$2,$3,'task','Task',$4,0)`, [
      userId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recordId,
      { objective: "Temporary" },
    ]);
    await database.query("select public.mutate_work_recent_item($1,$2,'task',$3,'keep',null)", [
      userId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      recordId,
    ]);
    await database.query("select public.delete_work_saved_record($1,$2,$3,1)", [
      userId,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      recordId,
    ]);
    const forgotten = await database.query(
      "select public.mutate_work_recent_item($1,$2,'task',$3,'forget',1) result",
      [userId, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", recordId],
    );
    assert.equal(forgotten.rows[0].result.revision, 2);
    assert.ok(forgotten.rows[0].result.deletedAt);
    const replayedOpen = await database.query(
      "select public.mutate_work_recent_item($1,$2,'task',$3,'keep',null) result",
      [userId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", recordId],
    );
    assert.equal(replayedOpen.rows[0].result.revision, 1);
    assert.equal(replayedOpen.rows[0].result.deletedAt, null);
  } finally {
    await database.close();
  }
});

test("incremental sync pages one global change clock without skipping record types", async () => {
  const database = await createDatabase();
  try {
    await database.query(`select public.upsert_work_saved_record($1,$2,$3,'task','Task',$4,0)`, [
      userId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      recordId,
      { objective: "one" },
    ]);
    await database.query("select public.mutate_work_recent_item($1,$2,'task',$3,'keep',null)", [
      userId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      recordId,
    ]);
    const secondRecordId = "55555555-5555-4555-8555-555555555555";
    await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'task','Task two',$4,0)`,
      [userId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", secondRecordId, { objective: "two" }],
    );

    const first = await database.query("select public.get_work_sync_changes($1,0,2) result", [
      userId,
    ]);
    assert.equal(first.rows[0].result.nextCursor, 2);
    assert.equal(first.rows[0].result.hasMore, true);
    assert.equal(first.rows[0].result.savedRecords.length, 1);
    assert.equal(first.rows[0].result.recentItems.length, 1);
    const second = await database.query("select public.get_work_sync_changes($1,2,2) result", [
      userId,
    ]);
    assert.equal(second.rows[0].result.nextCursor, 3);
    assert.equal(second.rows[0].result.hasMore, false);
    assert.equal(second.rows[0].result.savedRecords[0].payload.objective, "two");
  } finally {
    await database.close();
  }
});

test("browser roles are read-only and mutation RPCs are service-only", async () => {
  const database = await createDatabase();
  try {
    const privileges = await database.query(`
      select
        has_table_privilege('authenticated','public.work_saved_records','SELECT') authenticated_read,
        has_table_privilege('authenticated','public.work_saved_records','INSERT') authenticated_write,
        has_table_privilege('anon','public.work_saved_records','SELECT') anon_read,
        has_function_privilege(
          'authenticated',
          'public.upsert_work_saved_record(uuid,uuid,uuid,text,text,jsonb,bigint)',
          'EXECUTE'
        ) authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.upsert_work_saved_record(uuid,uuid,uuid,text,text,jsonb,bigint)',
          'EXECUTE'
        ) service_execute
    `);
    assert.deepEqual(privileges.rows, [
      {
        authenticated_read: true,
        authenticated_write: false,
        anon_read: false,
        authenticated_execute: false,
        service_execute: true,
      },
    ]);
    const functions = await database.query(`
      select proname,prosecdef,proconfig
      from pg_proc
      where proname in (
        'next_work_sync_version','upsert_work_saved_record',
        'delete_work_saved_record','mutate_work_recent_item','purge_work_sync_receipts',
        'get_work_sync_changes'
      )
      order by proname
    `);
    assert.equal(functions.rows.length, 6);
    for (const row of functions.rows) {
      assert.equal(row.prosecdef, false);
      assert.deepEqual(row.proconfig, ['search_path=""']);
    }
  } finally {
    await database.close();
  }
});
