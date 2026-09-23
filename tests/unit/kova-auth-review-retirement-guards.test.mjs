import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  authDatabase,
  passwordAccount,
  digest,
  now,
  expiry,
  owner,
  other,
} from "../helpers/kova-auth-database.mjs";

const hash = `scrypt-v1$32768$8$1$${"n".repeat(22)}$${"h".repeat(43)}`;
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const change = (db, account, token = "changed-session") =>
  db.query("select * from public.kova_auth_change_password($1,$2,$3,$4,$5,$6,$7)", [
    account.digest,
    account.credential.id,
    account.credential.revision,
    hash,
    digest(token),
    expiry,
    now,
  ]);
const state = async (db) =>
  (
    await db.query(`select
  (select jsonb_agg(to_jsonb(u) order by id) from auth.users u) as users,
  (select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s) as hosted_sessions,
  (select jsonb_agg(to_jsonb(c) order by id) from kova_private.auth_credentials c) as credentials,
  (select jsonb_agg(to_jsonb(s) order by id) from kova_private.auth_sessions s) as owned_sessions,
  (select count(*)::int from kova_private.auth_audit_events) as audits`)
  ).rows;

test("normal owned password changes retire the hosted password and refresh sessions in the same transaction", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    await db.query("update auth.users set encrypted_password='old-hosted-password' where id=$1", [
      owner,
    ]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [randomUUID(), owner]);
    const result = (await change(db, account)).rows[0];
    assert.equal(result.account_id, owner);
    assert.equal(
      await scalar(db, "select encrypted_password from auth.users where id=$1", [owner]),
      null,
    );
    assert.equal(
      await scalar(db, "select count(*)::int from auth.sessions where user_id=$1", [owner]),
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select legacy_disabled_at is not null from kova_private.auth_credentials where id=$1",
        [account.credential.id],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::int from kova_private.auth_sessions where account_id=$1 and revoked_at is null",
        [owner],
      ),
      1,
    );
    await assert.rejects(change(db, account), /kova_auth_/u);
  } finally {
    await db.close();
  }
});

test("a later audit failure rolls back BOTH hosted credential retirement and owned password/session changes", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    await db.query("update auth.users set encrypted_password='must-survive-rollback' where id=$1", [
      owner,
    ]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [randomUUID(), owner]);
    await db.exec(`create function public.reject_review_audit() returns trigger language plpgsql as $$begin raise exception 'review_audit_failure';end$$;
      create trigger reject_review_audit before insert on kova_private.auth_audit_events for each row execute function public.reject_review_audit()`);
    const before = await state(db);
    await assert.rejects(change(db, account), /review_audit_failure/u);
    assert.deepEqual(await state(db), before);
  } finally {
    await db.close();
  }
});

test("password and Google adoption cannot bypass a legacy ban, deletion or anonymous status", async (t) => {
  const db = await authDatabase();
  try {
    for (const status of ["banned_until='infinity'", "deleted_at=now()", "is_anonymous=true"]) {
      for (const method of ["password", "google"])
        await t.test(`${method}: ${status}`, async () => {
          await db.exec("begin");
          try {
            await db.query(
              "insert into auth.users(id,email,email_confirmed_at) values($1,'adopt@example.invalid',$2)",
              [owner, now],
            );
            await db.exec(`update auth.users set ${status}`);
            const candidate = await scalar(
              db,
              "select public.kova_auth_create_compatibility_principal()",
            );
            await db.exec("savepoint adoption_attempt");
            const operation =
              method === "password"
                ? db.query(
                    "select * from public.kova_auth_create_password_account($1,'adopt@example.invalid','Account',$2,$3,$4,'{}',$5)",
                    [candidate, hash, digest("verify"), expiry, now],
                  )
                : db.query(
                    "select * from public.kova_auth_finish_google($1,'google-subject','adopt@example.invalid',true,'Account',$2,$3,$4)",
                    [candidate, digest("handoff"), expiry, now],
                  );
            // A deleted account may be excluded from the email lookup. In that
            // case a new inert UUID is permitted, never the unavailable old UUID.
            try {
              const rows = (await operation).rows;
              assert.notEqual(rows[0]?.account_id, owner);
              assert.ok(status.startsWith("deleted_at"));
            } catch (error) {
              assert.match(error.message, /kova_auth_/u);
              await db.exec("rollback to adoption_attempt");
            }
            assert.equal(
              await scalar(db, "select count(*)::int from kova_private.auth_accounts where id=$1", [
                owner,
              ]),
              0,
            );
          } finally {
            await db.exec("rollback");
          }
        });
    }
  } finally {
    await db.close();
  }
});

test("the exact inert Kova-created bridge still admits Google and verified snapshots never expose its shadow email", async () => {
  const db = await authDatabase();
  try {
    const candidate = await scalar(db, "select public.kova_auth_create_compatibility_principal()");
    await db.query(
      "select * from public.kova_auth_finish_google($1,'stable-subject','real@example.invalid',true,'Real Person',$2,$3,$4)",
      [candidate, digest("handoff"), expiry, now],
    );
    const row = await scalar(db, "select public.kova_auth_account_snapshot($1,false,true)", [
      candidate,
    ]);
    assert.equal(row.id, candidate);
    assert.equal(row.email, "real@example.invalid");
    assert.equal(row.app_metadata.provider, "kova");
    assert.equal(row.user_metadata.full_name, "Real Person");
    assert.doesNotMatch(
      JSON.stringify(row),
      /shadow\+|encrypted_password|token_digest|session_epoch/u,
    );
    await db.query("update kova_private.auth_accounts set suspended_until='infinity' where id=$1", [
      candidate,
    ]);
    assert.equal(
      await scalar(db, "select public.kova_auth_account_snapshot($1,true,true)", [candidate]),
      null,
    );
    assert.equal(
      await scalar(db, "select public.kova_auth_delete_unused_compatibility_principal($1)", [
        candidate,
      ]),
      false,
    );
  } finally {
    await db.close();
  }
});

test("snapshot fallback is explicit and its RPC/private trigger functions are inaccessible to browser roles", async () => {
  const db = await authDatabase();
  try {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'legacy@example.invalid',$2)",
      [other, now],
    );
    assert.equal(
      await scalar(db, "select public.kova_auth_account_snapshot($1,false,true)", [other]),
      null,
    );
    assert.equal(
      (await scalar(db, "select public.kova_auth_account_snapshot($1,true,true)", [other]))
        .app_metadata.provider,
      "supabase",
    );
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege($1,'public.kova_auth_account_snapshot(uuid,boolean,boolean)','execute')",
          [role],
        ),
        role === "service_role",
      );
      for (const name of [
        "guard_legacy_account_adoption",
        "retire_legacy_password_on_owned_change",
      ]) {
        assert.equal(
          await scalar(db, "select has_function_privilege($1,$2,'execute')", [
            role,
            `kova_private.${name}()`,
          ]),
          false,
        );
      }
    }
    const config = (
      await db.query(
        "select prosecdef,proconfig from pg_proc where oid='public.kova_auth_account_snapshot(uuid,boolean,boolean)'::regprocedure",
      )
    ).rows[0];
    assert.equal(config.prosecdef, true);
    assert.ok(config.proconfig.includes('search_path=""'));
    assert.ok(config.proconfig.includes("statement_timeout=5s"));
  } finally {
    await db.close();
  }
});
