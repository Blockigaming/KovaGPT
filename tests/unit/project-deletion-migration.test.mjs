import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const MEMBER = "423e4567-e89b-42d3-a456-426614174000";
const PROJECT = "523e4567-e89b-42d3-a456-426614174000";
const ATTEMPT = "623e4567-e89b-42d3-a456-426614174000";

async function fixture({ activeUpload = false } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.projects(id uuid PRIMARY KEY, owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, name text);
    CREATE TABLE public.project_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE TABLE public.project_files(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE, uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, storage_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, storage_charged boolean DEFAULT true, size_bytes bigint DEFAULT 10, status text DEFAULT 'ready', account_cleanup_user_id uuid, upload_attempt_id uuid, delete_attempt_id uuid, upload_lease_until timestamptz, delete_lease_until timestamptz, updated_at timestamptz DEFAULT now(), storage_path text DEFAULT 'source');
    CREATE TABLE public.account_deletion_fences(user_id uuid PRIMARY KEY);
    CREATE TABLE public.user_storage(user_id uuid PRIMARY KEY, bytes_used bigint DEFAULT 10, updated_at timestamptz DEFAULT now());
  `);
    for (const name of [
      "project_activity",
      "project_chats",
      "project_comments",
      "project_file_chunks",
      "project_invites",
      "project_memory",
      "project_notes",
      "project_tasks",
    ]) {
      await db.exec(
        `CREATE TABLE public.${name}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE)`,
      );
    }
    for (const name of [
      "agent_resource_promotions",
      "agent_resource_relationships",
      "agent_resource_activity",
    ]) {
      await db.exec(
        `CREATE TABLE public.${name}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid REFERENCES public.projects(id), label text DEFAULT 'history')`,
      );
    }
    await db.exec(
      "ALTER TABLE public.project_file_chunks ADD COLUMN file_id uuid REFERENCES public.project_files(id) ON DELETE CASCADE",
    );
    const sql = await readFile(
      new URL(
        "../../supabase/migrations/20260904210000_project_deletion_storage_integrity.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(sql);
    await db.query("INSERT INTO auth.users VALUES ($1),($2)", [OWNER, MEMBER]);
    await db.query("INSERT INTO public.projects(id,owner_id,name) VALUES ($1,$2,'Original')", [
      PROJECT,
      OWNER,
    ]);
    await db.query("INSERT INTO public.project_members(project_id,user_id) VALUES($1,$2)", [
      PROJECT,
      MEMBER,
    ]);
    await db.query(
      "INSERT INTO public.project_files(project_id,uploaded_by,storage_owner_id) VALUES($1,$2,$2)",
      [PROJECT, MEMBER],
    );
    await db.query("INSERT INTO public.user_storage(user_id) VALUES($1)", [MEMBER]);
    await db.query(
      "INSERT INTO public.project_deletion_jobs(project_id,owner_id,status,attempt_id,lease_until) VALUES($1,$2,'deleting_storage',$3,now()+interval '1 minute')",
      [PROJECT, OWNER, ATTEMPT],
    );
    if (activeUpload)
      await db.exec(
        "UPDATE public.project_files SET status='pending',upload_lease_until=now()+interval '2 minutes'",
      );
    await db.query(
      "INSERT INTO public.project_file_chunks(project_id,file_id) SELECT project_id,id FROM public.project_files",
    );
    await db.query("UPDATE public.projects SET deletion_requested_at=now() WHERE id=$1", [PROJECT]);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260904231310_account_project_file_lifecycle.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

test("Auth cascades and FK nulling pass frozen project fences without admitting manual edits", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      () => db.query("DELETE FROM public.project_members WHERE user_id=$1", [MEMBER]),
      /project_deletion_pending/u,
    );
    await assert.rejects(
      () => db.exec("UPDATE public.project_files SET uploaded_by=NULL"),
      /project_deletion_pending/u,
    );
    await assert.rejects(
      () => db.exec("UPDATE public.project_files SET storage_path='replacement'"),
      /project_deletion_pending/u,
    );
    await db.query("DELETE FROM auth.users WHERE id=$1", [MEMBER]);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM public.project_members")).rows[0].n,
      0,
    );
    const files = await db.query(
      "SELECT uploaded_by,storage_owner_id,storage_path FROM public.project_files",
    );
    assert.deepEqual(files.rows, [
      { uploaded_by: null, storage_owner_id: null, storage_path: "source" },
    ]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.projects")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test("finalization clears restrictive agent project references while preserving their history", async () => {
  const db = await fixture();
  try {
    for (const name of [
      "agent_resource_promotions",
      "agent_resource_relationships",
      "agent_resource_activity",
    ]) {
      await db.query(`INSERT INTO public.${name}(project_id) VALUES($1)`, [PROJECT]);
    }
    const finalized = await db.query(
      "SELECT public.finalize_project_deletion($1,$2,$3) AS result",
      [OWNER, PROJECT, ATTEMPT],
    );
    assert.equal(finalized.rows[0].result.deleted, true);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.projects")).rows[0].n, 0);
    for (const name of [
      "agent_resource_promotions",
      "agent_resource_relationships",
      "agent_resource_activity",
    ]) {
      assert.deepEqual((await db.query(`SELECT project_id,label FROM public.${name}`)).rows, [
        { project_id: null, label: "history" },
      ]);
    }
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      0,
    );
    assert.equal(
      (await db.query("SELECT status FROM public.project_deletion_jobs")).rows[0].status,
      "completed",
    );
  } finally {
    await db.close();
  }
});

test("account file claims survive retries and finalize quota and RAG children atomically", async () => {
  const db = await fixture();
  try {
    const fileId = (await db.query("SELECT id FROM public.project_files")).rows[0].id;
    await assert.rejects(
      () =>
        db.query("SELECT public.claim_account_project_file_cleanup($1,$2,$3)", [
          MEMBER,
          fileId,
          ATTEMPT,
        ]),
      /fence_required/u,
    );
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [MEMBER]);
    const claim = (
      await db.query("SELECT public.claim_account_project_file_cleanup($1,$2,$3) AS result", [
        MEMBER,
        fileId,
        ATTEMPT,
      ])
    ).rows[0].result;
    assert.equal(claim.state, "claimed");
    assert.equal(claim.storage_charged, true);
    assert.equal(claim.status, "deleting");
    await assert.rejects(
      () => db.exec("UPDATE public.project_files SET status='ready'"),
      /account_file_cleanup_pending/u,
    );
    const retry = (
      await db.query(
        "SELECT public.claim_account_project_file_cleanup($1,$2,gen_random_uuid()) AS result",
        [MEMBER, fileId],
      )
    ).rows[0].result;
    assert.equal(retry.delete_attempt_id, ATTEMPT);
    await assert.rejects(
      () =>
        db.query("SELECT public.finalize_account_project_file_cleanup($1,$2,gen_random_uuid())", [
          MEMBER,
          fileId,
        ]),
      /claim_lost/u,
    );
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      10,
    );
    assert.equal(
      (
        await db.query("SELECT public.finalize_account_project_file_cleanup($1,$2,$3) AS result", [
          MEMBER,
          fileId,
          ATTEMPT,
        ])
      ).rows[0].result.deleted,
      true,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM public.project_file_chunks")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      0,
    );
    await db.query("SELECT public.finalize_account_project_file_cleanup($1,$2,$3)", [
      MEMBER,
      fileId,
      ATTEMPT,
    ]);
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      0,
    );
  } finally {
    await db.close();
  }
});

test("account cleanup waits for active uploads before reserving destructive work", async () => {
  const db = await fixture({ activeUpload: true });
  try {
    const fileId = (await db.query("SELECT id FROM public.project_files")).rows[0].id;
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [MEMBER]);
    const claim = (
      await db.query("SELECT public.claim_account_project_file_cleanup($1,$2,$3) AS result", [
        MEMBER,
        fileId,
        ATTEMPT,
      ])
    ).rows[0].result;
    assert.equal(claim.state, "busy");
    assert.equal(
      (await db.query("SELECT status FROM public.project_files")).rows[0].status,
      "pending",
    );
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      10,
    );
  } finally {
    await db.close();
  }
});

test("retained source charge stays until the last promoted reference removes bytes", async () => {
  const db = await fixture();
  try {
    const fileId = (await db.query("SELECT id FROM public.project_files")).rows[0].id;
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [MEMBER]);
    await db.query("SELECT public.claim_account_project_file_cleanup($1,$2,$3)", [
      MEMBER,
      fileId,
      ATTEMPT,
    ]);
    await db.query("SELECT public.finalize_account_project_file_cleanup($1,$2,$3,false)", [
      MEMBER,
      fileId,
      ATTEMPT,
    ]);
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      10,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM public.project_storage_retained_charges"))
        .rows[0].n,
      1,
    );
    // A promoted row owns no new quota; removing its last source releases the
    // original surviving owner's charge, and retries cannot release it twice.
    await db.query(
      "SELECT public.settle_project_source_storage_charge($1,'source',$2,10,false,true)",
      [ATTEMPT, OWNER],
    );
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM public.project_storage_retained_charges"))
        .rows[0].n,
      0,
    );
    await db.exec("UPDATE public.user_storage SET bytes_used=25");
    await db.query(
      "SELECT public.settle_project_source_storage_charge($1,'source',$2,10,false,true)",
      [ATTEMPT, OWNER],
    );
    assert.equal(
      (await db.query("SELECT bytes_used::int FROM public.user_storage")).rows[0].bytes_used,
      25,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('authenticated','public.settle_project_source_storage_charge(uuid,text,uuid,bigint,boolean,boolean)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('authenticated','public.project_storage_retained_charges','SELECT') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
