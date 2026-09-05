import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const FILE = "123e4567-e89b-42d3-a456-426614174000";
const ATTEMPT = "423e4567-e89b-42d3-a456-426614174000";
const PROJECT = "523e4567-e89b-42d3-a456-426614174000";

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE public.project_files(id uuid PRIMARY KEY,project_id uuid,upload_attempt_id uuid,status text,upload_lease_until timestamptz,updated_at timestamptz,storage_owner_id uuid,uploaded_by uuid,storage_path text);
      CREATE TABLE public.artifacts(generation uuid PRIMARY KEY,allowed boolean,published boolean DEFAULT false);
      CREATE FUNCTION public.lock_project_for_file_operation(p_file_id uuid) RETURNS uuid LANGUAGE SQL AS $$ SELECT project_id FROM public.project_files WHERE id=p_file_id $$;
      CREATE FUNCTION public.settle_account_storage_artifact(p_generation uuid,p_owner uuid,p_requester uuid,p_bucket text,p_path text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
        UPDATE public.artifacts SET published=true WHERE generation=p_generation AND allowed AND p_owner='${PROJECT}' AND p_requester='${PROJECT}' AND p_bucket='project-files' AND p_path='${PROJECT}/${ATTEMPT}.txt';
        RETURN FOUND;
      END $$;
    `);
    const migration = await readFile(
      new URL(
        "../../supabase/migrations/20260904200000_project_file_upload_integrity.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const fn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.set_project_file_upload_state("),
      migration.indexOf("REVOKE ALL ON FUNCTION public.set_project_file_upload_state"),
    );
    await db.exec(fn);
    await db.query(
      "INSERT INTO public.project_files VALUES($1,$2,$3,'pending',now()+interval '2 minutes',now(),$2,$2,$4)",
      [FILE, PROJECT, ATTEMPT, `${PROJECT}/${ATTEMPT}.txt`],
    );
    await db.query("INSERT INTO public.artifacts(generation,allowed) VALUES($1,false)", [ATTEMPT]);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

test("ready publication and generation settlement share one database transaction", async () => {
  const db = await fixture();
  try {
    assert.equal(
      (
        await db.query("SELECT public.set_project_file_upload_state($1,$2,'ready') AS ready", [
          FILE,
          ATTEMPT,
        ])
      ).rows[0].ready,
      false,
    );
    assert.equal(
      (await db.query("SELECT status FROM public.project_files")).rows[0].status,
      "pending",
    );
    await db.exec("UPDATE public.artifacts SET allowed=true");
    // Simulate a later metadata fence rejecting publication after settlement.
    await db.exec(
      `CREATE FUNCTION public.block_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='ready' THEN RAISE EXCEPTION 'metadata_fenced'; END IF;RETURN NEW;END $$;CREATE TRIGGER ready_fence BEFORE UPDATE ON public.project_files FOR EACH ROW EXECUTE FUNCTION public.block_ready()`,
    );
    await assert.rejects(
      () => db.query("SELECT public.set_project_file_upload_state($1,$2,'ready')", [FILE, ATTEMPT]),
      /metadata_fenced/,
    );
    assert.equal(
      (await db.query("SELECT published FROM public.artifacts")).rows[0].published,
      false,
    );
    await db.exec("DROP TRIGGER ready_fence ON public.project_files");
    assert.equal(
      (
        await db.query("SELECT public.set_project_file_upload_state($1,$2,'ready') AS ready", [
          FILE,
          ATTEMPT,
        ])
      ).rows[0].ready,
      true,
    );
    assert.equal(
      (await db.query("SELECT published FROM public.artifacts")).rows[0].published,
      true,
    );
    assert.equal(
      (await db.query("SELECT status FROM public.project_files")).rows[0].status,
      "ready",
    );
  } finally {
    await db.close();
  }
});

test("expired or displaced attempts never settle a generation", async () => {
  const db = await fixture();
  try {
    await db.exec(
      "UPDATE public.artifacts SET allowed=true;UPDATE public.project_files SET upload_lease_until=now()-interval '1 second'",
    );
    assert.equal(
      (
        await db.query("SELECT public.set_project_file_upload_state($1,$2,'ready') AS ready", [
          FILE,
          ATTEMPT,
        ])
      ).rows[0].ready,
      false,
    );
    assert.equal(
      (await db.query("SELECT published FROM public.artifacts")).rows[0].published,
      false,
    );
    await db.exec("UPDATE public.project_files SET upload_lease_until=now()+interval '1 minute'");
    assert.equal(
      (
        await db.query("SELECT public.set_project_file_upload_state($1,$2,'ready') AS ready", [
          FILE,
          PROJECT,
        ])
      ).rows[0].ready,
      false,
    );
    assert.equal(
      (await db.query("SELECT published FROM public.artifacts")).rows[0].published,
      false,
    );
  } finally {
    await db.close();
  }
});
