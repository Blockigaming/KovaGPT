import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333",
  gen = "44444444-4444-4444-8444-444444444444",
  next = "55555555-5555-4555-8555-555555555555";
async function database({ legacy = false, aliases = false } = {}) {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA kova_private;
 GRANT USAGE ON SCHEMA auth,storage,kova_private TO service_role;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz);
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE SQL AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE TABLE account_deletion_fences(user_id uuid PRIMARY KEY);
 CREATE TABLE user_library_items(id uuid PRIMARY KEY,user_id uuid,title text,item_type text,source text,content_text text,file_url text,file_name text,file_type text,file_size bigint,metadata jsonb,folder_id uuid,updated_at timestamptz,created_at timestamptz default now());
 ALTER TABLE user_library_items ENABLE ROW LEVEL SECURITY;
 CREATE POLICY own_read ON user_library_items FOR SELECT TO authenticated USING(user_id=current_setting('request.jwt.claim.sub',true)::uuid);
 CREATE POLICY own_write ON user_library_items FOR ALL TO authenticated USING(user_id=current_setting('request.jwt.claim.sub',true)::uuid) WITH CHECK(user_id=current_setting('request.jwt.claim.sub',true)::uuid);
 GRANT SELECT,INSERT,UPDATE,DELETE ON user_library_items TO authenticated;
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE user_storage(user_id uuid PRIMARY KEY,bytes_used bigint DEFAULT 0,updated_at timestamptz);
 CREATE TABLE usage_counts(user_id uuid PRIMARY KEY,uploads integer DEFAULT 0);
 CREATE FUNCTION effective_user_plan_tier(u uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'free'::text $$;
 CREATE FUNCTION try_add_storage_bytes(u uuid,b bigint,l bigint) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$BEGIN INSERT INTO user_storage(user_id,bytes_used) VALUES(u,0) ON CONFLICT DO NOTHING; UPDATE user_storage SET bytes_used=bytes_used+b WHERE user_id=u AND bytes_used+b<=l; RETURN FOUND; END$$;
 CREATE FUNCTION try_increment_daily_usage(u uuid,k text,n integer,l integer) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$BEGIN INSERT INTO usage_counts(user_id,uploads) VALUES(u,0) ON CONFLICT DO NOTHING; UPDATE usage_counts SET uploads=uploads+n WHERE user_id=u AND uploads+n<=l; RETURN FOUND; END$$;
 CREATE FUNCTION release_project_storage_bytes(u uuid,b bigint) RETURNS bigint LANGUAGE plpgsql SET search_path=public AS $$DECLARE remaining bigint; BEGIN UPDATE user_storage SET bytes_used=greatest(0,bytes_used-b) WHERE user_id=u RETURNING bytes_used INTO remaining; RETURN coalesce(remaining,0); END$$;
 INSERT INTO auth.users(id) VALUES('${owner}'),('${other}');
 GRANT ALL ON ALL TABLES IN SCHEMA public,storage TO service_role;`);
  for (const name of [
    "20260905001736_private_auth_identity_helpers.sql",
    "20260904232923_account_storage_generation_outbox.sql",
    "20260905011300_private_library_original_files.sql",
    "20260905031000_library_content_versions.sql",
  ])
    await db.exec(
      await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"),
    );
  if (legacy)
    await db.exec(
      `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('library-images','${owner}/legacy/image.png','{"size":23,"mimetype":"image/png"}'),('library-images','${owner}/unknown.png','{}');`,
    );
  if (aliases)
    await db.exec(
      `INSERT INTO user_library_items(id,user_id,title,item_type,source,content_text,file_url,file_size) VALUES('${id}','${owner}','Legacy','image','images','a','${owner}/legacy/image.png',999999),('${next}','${owner}','Alias','image','images','b','${owner}/legacy/image.png',999999);`,
    );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260905033500_library_image_storage_quota.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec("SET ROLE service_role");
  return db;
}
const path = `${owner}/${gen}.png`,
  sha = "a".repeat(64),
  fp = "b".repeat(64);
async function reserve(db, { who = owner, item = id, generation = gen, size = 10 } = {}) {
  return (
    await db.query("select reserve_library_image_upload($1,$2,$3,$4,$5,'image/png',$6) value", [
      who,
      item,
      generation,
      size,
      sha,
      fp,
    ])
  ).rows[0].value;
}
async function settle(db) {
  return (
    await db.query(
      "select settle_library_image_upload($1,$2,$3,$4,'Image','prompt','images') value",
      [owner, id, gen, fp],
    )
  ).rows[0].value;
}
async function upload(db, size = 10) {
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('library-images',$1,$2)",
    [path, { size, mimetype: "image/png" }],
  );
}
async function retire(db, del = true) {
  return (
    await db.query(
      "select retire_library_image_upload($1,$2,$3,$4,(select content_generation from user_library_items where id=$2)) value",
      [owner, id, gen, del],
    )
  ).rows[0].value;
}
async function cleaned(db) {
  return (await db.query("select record_library_image_cleanup($1,$2) value", [owner, gen])).rows[0]
    .value;
}
async function used(db) {
  return (
    (await db.query("select bytes_used from user_storage where user_id=$1", [owner])).rows[0]
      ?.bytes_used ?? 0
  );
}
test("image reservation charges actual bytes once and publication separately charges prompt text", async () => {
  const db = await database();
  try {
    await reserve(db);
    await reserve(db, { generation: next });
    assert.equal(await used(db), 10);
    assert.equal(await settle(db), false);
    await upload(db);
    assert.equal(await settle(db), true);
    assert.equal(await settle(db), true);
    assert.equal(await used(db), 16);
    assert.equal((await reserve(db, { generation: next })).generation, gen);
    await assert.rejects(reserve(db, { generation: next, size: 11 }), /conflict/);
    assert.equal(await retire(db, false), null);
    assert.equal(await used(db), 16);
  } finally {
    await db.close();
  }
});
test("image quota denial rolls back its generation and another owner cannot claim ordinary Library IDs", async () => {
  const db = await database();
  try {
    await db.query("insert into user_storage(user_id,bytes_used) values($1,524287995)", [owner]);
    await assert.rejects(reserve(db), /storage_limit/);
    assert.equal(
      (await db.query("select count(*)::int n from library_image_uploads")).rows[0].n,
      0,
    );
    await db.query(
      "insert into user_library_items(id,user_id,title,item_type,source,content_text) values($1,$2,'Owned','document','manual','')",
      [id, owner],
    );
    await assert.rejects(reserve(db, { who: other }), /conflict/);
    await db.exec(
      `RESET ROLE;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false);UPDATE user_library_items SET title='Still owned' WHERE id='${id}';DELETE FROM user_library_items WHERE id='${id}';`,
    );
  } finally {
    await db.close();
  }
});
test("direct Storage and managed metadata writes cannot bypass image quota", async () => {
  const db = await database();
  try {
    await db.exec(
      `RESET ROLE;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage,auth TO authenticated;GRANT INSERT,DELETE,SELECT ON storage.objects TO authenticated;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false);`,
    );
    await assert.rejects(upload(db), /row.level security/);
    await assert.rejects(
      db.query(
        "insert into user_library_items(id,user_id,title,item_type,source,file_url,file_size,metadata) values($1,$2,'Image','image','images',$3,1,'{}')",
        [id, owner, path],
      ),
      /managed_write_required/,
    );
    await assert.rejects(reserve(db), /permission denied/);
  } finally {
    await db.close();
  }
});
test("image deletion retains quota until actual Storage removal and releases current prompt and bytes exactly once", async () => {
  const db = await database();
  try {
    await reserve(db);
    await upload(db);
    await settle(db);
    await retire(db);
    assert.equal(await cleaned(db), false);
    assert.equal(await used(db), 16);
    assert.equal(
      (await db.query("select read_library_image_upload($1,$2) value", [owner, id])).rows[0].value,
      null,
    );
    await db.query("delete from storage.objects where bucket_id='library-images' and name=$1", [
      path,
    ]);
    assert.equal(await cleaned(db), true);
    assert.equal(await cleaned(db), true);
    assert.equal(await used(db), 0);
    assert.equal(await settle(db), false);
    assert.equal((await db.query("select count(*)::int n from user_library_items")).rows[0].n, 0);
    await upload(db);
    assert.equal(await cleaned(db), false);
    await db.query("delete from storage.objects where name=$1", [path]);
    assert.equal(await cleaned(db), true);
    assert.equal(await used(db), 0);
  } finally {
    await db.close();
  }
});
test("account deletion waits pending leases, blocks publication and drains immutable image cleanup before Auth", async () => {
  const db = await database();
  try {
    await reserve(db);
    await db.query("insert into account_deletion_fences(user_id) values($1)", [owner]);
    assert.equal(
      (await db.query("select prepare_library_image_account_deletion($1) value", [owner])).rows[0]
        .value,
      false,
    );
    assert.equal(await settle(db), false);
    await assert.rejects(reserve(db, { item: next, generation: next }), /deletion/);
    await db.query(
      "update library_image_uploads set lease_expires_at=now()-interval '1 second' where owner_id=$1",
      [owner],
    );
    assert.equal(
      (await db.query("select prepare_library_image_account_deletion($1) value", [owner])).rows[0]
        .value,
      false,
    );
    const claimed = (await db.query("select * from claim_library_image_cleanup($1,25)", [owner]))
      .rows;
    assert.equal(claimed.length, 1);
    assert.equal(await cleaned(db), true);
    assert.equal(
      (await db.query("select prepare_library_image_account_deletion($1) value", [owner])).rows[0]
        .value,
      true,
    );
    assert.equal(await used(db), 0);
    await db.query("delete from account_deletion_fences where user_id=$1", [owner]);
    assert.equal(await settle(db), false);
  } finally {
    await db.close();
  }
});
test("legacy Storage metadata and unregistered image paths are charged and bounded account cleanup releases them", async () => {
  const db = await database({ legacy: true });
  try {
    assert.equal(await used(db), 8388631);
    await db.query("insert into account_deletion_fences(user_id) values($1)", [owner]);
    await db.query("select prepare_library_image_account_deletion($1)", [owner]);
    for (const row of (await db.query("select * from claim_library_image_cleanup($1,25)", [owner]))
      .rows) {
      await db.query("delete from storage.objects where name=$1", [row.storage_path]);
      assert.equal(
        (
          await db.query("select record_library_image_cleanup($1,$2) value", [
            owner,
            row.generation,
          ])
        ).rows[0].value,
        true,
      );
    }
    assert.equal(await used(db), 0);
  } finally {
    await db.close();
  }
});
test("generic image outbox cleanup releases its quota while direct metadata deletion remains retryable", async () => {
  const db = await database();
  try {
    await reserve(db);
    await upload(db);
    await settle(db);
    await db.query("delete from user_library_items where id=$1", [id]);
    assert.equal(await used(db), 10);
    assert.equal(
      (await db.query("select state from library_image_uploads")).rows[0].state,
      "retired",
    );
    await db.query("update account_storage_artifacts set state='retired' where generation=$1", [
      gen,
    ]);
    await db.query("delete from storage.objects where name=$1", [path]);
    assert.equal(
      (await db.query("select record_account_storage_artifact_cleanup($1) value", [gen])).rows[0]
        .value,
      true,
    );
    assert.equal(await used(db), 0);
  } finally {
    await db.close();
  }
});

test("legacy aliases preserve the shared object and stale displayed content generations cannot retire a replacement", async () => {
  const db = await database({ legacy: true, aliases: true });
  try {
    const row = (await db.query("select read_library_image_upload($1,$2) value", [owner, id]))
      .rows[0].value;
    assert.equal(row.size_bytes, 23);
    assert.equal(await used(db), 8388633);
    assert.equal(
      (
        await db.query("select retire_library_image_upload($1,$2,$3,true,$4) value", [
          owner,
          id,
          row.generation,
          gen,
        ])
      ).rows[0].value,
      null,
    );
    const displayed = (
      await db.query("select content_generation from user_library_items where id=$1", [id])
    ).rows[0].content_generation;
    assert.deepEqual(
      (
        await db.query("select retire_library_image_upload($1,$2,$3,true,$4) value", [
          owner,
          id,
          row.generation,
          displayed,
        ])
      ).rows[0].value,
      { shared: true },
    );
    assert.equal(
      (
        await db.query("select state from library_image_uploads where generation=$1", [
          row.generation,
        ])
      ).rows[0].state,
      "ready",
    );
    assert.equal(await used(db), 8388632);
    const second = (
      await db.query("select content_generation from user_library_items where id=$1", [next])
    ).rows[0].content_generation;
    assert.equal(
      (
        await db.query("select retire_library_image_upload($1,$2,$3,true,$4) value", [
          owner,
          next,
          row.generation,
          second,
        ])
      ).rows[0].value.state,
      "retired",
    );
    await db.query("delete from storage.objects where name=$1", [row.storage_path]);
    assert.equal(
      (await db.query("select record_library_image_cleanup($1,$2) value", [owner, row.generation]))
        .rows[0].value,
      true,
    );
    assert.equal(await used(db), 8388608);
  } finally {
    await db.close();
  }
});

test("ordinary metadata cannot transition into an unverified private image", async () => {
  const db = await database();
  try {
    await db.query(
      "insert into user_library_items(id,user_id,title,item_type,source,content_text) values($1,$2,'Note','document','manual','')",
      [id, owner],
    );
    await db.exec(
      `RESET ROLE;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false);`,
    );
    await assert.rejects(
      db.query("update user_library_items set item_type='image',file_url=$1 where id=$2", [
        path,
        id,
      ]),
      /permission denied/,
    );
    await db.exec("RESET ROLE;SET ROLE service_role");
    await assert.rejects(
      db.query("update user_library_items set item_type='image',file_url=$1 where id=$2", [
        path,
        id,
      ]),
      /managed_write_required/,
    );
    assert.equal(
      (await db.query("select item_type from user_library_items where id=$1", [id])).rows[0]
        .item_type,
      "document",
    );
    assert.equal(await used(db), 0);
  } finally {
    await db.close();
  }
});
