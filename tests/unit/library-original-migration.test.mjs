import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333",
  gen = "44444444-4444-4444-8444-444444444444",
  next = "55555555-5555-4555-8555-555555555555";
async function database() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA kova_private;
 GRANT USAGE ON SCHEMA auth,storage,kova_private TO service_role;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz);
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE SQL AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE TABLE account_deletion_fences(user_id uuid PRIMARY KEY);
 CREATE TABLE user_library_items(id uuid PRIMARY KEY,user_id uuid,title text,item_type text,source text,content_text text,file_url text,file_name text,file_type text,file_size bigint,metadata jsonb,folder_id uuid,updated_at timestamptz);
 ALTER TABLE user_library_items ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own_read ON user_library_items FOR SELECT TO authenticated USING(user_id=current_setting('request.jwt.claim.sub',true)::uuid);
 CREATE POLICY own_write ON user_library_items FOR ALL TO authenticated USING(user_id=current_setting('request.jwt.claim.sub',true)::uuid) WITH CHECK(user_id=current_setting('request.jwt.claim.sub',true)::uuid);
 GRANT SELECT,INSERT,UPDATE,DELETE ON user_library_items TO authenticated;
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE user_storage(user_id uuid PRIMARY KEY,bytes_used bigint DEFAULT 0,updated_at timestamptz);
 CREATE TABLE usage_counts(user_id uuid PRIMARY KEY,uploads integer DEFAULT 0);
 CREATE FUNCTION try_add_storage_bytes(u uuid,b bigint,l bigint) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$BEGIN INSERT INTO user_storage(user_id,bytes_used) VALUES(u,0) ON CONFLICT DO NOTHING; UPDATE user_storage SET bytes_used=bytes_used+b WHERE user_id=u AND bytes_used+b<=l; RETURN FOUND; END$$;
 CREATE FUNCTION try_increment_daily_usage(u uuid,k text,n integer,l integer) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$BEGIN INSERT INTO usage_counts(user_id,uploads) VALUES(u,0) ON CONFLICT DO NOTHING; UPDATE usage_counts SET uploads=uploads+n WHERE user_id=u AND uploads+n<=l; RETURN FOUND; END$$;
 CREATE FUNCTION release_project_storage_bytes(u uuid,b bigint) RETURNS bigint LANGUAGE plpgsql SET search_path=public AS $$DECLARE remaining bigint; BEGIN UPDATE user_storage SET bytes_used=greatest(0,bytes_used-b) WHERE user_id=u RETURNING bytes_used INTO remaining; RETURN coalesce(remaining,0); END$$;
 INSERT INTO auth.users(id) VALUES('${owner}'),('${other}');
 GRANT ALL ON ALL TABLES IN SCHEMA public,storage TO service_role;`);
  for (const name of [
    "20260905001736_private_auth_identity_helpers.sql",
    "20260904232923_account_storage_generation_outbox.sql",
    "20260905011300_private_library_original_files.sql",
  ])
    await db.exec(
      await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"),
    );
  await db.exec("SET ROLE service_role");
  return db;
}
async function reserve(
  db,
  { user = owner, item = id, generation = gen, storage = 100, sha = "a".repeat(64) } = {},
) {
  return (
    await db.query(
      "select reserve_library_file_upload($1,$2,$3,'Original.pdf','application/pdf',10,$4,'Extracted text',$5) value",
      [user, item, generation, sha, storage],
    )
  ).rows[0].value;
}
async function settle(db, user = owner, item = id, generation = gen) {
  return (
    await db.query("select settle_library_file_upload($1,$2,$3) value", [user, item, generation])
  ).rows[0].value;
}
async function object(db, generation = gen) {
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('library-files',$1,$2)",
    [`${owner}/${generation}.pdf`, { size: 10, mimetype: "application/pdf" }],
  );
}
async function retire(db, generation = gen, del = true) {
  return (
    await db.query("select retire_library_file($1,$2,$3,$4) value", [owner, id, generation, del])
  ).rows[0].value;
}
async function cleanup(db, generation = gen) {
  await db.query("delete from storage.objects where name=$1", [`${owner}/${generation}.pdf`]);
  return (await db.query("select record_account_storage_artifact_cleanup($1) value", [generation]))
    .rows[0].value;
}
test("original lifecycle works with the actual service role and no auth.users SELECT grant", async () => {
  const db = await database();
  try {
    assert.equal(
      (await db.query("select has_table_privilege(current_user,'auth.users','SELECT') ok")).rows[0]
        .ok,
      false,
    );
    const first = await reserve(db),
      again = await reserve(db, { generation: next });
    assert.equal(again.generation, first.generation);
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 10);
    assert.equal(await settle(db), false);
    await object(db);
    assert.equal(await settle(db), true);
    assert.equal(await settle(db), true);
    const read = (await db.query("select read_library_file($1,$2,$3) value", [owner, id, gen]))
      .rows[0].value;
    assert.equal(read.file_name, "Original.pdf");
    assert.equal(read.extracted_text, undefined);
    assert.equal(
      (await db.query("select read_library_file($1,$2,$3) value", [other, id, gen])).rows[0].value,
      null,
    );
  } finally {
    await db.close();
  }
});
test("role grants, immutable metadata and owner RLS prevent bypassing the original-file lifecycle", async () => {
  const db = await database();
  try {
    await reserve(db);
    await object(db);
    await settle(db);
    await db.exec(
      `RESET ROLE; GRANT USAGE ON SCHEMA auth TO authenticated; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${owner}',false);`,
    );
    assert.equal((await db.query("select count(*)::int n from user_library_items")).rows[0].n, 1);
    await assert.rejects(db.query("select * from library_file_uploads"), /permission denied/);
    await assert.rejects(
      db.query("select reserve_account_storage_artifact($1,$2,$2,'library-files',$3)", [
        next,
        owner,
        `${owner}/${next}.pdf`,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("delete from user_library_items where id=$1", [id]),
      /managed_write/,
    );
    await assert.rejects(
      db.query("update user_library_items set file_url='https://elsewhere.invalid' where id=$1", [
        id,
      ]),
      /managed_write/,
    );
    await db.query("update user_library_items set title='Renamed' where id=$1", [id]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    assert.equal((await db.query("select count(*)::int n from user_library_items")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
test("storage quotas are atomic and identical retries do not charge twice", async () => {
  const db = await database();
  try {
    await assert.rejects(reserve(db, { storage: 9 }), /storage_limit/);
    assert.equal((await db.query("select count(*)::int n from usage_counts")).rows[0].n, 0);
    await reserve(db, { storage: 15 });
    await assert.rejects(
      reserve(db, { item: next, generation: next, storage: 15 }),
      /storage_limit/,
    );
    await assert.rejects(reserve(db, { sha: "b".repeat(64) }), /conflict/);
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 10);
  } finally {
    await db.close();
  }
});
test("failed upload cleanup releases storage once and old generations cannot settle or delete a retry", async () => {
  const db = await database();
  try {
    await reserve(db);
    assert.equal(await retire(db, gen, false), true);
    await cleanup(db);
    await cleanup(db);
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 0);
    const retry = await reserve(db, { generation: next });
    assert.equal(retry.generation, next);
    await object(db, next);
    assert.equal(await settle(db, owner, id, next), true);
    assert.equal(await settle(db, owner, id, gen), false);
    assert.equal(await retire(db, gen, true), false);
    assert.equal(await retire(db, next, false), false);
  } finally {
    await db.close();
  }
});
test("explicit deletion retains a minimal identity tombstone and cannot resurrect through a delayed save", async () => {
  const db = await database();
  try {
    await reserve(db);
    await object(db);
    await settle(db);
    assert.equal(await retire(db), true);
    assert.equal(
      (await db.query("select read_library_file($1,$2,$3) value", [owner, id, gen])).rows[0].value,
      null,
    );
    assert.equal((await db.query("select count(*)::int n from user_library_items")).rows[0].n, 1);
    await cleanup(db);
    assert.equal((await db.query("select count(*)::int n from user_library_items")).rows[0].n, 0);
    await assert.rejects(reserve(db, { generation: next }), /conflict/);
    assert.equal(
      (await db.query("select extracted_text,file_name,state from library_file_uploads")).rows[0]
        .state,
      "deleted",
    );
  } finally {
    await db.close();
  }
});
test("account deletion waits for active upload leases, revokes reads and purges metadata only after object cleanup", async () => {
  const db = await database();
  try {
    await reserve(db);
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    await assert.rejects(reserve(db, { item: next, generation: next }), /account_unavailable/);
    assert.equal(
      (await db.query("select prepare_library_file_account_deletion($1) value", [owner])).rows[0]
        .value,
      false,
    );
    await db.exec(
      "update account_storage_artifacts set lease_expires_at=now()-interval '1 second'",
    );
    assert.equal(
      (await db.query("select prepare_library_file_account_deletion($1) value", [owner])).rows[0]
        .value,
      false,
    );
    assert.equal(await settle(db), false);
    await cleanup(db);
    assert.equal(
      (await db.query("select prepare_library_file_account_deletion($1) value", [owner])).rows[0]
        .value,
      true,
    );
    assert.equal((await db.query("select count(*)::int n from library_file_uploads")).rows[0].n, 0);
    assert.equal(
      (await db.query("select state from account_storage_artifacts")).rows[0].state,
      "retired",
    );
  } finally {
    await db.close();
  }
});

test("a second owner cannot claim an ordinary Library ID or interfere with its owner's normal editing and deletion", async () => {
  const db = await database();
  try {
    await db.query(
      "insert into user_library_items(id,user_id,title,item_type,source,metadata) values($1,$2,'Ordinary note','document','manual','{}')",
      [id, owner],
    );
    await assert.rejects(reserve(db, { user: other }), /library_file_conflict/);
    await assert.rejects(reserve(db), /library_file_conflict/);
    assert.equal((await db.query("select count(*)::int n from library_file_uploads")).rows[0].n, 0);
    assert.equal(
      (await db.query("select count(*)::int n from account_storage_artifacts")).rows[0].n,
      0,
    );
    await db.exec(
      `RESET ROLE; GRANT USAGE ON SCHEMA auth TO authenticated; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${owner}',false);`,
    );
    await db.query(
      "update user_library_items set content_text='Owner changed this note' where id=$1",
      [id],
    );
    await db.query("delete from user_library_items where id=$1", [id]);
    assert.equal((await db.query("select count(*)::int n from user_library_items")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("failed original inputs expire after 24 hours while retired generations remain cleanup obligations", async () => {
  const db = await database();
  try {
    await reserve(db);
    await retire(db, gen, false);
    await cleanup(db);
    const expiry = (await db.query("select failure_expires_at from library_file_uploads")).rows[0]
      .failure_expires_at;
    await cleanup(db);
    assert.equal(
      Number(
        (await db.query("select failure_expires_at from library_file_uploads")).rows[0]
          .failure_expires_at,
      ),
      Number(expiry),
    );
    await db.exec("update library_file_uploads set failure_expires_at=now()-interval '1 second'");
    await assert.rejects(reserve(db, { generation: next }), /conflict/);
    await cleanup(db);
    const row = (
      await db.query(
        "select state,file_name,extracted_text,mime_type,sha256 from library_file_uploads",
      )
    ).rows[0];
    assert.deepEqual(row, {
      state: "deleted",
      file_name: "",
      extracted_text: "",
      mime_type: "",
      sha256: "0".repeat(64),
    });
    assert.equal(
      (await db.query("select state from account_storage_artifacts")).rows[0].state,
      "retired",
    );
  } finally {
    await db.close();
  }
});
