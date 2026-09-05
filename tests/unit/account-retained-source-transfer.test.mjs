import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { transferRetainedAccountSource } from "../../src/lib/account-retained-source-transfer.server.ts";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "423e4567-e89b-42d3-a456-426614174000";
const PROJECT = "523e4567-e89b-42d3-a456-426614174000";
const DEST = "623e4567-e89b-42d3-a456-426614174000";
const FILE = "723e4567-e89b-42d3-a456-426614174000";
const WORK = "823e4567-e89b-42d3-a456-426614174000";
const PROMOTED = "923e4567-e89b-42d3-a456-426614174000";
const PATH = PROJECT + "/source.txt";
const HASH = "a".repeat(64);
async function migration(db, name) {
  await db.exec(
    await readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8"),
  );
}
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA kova_private;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE FUNCTION kova_private.auth_user_exists(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1 AND deleted_at IS NULL)$$;
      REVOKE ALL ON FUNCTION kova_private.auth_user_exists(uuid) FROM PUBLIC; GRANT USAGE ON SCHEMA kova_private TO service_role,authenticated;
      GRANT EXECUTE ON FUNCTION kova_private.auth_user_exists(uuid) TO service_role;
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text,owner uuid,version text DEFAULT 'v1',metadata jsonb,UNIQUE(bucket_id,name));
      CREATE TABLE public.projects(id uuid PRIMARY KEY,owner_id uuid,deletion_requested_at timestamptz);
      CREATE TABLE public.project_members(project_id uuid,user_id uuid);
      CREATE TABLE public.project_files(id uuid PRIMARY KEY,project_id uuid,storage_path text,uploaded_by uuid,kind text,status text,
        storage_owner_id uuid,size_bytes bigint DEFAULT 0,storage_charged boolean DEFAULT false,delete_attempt_id uuid,delete_lease_until timestamptz,
        upload_attempt_id uuid,upload_lease_until timestamptz,updated_at timestamptz);
      CREATE TABLE public.project_file_chunks(file_id uuid);
      CREATE TABLE public.agent_deliverables(id uuid PRIMARY KEY,owner_id uuid,storage_reference text,status text);
      CREATE TABLE public.agent_resource_promotions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),deliverable_id uuid,destination_type text,destination_id uuid,project_id uuid,status text,owner_id uuid);
      CREATE TABLE public.account_deletion_fences(user_id uuid PRIMARY KEY);
      CREATE TABLE public.user_storage(user_id uuid,bytes_used bigint,updated_at timestamptz);
      CREATE TABLE public.user_library_items(id uuid,user_id uuid,file_url text,metadata jsonb);
      GRANT USAGE ON SCHEMA storage,auth TO service_role,authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
      GRANT SELECT ON storage.objects TO service_role,authenticated;
    `);
    await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [OWNER, OTHER]);
    await migration(db, "20260904232923_account_storage_generation_outbox");
    await migration(db, "20260904231310_account_project_file_lifecycle");
    await db.query("INSERT INTO public.projects VALUES($1,$2,NULL),($3,$4,NULL)", [
      PROJECT,
      OWNER,
      DEST,
      OTHER,
    ]);
    await db.query("INSERT INTO public.project_members VALUES($1,$2)", [PROJECT, OTHER]);
    await db.query(
      "INSERT INTO public.project_files(id,project_id,storage_path,uploaded_by,kind,status,storage_owner_id,size_bytes,storage_charged) VALUES($1,$2,$3,$4,'file','ready',$4,4,true)",
      [FILE, PROJECT, PATH, OWNER],
    );
    await migration(db, "20260904234409_project_storage_source_retirement");
    await migration(db, "20260905002230_retained_work_source_read_access");
    await migration(db, "20260905002934_account_retained_source_transfer");
    await db.query("INSERT INTO public.agent_deliverables VALUES($1,$2,$3,'ready')", [
      WORK,
      OTHER,
      "project-files:" + PATH,
    ]);
    await db.query(
      "INSERT INTO public.project_files(id,project_id,storage_path,uploaded_by,kind,status,storage_owner_id) VALUES($1,$2,$3,$4,'agent-deliverable','ready',$4)",
      [PROMOTED, DEST, PATH, OTHER],
    );
    await db.query(
      "INSERT INTO public.agent_resource_promotions(deliverable_id,destination_type,destination_id,project_id,status,owner_id) VALUES($1,'project_file',$2,$3,'completed',$4)",
      [WORK, PROMOTED, DEST, OTHER],
    );
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('project-files',$1,$2,'{\"size\":4}')",
      [PATH, OWNER],
    );
    await db.query("INSERT INTO public.user_library_items(id,user_id,file_url) VALUES($1,$2,$3)", [
      WORK,
      OTHER,
      "project-files:" + PATH,
    ]);
    await db.query(
      "INSERT INTO public.agent_resource_promotions(deliverable_id,destination_type,destination_id,status,owner_id) VALUES($1,'library_document',$1,'completed',$2)",
      [WORK, OTHER],
    );
    await db.query("INSERT INTO public.user_storage VALUES($1,4,now())", [OWNER]);
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [OWNER]);
    const attempt = crypto.randomUUID();
    await db.query("SELECT public.claim_account_project_file_cleanup($1,$2,$3)", [
      OWNER,
      FILE,
      attempt,
    ]);
    await db.query("SELECT public.finalize_account_project_file_cleanup($1,$2,$3,false)", [
      OWNER,
      FILE,
      attempt,
    ]);
    await db.exec("ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY");
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function asService(db, sql, args = []) {
  await db.exec("SET ROLE service_role");
  try {
    return await db.query(sql, args);
  } finally {
    await db.exec("RESET ROLE");
  }
}
async function claim(db, generation = crypto.randomUUID()) {
  return (
    await asService(db, "SELECT public.claim_account_retained_source_transfer($1,$2,$3) result", [
      OWNER,
      PATH,
      generation,
    ])
  ).rows[0].result;
}
async function copyObject(db, row, owner = null) {
  const result = await db.query(
    "INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('project-files',$1,$2,'{\"size\":4}') RETURNING id,version",
    [row.destination, owner],
  );
  return result.rows[0];
}
async function publish(db, row, object, hash = HASH) {
  return (
    await asService(
      db,
      "SELECT public.publish_account_retained_source_transfer($1,$2,$3,$4,$5) result",
      [OWNER, row.generation, object.id, object.version, hash],
    )
  ).rows[0].result;
}

test("actual service role preserves verified collaborator bytes and settles quota once without Auth SELECT", async () => {
  const db = await fixture();
  try {
    assert.equal(
      (await db.query("SELECT has_table_privilege('service_role','auth.users','SELECT') allowed"))
        .rows[0].allowed,
      false,
    );
    const row = await claim(db);
    assert.equal(row.state, "copy");
    const object = await copyObject(db, row);
    assert.equal(await publish(db, row, object), true);
    assert.equal(await publish(db, row, object), true);
    assert.equal(
      (
        await db.query("SELECT storage_reference FROM public.agent_deliverables WHERE id=$1", [
          WORK,
        ])
      ).rows[0].storage_reference,
      "project-files:" + row.destination,
    );
    assert.equal(
      (await db.query("SELECT storage_path FROM public.project_files WHERE id=$1", [PROMOTED]))
        .rows[0].storage_path,
      row.destination,
    );
    assert.equal(
      (await db.query("SELECT storage_path FROM public.project_storage_retained_charges")).rows[0]
        .storage_path,
      row.destination,
    );
    assert.equal(
      (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used,
      4,
    );
    // Storage removal is represented by the external adapter only in this test.
    await db.query("DELETE FROM storage.objects WHERE name=$1", [PATH]);
    await asService(db, "SELECT public.settle_account_project_storage_charges($1)", [[PATH]]);
    assert.equal(
      (await db.query("SELECT bytes_used FROM public.user_storage")).rows[0].bytes_used,
      4,
    );
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${OTHER}'`);
    assert.deepEqual(
      (await db.query("SELECT name FROM storage.objects")).rows.map((r) => r.name),
      [row.destination],
    );
    await db.exec("RESET ROLE");
    assert.equal(
      (await db.query("SELECT file_url FROM public.user_library_items WHERE id=$1", [WORK])).rows[0]
        .file_url,
      "project-files:" + row.destination,
    );
    assert.equal((await claim(db)).state, "published");
  } finally {
    await db.close();
  }
});

test("retirement blocks late references and wrong-owner or changed copies cannot publish", async () => {
  const db = await fixture();
  try {
    const row = await claim(db);
    await assert.rejects(
      db.query("INSERT INTO public.agent_deliverables VALUES(gen_random_uuid(),$1,$2,'ready')", [
        OTHER,
        "project-files:" + PATH,
      ]),
      /can no longer be restored/,
    );
    const object = await copyObject(db, row, OWNER);
    assert.equal(await publish(db, row, object), false);
    await db.query("UPDATE storage.objects SET owner_id=NULL,version='changed' WHERE id=$1", [
      object.id,
    ]);
    assert.equal(await publish(db, row, object), false);
    await db.query("UPDATE storage.objects SET version='v1' WHERE id=$1", [object.id]);
    await db.query("UPDATE storage.objects SET version='source-changed' WHERE name=$1", [PATH]);
    assert.equal(await publish(db, row, object), false);
    assert.equal(
      (await db.query("SELECT storage_reference FROM public.agent_deliverables")).rows[0]
        .storage_reference,
      "project-files:" + PATH,
    );
  } finally {
    await db.close();
  }
});

test("expired uncertain copy generations stay swept after Auth deletion and never publish", async () => {
  const db = await fixture();
  try {
    const first = await claim(db);
    assert.equal((await claim(db, first.generation)).state, "busy");
    await db.query(
      "UPDATE public.account_storage_artifacts SET lease_expires_at=now()-interval '1 second' WHERE generation=$1",
      [first.generation],
    );
    const second = await claim(db);
    assert.equal(second.state, "copy");
    assert.notEqual(second.destination, first.destination);
    const late = await copyObject(db, first);
    assert.equal(await publish(db, first, late), false);
    const good = await copyObject(db, second);
    assert.equal(await publish(db, second, good), true);
    await db.query("DELETE FROM auth.users WHERE id=$1", [OWNER]);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.project_storage_source_transfers"))
        .rows[0].n,
      2,
    );
    const swept = (
      await asService(db, "SELECT * FROM public.claim_account_storage_artifact_cleanup(NULL,25)")
    ).rows;
    assert.ok(swept.some((r) => r.generation === first.generation));
    await asService(db, "SELECT public.record_account_storage_artifact_cleanup($1)", [
      first.generation,
    ]);
    await db.query(
      "UPDATE public.account_storage_artifacts SET next_cleanup_at=now() WHERE generation=$1",
      [first.generation],
    );
    assert.ok(
      (
        await asService(db, "SELECT * FROM public.claim_account_storage_artifact_cleanup(NULL,25)")
      ).rows.some((r) => r.generation === first.generation),
    );
  } finally {
    await db.close();
  }
});

test("forged references, missing deletion fences, and browser callers cannot initiate transfers", async () => {
  const db = await fixture();
  try {
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      db.query("SELECT public.claim_account_retained_source_transfer($1,$2,$3)", [
        OWNER,
        PATH,
        crypto.randomUUID(),
      ]),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
    await db.exec("DELETE FROM public.project_storage_source_access");
    await assert.rejects(claim(db), /provenance_invalid/);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM public.account_storage_artifacts")).rows[0].n,
      0,
    );
    await db.exec("DELETE FROM public.account_deletion_fences");
    await assert.rejects(claim(db), /fence_required/);
  } finally {
    await db.close();
  }
});

test("current collaborator deletion and changed promotion provenance prevent CAS publication", async () => {
  const db = await fixture();
  try {
    const row = await claim(db),
      object = await copyObject(db, row);
    await db.query("INSERT INTO public.account_deletion_fences VALUES($1)", [OTHER]);
    assert.equal(await publish(db, row, object), false);
    await db.query("DELETE FROM public.account_deletion_fences WHERE user_id=$1", [OTHER]);
    await db.exec("UPDATE public.agent_resource_promotions SET status='failed'");
    assert.equal(await publish(db, row, object), false);
    await db.exec(
      "UPDATE public.agent_resource_promotions SET status='completed'; UPDATE public.projects SET deletion_requested_at=now() WHERE id='" +
        DEST +
        "'",
    );
    assert.equal(await publish(db, row, object), false);
  } finally {
    await db.close();
  }
});

function adapter({ mismatch = false, copyError = false, denied = false } = {}) {
  const events = [];
  let row;
  const object = crypto.randomUUID();
  return {
    events,
    client: {
      async rpc(name, args) {
        events.push(name);
        if (name === "claim_account_retained_source_transfer") {
          row = {
            state: "copy",
            generation: args.p_generation,
            source: PATH,
            destination: PROJECT + "/" + args.p_generation + ".txt",
            size: 4,
          };
          return { data: row, error: null };
        }
        assert.match(args.p_sha256, /^[0-9a-f]{64}$/);
        return { data: !denied, error: null };
      },
      storage: {
        from() {
          return {
            async copy(source, destination) {
              events.push("copy");
              assert.equal(source, PATH);
              assert.equal(destination, row.destination);
              return { data: {}, error: copyError ? {} : null };
            },
            async info() {
              events.push("info");
              return { data: { id: object, version: "v1", size: 4 }, error: null };
            },
            async download(path) {
              events.push("download");
              return { data: new Blob([mismatch && path !== PATH ? "evil" : "safe"]), error: null };
            },
          };
        },
      },
    },
  };
}
test("Storage adapter reserves before one copy and verifies both byte hashes before publishing", async () => {
  const { client, events } = adapter();
  assert.equal(await transferRetainedAccountSource(client, OWNER, PATH), true);
  assert.deepEqual(events, [
    "claim_account_retained_source_transfer",
    "copy",
    "download",
    "info",
    "download",
    "publish_account_retained_source_transfer",
  ]);
  for (const options of [{ mismatch: true }, { copyError: true }]) {
    const failed = adapter(options);
    await assert.rejects(
      transferRetainedAccountSource(failed.client, OWNER, PATH),
      /unverified|copy_failed/,
    );
    assert.equal(failed.events.filter((v) => v === "copy").length, 1);
    assert.ok(!failed.events.includes("publish_account_retained_source_transfer"));
  }
  const denied = adapter({ denied: true });
  assert.equal(await transferRetainedAccountSource(denied.client, OWNER, PATH), false);
});
