import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { authDatabase, digest, now, expiry, owner, other } from "../helpers/kova-auth-database.mjs";

const email = "owner@example.invalid";
const subject = "verified-hosted-google-subject";
const signature =
  "public.kova_auth_finish_google(uuid,text,text,boolean,text,text,timestamptz,timestamptz)";
const finish = (db, candidate = other, address = email, googleSubject = subject) =>
  db.query("select * from public.kova_auth_finish_google($1,$2,$3,true,'Owner',$4,$5,$6)", [
    candidate,
    googleSubject,
    address,
    digest("handoff"),
    expiry,
    now,
  ]);

async function hosted(
  db,
  { userId = owner, address = email, googleSubject = subject, confirmed = true } = {},
) {
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
    userId,
    address,
    confirmed ? now : null,
  ]);
  await db.query(
    "insert into auth.identities(id,user_id,provider,provider_id,identity_data) values($1,$2,'google',$3,$4)",
    [randomUUID(), userId, googleSubject, { sub: googleSubject }],
  );
}

test("the replaced security-definer RPC remains service-role only", async () => {
  const db = await authDatabase();
  try {
    const publicGrant = await db.query(
      `select exists(
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
       where p.oid=$1::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) as allowed`,
      [signature],
    );
    assert.equal(publicGrant.rows[0].allowed, false);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const privilege = await db.query(
        "select has_function_privilege($1,$2,'execute') as allowed",
        [role, signature],
      );
      assert.equal(privilege.rows[0].allowed, role === "service_role");
    }
  } finally {
    await db.close();
  }
});

test("verified hosted Google subject adopts the existing UUID and not the candidate", async () => {
  const db = await authDatabase();
  try {
    await hosted(db);
    await db.query("insert into auth.users(id,email) values($1,'shadow@example.invalid')", [other]);
    assert.deepEqual((await finish(db)).rows, [{ account_id: owner, candidate_used: false }]);
    assert.deepEqual(
      (
        await db.query(
          "select id,legacy_supabase_user_id,primary_email from kova_private.auth_accounts",
        )
      ).rows,
      [{ id: owner, legacy_supabase_user_id: owner, primary_email: email }],
    );
    assert.equal(
      (
        await db.query(
          "select provider_subject from kova_private.auth_identities where provider='google'",
        )
      ).rows[0].provider_subject,
      subject,
    );
  } finally {
    await db.close();
  }
});

test("a fresh subject cannot claim the confirmed hosted mailbox by email alone", async () => {
  const db = await authDatabase();
  try {
    await hosted(db);
    await db.query("insert into auth.users(id,email) values($1,'shadow@example.invalid')", [other]);
    await assert.rejects(finish(db, other, email, "different-google-subject"), {
      code: "KVA02",
    });
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_accounts")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("a mismatched hosted subject, unconfirmed email, or duplicate mailbox cannot be adopted", async (t) => {
  for (const variant of ["mismatched-sub", "unconfirmed", "duplicate-mailbox"]) {
    await t.test(variant, async () => {
      const db = await authDatabase();
      try {
        await hosted(db, { confirmed: variant !== "unconfirmed" });
        await db.query("insert into auth.users(id,email) values($1,'shadow@example.invalid')", [
          other,
        ]);
        if (variant === "mismatched-sub")
          await db.query("update auth.identities set identity_data=$1", [{ sub: "different" }]);
        if (variant === "duplicate-mailbox")
          await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
            randomUUID(),
            email,
            now,
          ]);
        await assert.rejects(finish(db), { code: "KVA02" });
        assert.equal(
          (await db.query("select count(*)::int n from kova_private.auth_accounts")).rows[0].n,
          0,
        );
      } finally {
        await db.close();
      }
    });
  }
});

test("fresh Google subject cannot link an existing verified owned account by email alone", async () => {
  const db = await authDatabase();
  try {
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
      owner,
      "shadow@example.invalid",
      now,
    ]);
    await db.query("insert into auth.users(id,email) values($1,'candidate@example.invalid')", [
      other,
    ]);
    await db.query(
      "insert into kova_private.auth_accounts(id,legacy_supabase_user_id,primary_email,email_verified_at) values($1,$1,$2,$3)",
      [owner, email, now],
    );
    await assert.rejects(finish(db), { code: "KVA02" });
    assert.equal(
      (await db.query("select count(*)::int n from kova_private.auth_identities")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
