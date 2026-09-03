import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const baseMigration = await readFile(
  "supabase/migrations/20260903213000_work_cross_device_sync.sql",
  "utf8",
);
const hardeningMigration = await readFile(
  "supabase/migrations/20260903214500_work_sync_protection_hardening.sql",
  "utf8",
);

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";

async function createBaseDatabase() {
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
  await database.exec(baseMigration);
  return database;
}

function nestedContainers(count, leaf = "leaf") {
  let value = leaf;
  for (let index = 0; index < count; index += 1) value = { nested: value };
  return value;
}

async function expectDatabaseError(action, code, message) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.code, code);
    assert.match(String(error?.message), message);
    return true;
  });
}

test("forward migration scrubs legacy receipts and deleted Work bodies", async () => {
  const database = await createBaseDatabase();
  try {
    await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'task','Private task',$4,0)`,
      [
        userId,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recordId,
        { objective: "do not retain after deletion" },
      ],
    );
    await database.query("select public.delete_work_saved_record($1,$2,$3,1)", [
      userId,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      recordId,
    ]);

    await database.exec(hardeningMigration);

    const tombstone = await database.query(
      "select title,payload,revision,sync_version,deleted_at is not null deleted from public.work_saved_records where owner_id=$1 and id=$2",
      [userId, recordId],
    );
    assert.deepEqual(tombstone.rows, [
      {
        title: "Deleted Work item",
        payload: {},
        revision: 2,
        sync_version: 2,
        deleted: true,
      },
    ]);

    const receipts = await database.query(
      "select operation,request_fingerprint,result from public.work_sync_mutations where owner_id=$1 order by mutation_id",
      [userId],
    );
    assert.deepEqual(
      receipts.rows.map((row) => row.operation),
      ["save", "delete"],
    );
    for (const row of receipts.rows) {
      assert.match(row.request_fingerprint, /^legacy:[0-9a-f]{64}$/u);
      assert.equal(Object.hasOwn(row.result, "title"), false);
      assert.equal(Object.hasOwn(row.result, "payload"), false);
      assert.ok(Buffer.byteLength(JSON.stringify(row.result)) <= 2_048);
    }

    await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'task','Restored',$4,2)`,
      [userId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", recordId, { objective: "new body" }],
    );
    await database.query("select public.delete_work_saved_record($1,$2,$3,3)", [
      userId,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      recordId,
    ]);
    await database.query("select public.mutate_work_recent_item($1,$2,'run',$3,'keep',null)", [
      userId,
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      runId,
    ]);

    const after = await database.query(
      "select title,payload,revision from public.work_saved_records where owner_id=$1 and id=$2",
      [userId, recordId],
    );
    assert.deepEqual(after.rows, [{ title: "Deleted Work item", payload: {}, revision: 4 }]);
    const audits = await database.query(
      "select count(*)::integer count from public.account_audit_entries where event_type='work_sync'",
    );
    assert.equal(audits.rows[0].count, 2);
    await expectDatabaseError(
      () =>
        database.query(
          `insert into public.work_saved_records(
             owner_id,id,kind,title,payload,revision,sync_version,deleted_at
           ) values ($1,$2,'task','Retained body',$3,1,1,now())`,
          [otherUserId, "99999999-9999-4999-8999-999999999999", { objective: "invalid tombstone" }],
        ),
      "23514",
      /work_saved_records_deleted_body_check/u,
    );
  } finally {
    await database.close();
  }
});

test("new mutation receipts are compact, exact-request idempotent, and operation-bound", async () => {
  const database = await createBaseDatabase();
  try {
    await database.exec(hardeningMigration);
    const mutationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const input = [userId, mutationId, recordId, { objective: "stable request" }];
    const first = await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'template','Weekly review',$4,0) result`,
      input,
    );
    assert.equal(Object.hasOwn(first.rows[0].result, "title"), false);
    assert.equal(Object.hasOwn(first.rows[0].result, "payload"), false);

    const replay = await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'template','Weekly review',$4,0) result`,
      input,
    );
    assert.deepEqual(replay.rows[0].result, first.rows[0].result);

    await expectDatabaseError(
      () =>
        database.query(
          `select public.upsert_work_saved_record($1,$2,$3,'template','Changed request',$4,0)`,
          [userId, mutationId, recordId, { objective: "different" }],
        ),
      "23505",
      /work_sync_mutation_reused/u,
    );
    await expectDatabaseError(
      () =>
        database.query("select public.delete_work_saved_record($1,$2,$3,1)", [
          userId,
          mutationId,
          recordId,
        ]),
      "23505",
      /work_sync_mutation_reused/u,
    );

    const state = await database.query(
      `
      select
        m.operation,
        m.request_fingerprint,
        m.result,
        octet_length(m.result::text) result_bytes,
        c.current_version,
        (select count(*)::integer from public.account_audit_entries where event_type='work_sync') audits
      from public.work_sync_mutations m
      join public.work_sync_counters c on c.owner_id=m.owner_id
      where m.owner_id=$1
    `,
      [userId],
    );
    assert.equal(state.rows.length, 1);
    assert.equal(state.rows[0].operation, "save");
    assert.match(state.rows[0].request_fingerprint, /^[0-9a-f]{64}$/u);
    assert.equal(state.rows[0].result_bytes <= 2_048, true);
    assert.equal(state.rows[0].current_version, 1);
    assert.equal(state.rows[0].audits, 0);
  } finally {
    await database.close();
  }
});

test("payload depth permits sixteen containers and rejects seventeen at the database", async () => {
  const database = await createBaseDatabase();
  try {
    await database.exec(hardeningMigration);
    const acceptedPayload = nestedContainers(16);
    const rejectedPayload = nestedContainers(17);
    const rejectedEmptyObject = nestedContainers(16, {});
    const rejectedEmptyArray = nestedContainers(16, []);
    const depth = await database.query(
      `select
         public.work_sync_payload_depth_allowed($1,16) accepted,
         public.work_sync_payload_depth_allowed($2,16) rejected,
         public.work_sync_payload_depth_allowed($3,16) empty_object_rejected,
         public.work_sync_payload_depth_allowed($4,16) empty_array_rejected`,
      [acceptedPayload, rejectedPayload, rejectedEmptyObject, rejectedEmptyArray],
    );
    assert.deepEqual(depth.rows, [
      {
        accepted: true,
        rejected: false,
        empty_object_rejected: false,
        empty_array_rejected: false,
      },
    ]);

    await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'task','Depth 16',$4,0)`,
      [userId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", recordId, acceptedPayload],
    );
    await expectDatabaseError(
      () =>
        database.query(`select public.upsert_work_saved_record($1,$2,$3,'task','Depth 17',$4,0)`, [
          otherUserId,
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "55555555-5555-4555-8555-555555555555",
          rejectedPayload,
        ]),
      "22023",
      /work_sync_input_invalid/u,
    );
    await expectDatabaseError(
      () =>
        database.query(
          `insert into public.work_saved_records(
             owner_id,id,kind,title,payload,revision,sync_version
           ) values ($1,$2,'task','Direct depth 17',$3,1,1)`,
          [otherUserId, "66666666-6666-4666-8666-666666666666", rejectedPayload],
        ),
      "23514",
      /work_saved_records_payload_depth_check/u,
    );
  } finally {
    await database.close();
  }
});

test("active Work payloads have an atomic eight-MiB compact-payload ceiling", async () => {
  const database = await createBaseDatabase();
  try {
    await database.exec(hardeningMigration);
    await database.exec(`
      insert into public.work_saved_records(
        owner_id,id,kind,title,payload,revision,sync_version
      )
      select
        '${userId}',
        ('60000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        'task',
        'Quota record ' || value,
        jsonb_build_object('body', repeat('x', 97000)),
        1,
        value
      from generate_series(1, 86) value;
    `);
    const usage = await database.query(
      "select sum(octet_length(payload::text))::bigint compact_bytes from public.work_saved_records where owner_id=$1 and deleted_at is null",
      [userId],
    );
    assert.equal(usage.rows[0].compact_bytes < 8 * 1024 * 1024, true);

    await expectDatabaseError(
      () =>
        database.query(
          `insert into public.work_saved_records(
             owner_id,id,kind,title,payload,revision,sync_version
           ) values ($1,$2,'task','Over quota',$3,1,87)`,
          [userId, "60000000-0000-4000-8000-000000000087", { body: "x".repeat(97_000) }],
        ),
      "54000",
      /work_sync_payload_capacity/u,
    );
    await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'task','Other owner',$4,0)`,
      [
        otherUserId,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "77777777-7777-4777-8777-777777777777",
        { body: "independent quota" },
      ],
    );
  } finally {
    await database.close();
  }
});

test("receipt capacity blocks only new mutations and uses SQLSTATE P0003", async () => {
  const database = await createBaseDatabase();
  try {
    await database.exec(`
      insert into public.work_sync_mutations(owner_id,mutation_id,result,created_at)
      select
        '${userId}',
        ('70000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        jsonb_build_object(
          'id', '${recordId}',
          'revision', 1,
          'syncVersion', 1,
          'deletedAt', now()
        ),
        now()
      from generate_series(1, 10000) value;
    `);
    await database.exec(hardeningMigration);

    await expectDatabaseError(
      () =>
        database.query(
          `select public.upsert_work_saved_record($1,$2,$3,'task','At capacity',$4,0)`,
          [
            userId,
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            recordId,
            { objective: "must roll back" },
          ],
        ),
      "P0003",
      /work_sync_receipt_capacity/u,
    );
    const rolledBack = await database.query(
      "select count(*)::integer count from public.work_saved_records where owner_id=$1",
      [userId],
    );
    assert.equal(rolledBack.rows[0].count, 0);

    const legacyReplay = await database.query(
      "select public.delete_work_saved_record($1,$2,$3,1) result",
      [userId, "70000000-0000-4000-8000-000000000001", recordId],
    );
    assert.equal(legacyReplay.rows[0].result.id, recordId);

    await database.query(
      "update public.work_sync_mutations set created_at=now()-interval '8 days' where owner_id=$1",
      [userId],
    );
    await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'task','After retention',$4,0)`,
      [
        userId,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        recordId,
        { objective: "autonomous pruning" },
      ],
    );
    const pruned = await database.query(
      "select count(*)::integer count from public.work_sync_mutations where owner_id=$1",
      [userId],
    );
    assert.equal(pruned.rows[0].count, 1);

    await database.query(
      `select public.upsert_work_saved_record($1,$2,$3,'task','Other owner',$4,0)`,
      [
        otherUserId,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "88888888-8888-4888-8888-888888888888",
        { objective: "allowed" },
      ],
    );
    const index = await database.query(
      "select indexdef from pg_indexes where schemaname='public' and indexname='work_sync_mutations_owner_created_idx'",
    );
    assert.equal(index.rows.length, 1);
    assert.match(index.rows[0].indexdef, /\(owner_id, created_at\)/u);
  } finally {
    await database.close();
  }
});

test("hardening helpers and replacement RPCs remain invoker-only and service-only", async () => {
  const database = await createBaseDatabase();
  try {
    await database.exec(hardeningMigration);
    const functions = await database.query(`
      select proname,prosecdef,proconfig
      from pg_proc
      where proname in (
        'work_sync_request_fingerprint','work_sync_payload_depth_allowed',
        'enforce_work_sync_receipt_capacity','enforce_work_saved_payload_capacity',
        'upsert_work_saved_record','delete_work_saved_record','mutate_work_recent_item'
      )
      order by proname
    `);
    assert.equal(functions.rows.length, 7);
    for (const row of functions.rows) {
      assert.equal(row.prosecdef, false);
      assert.deepEqual(row.proconfig, ['search_path=""']);
    }

    const privileges = await database.query(`
      select
        has_function_privilege(
          'authenticated',
          'public.work_sync_request_fingerprint(jsonb)',
          'EXECUTE'
        ) authenticated_helper,
        has_function_privilege(
          'service_role',
          'public.work_sync_request_fingerprint(jsonb)',
          'EXECUTE'
        ) service_helper,
        has_function_privilege(
          'authenticated',
          'public.upsert_work_saved_record(uuid,uuid,uuid,text,text,jsonb,bigint)',
          'EXECUTE'
        ) authenticated_mutation,
        has_function_privilege(
          'service_role',
          'public.upsert_work_saved_record(uuid,uuid,uuid,text,text,jsonb,bigint)',
          'EXECUTE'
        ) service_mutation
    `);
    assert.deepEqual(privileges.rows, [
      {
        authenticated_helper: false,
        service_helper: true,
        authenticated_mutation: false,
        service_mutation: true,
      },
    ]);
    assert.doesNotMatch(hardeningMigration, /insert into public\.account_audit_entries/iu);
    assert.doesNotMatch(hardeningMigration, /security definer/iu);
  } finally {
    await database.close();
  }
});
