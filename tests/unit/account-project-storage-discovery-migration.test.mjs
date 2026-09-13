import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "423e4567-e89b-42d3-a456-426614174000";
const migrations = new URL("../../supabase/migrations/", import.meta.url);

async function createDatabase() {
  const migrationFiles = (await readdir(migrations)).filter((name) =>
    name.endsWith("_account_project_storage_discovery.sql"),
  );
  assert.equal(migrationFiles.length, 1);
  const migration = await readFile(new URL(migrationFiles[0], migrations), "utf8");
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE outsider;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL,
      owner_id text,
      owner uuid
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public, storage TO service_role;
    GRANT SELECT ON storage.objects TO service_role;
    -- Simulate a platform that grants client RPC execution by default.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
  `);
  await db.exec(migration);
  await db.exec(migration);
  return db;
}

test("ownership discovery is service-only, read-only and bounded even without project metadata", async () => {
  const db = await createDatabase();
  try {
    await db.query(
      `
      INSERT INTO storage.objects(bucket_id,name,owner_id,owner) VALUES
      ('project-files','project/a-unregistered.txt',$1,NULL),
      ('project-files','project/b-legacy.txt',NULL,$1::uuid),
      ('project-files','project/c-other-owner.txt',$2,$1::uuid),
      ('project-files','project/d-service-owned.txt',NULL,NULL),
      ('library-images','user/image.png',$1,NULL)
    `,
      [OWNER, OTHER],
    );
    const privileges = await db.query(`
      SELECT role,
        has_function_privilege(role, 'public.list_account_project_storage_objects(uuid,integer)', 'EXECUTE') AS allowed
      FROM unnest(ARRAY['anon','authenticated','outsider','service_role']) AS role
      ORDER BY role
    `);
    assert.deepEqual(privileges.rows, [
      { role: "anon", allowed: false },
      { role: "authenticated", allowed: false },
      { role: "outsider", allowed: false },
      { role: "service_role", allowed: true },
    ]);
    const security = await db.query(`
      SELECT prosecdef FROM pg_proc
      WHERE oid = 'public.list_account_project_storage_objects(uuid,integer)'::regprocedure
    `);
    assert.equal(
      security.rows[0].prosecdef,
      false,
      "discovery must not elevate database privileges",
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      () =>
        db.query("SELECT * FROM public.list_account_project_storage_objects($1, 1000)", [OWNER]),
      /permission denied/u,
    );
    await db.exec("RESET ROLE; SET ROLE service_role");
    assert.deepEqual(
      (await db.query("SELECT * FROM public.list_account_project_storage_objects($1, 1)", [OWNER]))
        .rows,
      [{ name: "project/a-unregistered.txt", owner_id: OWNER }],
    );
    assert.deepEqual(
      (
        await db.query("SELECT * FROM public.list_account_project_storage_objects($1, 1000)", [
          OWNER,
        ])
      ).rows,
      [
        { name: "project/a-unregistered.txt", owner_id: OWNER },
        { name: "project/b-legacy.txt", owner_id: OWNER },
      ],
    );
    assert.deepEqual(
      (
        await db.query("SELECT * FROM public.list_account_project_storage_objects($1, 1000)", [
          OTHER,
        ])
      ).rows,
      [{ name: "project/c-other-owner.txt", owner_id: OTHER }],
    );
    for (const limit of [0, -1, 1001, null]) {
      await assert.rejects(
        () =>
          db.query("SELECT * FROM public.list_account_project_storage_objects($1, $2)", [
            OWNER,
            limit,
          ]),
        /invalid_account_storage_discovery_arguments/u,
      );
    }
    await assert.rejects(
      () => db.query("SELECT * FROM public.list_account_project_storage_objects(NULL, 1000)"),
      /invalid_account_storage_discovery_arguments/u,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM storage.objects")).rows[0].count,
      5,
    );
  } finally {
    await db.close();
  }
});
