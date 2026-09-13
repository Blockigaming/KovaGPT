import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../../supabase/migrations/20260906230506_remove_duplicate_performance_indexes.sql",
  import.meta.url,
);

async function createFixture({ mismatchedDailyIndex = false } = {}) {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public.daily_usage (
      user_id uuid NOT NULL,
      usage_date date NOT NULL,
      used integer NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, usage_date)
    );
    CREATE UNIQUE INDEX daily_usage_user_date_uidx
      ON public.daily_usage (${mismatchedDailyIndex ? "usage_date, user_id" : "user_id, usage_date"});

    CREATE TABLE public.user_library_items (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX user_library_items_user_id_created_idx
      ON public.user_library_items (user_id, created_at DESC);
    CREATE INDEX idx_user_library_items_user_created
      ON public.user_library_items (user_id, created_at DESC);

    CREATE TABLE public.writing_document_versions (
      id uuid PRIMARY KEY,
      document_id uuid NOT NULL,
      version integer NOT NULL
    );
    CREATE INDEX writing_versions_document_latest_idx
      ON public.writing_document_versions (document_id, version DESC);
    CREATE INDEX writing_document_versions_doc_idx
      ON public.writing_document_versions (document_id, version DESC);
  `);
  return database;
}

async function migrationSql() {
  return readFile(migrationUrl, "utf8");
}

test("performance-index migration drops only the three confirmed duplicate indexes", async () => {
  const database = await createFixture();
  try {
    const migration = await migrationSql();
    await database.exec(migration);
    await database.exec(migration);

    const indexes = await database.query(`
      SELECT to_regclass(name)::text AS relation
      FROM unnest(ARRAY[
        'public.daily_usage_pkey',
        'public.daily_usage_user_date_uidx',
        'public.user_library_items_user_id_created_idx',
        'public.idx_user_library_items_user_created',
        'public.writing_versions_document_latest_idx',
        'public.writing_document_versions_doc_idx'
      ]) AS name
    `);
    assert.deepEqual(indexes.rows, [
      { relation: "daily_usage_pkey" },
      { relation: null },
      { relation: "user_library_items_user_id_created_idx" },
      { relation: null },
      { relation: "writing_versions_document_latest_idx" },
      { relation: null },
    ]);

    await database.exec(`
      INSERT INTO public.daily_usage(user_id, usage_date, used)
      VALUES ('11111111-1111-4111-8111-111111111111', '2026-09-06', 1)
      ON CONFLICT (user_id, usage_date) DO UPDATE SET used = public.daily_usage.used + 1;
    `);
    const usage = await database.query("SELECT used FROM public.daily_usage");
    assert.deepEqual(usage.rows, [{ used: 1 }]);
  } finally {
    await database.close();
  }
});

test("performance-index migration fails closed for a same-named nonduplicate index", async () => {
  const database = await createFixture({ mismatchedDailyIndex: true });
  try {
    await assert.rejects(
      database.exec(await migrationSql()),
      /daily_usage_user_date_uidx is not the expected duplicate/u,
    );
    const remaining = await database.query(
      "SELECT to_regclass('public.daily_usage_user_date_uidx')::text AS relation",
    );
    assert.deepEqual(remaining.rows, [{ relation: "daily_usage_user_date_uidx" }]);
  } finally {
    await database.close();
  }
});

test("generated schema contract excludes indexes removed by a migration", async () => {
  const contract = JSON.parse(
    await readFile(new URL("../../database-contract.json", import.meta.url), "utf8"),
  );
  for (const removed of [
    "daily_usage_user_date_uidx",
    "idx_user_library_items_user_created",
    "writing_document_versions_doc_idx",
  ]) {
    assert.equal(contract.indexes.includes(removed), false, `${removed} must not be contracted`);
  }
  assert.equal(
    contract.tables.includes("daily_usage"),
    true,
    "daily usage table must remain contracted",
  );
  for (const retained of [
    "user_library_items_user_id_created_idx",
    "writing_versions_document_latest_idx",
  ]) {
    assert.equal(contract.indexes.includes(retained), true, `${retained} must remain contracted`);
  }
});
