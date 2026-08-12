import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = "supabase/migrations/20260803110000_release_security_hardening.sql";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;

    CREATE TABLE public.processed_stripe_events (
      event_id text PRIMARY KEY,
      type text NOT NULL,
      environment text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE FUNCTION public.enqueue_email(text, jsonb) RETURNS bigint
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1::bigint $$;
    CREATE FUNCTION public.read_email_batch(text, integer, integer) RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT '[]'::jsonb $$;
    CREATE FUNCTION public.delete_email(text, bigint) RETURNS void
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
    CREATE FUNCTION public.move_to_dlq(text, text, bigint, jsonb) RETURNS void
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT $$;
    CREATE FUNCTION public.try_increment_daily_usage(uuid, text, integer, integer) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
    CREATE FUNCTION public.try_add_storage_bytes(uuid, bigint, bigint) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
    CREATE FUNCTION public.is_family_member(uuid, uuid) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT false $$;
    CREATE FUNCTION public.family_owner_of(uuid) RETURNS uuid
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::uuid $$;

    GRANT ALL ON public.processed_stripe_events TO anon, authenticated;
  `);
  return database;
}

async function migrationSql() {
  return readFile(migrationPath, "utf8");
}

test("release hardening indexes the real processed_at column and is idempotent", async () => {
  const database = await createDatabase();
  try {
    const migration = await migrationSql();
    await database.exec(migration);
    await database.exec(migration);

    const indexes = await database.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'processed_stripe_events'
        AND indexname LIKE 'processed_stripe_events_%_at_idx'
      ORDER BY indexname
    `);
    assert.deepEqual(indexes.rows, [
      {
        indexname: "processed_stripe_events_processed_at_idx",
        indexdef:
          "CREATE INDEX processed_stripe_events_processed_at_idx ON public.processed_stripe_events USING btree (processed_at)",
      },
    ]);

    const columns = await database.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'processed_stripe_events'
      ORDER BY ordinal_position
    `);
    assert.deepEqual(
      columns.rows.map(({ column_name }) => column_name),
      ["event_id", "type", "environment", "processed_at", "correlation_id"],
    );
  } finally {
    await database.close();
  }
});

test("release hardening preserves privilege lockdown", async () => {
  const database = await createDatabase();
  try {
    await database.exec(await migrationSql());
    const result = await database.query(`
      SELECT
        has_table_privilege('anon', 'public.processed_stripe_events', 'SELECT') AS anon_select,
        has_table_privilege('authenticated', 'public.processed_stripe_events', 'INSERT') AS authenticated_insert
    `);
    assert.deepEqual(result.rows, [{ anon_select: false, authenticated_insert: false }]);
  } finally {
    await database.close();
  }
});

test("migration contains no stale created_at index or synthetic created_at column", async () => {
  const migration = await migrationSql();
  assert.match(migration, /processed_stripe_events_processed_at_idx/u);
  assert.match(migration, /processed_stripe_events\(processed_at\)/u);
  assert.doesNotMatch(migration, /processed_stripe_events_created_at_idx/u);
  assert.doesNotMatch(migration, /add column if not exists created_at/iu);
});
