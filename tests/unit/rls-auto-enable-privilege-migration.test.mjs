import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationDirectory = new URL("../../supabase/migrations/", import.meta.url);

async function loadMigration() {
  const names = (await readdir(migrationDirectory)).filter((name) =>
    name.endsWith("_rls_auto_enable_privilege_lockdown.sql"),
  );
  assert.equal(names.length, 1, "expected exactly one RLS trigger privilege migration");
  return readFile(new URL(names[0], migrationDirectory), "utf8");
}

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

test("RLS trigger privilege migration is a no-op when the function is absent", async () => {
  const database = await createDatabase();
  try {
    await database.exec(await loadMigration());
    const result = await database.query(`
      SELECT to_regprocedure('public.rls_auto_enable()') IS NULL AS function_absent
    `);
    assert.deepEqual(result.rows, [{ function_absent: true }]);
  } finally {
    await database.close();
  }
});

test("browser-role revocation is idempotent while the live security-definer contract remains intact", async () => {
  const database = await createDatabase();
  try {
    await database.exec(`
      CREATE FUNCTION public.rls_auto_enable()
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog
      AS $$ BEGIN NULL; END $$;

      GRANT EXECUTE ON FUNCTION public.rls_auto_enable()
        TO PUBLIC, anon, authenticated, service_role;
    `);

    const before = await database.query(`
      SELECT pg_get_functiondef('public.rls_auto_enable()'::regprocedure) AS definition
    `);

    const migration = await loadMigration();
    await database.exec(migration);
    await database.exec(migration);

    const privileges = await database.query(`
      SELECT
        has_function_privilege(
          'anon',
          'public.rls_auto_enable()',
          'EXECUTE'
        ) AS anon_execute,
        has_function_privilege(
          'authenticated',
          'public.rls_auto_enable()',
          'EXECUTE'
        ) AS authenticated_execute,
        has_function_privilege(
          'outsider',
          'public.rls_auto_enable()',
          'EXECUTE'
        ) AS public_execute,
        has_function_privilege(
          'service_role',
          'public.rls_auto_enable()',
          'EXECUTE'
        ) AS service_execute
    `);
    assert.deepEqual(privileges.rows, [
      {
        anon_execute: false,
        authenticated_execute: false,
        public_execute: false,
        service_execute: true,
      },
    ]);

    const after = await database.query(`
      SELECT pg_get_functiondef('public.rls_auto_enable()'::regprocedure) AS definition
    `);
    assert.equal(after.rows[0].definition, before.rows[0].definition);
  } finally {
    await database.close();
  }
});

test("migration changes privileges only", async () => {
  const migration = await loadMigration();
  assert.match(migration, /to_regprocedure\('public\.rls_auto_enable\(\)'\)/u);
  assert.match(
    migration,
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rls_auto_enable\(\)[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/iu,
  );
  assert.doesNotMatch(migration, /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/iu);
  assert.doesNotMatch(migration, /ALTER\s+FUNCTION/iu);
  assert.doesNotMatch(migration, /DROP\s+FUNCTION/iu);
  assert.doesNotMatch(migration, /(?:CREATE|ALTER|DROP)\s+EVENT\s+TRIGGER/iu);
  assert.doesNotMatch(migration, /GRANT\s+EXECUTE/iu);
  assert.doesNotMatch(
    migration,
    /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.rls_auto_enable\(\)[\s\S]*?\bservice_role\b/iu,
  );
});
