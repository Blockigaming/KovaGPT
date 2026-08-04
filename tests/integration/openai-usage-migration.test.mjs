import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "supabase/migrations/20260803130000_ai_usage_accounting.sql",
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  `);
  await db.exec(migration);
  return db;
}

test("AI usage migration applies and atomic reservation state machine reconciles exactly once", async () => {
  const db = await database();
  const insertedUser = await db.query("insert into auth.users default values returning id");
  const userId = insertedUser.rows[0].id;
  const args = [
    "request-12345678",
    "idem-12345678",
    userId,
    null,
    null,
    "medium",
    "free",
    false,
    "gpt-4.1-mini",
    100,
    600,
    0.001,
    false,
    1000,
    5000,
    10,
    5,
    10,
    2,
    120,
    "2026-08-01T00:00:00Z",
    "2026-09-01T00:00:00Z",
  ];
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  const first = await db.query(`select * from acquire_ai_generation(${placeholders})`, args);
  assert.equal(first.rows[0].decision, "acquired");
  const duplicate = await db.query(`select * from acquire_ai_generation(${placeholders})`, args);
  assert.equal(duplicate.rows[0].decision, "duplicate");
  const eventId = first.rows[0].event_id;
  const finalized = await db.query(
    "select finalize_ai_generation($1,'completed',100,10,40,0,0.0001,250,'{}'::jsonb,null) as ok",
    [eventId],
  );
  assert.equal(finalized.rows[0].ok, true);
  const secondFinalize = await db.query(
    "select finalize_ai_generation($1,'completed',100,10,40,0,0.0001,250,'{}'::jsonb,null) as ok",
    [eventId],
  );
  assert.equal(secondFinalize.rows[0].ok, false);
  const row = await db.query(
    "select status,input_tokens,cached_input_tokens,output_tokens,actual_billable_tokens,lease_expires_at from ai_usage_events where id=$1",
    [eventId],
  );
  assert.deepEqual(row.rows[0], {
    status: "completed",
    input_tokens: 100,
    cached_input_tokens: 10,
    output_tokens: 40,
    actual_billable_tokens: 140,
    lease_expires_at: null,
  });
  await db.close();
});

test("AI usage migration enables RLS and limits browser grants to owner-scoped select", async () => {
  const db = await database();
  const rls = await db.query(
    "select relrowsecurity from pg_class where oid='public.ai_usage_events'::regclass",
  );
  assert.equal(rls.rows[0].relrowsecurity, true);
  const privileges = await db.query(
    "select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='ai_usage_events' and grantee='authenticated'",
  );
  assert.deepEqual(
    privileges.rows.map((row) => row.privilege_type),
    ["SELECT"],
  );
  await db.close();
});
