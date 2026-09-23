import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { authHttp, authRequest } from "../helpers/kova-auth-http.mjs";
import { verifyKovaPassword } from "../../src/lib/kova-auth-crypto.server.mjs";

const email = "owner@example.invalid";
const hash = `scrypt-v1$32768$8$1$${"n".repeat(22)}$${"h".repeat(43)}`;
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const create = (db) => scalar(db, "select public.kova_auth_create_compatibility_principal()");
const cleanup = (db, id) =>
  scalar(db, "select public.kova_auth_delete_unused_compatibility_principal($1)", [id]);
const snapshot = async (db) =>
  (
    await db.query(`select
  (select jsonb_agg(to_jsonb(u) order by id) from auth.users u) as hosted_users,
  (select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s) as hosted_sessions,
  (select jsonb_agg(to_jsonb(a) order by id) from kova_private.auth_accounts a) as accounts,
  (select jsonb_agg(to_jsonb(c) order by id) from kova_private.auth_credentials c) as credentials,
  (select jsonb_agg(to_jsonb(s) order by id) from kova_private.auth_sessions s) as sessions,
  (select jsonb_agg(to_jsonb(r) order by id) from kova_private.auth_password_recoveries r) as recoveries,
  (select count(*)::int from kova_private.auth_audit_events) as audit_count`)
  ).rows;

async function recoveryFixture(db, { at = now, until = expiry, token = "recovery" } = {}) {
  await passwordAccount(db, { id: owner, email, at, expiresAt: until });
  await db.query("update auth.users set encrypted_password='legacy-test-hash' where id=$1", [
    owner,
  ]);
  await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [randomUUID(), owner]);
  assert.equal(
    await scalar(db, "select public.kova_auth_create_recovery($1,$2,$3,'{}',$4)", [
      email,
      digest(token),
      until,
      at,
    ]),
    true,
  );
}

const recover = (db, overrides = {}) =>
  db.query("select * from public.kova_auth_consume_recovery($1,$2,$3,$4,$5)", [
    overrides.digest ?? digest("recovery"),
    overrides.hash === undefined ? hash : overrides.hash,
    overrides.session ?? digest("new-session"),
    overrides.expiry === undefined ? expiry : overrides.expiry,
    overrides.now === undefined ? now : overrides.now,
  ]);

test("Kova creates inert compatibility UUIDs without hosted credentials and cleanup cannot delete adopted or foreign accounts", async () => {
  const db = await authDatabase();
  try {
    const id = await create(db);
    const row = (
      await db.query(
        "select email,encrypted_password,email_confirmed_at,banned_until::text,raw_app_meta_data from auth.users where id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.email, `shadow+${id}@auth.invalid.kovagpt.com`);
    assert.equal(row.encrypted_password, null);
    assert.equal(row.email_confirmed_at, null);
    assert.equal(row.banned_until, "infinity");
    assert.equal(row.raw_app_meta_data.provider, "kova_shadow");
    assert.equal(await scalar(db, "select count(*)::int from auth.identities"), 0);
    assert.equal(await scalar(db, "select public.kova_auth_directory_email($1)", [id]), null);
    await db.query(
      "select * from public.kova_auth_create_password_account($1,$2,'Owned',$3,$4,$5,'{}',$6)",
      [id, email, hash, digest("verify-new"), expiry, now],
    );
    assert.equal(
      await scalar(
        db,
        "select count(*)::int from kova_private.auth_compatibility_candidates where account_id=$1",
        [id],
      ),
      0,
    );
    assert.equal(await cleanup(db, id), false);
    assert.equal(
      await scalar(db, "select count(*)::int from kova_private.auth_accounts where id=$1", [id]),
      1,
    );
    await db.query("select * from public.kova_auth_consume_verification($1,$2,$3,$4)", [
      digest("verify-new"),
      digest("new-cookie"),
      expiry,
      now,
    ]);
    assert.equal(await scalar(db, "select public.kova_auth_directory_email($1)", [id]), email);
    assert.equal(await cleanup(db, id), false);
    await db.query("insert into auth.users(id,email) values($1,'real@example.invalid')", [other]);
    assert.equal(await cleanup(db, other), false);
    const unused = await create(db);
    assert.equal(await cleanup(db, unused), true);
    assert.equal(await cleanup(db, unused), true);
    assert.equal(await cleanup(db, null), false);
  } finally {
    await db.close();
  }
});

test("changed candidate state, hosted identities and sessions prevent cleanup; candidate allocation failure rolls back its UUID", async (t) => {
  const db = await authDatabase();
  try {
    for (const [name, mutation] of [
      ["password", "update auth.users set encrypted_password='not-inert' where id=$1"],
      ["verification", "update auth.users set email_confirmed_at=now() where id=$1"],
      ["marker", "update auth.users set raw_app_meta_data='{}' where id=$1"],
      ["address", "update auth.users set email='changed@example.invalid' where id=$1"],
      ["ban", "update auth.users set banned_until=null where id=$1"],
      ["identity", "insert into auth.identities(id,user_id) values(gen_random_uuid(),$1)"],
      ["session", "insert into auth.sessions(id,user_id) values(gen_random_uuid(),$1)"],
    ])
      await t.test(name, async () => {
        const id = await create(db);
        await db.query(mutation, [id]);
        assert.equal(await cleanup(db, id), false);
        assert.equal(await scalar(db, "select count(*)::int from auth.users where id=$1", [id]), 1);
      });
    const before = await scalar(db, "select count(*)::int from auth.users");
    await db.exec(`create function public.reject_candidate() returns trigger language plpgsql as $$begin raise exception 'fixture rollback'; end$$;
      create trigger reject_candidate before insert on kova_private.auth_compatibility_candidates for each row execute function public.reject_candidate()`);
    await assert.rejects(create(db), /fixture rollback/u);
    assert.equal(await scalar(db, "select count(*)::int from auth.users"), before);
  } finally {
    await db.close();
  }
});

test("password recovery atomically retires the hosted password and refresh sessions, rotates Kova sessions and rejects replay", async () => {
  const db = await authDatabase();
  try {
    await recoveryFixture(db);
    const row = (await recover(db)).rows[0];
    assert.equal(row.account_id, owner);
    assert.equal(row.assurance_level, "aal1");
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
        "select count(*)::int from kova_private.auth_sessions where account_id=$1 and revoked_at is null",
        [owner],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select secret_hash from kova_private.auth_credentials where account_id=$1 and disabled_at is null",
        [owner],
      ),
      hash,
    );
    const after = await snapshot(db);
    await assert.rejects(recover(db), /kova_auth_invalid_recovery/u);
    assert.deepEqual(await snapshot(db), after);
  } finally {
    await db.close();
  }
});

test("recovery rejects invalid identity, MFA, token and time evidence without disabling the working hosted password", async (t) => {
  const db = await authDatabase();
  try {
    await recoveryFixture(db);
    for (const [name, mutation, overrides] of [
      [
        "suspended",
        "update kova_private.auth_accounts set suspended_until='infinity' where id=$1",
        {},
      ],
      ["deleted", "update kova_private.auth_accounts set deleted_at=now() where id=$1", {}],
      ["legacy ban", "update auth.users set banned_until='infinity' where id=$1", {}],
      ["legacy deletion", "update auth.users set deleted_at=now() where id=$1", {}],
      ["legacy anonymous identity", "update auth.users set is_anonymous=true where id=$1", {}],
      [
        "unverified",
        "update kova_private.auth_accounts set email_verified_at=null where id=$1",
        {},
      ],
      [
        "identity disabled",
        "update kova_private.auth_identities set disabled_at=now() where account_id=$1",
        {},
      ],
      [
        "email changed",
        "update kova_private.auth_accounts set primary_email='new@example.invalid' where id=$1",
        {},
      ],
      ["owned MFA", "update kova_private.auth_accounts set mfa_required=true where id=$1", {}],
      [
        "legacy MFA",
        "insert into auth.mfa_factors(id,user_id,status) values(gen_random_uuid(),$1,'verified')",
        {},
      ],
      [
        "used",
        "update kova_private.auth_password_recoveries set consumed_at=now() where account_id=$1",
        {},
      ],
      ["expired", null, { now: expiry, expiry: "2026-10-02T12:00:00Z" }],
      [
        "changed epoch",
        "update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1",
        {},
      ],
      [
        "changed verified identity",
        "update kova_private.auth_identities set normalized_email='new@example.invalid' where account_id=$1",
        {},
      ],
      [
        "old proof after verified mailbox change",
        "with changed as (update kova_private.auth_accounts set primary_email='new@example.invalid' where id=$1 returning id) update kova_private.auth_identities set normalized_email='new@example.invalid' where account_id in(select id from changed)",
        {},
      ],
      ["wrong token", null, { digest: digest("wrong") }],
      ["null time", null, { now: null }],
      ["infinite time", null, { now: "infinity" }],
      ["null expiry", null, { expiry: null }],
      ["infinite expiry", null, { expiry: "infinity" }],
      ["null hash", null, { hash: null }],
    ])
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          if (mutation) await db.query(mutation, [owner]);
          const before = await snapshot(db);
          await db.exec("savepoint attempt");
          await assert.rejects(recover(db, overrides));
          await db.exec("rollback to attempt");
          assert.deepEqual(await snapshot(db), before);
        } finally {
          await db.exec("rollback");
        }
      });
  } finally {
    await db.close();
  }
});

test("late recovery failure rolls back hosted password retirement, hosted session deletion, proof consumption and owned credential changes", async (t) => {
  const db = await authDatabase();
  try {
    await recoveryFixture(db);
    await t.test("session collision", async () => {
      const before = await snapshot(db);
      await assert.rejects(recover(db, { session: digest("session") }));
      assert.deepEqual(await snapshot(db), before);
    });
    await db.exec(`create function public.reject_recovery_audit() returns trigger language plpgsql as $$begin
      if new.event_type='password_recovered' then raise exception 'fixture audit failure'; end if; return new; end$$;
      create trigger reject_recovery_audit before insert on kova_private.auth_audit_events for each row execute function public.reject_recovery_audit()`);
    const before = await snapshot(db);
    await assert.rejects(recover(db), /fixture audit failure/u);
    assert.deepEqual(await snapshot(db), before);
  } finally {
    await db.close();
  }
});

test("lifecycle functions are service-only and grant no direct private or raw Auth table access", async () => {
  const db = await authDatabase();
  try {
    for (const signature of [
      "public.kova_auth_create_compatibility_principal()",
      "public.kova_auth_delete_unused_compatibility_principal(uuid)",
      "public.kova_auth_has_verified_legacy_mfa(uuid)",
      "public.kova_auth_consume_recovery(text,text,text,timestamptz,timestamptz)",
    ]) {
      const roles = (
        await db.query(
          "select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') browser,has_function_privilege('service_role',$1,'execute') service",
          [signature],
        )
      ).rows[0];
      assert.deepEqual(roles, { anon: false, browser: false, service: true });
    }
    await db.exec("set role service_role");
    const id = await create(db);
    assert.equal(await cleanup(db, id), true);
    await assert.rejects(db.query("select * from auth.users"), /permission denied/u);
    await assert.rejects(
      db.query("select * from kova_private.auth_compatibility_candidates"),
      /permission denied/u,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

test("actual owned store rejects malformed lifecycle responses and never calls hosted Auth administration", async () => {
  const allowed = new Set([
    "kova_auth_create_compatibility_principal",
    "kova_auth_delete_unused_compatibility_principal",
    "kova_auth_has_verified_legacy_mfa",
    "kova_auth_finalize_account_deletion",
  ]);
  let value = owner;
  const h = authHttp({
    rpc: async (name) => {
      assert.ok(allowed.has(name));
      return { data: value };
    },
  });
  assert.equal(await h.store.createCompatibilityPrincipal(), owner);
  value = true;
  await h.store.deleteCompatibilityPrincipal(other);
  await h.store.finalizeOwnedAccountDeletion(owner, other);
  assert.equal(await h.store.hasVerifiedLegacyMfa(owner), true);
  value = false;
  assert.equal(await h.store.hasVerifiedLegacyMfa(owner), false);
  await assert.rejects(h.store.finalizeOwnedAccountDeletion(owner, other));
  for (value of [null, {}, [], "", 42, "true"]) {
    await assert.rejects(h.store.createCompatibilityPrincipal());
    await assert.rejects(h.store.deleteCompatibilityPrincipal(owner));
    await assert.rejects(h.store.hasVerifiedLegacyMfa(owner));
    await assert.rejects(h.store.finalizeOwnedAccountDeletion(owner, other));
  }
});

test("actual signup HTTP, password crypto and SQL preserve the first pending credential and clean unused candidates without hosted Auth", async () => {
  const db = await authDatabase();
  try {
    const h = authHttp({
      env: { KOVA_AUTH_PUBLIC_ORIGIN: "https://kova.test", KOVA_EMAIL_QUEUE_ENABLED: "true" },
      rpc: async (name, args) => {
        assert.ok(
          [
            "kova_auth_create_compatibility_principal",
            "kova_auth_create_password_account",
            "kova_auth_delete_unused_compatibility_principal",
          ].includes(name),
        );
        const keys = Object.keys(args);
        try {
          const result = await db.query(
            `select * from public.${name}(${keys.map((key, i) => `${key}=>$${i + 1}`).join(",")})`,
            Object.values(args),
          );
          return {
            data:
              name === "kova_auth_create_password_account"
                ? result.rows
                : Object.values(result.rows[0])[0],
          };
        } catch (error) {
          return { error: { code: error.code } };
        }
      },
    });
    const request = (password) => authRequest({ email, password }, { path: "/api/auth/signup" });
    assert.equal((await h.handleKovaSignup(request("the-first-password-test"))).status, 202);
    const first = await scalar(db, "select secret_hash from kova_private.auth_credentials");
    assert.equal((await h.handleKovaSignup(request("a-different-password-test"))).status, 202);
    assert.equal(await scalar(db, "select secret_hash from kova_private.auth_credentials"), first);
    assert.equal(await verifyKovaPassword("the-first-password-test", first), true);
    assert.equal(await verifyKovaPassword("a-different-password-test", first), false);
    assert.equal(await scalar(db, "select count(*)::int from auth.users"), 1);
    assert.equal(await scalar(db, "select count(*)::int from auth.identities"), 0);
    assert.equal(
      await scalar(db, "select count(*)::int from kova_private.auth_compatibility_candidates"),
      0,
    );
    assert.equal(await scalar(db, "select count(*)::int from public.test_email_queue"), 1);
  } finally {
    await db.close();
  }
});

test("upgrading retires unbound recovery links without touching passwords or inventing current proof", async () => {
  const db = await authDatabase({
    beforeMigration: async (name, connection) => {
      if (name.endsWith("_kova_owned_compatibility_lifecycle.sql"))
        await recoveryFixture(connection);
    },
  });
  try {
    assert.equal(
      await scalar(db, "select consumed_at is not null from kova_private.auth_password_recoveries"),
      true,
    );
    assert.equal(
      await scalar(db, "select account_epoch from kova_private.auth_password_recoveries"),
      null,
    );
    assert.equal(
      await scalar(db, "select encrypted_password from auth.users where id=$1", [owner]),
      "legacy-test-hash",
    );
    const before = await snapshot(db);
    await assert.rejects(recover(db), /kova_auth_invalid_recovery/u);
    assert.deepEqual(await snapshot(db), before);
  } finally {
    await db.close();
  }
});

test("real recovery HTTP, crypto, store and PostgreSQL finish without an Auth SDK and reject reuse", async () => {
  const db = await authDatabase();
  try {
    const at = new Date().toISOString();
    const until = new Date(Date.now() + 86400000).toISOString();
    const token = "r".repeat(43);
    await recoveryFixture(db, { at, until, token });
    const h = authHttp({
      rpc: async (name, args) => {
        assert.ok(
          [
            "kova_auth_recovery_target",
            "kova_auth_has_verified_legacy_mfa",
            "kova_auth_consume_recovery",
          ].includes(name),
        );
        const keys = Object.keys(args);
        try {
          const result = await db.query(
            `select * from public.${name}(${keys.map((key, i) => `${key}=>$${i + 1}`).join(",")})`,
            Object.values(args),
          );
          return {
            data:
              name === "kova_auth_consume_recovery"
                ? result.rows
                : Object.values(result.rows[0])[0],
          };
        } catch (error) {
          return { error: { code: error.code } };
        }
      },
    });
    const password = "a-new-owned-password-test";
    const response = await h.handleKovaRecoveryReset(
      authRequest({ token, password }, { path: "/api/auth/recovery/reset" }),
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /__Host-kova_session=.+HttpOnly/u);
    const stored = await scalar(
      db,
      "select secret_hash from kova_private.auth_credentials where account_id=$1 and disabled_at is null",
      [owner],
    );
    assert.equal(await verifyKovaPassword(password, stored), true);
    assert.equal(
      await scalar(db, "select encrypted_password from auth.users where id=$1", [owner]),
      null,
    );
    assert.equal(
      (
        await h.handleKovaRecoveryReset(
          authRequest({ token, password }, { path: "/api/auth/recovery/reset" }),
        )
      ).status,
      400,
    );
    assert.ok(h.calls.every(([name]) => name.startsWith("kova_auth_")));
  } finally {
    await db.close();
  }
});
