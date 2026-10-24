import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { authDatabase, livePasswordAccount } from "../helpers/kova-auth-database.mjs";

const migration = new URL(
  "../../supabase/migrations/20261019222427_kova_owned_session_guard_coverage.sql",
  import.meta.url,
);
const fixture = "public.guard_added_after_auth";

test("later RLS tables retain owner isolation and reject revoked sessions after additive repair", async () => {
  let existingGuardOid;
  let beforePrivateAcl;
  const db = await authDatabase({
    beforeMigrations: `
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
      $$;
      create table public.guard_existing(id int);
      alter table public.guard_existing enable row level security;
    `,
    beforeMigration: async (name, current) => {
      if (!name.endsWith("_kova_owned_session_guard_coverage.sql")) return;
      existingGuardOid = (
        await current.query(`select oid from pg_catalog.pg_policy
          where polrelid='public.guard_existing'::regclass and polname='kova_owned_session_guard'`)
      ).rows[0].oid;
      beforePrivateAcl = (
        await current.query(`select relacl::text as acl from pg_catalog.pg_class
          where oid='kova_private.auth_sessions'::regclass`)
      ).rows[0].acl;
      await current.exec(`
        create table ${fixture}(id uuid primary key, owner_id uuid not null, value text);
        alter table ${fixture} enable row level security;
        grant select, insert, update, delete on ${fixture} to anon, authenticated;
        create policy owner_access on ${fixture} for all to authenticated
          using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
        create table public.guard_disabled(id int);
        create schema if not exists storage;
        create table storage.s3_multipart_guard_fixture(id int);
        alter table storage.s3_multipart_guard_fixture enable row level security;
      `);
      assert.equal(
        (
          await current.query(`select count(*)::int as n from pg_catalog.pg_policy
          where polrelid='${fixture}'::regclass and polname='kova_owned_session_guard'`)
        ).rows[0].n,
        0,
      );
    },
  });
  try {
    const owner = await livePasswordAccount(db, { id: randomUUID(), token: randomUUID() });
    const other = await livePasswordAccount(db, { id: randomUUID(), token: randomUUID() });
    const claims = (account) => ({
      kova_auth: 1,
      role: "authenticated",
      aud: "authenticated",
      sub: account.account_id,
      session_id: account.session_id,
      email: account.email,
      email_verified: true,
      aal: account.assurance_level,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const ownerClaims = claims(owner);
    const asCaller = (caller, sql, params = []) =>
      db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(caller),
        ]);
        await tx.exec("set local role authenticated");
        return tx.query(sql, params);
      });
    const id = randomUUID();
    await asCaller(ownerClaims, `insert into ${fixture} values($1,$2,'private')`, [
      id,
      owner.account_id,
    ]);
    assert.equal((await asCaller(ownerClaims, `select id from ${fixture}`)).rows.length, 1);
    assert.equal((await asCaller(claims(other), `select id from ${fixture}`)).rows.length, 0);
    await assert.rejects(
      asCaller(claims(other), `insert into ${fixture} values($1,$2,'forged')`, [
        randomUUID(),
        owner.account_id,
      ]),
      /row-level security/u,
    );
    await assert.rejects(
      asCaller(ownerClaims, `update ${fixture} set owner_id=$1 where id=$2`, [
        other.account_id,
        id,
      ]),
      /row-level security/u,
    );

    await db.query("select public.kova_auth_revoke_session($1)", [owner.digest]);
    assert.equal((await asCaller(ownerClaims, `select id from ${fixture}`)).rows.length, 0);
    assert.equal(
      (await asCaller(ownerClaims, `update ${fixture} set value='changed' returning id`)).rows
        .length,
      0,
    );
    assert.equal(
      (await asCaller(ownerClaims, `delete from ${fixture} returning id`)).rows.length,
      0,
    );
    await assert.rejects(
      asCaller(ownerClaims, `insert into ${fixture} values($1,$2,'stale')`, [
        randomUUID(),
        owner.account_id,
      ]),
      /row-level security/u,
    );
    assert.equal(
      (await db.query(`select value from ${fixture} where id=$1`, [id])).rows[0].value,
      "private",
    );

    // Rerunning the repair preserves the original guard and ownership policy.
    await db.exec(await readFile(migration, "utf8"));
    assert.equal(
      (
        await db.query(`select oid from pg_catalog.pg_policy
      where polrelid='public.guard_existing'::regclass and polname='kova_owned_session_guard'`)
      ).rows[0].oid,
      existingGuardOid,
    );
    assert.equal(
      (
        await db.query(`select count(*)::int as n from pg_catalog.pg_policy
      where polrelid='${fixture}'::regclass and polname='owner_access' and polpermissive`)
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(`select relacl::text as acl from pg_catalog.pg_class
      where oid='kova_private.auth_sessions'::regclass`)
      ).rows[0].acl,
      beforePrivateAcl,
    );
    assert.equal(
      (
        await db.query(`select count(*)::int as n from pg_catalog.pg_policy
      where polname='kova_owned_session_guard' and polrelid in
        ('public.guard_disabled'::regclass,'storage.s3_multipart_guard_fixture'::regclass,'kova_private.auth_sessions'::regclass)`)
      ).rows[0].n,
      0,
    );

    // A same-name policy with weaker semantics must never be accepted or replaced.
    await db.exec(`alter policy kova_owned_session_guard on ${fixture} using (true)`);
    await assert.rejects(
      db.exec(await readFile(migration, "utf8")),
      /kova_auth_session_guard_policy_conflict/u,
    );
  } finally {
    await db.close();
  }
});
