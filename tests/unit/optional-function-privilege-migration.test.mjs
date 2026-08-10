import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "supabase/migrations/20260702142256_b1d45ef2-76ad-4dab-b773-9725f47fccfc.sql";

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE outsider;
  `);
  return database;
}

async function loadMigration() {
  return readFile(migrationPath, "utf8");
}

test("optional privilege lockdown is a no-op when dynamic functions and feature flags are absent", async () => {
  const database = await createDatabase();
  try {
    await database.exec(await loadMigration());
    const result = await database.query(`
      SELECT
        to_regprocedure('public.email_queue_wake()') IS NULL AS wake_absent,
        to_regprocedure('public.email_queue_dispatch()') IS NULL AS dispatch_absent,
        to_regclass('public.feature_flags') IS NULL AS flags_absent
    `);
    assert.deepEqual(result.rows, [
      {
        wake_absent: true,
        dispatch_absent: true,
        flags_absent: true,
      },
    ]);
  } finally {
    await database.close();
  }
});

test("existing functions lose public, anon, and authenticated execute without changing service-role access or function body", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      CREATE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
      RETURNS bigint
      LANGUAGE sql
      SECURITY DEFINER
      AS $$ SELECT 42::bigint $$;

      CREATE FUNCTION public.email_queue_dispatch()
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$ BEGIN NULL; END $$;

      GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)
        TO PUBLIC, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION public.email_queue_dispatch()
        TO PUBLIC, anon, authenticated, service_role;
    `);

    const before = await database.query(`
      SELECT pg_get_functiondef('public.enqueue_email(text,jsonb)'::regprocedure) AS definition
    `);

    await database.exec(await loadMigration());

    const privileges = await database.query(`
      SELECT
        has_function_privilege('anon', 'public.enqueue_email(text,jsonb)', 'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated', 'public.enqueue_email(text,jsonb)', 'EXECUTE') AS authenticated_execute,
        has_function_privilege('outsider', 'public.enqueue_email(text,jsonb)', 'EXECUTE') AS public_execute,
        has_function_privilege('service_role', 'public.enqueue_email(text,jsonb)', 'EXECUTE') AS service_execute,
        has_function_privilege('anon', 'public.email_queue_dispatch()', 'EXECUTE') AS dispatch_anon_execute,
        has_function_privilege('service_role', 'public.email_queue_dispatch()', 'EXECUTE') AS dispatch_service_execute
    `);
    assert.deepEqual(privileges.rows, [
      {
        anon_execute: false,
        authenticated_execute: false,
        public_execute: false,
        service_execute: true,
        dispatch_anon_execute: false,
        dispatch_service_execute: true,
      },
    ]);

    const after = await database.query(`
      SELECT pg_get_functiondef('public.enqueue_email(text,jsonb)'::regprocedure) AS definition
    `);
    assert.equal(after.rows[0].definition, before.rows[0].definition);
  } finally {
    await database.close();
  }
});

test("existing feature flags table loses anon select while other roles are not granted access", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      CREATE TABLE public.feature_flags (
        key text PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT false
      );
      GRANT SELECT ON public.feature_flags TO anon;
    `);

    await database.exec(await loadMigration());

    const result = await database.query(`
      SELECT
        has_table_privilege('anon', 'public.feature_flags', 'SELECT') AS anon_select,
        has_table_privilege('authenticated', 'public.feature_flags', 'SELECT') AS authenticated_select,
        has_table_privilege('service_role', 'public.feature_flags', 'SELECT') AS service_select
    `);
    assert.deepEqual(result.rows, [
      {
        anon_select: false,
        authenticated_select: false,
        service_select: false,
      },
    ]);
  } finally {
    await database.close();
  }
});

test("migration mutates privileges only and never creates optional objects", async () => {
  const migration = await loadMigration();
  assert.match(migration, /to_regprocedure\(function_signature\)/u);
  assert.match(migration, /to_regclass\('public\.feature_flags'\)/u);
  assert.doesNotMatch(migration, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/iu);
  assert.doesNotMatch(migration, /GRANT\s+(?:EXECUTE|SELECT)/iu);
  assert.doesNotMatch(migration, /DROP\s+(?:FUNCTION|TABLE)/iu);
});
