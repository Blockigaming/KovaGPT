import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationsDirectory = new URL(
  "../../supabase/migrations/",
  import.meta.url,
);

async function loadMigration() {
  const names = (await readdir(migrationsDirectory)).filter((name) =>
    name.endsWith("_storage_bucket_and_default_privilege_reconciliation.sql"),
  );
  assert.equal(
    names.length,
    1,
    "expected exactly one storage/default-privilege migration",
  );
  return readFile(new URL(names[0], migrationsDirectory), "utf8");
}

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE outsider;

    CREATE SCHEMA auth;
    CREATE SCHEMA storage;

    CREATE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$ SELECT NULL::uuid $$;

    CREATE FUNCTION storage.foldername(input text)
    RETURNS text[]
    LANGUAGE sql
    IMMUTABLE
    AS $$ SELECT string_to_array(input, '/') $$;

    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );

    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('agent-evidence', 'agent-evidence', false, 5242880, ARRAY['image/png']);

    CREATE POLICY "agent evidence owner read"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'agent-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
    CREATE POLICY "Owners read agent evidence"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'agent-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);

    CREATE TABLE public.existing_client_table (id integer PRIMARY KEY);
    GRANT SELECT ON public.existing_client_table TO anon, authenticated;
  `);
  return database;
}

test("bucket reconciliation is exact and idempotent", async () => {
  const database = await createDatabase();
  try {
    const migration = await loadMigration();
    await database.exec(migration);
    await database.exec(migration);

    const buckets = await database.query(`
      SELECT id, public, file_size_limit, allowed_mime_types
      FROM storage.buckets
      ORDER BY id
    `);
    assert.deepEqual(buckets.rows, [
      {
        id: "agent-evidence",
        public: false,
        file_size_limit: 10485760,
        allowed_mime_types: [
          "image/png",
          "image/jpeg",
          "text/plain",
          "application/json",
        ],
      },
      {
        id: "library-images",
        public: false,
        file_size_limit: 8388608,
        allowed_mime_types: [
          "image/png",
          "image/jpeg",
          "image/jpg",
          "image/webp",
          "image/gif",
        ],
      },
    ]);

    const policies = await database.query(`
      SELECT policyname, roles
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND qual LIKE '%agent-evidence%'
      ORDER BY policyname
    `);
    assert.deepEqual(policies.rows, [
      { policyname: "Owners read agent evidence", roles: ["authenticated"] },
    ]);
  } finally {
    await database.close();
  }
});

test("default ACL hardening affects future postgres-owned objects only", async () => {
  const database = await createDatabase();
  try {
    await database.exec(await loadMigration());
    await database.exec(`
      CREATE TABLE public.future_table (id integer PRIMARY KEY);
      CREATE SEQUENCE public.future_sequence;
      CREATE FUNCTION public.future_function()
      RETURNS void
      LANGUAGE plpgsql
      AS $$ BEGIN NULL; END $$;
    `);

    const privileges = await database.query(`
      SELECT
        has_table_privilege('anon', 'public.existing_client_table', 'SELECT') AS existing_anon,
        has_table_privilege('authenticated', 'public.existing_client_table', 'SELECT')
          AS existing_authenticated,
        has_table_privilege('anon', 'public.future_table', 'SELECT') AS future_table_anon,
        has_table_privilege('authenticated', 'public.future_table', 'SELECT')
          AS future_table_authenticated,
        has_sequence_privilege('anon', 'public.future_sequence', 'USAGE') AS future_sequence_anon,
        has_sequence_privilege('authenticated', 'public.future_sequence', 'USAGE')
          AS future_sequence_authenticated,
        has_function_privilege('anon', 'public.future_function()', 'EXECUTE')
          AS future_function_anon,
        has_function_privilege('authenticated', 'public.future_function()', 'EXECUTE')
          AS future_function_authenticated,
        has_function_privilege('outsider', 'public.future_function()', 'EXECUTE')
          AS future_function_public
    `);
    assert.deepEqual(privileges.rows, [
      {
        existing_anon: true,
        existing_authenticated: true,
        future_table_anon: false,
        future_table_authenticated: false,
        future_sequence_anon: false,
        future_sequence_authenticated: false,
        // PostgreSQL's implicit PUBLIC function EXECUTE default is role-global.
        // This narrow public-schema migration intentionally leaves it unchanged.
        future_function_anon: true,
        future_function_authenticated: true,
        future_function_public: true,
      },
    ]);
  } finally {
    await database.close();
  }
});

test("migration remains deliberately narrower than the unbounded project-file path", async () => {
  const migration = await loadMigration();
  assert.doesNotMatch(migration, /project-files/iu);
  assert.match(migration, /FOR ROLE postgres IN SCHEMA public/iu);
  assert.doesNotMatch(migration, /ON FUNCTIONS/iu);
  assert.doesNotMatch(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE (?!postgres\b)/iu,
  );
  assert.doesNotMatch(migration, /REVOKE[\s\S]*FROM[^;]*service_role/iu);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\s+TABLE\b/iu);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/iu);
});
