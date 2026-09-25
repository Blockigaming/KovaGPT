import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { authDatabase, passwordAccount, owner, other } from "../helpers/kova-auth-database.mjs";

async function fixture() {
  const identity = await readFile(
    "supabase/migrations/20260905001736_private_auth_identity_helpers.sql",
    "utf8",
  );
  const irreversible = await readFile(
    "supabase/migrations/20260905030947_irreversible_account_deletion.sql",
    "utf8",
  );
  const db = await authDatabase({
    beforeMigrations: `${identity}
    create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade,
      requested_at timestamptz default now(),updated_at timestamptz default now());
    create table public.retained_fixture(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    ${irreversible}`,
  });
  const at = new Date().toISOString();
  const until = new Date(Date.now() + 86400000).toISOString();
  const account = await passwordAccount(db, { id: owner, at, expiresAt: until });
  const sibling = await passwordAccount(db, { id: other, token: "other", at, expiresAt: until });
  await db.query("insert into public.retained_fixture(id,user_id) values($1,$2),($3,$4)", [
    randomUUID(),
    owner,
    randomUUID(),
    other,
  ]);
  return { db, account, sibling };
}
const finish = async (db, id, session) =>
  (await db.query("select public.kova_auth_finalize_account_deletion($1,$2) done", [id, session]))
    .rows[0].done;
const snapshot = async (db) =>
  (
    await db.query(`select
  (select jsonb_agg(to_jsonb(u) order by id) from auth.users u) as users,
  (select jsonb_agg(to_jsonb(a) order by id) from kova_private.auth_accounts a) as accounts,
  (select jsonb_agg(to_jsonb(s) order by id) from kova_private.auth_sessions s) as sessions,
  (select jsonb_agg(to_jsonb(c) order by id) from kova_private.auth_credentials c) as credentials,
  (select jsonb_agg(to_jsonb(f) order by user_id) from public.account_deletion_fences f) as fences,
  (select jsonb_agg(to_jsonb(r) order by id) from public.retained_fixture r) as retained`)
  ).rows;

test("owned final deletion requires the irreversible fence and exact current session, preserves another owner and cascades owned secrets", async () => {
  const { db, account, sibling } = await fixture();
  try {
    assert.equal(await finish(db, owner, account.session_id), false);
    await db.query("insert into public.account_deletion_fences(user_id) values($1)", [owner]);
    await assert.rejects(
      db.query("delete from public.account_deletion_fences where user_id=$1", [owner]),
      /account_deletion_irreversible/u,
    );
    assert.equal(await finish(db, owner, sibling.session_id), false);
    await db.exec("set role service_role");
    await assert.rejects(
      db.query("delete from auth.users where id=$1", [owner]),
      /permission denied/u,
    );
    assert.equal(await finish(db, owner, account.session_id), true);
    assert.equal(await finish(db, owner, account.session_id), true);
    await db.exec("reset role");
    for (const table of [
      "auth.users",
      "kova_private.auth_accounts",
      "kova_private.auth_sessions",
      "kova_private.auth_credentials",
      "kova_private.auth_identities",
    ]) {
      const key =
        table === "auth.users" || table === "kova_private.auth_accounts" ? "id" : "account_id";
      assert.equal(
        (await db.query(`select count(*)::int n from ${table} where ${key}=$1`, [owner])).rows[0].n,
        0,
      );
    }
    assert.deepEqual((await db.query("select user_id from public.retained_fixture")).rows, [
      { user_id: other },
    ]);
    assert.equal(
      (await db.query("select count(*)::int n from public.account_deletion_fences")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("revocation, stale epoch, expiry, MFA or identity changes at finalization prevent destructive writes", async (t) => {
  const { db, account } = await fixture();
  try {
    await db.query("insert into public.account_deletion_fences(user_id) values($1)", [owner]);
    for (const [name, sql] of [
      [
        "revoked session",
        "update kova_private.auth_sessions set revoked_at=now() where account_id=$1",
      ],
      ["epoch", "update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1"],
      [
        "expiry",
        "update kova_private.auth_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where account_id=$1",
      ],
      ["suspended", "update kova_private.auth_accounts set suspended_until='infinity' where id=$1"],
      ["MFA", "update kova_private.auth_accounts set mfa_required=true where id=$1"],
      ["identity", "update kova_private.auth_identities set disabled_at=now() where account_id=$1"],
      ["unverified", "update kova_private.auth_accounts set email_verified_at=null where id=$1"],
    ])
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          await db.query(sql, [owner]);
          const before = await snapshot(db);
          assert.equal(await finish(db, owner, account.session_id), false);
          assert.deepEqual(await snapshot(db), before);
        } finally {
          await db.exec("rollback");
        }
      });
    await db.exec(`create function public.refuse_final_deletion() returns trigger language plpgsql as $$begin raise exception 'fixture final deletion failure'; end$$;
      create trigger refuse_final_deletion before delete on auth.users for each row execute function public.refuse_final_deletion()`);
    const before = await snapshot(db);
    await assert.rejects(finish(db, owner, account.session_id), /fixture final deletion failure/u);
    assert.deepEqual(await snapshot(db), before);
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        (
          await db.query(
            "select has_function_privilege($1,'public.kova_auth_finalize_account_deletion(uuid,uuid)','execute') allowed",
            [role],
          )
        ).rows[0].allowed,
        false,
      );
    }
  } finally {
    await db.close();
  }
});
