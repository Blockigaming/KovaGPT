import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { authDatabase, passwordAccount } from "../helpers/kova-auth-database.mjs";

const migration = "20260930224000_kova_owned_storage_cache_boundary.sql";
let db;
const setup = `
  create schema storage;
  grant usage on schema storage to anon,authenticated,service_role;
  create table storage.objects(id uuid primary key,owner_id uuid,value text);
  create table storage.buckets(id text primary key);
  create table storage.s3_multipart_uploads(id text primary key);
  create table storage.buckets_vectors(id text primary key);
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to authenticated,service_role;
  create policy owner_access on storage.objects for all to authenticated
    using(owner_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid)
    with check(owner_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
  alter role service_role bypassrls;
`;
before(async () => {
  db = await authDatabase({ beforeMigrations: setup });
});
after(async () => {
  await db?.close();
});
async function account() {
  const at = new Date().toISOString();
  const row = await passwordAccount(db, {
    id: randomUUID(),
    token: randomUUID(),
    at,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const claims = {
    kova_auth: 1,
    role: "authenticated",
    aud: "authenticated",
    sub: row.account_id,
    session_id: row.session_id,
    email: row.email,
    email_verified: true,
    aal: row.assurance_level,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  await db.query("insert into storage.objects values($1,$2,'private')", [
    row.account_id,
    row.account_id,
  ]);
  return { ...row, claims };
}
async function read(claims, operation, role = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claims',$1,true),set_config('storage.operation',$2,true)",
      [JSON.stringify(claims), operation ?? ""],
    );
    await tx.exec(`set local role ${role}`);
    return (await tx.query("select * from storage.objects where id=$1", [claims.sub])).rows;
  });
}
test("reproduces the CDN bypass and prevents warming that byte cache with owned authority", async () => {
  const owner = await account();
  await db.exec("drop policy kova_owned_storage_cache_boundary on storage.objects");
  // A gateway cache hit returns previously authorized bytes without a new SQL
  // statement. The preserved deployed edge log is HIT at 22:03:45.462Z.
  const cached = await read(owner.claims, "storage.object.get_authenticated");
  assert.equal(cached.length, 1);
  await db.query("select public.kova_auth_revoke_session($1)", [owner.digest]);
  assert.equal((await read(owner.claims, "storage.object.get_authenticated")).length, 0);
  assert.equal(cached.length, 1);
  await db.exec("drop function kova_auth_guard.storage_operation_is_safe()");
  await db.exec(
    await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), "utf8"),
  );
  const fresh = await account();
  for (const operation of [
    "storage.object.get_authenticated",
    "object.get_authenticated",
    "storage.render.image_authenticated",
    "storage.s3.object.get",
    "storage.object.get_public",
    "storage.object.future_byte_download",
    "",
    null,
  ])
    assert.equal((await read(fresh.claims, operation)).length, 0, operation);
});
test("fresh signing/listing keeps ownership checks and loses authority immediately on revoke", async () => {
  const owner = await account(),
    other = await account();
  for (const op of ["storage.object.sign", "object.sign_many", "storage.object.list"])
    assert.equal((await read(owner.claims, op)).length, 1);
  await db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claims',$1,true),set_config('storage.operation','storage.object.sign',true)",
      [JSON.stringify(other.claims)],
    );
    await tx.exec("set local role authenticated");
    assert.equal(
      (await tx.query("select * from storage.objects where id=$1", [owner.account_id])).rows.length,
      0,
    );
  });
  await db.query("select public.kova_auth_revoke_session($1)", [owner.digest]);
  for (const op of ["storage.object.sign", "storage.object.list"])
    assert.equal((await read(owner.claims, op)).length, 0);
});
test("service operations and non-byte owner mutations are preserved; internal tables untouched", async () => {
  const owner = await account();
  assert.equal(
    (
      await read(
        { ...owner.claims, kova_auth: undefined },
        "storage.object.get_authenticated",
        "service_role",
      )
    ).length,
    1,
  );
  await db.transaction(async (tx) => {
    await tx.query(
      "select set_config('request.jwt.claims',$1,true),set_config('storage.operation','storage.object.upload_update',true)",
      [JSON.stringify(owner.claims)],
    );
    await tx.exec("set local role authenticated");
    assert.equal(
      (
        await tx.query("update storage.objects set value='changed' where id=$1 returning id", [
          owner.account_id,
        ])
      ).rows.length,
      1,
    );
  });
  assert.deepEqual(
    (
      await db.query(
        "select tablename from pg_policies where policyname='kova_owned_storage_cache_boundary'",
      )
    ).rows,
    [{ tablename: "objects" }],
  );
});
test("unmarked legacy access keeps its existing policy, malformed markers do not bypass", async () => {
  const owner = await account();
  const legacy = { ...owner.claims };
  delete legacy.kova_auth;
  // Existing retirement guard separately decides whether this hosted user is retired.
  await db.query("delete from kova_private.auth_legacy_retirements where account_id=$1", [
    owner.account_id,
  ]);
  assert.equal((await read(legacy, "storage.object.get_authenticated")).length, 1);
  for (const marker of [0, "1", null, true])
    assert.equal(
      (await read({ ...owner.claims, kova_auth: marker }, "storage.object.sign")).length,
      0,
    );
});
