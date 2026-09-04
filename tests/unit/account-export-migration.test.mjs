import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = "supabase/migrations/20260903203000_account_data_exports.sql";
const userId = "11111111-1111-4111-8111-111111111111";
const workerId = "export-worker-123";
const artifactId = "33333333-3333-4333-8333-333333333333";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
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
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT null::uuid $$;
    INSERT INTO auth.users(id) VALUES ('${userId}');
  `);
  await database.exec(await readFile(migrationPath, "utf8"));
  return database;
}

test("account export jobs lease and settle exactly once", async () => {
  const database = await createDatabase();
  try {
    const inserted = await database.query(
      "INSERT INTO public.account_export_jobs(user_id) VALUES ($1) RETURNING id",
      [userId],
    );
    const jobId = inserted.rows[0].id;
    const claimed = await database.query(
      "SELECT id,status,attempts FROM public.claim_account_export_jobs($1,1,180)",
      [workerId],
    );
    assert.deepEqual(claimed.rows, [{ id: jobId, status: "processing", attempts: 1 }]);

    const wrongPath = await database.query(
      "SELECT public.settle_account_export_success($1,$2,$3,$4,$5) AS ok",
      [
        jobId,
        workerId,
        `44444444-4444-4444-8444-444444444444/${jobId}/${artifactId}.json`,
        "a".repeat(64),
        1234,
      ],
    );
    assert.deepEqual(wrongPath.rows, [{ ok: false }]);

    const settled = await database.query(
      "SELECT public.settle_account_export_success($1,$2,$3,$4,$5) AS ok",
      [jobId, workerId, `${userId}/${jobId}/${artifactId}.json`, "a".repeat(64), 1234],
    );
    assert.deepEqual(settled.rows, [{ ok: true }]);
    const duplicate = await database.query(
      "SELECT public.settle_account_export_success($1,$2,$3,$4,$5) AS ok",
      [jobId, workerId, `${userId}/${jobId}/${artifactId}.json`, "a".repeat(64), 1234],
    );
    assert.deepEqual(duplicate.rows, [{ ok: false }]);

    const audit = await database.query(
      "SELECT event_type,result,target_id FROM public.account_audit_entries",
    );
    assert.deepEqual(audit.rows, [
      { event_type: "account_export", result: "success", target_id: jobId },
    ]);
  } finally {
    await database.close();
  }
});

test("one user cannot create concurrent export jobs", async () => {
  const database = await createDatabase();
  try {
    await database.query("INSERT INTO public.account_export_jobs(user_id) VALUES ($1)", [userId]);
    await assert.rejects(
      () => database.query("INSERT INTO public.account_export_jobs(user_id) VALUES ($1)", [userId]),
      /account_export_jobs_one_active_per_user/u,
    );
  } finally {
    await database.close();
  }
});

test("only the service role can invoke export worker functions", async () => {
  const database = await createDatabase();
  try {
    const privileges = await database.query(`
      SELECT
        has_function_privilege('anon','public.claim_account_export_jobs(text,integer,integer)','EXECUTE') AS anon_execute,
        has_function_privilege('authenticated','public.claim_account_export_jobs(text,integer,integer)','EXECUTE') AS authenticated_execute,
        has_function_privilege('service_role','public.claim_account_export_jobs(text,integer,integer)','EXECUTE') AS service_execute
    `);
    assert.deepEqual(privileges.rows, [
      { anon_execute: false, authenticated_execute: false, service_execute: true },
    ]);
    const definition = await database.query(`
      SELECT prosecdef, proconfig
      FROM pg_proc
      WHERE oid = 'public.claim_account_export_jobs(text,integer,integer)'::regprocedure
    `);
    assert.equal(definition.rows[0].prosecdef, false);
    assert.deepEqual(definition.rows[0].proconfig, ['search_path=""']);
  } finally {
    await database.close();
  }
});

test("the export bucket is private and bounded", async () => {
  const database = await createDatabase();
  try {
    const bucket = await database.query(
      "SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='account-exports'",
    );
    assert.deepEqual(bucket.rows, [
      {
        public: false,
        file_size_limit: 52428800,
        allowed_mime_types: ["application/json"],
      },
    ]);
  } finally {
    await database.close();
  }
});
