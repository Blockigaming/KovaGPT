import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { claimProjectStorageSourceCleanup } from "../../src/lib/project-storage-references.server.ts";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "423e4567-e89b-42d3-a456-426614174000";
const PROJECT = "523e4567-e89b-42d3-a456-426614174000";
const DEST = "623e4567-e89b-42d3-a456-426614174000";
const FILE = "723e4567-e89b-42d3-a456-426614174000";
const WORK = "823e4567-e89b-42d3-a456-426614174000";
const PATH = PROJECT + "/source.txt";
async function fixture({ forged = false } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects(bucket_id text,name text,owner_id text,owner uuid);
      CREATE TABLE public.projects(id uuid PRIMARY KEY,owner_id uuid,deletion_requested_at timestamptz);
      CREATE TABLE public.project_members(project_id uuid,user_id uuid);
      CREATE TABLE public.project_files(id uuid PRIMARY KEY,project_id uuid,storage_path text,uploaded_by uuid,kind text,status text);
      CREATE TABLE public.agent_deliverables(id uuid PRIMARY KEY,owner_id uuid,storage_reference text,status text);
      CREATE TABLE public.account_deletion_fences(user_id uuid PRIMARY KEY);
      CREATE TABLE public.account_storage_artifacts(bucket text,storage_path text,state text,owner_id uuid,requester_id uuid);
      CREATE TABLE public.project_storage_retained_charges(file_id uuid,storage_path text,owner_id uuid,size_bytes bigint);
      CREATE TABLE public.user_storage(user_id uuid,bytes_used bigint,updated_at timestamptz);
    `);
    await db.query("INSERT INTO public.projects VALUES($1,$2,NULL),($3,$4,NULL)", [
      PROJECT,
      OWNER,
      DEST,
      OTHER,
    ]);
    if (forged) {
      await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,$3,'ready')", [
        WORK,
        OTHER,
        "project-files:" + PATH,
      ]);
      await db.query("INSERT INTO storage.objects VALUES('project-files',$1,NULL,NULL)", [PATH]);
    } else {
      await db.query("INSERT INTO public.project_files VALUES($1,$2,$3,$4,'file','ready')", [
        FILE,
        PROJECT,
        PATH,
        OWNER,
      ]);
    }
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260904234409_project_storage_source_retirement.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const lifecycle = await readFile(
      new URL(
        "../../supabase/migrations/20260904231310_account_project_file_lifecycle.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(
      lifecycle.slice(
        lifecycle.indexOf(
          "CREATE OR REPLACE FUNCTION public.list_account_project_storage_objects(",
        ),
      ),
    );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

test("persistent source retirement rejects a later Work restore and Project reference", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,$3,'ready')", [
      WORK,
      OWNER,
      "project-files:" + PATH,
    ]);
    await db.query("UPDATE public.agent_deliverables SET status='deleted' WHERE id=$1", [WORK]);
    await db.query("UPDATE public.project_files SET status='deleting' WHERE id=$1", [FILE]);
    assert.deepEqual(
      (
        await db.query(
          "SELECT public.claim_project_storage_source_cleanup($1,NULL,NULL,$2) AS retained",
          [[PATH], [FILE]],
        )
      ).rows[0].retained,
      [],
    );
    // These are later transactions, in the gap before/after an external remove.
    await assert.rejects(
      () => db.query("UPDATE public.agent_deliverables SET status='ready' WHERE id=$1", [WORK]),
      /can no longer be restored/,
    );
    await assert.rejects(
      () =>
        db.query(
          "INSERT INTO public.project_files VALUES(gen_random_uuid(),$1,$2,$3,'agent-deliverable','ready')",
          [DEST, PATH, OTHER],
        ),
      /can no longer be restored/,
    );
    await assert.rejects(
      () => db.query("UPDATE public.project_files SET status='ready' WHERE id=$1", [FILE]),
      /can no longer be restored/,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT public.claim_project_storage_source_cleanup($1,NULL,NULL,$2) AS retained",
          [[PATH], [FILE]],
        )
      ).rows[0].retained,
      [],
    );
  } finally {
    await db.close();
  }
});

test("a committed live reference wins before retirement, including another account Work owner", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO public.project_members VALUES($1,$2)", [PROJECT, OTHER]);
    await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,$3,'ready')", [
      WORK,
      OTHER,
      "project-files:" + PATH,
    ]);
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [OWNER]);
    await db.exec("UPDATE public.project_files SET status='deleting'");
    assert.deepEqual(
      (
        await db.query(
          "SELECT public.claim_project_storage_source_cleanup($1,NULL,$2,$3) AS retained",
          [[PATH], OWNER, [FILE]],
        )
      ).rows[0].retained,
      [PATH],
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.project_storage_source_retirements"))
        .rows[0].n,
      0,
    );
    await db.query("UPDATE public.agent_deliverables SET status='deleted' WHERE id=$1", [WORK]);
    assert.deepEqual(
      (
        await db.query(
          "SELECT public.claim_project_storage_source_cleanup($1,NULL,$2,$3) AS retained",
          [[PATH], OWNER, [FILE]],
        )
      ).rows[0].retained,
      [],
    );
  } finally {
    await db.close();
  }
});

test("forged caller-owned Work references never authorize foreign unregistered object deletion", async () => {
  const db = await fixture({ forged: true });
  try {
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [OTHER]);
    assert.deepEqual(
      (
        await db.query("SELECT * FROM public.list_account_project_storage_objects($1,1000)", [
          OTHER,
        ])
      ).rows,
      [],
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT public.claim_project_storage_source_cleanup($1,NULL,$2) AS retained",
          [[PATH], OTHER],
        )
      ).rows[0].retained,
      [PATH],
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.project_storage_source_retirements"))
        .rows[0].n,
      0,
    );
    await db.exec("DELETE FROM public.account_deletion_fences");
    await assert.rejects(
      () =>
        db.query("INSERT INTO public.agent_deliverables VALUES(gen_random_uuid(),$1,$2,'ready')", [
          OTHER,
          "project-files:" + PATH,
        ]),
      /source_unavailable/,
    );
    // A body-only Work deliverable remains valid and never enters this fence.
    await db.query(
      "INSERT INTO public.agent_deliverables VALUES(gen_random_uuid(),$1,NULL,'ready')",
      [OTHER],
    );
  } finally {
    await db.close();
  }
});

test("source claims require a deletion scope and are unavailable to authenticated callers", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      () => db.query("SELECT public.claim_project_storage_source_cleanup($1)", [[PATH]]),
      /scope_required/,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.claim_project_storage_source_cleanup($1,NULL,NULL,$2)", [
          [PATH],
          [FILE],
        ]),
      /claim_required/,
    );
    await assert.rejects(
      () =>
        db.query("SELECT public.claim_project_storage_source_cleanup($1,NULL,$2)", [[PATH], OWNER]),
      /fence_required/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('authenticated','public.claim_project_storage_source_cleanup(text[],uuid,uuid,uuid[])','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('authenticated','public.project_storage_source_provenance','SELECT') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});

test("pending upload metadata cannot become a new Work source before publication", async () => {
  const db = await fixture();
  try {
    await db.exec("UPDATE public.project_files SET status='pending'");
    await assert.rejects(
      () =>
        db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,$3,'ready')", [
          WORK,
          OWNER,
          "project-files:" + PATH,
        ]),
      /source_unavailable/,
    );
    await db.exec("UPDATE public.project_files SET status='ready'");
    await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,$3,'ready')", [
      WORK,
      OWNER,
      "project-files:" + PATH,
    ]);
  } finally {
    await db.close();
  }
});

test("source cleanup adapter validates server retention responses and preserves the client receiver", async () => {
  const calls = [];
  const client = {
    from() {},
    async rpc(name, args) {
      assert.equal(this, client);
      calls.push({ name, args });
      return { data: [PATH], error: null };
    },
  };
  assert.deepEqual(
    await claimProjectStorageSourceCleanup(client, null, [PATH, PATH], [FILE], OWNER),
    new Set([PATH]),
  );
  assert.deepEqual(calls, [
    {
      name: "claim_project_storage_source_cleanup",
      args: { p_paths: [PATH], p_project_id: null, p_account_id: OWNER, p_file_ids: [FILE] },
    },
  ]);
  await assert.rejects(
    () =>
      claimProjectStorageSourceCleanup(
        { from() {}, rpc: async () => ({ data: ["unrequested"], error: null }) },
        null,
        [PATH],
        [FILE],
      ),
    /claim_failed/,
  );
  await assert.rejects(
    () =>
      claimProjectStorageSourceCleanup(
        { from() {}, rpc: async () => ({ data: [], error: { message: "unavailable" } }) },
        null,
        [PATH],
        [FILE],
      ),
    /claim_failed/,
  );
});

test("validated member access survives source metadata removal until the final promoted reference", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO public.project_members VALUES($1,$2)", [PROJECT, OTHER]);
    await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,$3,'ready')", [
      WORK,
      OTHER,
      "project-files:" + PATH,
    ]);
    await db.query("UPDATE public.agent_deliverables SET status='deleted' WHERE id=$1", [WORK]);
    await db.query("DELETE FROM public.project_files WHERE id=$1", [FILE]);
    await db.query(
      "INSERT INTO public.project_files VALUES($1,$2,$3,$4,'agent-deliverable','deleting')",
      [FILE, DEST, PATH, OTHER],
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT public.claim_project_storage_source_cleanup($1,NULL,NULL,$2) AS retained",
          [[PATH], [FILE]],
        )
      ).rows[0].retained,
      [],
    );
  } finally {
    await db.close();
  }
});

test("an unrelated uploader in the deleting project cannot lend ownership to a forged source", async () => {
  const db = await fixture({ forged: true });
  try {
    await db.query("UPDATE public.agent_deliverables SET status='deleted' WHERE id=$1", [WORK]);
    await db.query("INSERT INTO public.project_files VALUES($1,$2,$3,$4,'file','ready')", [
      FILE,
      PROJECT,
      PATH,
      OWNER,
    ]);
    await db.query("DELETE FROM public.project_files WHERE id=$1", [FILE]);
    await db.query(
      "INSERT INTO public.project_files VALUES($1,$2,$3,$4,'agent-deliverable','ready')",
      [FILE, DEST, PATH, OTHER],
    );
    await db.query(
      "INSERT INTO public.project_files VALUES(gen_random_uuid(),$1,$2,$3,'file','ready')",
      [DEST, DEST + "/unrelated.txt", OWNER],
    );
    await db.query("UPDATE public.projects SET deletion_requested_at=now() WHERE id=$1", [DEST]);
    assert.deepEqual(
      (
        await db.query("SELECT public.claim_project_storage_source_cleanup($1,$2) AS retained", [
          [PATH],
          DEST,
        ])
      ).rows[0].retained,
      [PATH],
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.project_storage_source_retirements"))
        .rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("a retained legitimate Work source remains downloadable after the original Project disappears", async () => {
  const db = await fixture();
  try {
    await db.exec(`create schema auth; create function auth.uid() returns uuid language sql stable as $$ select '${OTHER}'::uuid $$;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema storage,auth to authenticated;
      grant select on storage.objects,public.project_files,public.project_members to authenticated;
      grant execute on function auth.uid(),storage.foldername(text) to authenticated;`);
    const upload = await readFile(
      new URL(
        "../../supabase/migrations/20260904200000_project_file_upload_integrity.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(
      upload.slice(upload.indexOf('CREATE POLICY "project_files_read"\nON storage.objects')),
    );
    await db.exec(
      "create schema kova_private; grant usage on schema kova_private to authenticated",
    );
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260905002230_retained_work_source_read_access.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query("INSERT INTO public.project_members VALUES($1,$2)", [PROJECT, OTHER]);
    await db.query("INSERT INTO storage.objects VALUES('project-files',$1,NULL,NULL)", [PATH]);
    await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,$3,'ready')", [
      WORK,
      OTHER,
      "project-files:" + PATH,
    ]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select name from storage.objects")).rows.length, 1);
    await db.exec("reset role");
    await db.query("UPDATE public.projects SET deletion_requested_at=now() WHERE id=$1", [PROJECT]);
    const retained = (
      await db.query("SELECT public.claim_project_storage_source_cleanup($1,$2) retained", [
        [PATH],
        PROJECT,
      ])
    ).rows[0].retained;
    assert.deepEqual(
      retained,
      [PATH],
      "the live Work reference deliberately retains the private bytes",
    );
    await db.query("DELETE FROM public.project_files WHERE project_id=$1", [PROJECT]);
    await db.query("DELETE FROM public.project_members WHERE project_id=$1", [PROJECT]);
    await db.query("DELETE FROM public.projects WHERE id=$1", [PROJECT]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select name from storage.objects")).rows.length,
      1,
      "an independently proved live Work reference must remain readable",
    );
    await db.exec("reset role");
    await db.query("UPDATE public.agent_deliverables SET status='deleted' WHERE id=$1", [WORK]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select name from storage.objects")).rows.length,
      0,
      "deleted Work cannot grant access",
    );
    await db.exec("reset role");
    await db.query("UPDATE public.agent_deliverables SET status='ready' WHERE id=$1", [WORK]);
    await db.query("INSERT INTO public.project_storage_source_retirements VALUES($1,now())", [
      PATH,
    ]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select name from storage.objects")).rows.length,
      0,
      "a retired path cannot be read",
    );
  } finally {
    await db.close();
  }
});

test("retained Work read helper rejects forged references, unrelated callers, and account deletion", async () => {
  const db = await fixture({ forged: true });
  try {
    await db.exec(`create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create schema kova_private; grant usage on schema auth,kova_private,storage to authenticated;
      alter table storage.objects enable row level security;grant select on storage.objects to authenticated;
      grant execute on function auth.uid() to authenticated;`);
    await db.exec(
      await readFile(
        new URL(
          "../../supabase/migrations/20260905002230_retained_work_source_read_access.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${OTHER}',false);`,
    );
    assert.equal(
      (await db.query("select name from storage.objects")).rows.length,
      0,
      "caller-owned forged Work row alone provides no authority",
    );
    await assert.rejects(
      () => db.query("select * from public.project_storage_source_access"),
      (error) => error.code === "42501",
    );
    await db.exec("reset role");
    await db.query("INSERT INTO public.project_storage_source_access VALUES($1,$2)", [PATH, OTHER]);
    await db.exec(
      `set role authenticated;select set_config('request.jwt.claim.sub','${OWNER}',false);`,
    );
    assert.equal(
      (await db.query("select name from storage.objects")).rows.length,
      0,
      "another account cannot borrow a recorded grant",
    );
    await db.exec(`select set_config('request.jwt.claim.sub','${OTHER}',false);`);
    assert.equal((await db.query("select name from storage.objects")).rows.length, 1);
    await db.exec("reset role");
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [OTHER]);
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select name from storage.objects")).rows.length,
      0,
      "account deletion blocks newly signed access",
    );
    await db.exec("reset role");
    const privileges = await db.query(
      "select has_function_privilege('anon','kova_private.can_read_retained_work_source(text)','EXECUTE') anon,has_function_privilege('authenticated','kova_private.can_read_retained_work_source(text)','EXECUTE') browser",
    );
    assert.deepEqual(privileges.rows, [{ anon: false, browser: true }]);
  } finally {
    await db.close();
  }
});
