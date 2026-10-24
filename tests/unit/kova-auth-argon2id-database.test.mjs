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

const salt = Buffer.alloc(16, 1).toString("base64").replace(/=+$/u, "");
const key = Buffer.alloc(32, 2).toString("base64").replace(/=+$/u, "");
const argon = `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${key}`;
const nativeArgon = argon.replace("m=19456,t=2,p=1", "m=19456,p=1,t=2");
const scrypt = `scrypt-v1$32768$8$1$${Buffer.alloc(16, 3).toString("base64url")}$${Buffer.alloc(32, 4).toString("base64url")}`;
const nextScrypt = scrypt.slice(0, -1) + (scrypt.endsWith("A") ? "E" : "A");
const scalar = async (db, sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const cas = async (db, account, overrides = {}) => {
  const values = {
    accountId: owner,
    credentialId: account.credential.id,
    revision: account.credential.revision,
    oldHash: scrypt,
    newHash: argon,
    token: account.token,
    at: now,
    ...overrides,
  };
  return scalar(db, "select public.kova_auth_upgrade_password_hash($1,$2,$3,$4,$5,$6,$7)", [
    values.accountId,
    values.credentialId,
    values.revision,
    values.oldHash,
    values.newHash,
    digest(values.token),
    values.at,
  ]);
};
const credentials = async (db, id = owner) =>
  (
    await db.query(
      "select id,account_id,secret_hash,algorithm,revision,activated_at,disabled_at from kova_private.auth_credentials where account_id=$1 order by id",
      [id],
    )
  ).rows;
const snapshot = async (db) =>
  (
    await db.query(`select
  (select jsonb_agg(to_jsonb(a) order by id) from kova_private.auth_accounts a) accounts,
  (select jsonb_agg(to_jsonb(s) order by id) from kova_private.auth_sessions s) sessions,
  (select jsonb_agg(to_jsonb(c) order by id) from kova_private.auth_credentials c) credentials,
  (select count(*)::int from kova_private.auth_audit_events) audit_count`)
  ).rows;

test("additive Argon2id SQL preserves legacy identities, writer paths and authenticated CAS", async (t) => {
  // The existing repository helper applies all ordered Auth migrations,
  // including the new additive Argon2id migration, exactly once.
  const db = await authDatabase();
  try {
    const inTransaction = async (name, run) =>
      t.test(name, async () => {
        await db.exec("begin");
        try {
          await run();
        } finally {
          await db.exec("rollback");
        }
      });

    await inTransaction(
      "strict bounded PHC accepts both maintained parameter orders and rejects malformed profiles",
      async () => {
        const algorithm = (value) =>
          scalar(db, "select kova_private.password_hash_algorithm($1)", [value]);
        assert.equal(await algorithm(scrypt), "scrypt-v1");
        assert.equal(await algorithm(argon), "argon2id");
        assert.equal(await algorithm(nativeArgon), "argon2id");
        for (const value of [
          null,
          "",
          scrypt.replace("scrypt-v1$32768$8$1$", "scrypt-v1$16384$8$1$"),
          `scrypt-v1$${"x".repeat(80)}`,
          argon.replace("m=19456", "m=1048576"),
          argon.replace("t=2", "t=3"),
          argon.replace("p=1", "p=4"),
          argon.replace("v=19", "v=16"),
          argon.replace("m=19456,t=2,p=1", "m=19456,t=2,p=1,p=1"),
          argon.replace("m=19456,t=2,p=1", "p=1,m=19456,t=2"),
          argon.replace(salt, `${salt}==`),
          argon.replace(key, `${key}=`),
          argon.replace(salt, salt.slice(0, -1) + "B"),
          argon.replace(key, key.slice(0, -1) + "B"),
          argon + "\n",
          argon + "$extra",
          argon.replace("argon2id", "argon2i"),
          argon.replace(salt, salt.slice(1)),
        ])
          assert.equal(await algorithm(value), null, "Unsupported representation must fail closed");
      },
    );

    await inTransaction(
      "signup and verification retain UUID and store native Argon profile with correct algorithm",
      async () => {
        const account = await passwordAccount(db, {
          id: owner,
          token: "new-argon",
          passwordHash: nativeArgon,
        });
        assert.equal(account.account_id, owner);
        assert.equal((await credentials(db))[0].algorithm, "argon2id");
        assert.equal((await credentials(db))[0].secret_hash, nativeArgon);
        assert.equal((await credentials(db))[0].revision, 1);
        assert.equal(
          await scalar(db, "select count(*)::int from auth.users where id=$1", [owner]),
          1,
        );
      },
    );

    await inTransaction(
      "password change accepts Argon, increments revision and rotates existing sessions",
      async () => {
        const account = await passwordAccount(db, { passwordHash: scrypt });
        await db.query("select * from public.kova_auth_change_password($1,$2,$3,$4,$5,$6,$7)", [
          account.digest,
          account.credential.id,
          account.credential.revision,
          argon,
          digest("changed-session"),
          expiry,
          now,
        ]);
        const [credential] = await credentials(db);
        assert.equal(credential.algorithm, "argon2id");
        assert.equal(credential.revision, 2);
        assert.equal(
          await scalar(db, "select count(*)::int from public.kova_auth_resolve_session($1,$2)", [
            account.digest,
            now,
          ]),
          0,
        );
        assert.equal(
          await scalar(db, "select count(*)::int from public.kova_auth_resolve_session($1,$2)", [
            digest("changed-session"),
            now,
          ]),
          1,
        );
      },
    );

    await inTransaction(
      "recovery accepts Argon and preserves stable account identity",
      async () => {
        await passwordAccount(db, { passwordHash: scrypt });
        const email = `${owner}@example.invalid`;
        assert.equal(
          await scalar(db, "select public.kova_auth_create_recovery($1,$2,$3,'{}',$4)", [
            email,
            digest("recovery"),
            new Date(Date.parse(now) + 3600_000).toISOString(),
            now,
          ]),
          true,
        );
        const result = (
          await db.query("select * from public.kova_auth_consume_recovery($1,$2,$3,$4,$5)", [
            digest("recovery"),
            nativeArgon,
            digest("recovered"),
            expiry,
            now,
          ])
        ).rows[0];
        assert.equal(result.account_id, owner);
        assert.equal((await credentials(db))[0].algorithm, "argon2id");
        assert.equal((await credentials(db))[0].revision, 2);
        await assert.rejects(
          db.query("select * from public.kova_auth_consume_recovery($1,$2,$3,$4,$5)", [
            digest("recovery"),
            argon,
            digest("replay"),
            expiry,
            now,
          ]),
          /kova_auth_invalid_recovery/u,
        );
      },
    );

    await inTransaction(
      "legacy MFA stages Argon and activates it only after the factor completion transaction",
      async () => {
        await passwordAccount(db, { passwordHash: scrypt });
        await db.query(
          "update kova_private.auth_credentials set disabled_at=$2 where account_id=$1",
          [owner, now],
        );
        await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [
          "40000000-0000-4000-8000-000000000004",
          owner,
        ]);
        const staged = (
          await db.query(
            "select * from public.kova_auth_begin_legacy_mfa_migration($1,$2,$3,$4,$5)",
            [owner, "v1.test-only.encrypted.secret.envelope", "Fixture", nativeArgon, now],
          )
        ).rows[0];
        assert.equal(
          await scalar(
            db,
            "select count(*)::int from kova_private.auth_credentials where account_id=$1 and disabled_at is null",
            [owner],
          ),
          0,
        );
        await db.query("select * from public.kova_auth_read_legacy_mfa_migration($1,$2,$3)", [
          owner,
          staged.factor_id,
          now,
        ]);
        const result = (
          await db.query(
            "select * from public.kova_auth_activate_legacy_mfa_migration($1,$2,$3,$4,$5,$6)",
            [
              owner,
              staged.factor_id,
              Array.from({ length: 8 }, (_, i) => digest(`code-${i}`)),
              digest("bridged"),
              expiry,
              now,
            ],
          )
        ).rows[0];
        assert.equal(result.account_id, owner);
        assert.equal(result.assurance_level, "aal2");
        const active = (await credentials(db)).filter((row) => row.disabled_at === null);
        assert.equal(active.length, 1);
        assert.equal(active[0].algorithm, "argon2id");
        assert.equal(active[0].secret_hash, nativeArgon);
      },
    );

    await inTransaction(
      "completed-session CAS keeps revision and live owned sessions, and is idempotent",
      async () => {
        const account = await passwordAccount(db, { passwordHash: scrypt });
        await passwordAccount(db, {
          id: other,
          token: "other",
          passwordHash: scrypt,
        });
        const beforeSessions = (
          await db.query("select * from kova_private.auth_sessions order by id")
        ).rows;
        const beforeAccount = (
          await db.query("select * from kova_private.auth_accounts order by id")
        ).rows;
        const beforeOther = await credentials(db, other);
        assert.equal(await cas(db, account), true);
        const [credential] = await credentials(db);
        assert.equal(credential.algorithm, "argon2id");
        assert.equal(credential.revision, account.credential.revision);
        assert.deepEqual(
          (await db.query("select * from kova_private.auth_sessions order by id")).rows,
          beforeSessions,
        );
        assert.deepEqual(
          (await db.query("select * from kova_private.auth_accounts order by id")).rows,
          beforeAccount,
        );
        assert.deepEqual(await credentials(db, other), beforeOther);
        assert.equal(await cas(db, account), false);
        const events = (
          await db.query(
            "select metadata from kova_private.auth_audit_events where event_type='password_hash_upgraded'",
          )
        ).rows;
        assert.deepEqual(events, [{ metadata: { algorithm: "argon2id" } }]);
        assert.equal(JSON.stringify(events).includes(scrypt), false);
        assert.equal(JSON.stringify(events).includes(argon), false);
      },
    );

    await inTransaction(
      "CAS rejects stale credentials, wrong account, malformed target and downgrades without writes",
      async () => {
        const account = await passwordAccount(db, { passwordHash: scrypt });
        for (const options of [
          { accountId: other },
          { credentialId: other },
          { revision: 2 },
          { oldHash: nextScrypt },
          { newHash: scrypt },
          { newHash: argon.replace("t=2", "t=9") },
        ]) {
          const before = await snapshot(db);
          assert.equal(await cas(db, account, options), false);
          assert.deepEqual(await snapshot(db), before);
        }
      },
    );

    await inTransaction(
      "revocation, expiry, suspension, stale epoch and unfinished MFA block rehash",
      async () => {
        const account = await passwordAccount(db, { passwordHash: scrypt });
        const mutations = [
          "update kova_private.auth_sessions set revoked_at=$2 where account_id=$1",
          "update kova_private.auth_sessions set created_at=$2::timestamptz-interval '2 seconds',last_seen_at=$2::timestamptz-interval '2 seconds',expires_at=$2::timestamptz-interval '1 second' where account_id=$1",
          "update kova_private.auth_accounts set suspended_until=$2::timestamptz+interval '1 day' where id=$1",
          "update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1",
          "update kova_private.auth_accounts set mfa_required=true where id=$1",
        ];
        for (const sql of mutations) {
          await db.exec("savepoint invalid_session");
          await db.query(sql, sql.includes("$2") ? [owner, now] : [owner]);
          await assert.rejects(cas(db, account), /kova_auth_invalid_session/u);
          await db.exec("rollback to savepoint invalid_session; release savepoint invalid_session");
        }
        assert.equal((await credentials(db))[0].secret_hash, scrypt);
      },
    );

    await inTransaction("a changed password wins over an old rehash snapshot", async () => {
      const account = await passwordAccount(db, { passwordHash: scrypt });
      await db.query("select * from public.kova_auth_change_password($1,$2,$3,$4,$5,$6,$7)", [
        account.digest,
        account.credential.id,
        account.credential.revision,
        nativeArgon,
        digest("new-password-session"),
        expiry,
        now,
      ]);
      const before = await snapshot(db);
      assert.equal(await cas(db, account, { token: "new-password-session" }), false);
      assert.deepEqual(await snapshot(db), before);
    });

    await inTransaction(
      "transactional audit failure rolls a rehash back without retiring owned sessions",
      async () => {
        const account = await passwordAccount(db, { passwordHash: scrypt });
        await db.exec(`create function public.refuse_hash_audit() returns trigger language plpgsql as $$begin
        if new.event_type='password_hash_upgraded' then raise exception 'fixture_audit_failure'; end if; return new; end$$;
        create trigger refuse_hash_audit before insert on kova_private.auth_audit_events
        for each row execute function public.refuse_hash_audit()`);
        const before = await snapshot(db);
        await db.exec("savepoint audit_failure");
        await assert.rejects(cas(db, account), /fixture_audit_failure/u);
        await db.exec("rollback to savepoint audit_failure; release savepoint audit_failure");
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await inTransaction("private helpers and CAS do not gain browser-role execution", async () => {
      for (const role of ["anon", "authenticated"]) {
        assert.equal(
          await scalar(
            db,
            "select has_function_privilege($1,'public.kova_auth_upgrade_password_hash(uuid,uuid,bigint,text,text,text,timestamptz)','execute')",
            [role],
          ),
          false,
        );
        assert.equal(
          await scalar(
            db,
            "select has_function_privilege($1,'kova_private.password_hash_algorithm(text)','execute')",
            [role],
          ),
          false,
        );
      }
      assert.equal(
        await scalar(
          db,
          "select has_function_privilege('service_role','public.kova_auth_upgrade_password_hash(uuid,uuid,bigint,text,text,text,timestamptz)','execute')",
        ),
        true,
      );
    });

    await inTransaction(
      "credential boundary rejects malformed Argon writes, and service-role CAS executes without wider grants",
      async () => {
        const account = await passwordAccount(db, { passwordHash: scrypt });
        const before = await snapshot(db);
        await db.exec("savepoint malformed_hash");
        await assert.rejects(
          db.query(
            "update kova_private.auth_credentials set secret_hash=$2,algorithm='scrypt-v1' where account_id=$1",
            [owner, argon.replace("m=19456", "m=1048576")],
          ),
          /kova_auth_invalid_password/u,
        );
        await db.exec("rollback to savepoint malformed_hash; release savepoint malformed_hash");
        assert.deepEqual(await snapshot(db), before);
        await db.exec("set local role service_role");
        assert.equal(await cas(db, account, { newHash: nativeArgon }), true);
        await db.exec("reset role");
        assert.equal((await credentials(db))[0].secret_hash, nativeArgon);
        assert.equal((await credentials(db))[0].revision, 1);
      },
    );
  } finally {
    await db.close();
  }
});
