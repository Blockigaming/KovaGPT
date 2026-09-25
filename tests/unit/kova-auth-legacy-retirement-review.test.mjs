import assert from "node:assert/strict";
import test from "node:test";
import {
  authDatabase,
  passwordAccount,
  digest,
  now,
  expiry,
  owner,
  other,
} from "../helpers/kova-auth-database.mjs";
const hash = `scrypt-v1$32768$8$1$${"q".repeat(22)}$${"r".repeat(43)}`;
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const allowed = (db, id) => scalar(db, "select public.kova_auth_legacy_session_allowed($1)", [id]);
async function fixture(db) {
  const p = await passwordAccount(db);
  // Model a previously adopted credential before the new retirement migration.
  await db.query("delete from kova_private.auth_legacy_retirements where account_id=$1", [owner]);
  await db.query("update auth.users set encrypted_password='legacy-password-hash' where id=$1", [
    owner,
  ]);
  await db.query("insert into auth.sessions(id,user_id) values(gen_random_uuid(),$1)", [owner]);
  return p;
}
const change = (db, p, revision = p.credential.revision) =>
  db.query("select * from public.kova_auth_change_password($1,$2,$3,$4,$5,$6,$7)", [
    p.digest,
    p.credential.id,
    revision,
    hash,
    digest("rotated"),
    expiry,
    now,
  ]);
const snapshot = async (db) =>
  (
    await db.query(`select
 (select jsonb_agg(to_jsonb(u)) from auth.users u) users,
 (select jsonb_agg(to_jsonb(s)) from auth.sessions s) hosted_sessions,
 (select jsonb_agg(to_jsonb(c)) from kova_private.auth_credentials c) credentials,
 (select jsonb_agg(to_jsonb(s)) from kova_private.auth_sessions s) sessions,
 (select jsonb_agg(to_jsonb(a)) from kova_private.auth_accounts a) accounts,
 (select jsonb_agg(to_jsonb(r)) from kova_private.auth_legacy_retirements r) retirements`)
  ).rows;

test("owned password changes atomically retire the hosted password, refresh sessions and already-issued hosted JWT authority", async () => {
  const db = await authDatabase();
  try {
    const p = await fixture(db);
    assert.equal(await allowed(db, owner), true);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ role: "authenticated", sub: owner }),
    ]);
    assert.equal(await scalar(db, "select kova_auth_guard.session_is_active()"), true);
    const next = (await change(db, p)).rows[0];
    assert.equal(next.account_id, owner);
    assert.equal(
      await scalar(db, "select encrypted_password from auth.users where id=$1", [owner]),
      null,
    );
    assert.equal(
      await scalar(db, "select count(*)::int from auth.sessions where user_id=$1", [owner]),
      0,
    );
    assert.equal(await allowed(db, owner), false);
    assert.equal(await scalar(db, "select kova_auth_guard.session_is_active()"), false);
    assert.equal(
      (await db.query("select * from public.kova_auth_resolve_session($1,$2)", [p.digest, now]))
        .rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from public.kova_auth_resolve_session($1,$2)", [
          digest("rotated"),
          now,
        ])
      ).rows.length,
      1,
    );
    // The non-secret denial marker deliberately survives erasure of the UUID root.
    await db.query("delete from auth.users where id=$1", [owner]);
    assert.equal(await scalar(db, "select kova_auth_guard.session_is_active()"), false);
  } finally {
    await db.close();
  }
});

test("audit failure and stale password proof roll back all retirement and credential effects", async () => {
  const db = await authDatabase();
  try {
    const p = await fixture(db);
    const before = await snapshot(db);
    await assert.rejects(change(db, p, 999), /stale_credential/);
    assert.deepEqual(await snapshot(db), before);
    await db.exec(`create function public.reject_review_audit() returns trigger language plpgsql as $$ begin raise exception 'test_audit_failure'; end $$;
   create trigger reject_review_audit before insert on kova_private.auth_audit_events for each row execute function public.reject_review_audit();`);
    await assert.rejects(change(db, p), /test_audit_failure/);
    assert.deepEqual(await snapshot(db), before);
  } finally {
    await db.close();
  }
});

for (const kind of ["password", "google", "recovery"])
  test(`${kind}: legacy bans cannot be bypassed during adoption`, async () => {
    const db = await authDatabase();
    try {
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at,banned_until) values($1,'banned@example.invalid',$2,'infinity')",
        [owner, now],
      );
      await db.query("insert into auth.users(id,email) values($1,'candidate@example.invalid')", [
        other,
      ]);
      const operation =
        kind === "password"
          ? () =>
              db.query(
                "select * from public.kova_auth_create_password_account($1,'banned@example.invalid','Banned',$2,$3,$4,'{}',$5)",
                [other, hash, digest("verify"), expiry, now],
              )
          : kind === "google"
            ? () =>
                db.query(
                  "select * from public.kova_auth_finish_google($1,'banned-google','banned@example.invalid',true,'Banned',$2,$3,$4)",
                  [other, digest("handoff"), expiry, now],
                )
            : () =>
                db.query(
                  "select public.kova_auth_create_recovery('banned@example.invalid',$1,$2,'{}',$3)",
                  [digest("recover"), expiry, now],
                );
      await assert.rejects(operation(), /account_unavailable/);
      assert.equal(await scalar(db, "select count(*)::int from kova_private.auth_accounts"), 0);
      assert.equal(await scalar(db, "select count(*)::int from public.test_email_queue"), 0);
    } finally {
      await db.close();
    }
  });

test("a legacy ban after adoption blocks cookie resolution, new sessions and security mutations", async () => {
  const db = await authDatabase();
  try {
    const p = await passwordAccount(db);
    await db.query("update auth.users set banned_until='infinity' where id=$1", [owner]);
    assert.equal(
      (await db.query("select * from public.kova_auth_resolve_session($1,$2)", [p.digest, now]))
        .rows.length,
      0,
    );
    await assert.rejects(change(db, p), /invalid_session/);
    await assert.rejects(
      db.query("select * from public.kova_auth_create_session($1,$2,$3,$4,'aal1',$5,$6)", [
        owner,
        p.credential.id,
        p.credential.revision,
        digest("another"),
        expiry,
        now,
      ]),
      /account_unavailable/,
    );
  } finally {
    await db.close();
  }
});

test("a verified Google subject can rename its email without moving UUIDs or reviving old proofs; collisions roll back", async () => {
  const db = await authDatabase();
  try {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'old@example.invalid',$2)",
      [owner, now],
    );
    const google = (email, subject = "same-subject", handoff = "h") =>
      db.query("select * from public.kova_auth_finish_google($1,$2,$3,true,'Owner',$4,$5,$6)", [
        owner,
        subject,
        email,
        digest(handoff),
        expiry,
        now,
      ]);
    await google("old@example.invalid");
    await google("new@example.invalid", "same-subject", "h2");
    assert.equal(
      await scalar(db, "select primary_email from kova_private.auth_accounts where id=$1", [owner]),
      "new@example.invalid",
    );
    assert.equal(await scalar(db, "select count(*)::int from kova_private.auth_accounts"), 1);
    assert.equal(
      await scalar(
        db,
        "select count(*)::int from kova_private.auth_session_handoffs where consumed_at is null",
      ),
      1,
    );
    assert.equal(await allowed(db, owner), false);
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'occupied@example.invalid',$2)",
      [other, now],
    );
    const before = await snapshot(db);
    await assert.rejects(
      google("occupied@example.invalid", "same-subject", "h3"),
      /email_conflict/,
    );
    assert.deepEqual(await snapshot(db), before);
    await assert.rejects(
      google("new@example.invalid", "different-subject", "h4"),
      /invalid_google_identity/,
    );
  } finally {
    await db.close();
  }
});

test("retirement markers and internal helpers remain inaccessible to browser roles", async () => {
  const db = await authDatabase();
  try {
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        await scalar(
          db,
          "select has_table_privilege($1,'kova_private.auth_legacy_retirements','select')",
          [role],
        ),
        false,
      );
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1,'public.kova_auth_legacy_session_allowed(uuid)','execute')",
          [role],
        ),
        false,
      );
    }
    assert.equal(
      await scalar(
        db,
        "select has_function_privilege('service_role','public.kova_auth_legacy_session_allowed(uuid)','execute')",
      ),
      true,
    );
  } finally {
    await db.close();
  }
});
