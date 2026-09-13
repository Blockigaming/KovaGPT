import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "423e4567-e89b-42d3-a456-426614174000";
const PROJECT = "523e4567-e89b-42d3-a456-426614174000";

test("account discovery collects final service-owned Work sources while retaining other live owners", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA storage;
      CREATE TABLE storage.objects(bucket_id text,name text,owner_id text,owner uuid);
      CREATE TABLE public.agent_deliverables(owner_id uuid,storage_reference text,status text);
      CREATE TABLE public.projects(id uuid,owner_id uuid);
      CREATE TABLE public.project_files(project_id uuid,uploaded_by uuid,storage_path text);
      CREATE TABLE public.project_storage_retained_charges(file_id uuid,storage_path text,owner_id uuid,size_bytes bigint);
      CREATE TABLE public.project_storage_source_provenance(storage_path text,owner_id uuid,uploaded_by uuid);
      CREATE TABLE public.project_storage_source_access(storage_path text,principal_id uuid);
      CREATE TABLE public.account_storage_artifacts(bucket text,storage_path text,state text,owner_id uuid,requester_id uuid);
      CREATE TABLE public.user_storage(user_id uuid,bytes_used bigint,updated_at timestamptz);
    `);
    const migration = await readFile(
      new URL(
        "../../supabase/migrations/20260904231310_account_project_file_lifecycle.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(
      migration.slice(
        migration.indexOf(
          "CREATE OR REPLACE FUNCTION public.list_account_project_storage_objects(",
        ),
      ),
    );
    for (const name of ["collect", "work-keeps", "project-keeps", "other-auth-keeps"]) {
      const path = PROJECT + "/" + name + ".txt";
      await db.query("INSERT INTO storage.objects VALUES('project-files',$1,$2,NULL)", [
        path,
        name === "other-auth-keeps" ? OTHER : null,
      ]);
      await db.query("INSERT INTO public.project_storage_source_provenance VALUES($1,$2,$2)", [
        path,
        OWNER,
      ]);
      await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,'ready')", [
        OWNER,
        "project-files:" + path,
      ]);
    }
    await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,'ready')", [
      OTHER,
      "project-files:" + PROJECT + "/work-keeps.txt",
    ]);
    await db.query("INSERT INTO public.projects VALUES($1,$2)", [PROJECT, OTHER]);
    await db.query("INSERT INTO public.project_files VALUES($1,$2,$3)", [
      PROJECT,
      OTHER,
      PROJECT + "/project-keeps.txt",
    ]);
    // Storage was removed in an earlier failed request, while its durable
    // charge still needs settlement. The old file id is never reused.
    await db.query("INSERT INTO public.project_storage_retained_charges VALUES($1,$2,$3,10)", [
      PROJECT,
      PROJECT + "/missing.txt",
      OWNER,
    ]);
    await db.query("INSERT INTO public.user_storage VALUES($1,10,now())", [OWNER]);
    assert.deepEqual(
      (
        await db.query("SELECT * FROM public.list_account_project_storage_objects($1,1000)", [
          OWNER,
        ])
      ).rows,
      [
        { name: PROJECT + "/collect.txt", owner_id: null },
        { name: PROJECT + "/missing.txt", owner_id: null },
      ],
    );
    await db.query("SELECT public.settle_account_project_storage_charges($1)", [
      [PROJECT + "/missing.txt"],
    ]);
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      0,
    );
    await db.query("DELETE FROM storage.objects WHERE name=$1", [PROJECT + "/collect.txt"]);
    assert.deepEqual(
      (
        await db.query("SELECT * FROM public.list_account_project_storage_objects($1,1000)", [
          OWNER,
        ])
      ).rows,
      [],
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('authenticated','public.settle_account_project_storage_charges(text[])','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
