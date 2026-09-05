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
const third = "66666666-6666-4666-8666-666666666666";
async function replaceReserve(db, generation = next, expected = gen, sha = "b".repeat(64)) {
  return (
    await db.query(
      "select reserve_library_file_replacement($1,$2,$3,$4,'New.pdf','application/pdf',10,$5,'New text',1000) value",
      [owner, id, generation, expected, sha],
    )
  ).rows[0].value;
}
async function replaceSettle(db, generation = next) {
  return (
    await db.query("select settle_library_file_replacement($1,$2,$3) value", [
      owner,
      id,
      generation,
    ])
  ).rows[0].value;
}
async function initial(db) {
  await reserve(db);
  await object(db);
  assert.equal(await settle(db), true);
}
test("original replacement preserves exact immutable old bytes, CAS and one quota charge per retained generation", async () => {
  const db = await database();
  try {
    await initial(db);
    const pending = await replaceReserve(db);
    assert.equal(pending.base_generation, gen);
    assert.equal((await replaceReserve(db, third)).generation, next);
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 20);
    assert.equal(await replaceSettle(db), false);
    await object(db, next);
    assert.equal(await replaceSettle(db), true);
    assert.equal(await replaceSettle(db), true);
    const old = (
      await db.query("select read_library_file_version($1,$2,$3) value", [owner, id, gen])
    ).rows[0].value;
    assert.equal(old.sha256, "a".repeat(64));
    assert.equal(old.revision, 1);
    assert.equal(old.extracted_text, undefined);
    const current = (
      await db.query("select read_library_file_version($1,$2,$3) value", [owner, id, next])
    ).rows[0].value;
    assert.equal(current.sha256, "b".repeat(64));
    assert.equal((await replaceReserve(db, third)).generation, next);
    assert.equal(
      (await db.query("select content_revision from user_library_items")).rows[0].content_revision,
      2,
    );
    await assert.rejects(replaceReserve(db, third, gen, "c".repeat(64)), /conflict/);
    assert.equal(await retire(db, gen), false);
    assert.equal(
      (await db.query("select read_library_file_version($1,$2,$3) value", [other, id, gen])).rows[0]
        .value,
      null,
    );
  } finally {
    await db.close();
  }
});
test("deleting the current original retires every version and releases quota only after each actual cleanup", async () => {
  const db = await database();
  try {
    await initial(db);
    await replaceReserve(db);
    await object(db, next);
    await replaceSettle(db);
    assert.equal(await retire(db, next), true);
    assert.equal(
      (await db.query("select read_library_file_version($1,$2,$3) value", [owner, id, gen])).rows[0]
        .value,
      null,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from account_storage_artifacts where state='retired'",
        )
      ).rows[0].n,
      2,
    );
    await cleanup(db, next);
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 10);
    await cleanup(db, gen);
    await cleanup(db, gen);
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 0);
    assert.equal(
      (await db.query("select file_name from library_file_versions")).rows[0].file_name,
      "",
    );
    assert.equal(await replaceSettle(db), false);
  } finally {
    await db.close();
  }
});
test("failed replacement cannot destroy current content and stale producer cleanup cannot retire a settled generation", async () => {
  const db = await database();
  try {
    await initial(db);
    await replaceReserve(db);
    assert.equal(
      (await db.query("select retire_library_file_replacement($1,$2,$3) value", [owner, id, next]))
        .rows[0].value,
      true,
    );
    await cleanup(db, next);
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 10);
    assert.equal(await replaceSettle(db), false);
    await replaceReserve(db, third);
    await object(db, third);
    assert.equal(await replaceSettle(db, third), true);
    assert.equal(
      (await db.query("select retire_library_file_replacement($1,$2,$3) value", [owner, id, third]))
        .rows[0].value,
      false,
    );
    assert.equal(
      (await db.query("select file_name from user_library_items")).rows[0].file_name,
      "New.pdf",
    );
  } finally {
    await db.close();
  }
});
test("account deletion waits for active replacements then drains all retained generations before purging metadata", async () => {
  const db = await database();
  try {
    await initial(db);
    await replaceReserve(db);
    await db.query("insert into account_deletion_fences values($1)", [owner]);
    assert.equal(
      (await db.query("select prepare_library_file_account_deletion($1) value", [owner])).rows[0]
        .value,
      false,
    );
    assert.equal(await replaceSettle(db), false);
    await db.exec(
      "update account_storage_artifacts set lease_expires_at=now()-interval '1 minute'",
    );
    assert.equal(
      (await db.query("select prepare_library_file_account_deletion($1) value", [owner])).rows[0]
        .value,
      false,
    );
    await cleanup(db, next);
    await cleanup(db, gen);
    assert.equal(
      (await db.query("select prepare_library_file_account_deletion($1) value", [owner])).rows[0]
        .value,
      true,
    );
    assert.equal(
      (await db.query("select count(*)::int n from library_file_replacements")).rows[0].n,
      0,
    );
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 0);
  } finally {
    await db.close();
  }
});
test("text revisions preserve history with bounded quota, reject stale/recreated items and release history on deletion", async () => {
  const db = await database();
  try {
    const row = (
      await db.query(
        "insert into user_library_items(id,user_id,title,item_type,content_text) values($1,$2,'Note','document','old text') returning *",
        [id, owner],
      )
    ).rows[0];
    const change = (revision, text, generation = row.content_generation, limit = 1000) =>
      db.query("select replace_library_text($1,$2,$3,$4,$5,$6) value", [
        owner,
        id,
        generation,
        revision,
        text,
        limit,
      ]);
    assert.equal((await change(1, "new text")).rows[0].value, 2);
    assert.equal((await change(1, "new text")).rows[0].value, 2);
    await assert.rejects(change(1, "stale text"), /conflict/);
    await assert.rejects(change(2, "third text", row.content_generation, 8), /storage_limit/);
    assert.equal(
      (await db.query("select content_text from library_text_versions")).rows[0].content_text,
      "old text",
    );
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 16);
    assert.equal(
      (
        await db.query("select delete_library_text($1,$2,$3,1) value", [
          owner,
          id,
          row.content_generation,
        ])
      ).rows[0].value,
      false,
    );
    assert.equal(
      (
        await db.query("select delete_library_text($1,$2,$3,2) value", [
          owner,
          id,
          row.content_generation,
        ])
      ).rows[0].value,
      true,
    );
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 0);
    await db.query(
      "insert into user_library_items(id,user_id,title,item_type,content_text) values($1,$2,'New note','document','new identity')",
      [id, owner],
    );
    await assert.rejects(change(1, "stale replacement"), /conflict/);
    assert.equal(
      (
        await db.query("select delete_library_text($1,$2,$3,1) value", [
          owner,
          id,
          row.content_generation,
        ])
      ).rows[0].value,
      false,
    );
  } finally {
    await db.close();
  }
});
test("ordinary RLS title changes remain available, while direct body mutations and private version reads are denied", async () => {
  const db = await database();
  try {
    await db.query(
      "insert into user_library_items(id,user_id,title,item_type,content_text) values($1,$2,'Note','document','text')",
      [id, owner],
    );
    await db.exec(
      `RESET ROLE;GRANT USAGE ON SCHEMA auth TO authenticated;SET ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${owner}',false)`,
    );
    await db.query("update user_library_items set title='Renamed' where id=$1", [id]);
    await assert.rejects(
      db.query("update user_library_items set content_text='bypass' where id=$1", [id]),
      /permission denied/,
    );
    await assert.rejects(db.query("select * from library_file_versions"), /permission denied/);
    await assert.rejects(db.query("select * from library_text_versions"), /permission denied/);
  } finally {
    await db.close();
  }
});
test("keyset listing reaches older items, searches complete bodies and emits only bounded previews", async () => {
  const db = await database();
  try {
    await db.query(
      "insert into user_library_items(id,user_id,title,item_type,content_text,created_at) select gen_random_uuid(),$1,'Item '||lpad(n::text,3,'0'),'document',case when n=220 then repeat('private body ',1000)||'unique tail match' else 'body' end,'2026-09-01'::timestamptz+ n*interval '1 minute' from generate_series(1,230) n",
      [owner],
    );
    const page = async (cursor = null, query = "", sort = "newest") =>
      (
        await db.query("select list_library_items_page($1,$2,$3,'all','all',$4) value", [
          owner,
          query,
          cursor,
          sort,
        ])
      ).rows[0].value;
    const found = [];
    let cursor = null;
    do {
      const result = await page(cursor);
      assert.ok(result.items.length <= 50);
      for (const item of result.items) {
        assert.equal(item.content_text, undefined);
        assert.ok((item.content_excerpt?.length ?? 0) <= 320);
        found.push(item.id);
      }
      cursor = result.cursor;
    } while (cursor);
    assert.equal(found.length, 230);
    assert.equal(new Set(found).size, 230);
    const searched = await page(null, "unique tail match");
    assert.equal(searched.items.length, 1);
    assert.equal(searched.items[0].title, "Item 220");
    assert.ok(!searched.items[0].content_excerpt.includes("unique tail"));
    await assert.rejects(
      page({ id, sort: "size", query: "", folder: "all", filter: "all" }),
      /page_invalid/,
    );
    const otherPage = (await db.query("select list_library_items_page($1) value", [other])).rows[0]
      .value;
    assert.equal(otherPage.items.length, 0);
  } finally {
    await db.close();
  }
});
test("legacy multibyte current text remains replaceable and its original content is retained without truncation", async () => {
  const db = await database();
  try {
    // Simulate an old valid 150k-character body existing before the new current-text limit.
    await db.exec(
      "RESET ROLE;ALTER TABLE user_library_items DISABLE TRIGGER b_account_library_current_text",
    );
    const legacy = "界".repeat(150000);
    const row = (
      await db.query(
        "insert into user_library_items(id,user_id,title,item_type,content_text,content_bytes_charged) values($1,$2,'Legacy','document',$3,450000) returning *",
        [id, owner, legacy],
      )
    ).rows[0];
    await db.query("insert into user_storage(user_id,bytes_used) values($1,450000)", [owner]);
    await db.exec(
      "ALTER TABLE user_library_items ENABLE TRIGGER b_account_library_current_text;SET ROLE service_role",
    );
    assert.equal(
      (
        await db.query("select replace_library_text($1,$2,$3,1,'small correction',1000000) value", [
          owner,
          id,
          row.content_generation,
        ])
      ).rows[0].value,
      2,
    );
    assert.equal(
      (await db.query("select content_text from library_text_versions")).rows[0].content_text,
      legacy,
    );
    assert.equal(
      (await db.query("select bytes_used from user_storage")).rows[0].bytes_used,
      450016,
    );
  } finally {
    await db.close();
  }
});
test("current text and archive charge together; a smaller replacement at the quota boundary remains possible", async () => {
  const db = await database();
  try {
    const row = (
      await db.query(
        "insert into user_library_items(id,user_id,title,item_type,content_text) values($1,$2,'Note','document','12345678') returning *",
        [id, owner],
      )
    ).rows[0];
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 8);
    assert.equal(
      (
        await db.query("select replace_library_text($1,$2,$3,1,'',8) value", [
          owner,
          id,
          row.content_generation,
        ])
      ).rows[0].value,
      2,
    );
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 8);
    await db.query("select delete_library_text($1,$2,$3,2)", [owner, id, row.content_generation]);
    assert.equal((await db.query("select bytes_used from user_storage")).rows[0].bytes_used, 0);
  } finally {
    await db.close();
  }
});
