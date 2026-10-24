import assert from "node:assert/strict";
import test from "node:test";
import {
  authDatabase,
  passwordAccount,
  digest,
  now,
  owner,
  other,
} from "../helpers/kova-auth-database.mjs";

const at = (seconds) => new Date(Date.parse(now) + seconds * 1000).toISOString();
const hash = `scrypt-v1$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}`;
const email = "fixture@example.invalid";
const payload = (recipient = email, kind = "verification") => ({
  to: recipient,
  label: `kova-auth-${kind}`,
  purpose: "auth",
  subject: "Fixture",
  text: "Fixture action",
});
const scalar = async (db, statement, values = []) =>
  Object.values((await db.query(statement, values)).rows[0])[0];
const pending = async (
  db,
  {
    id = owner,
    address = email,
    proof = "verify",
    issued = now,
    expires = at(3600),
    seed = true,
  } = {},
) => {
  if (seed) await db.query("insert into auth.users(id,email) values($1,$2)", [id, address]);
  return (
    await db.query(
      "select * from public.kova_auth_create_password_account($1,$2,'Fixture',$3,$4,$5,$6,$7)",
      [id, address, hash, digest(proof), expires, payload(address), issued],
    )
  ).rows[0];
};
const verify = (db, proof = "verify", session = "verified-session", time = at(1)) =>
  db.query("select * from public.kova_auth_consume_verification($1,$2,$3,$4)", [
    digest(proof),
    digest(session),
    at(86400),
    time,
  ]);
const resend = (db, proof = "replacement", time = at(61)) =>
  scalar(db, "select public.kova_auth_resend_verification($1,$2,$3,$4,$5)", [
    email,
    digest(proof),
    at(3661),
    payload(),
    time,
  ]);
const recovery = (db, proof = "recovery", time = at(2), expires = at(3602)) =>
  scalar(db, "select public.kova_auth_create_recovery($1,$2,$3,$4,$5)", [
    email,
    digest(proof),
    expires,
    payload(email, "recovery"),
    time,
  ]);
const reset = (
  db,
  proof = "recovery",
  session = "recovered-session",
  time = at(3),
  newHash = hash,
) =>
  db.query("select * from public.kova_auth_consume_recovery($1,$2,$3,$4,$5)", [
    digest(proof),
    newHash,
    digest(session),
    at(86400),
    time,
  ]);
const snapshot = async (db) =>
  (
    await db.query(`select
  (select jsonb_agg(to_jsonb(u) order by id) from auth.users u) hosted_users,
  (select jsonb_agg(to_jsonb(h) order by id) from auth.sessions h) hosted_sessions,
  (select jsonb_agg(to_jsonb(l) order by account_id) from kova_private.auth_legacy_retirements l) legacy_retirements,
  (select jsonb_agg(to_jsonb(a) order by id) from kova_private.auth_accounts a) accounts,
  (select jsonb_agg(to_jsonb(i) order by id) from kova_private.auth_identities i) identities,
  (select jsonb_agg(to_jsonb(c) order by id) from kova_private.auth_credentials c) credentials,
  (select jsonb_agg(to_jsonb(s) order by id) from kova_private.auth_sessions s) sessions,
  (select jsonb_agg(to_jsonb(v) order by id) from kova_private.auth_email_verifications v) verifications,
  (select jsonb_agg(to_jsonb(r) order by id) from kova_private.auth_password_recoveries r) recoveries,
  (select jsonb_agg(to_jsonb(q) order by id) from public.test_email_queue q) queue,
  (select count(*)::int from kova_private.auth_audit_events) audit_count`)
  ).rows;
const denied = async (db, run, expected = "KVA01") => {
  const before = await snapshot(db);
  await db.exec("savepoint denied_action");
  await assert.rejects(run, (error) => error.code === expected);
  await db.exec("rollback to savepoint denied_action; release savepoint denied_action");
  assert.deepEqual(await snapshot(db), before);
};
const failQueue = (db) =>
  db.exec(`create or replace function public.enqueue_email(queue_name text,payload jsonb)
  returns bigint language plpgsql as $$begin raise exception 'fixture_queue_unavailable'; end$$`);
const failAudit = (db, event, state = "P0001") =>
  db.exec(`create function public.refuse_fixture_audit() returns trigger language plpgsql as $$begin
  if new.event_type='${event}' then raise exception 'fixture_audit_unavailable' using errcode='${state}'; end if; return new; end$$;
  create trigger refuse_fixture_audit before insert on kova_private.auth_audit_events
  for each row execute function public.refuse_fixture_audit()`);

test("new email-proof reliability checks on exact retained SQL", async (t) => {
  const db = await authDatabase();
  try {
    const scenario = (name, run) =>
      t.test(name, async () => {
        await db.exec("begin");
        try {
          await run();
        } finally {
          await db.exec("rollback");
        }
      });

    await scenario(
      "first verification and recovery reject infinite or over-one-hour issuance atomically",
      async () => {
        await db.query("insert into auth.users(id,email) values($1,$2)", [owner, email]);
        for (const expires of ["infinity", at(3601)])
          await denied(db, () => pending(db, { expires, seed: false }), "P0001");
        await pending(db, { seed: false });
        await verify(db);
        for (const expires of ["infinity", at(3603)])
          await denied(db, () => recovery(db, "bad-recovery", at(2), expires), "P0001");
        assert.equal(
          await scalar(db, "select count(*)::int from kova_private.auth_password_recoveries"),
          0,
        );
      },
    );

    await scenario(
      "verification is single-use; expired, future-created and malformed proofs do not mutate state",
      async () => {
        await pending(db);
        await denied(db, () => verify(db, "verify", "too-early", at(-1)));
        await denied(db, () => verify(db, "verify", "expired", at(3600)));
        await denied(db, () =>
          db.query("select * from public.kova_auth_consume_verification($1,$2,$3,$4)", [
            "malformed",
            digest("bad"),
            at(86400),
            at(1),
          ]),
        );
        const result = await verify(db);
        assert.equal(result.rows[0].account_id, owner);
        await denied(db, () => verify(db, "verify", "replay"));
        assert.equal(await scalar(db, "select count(*)::int from kova_private.auth_sessions"), 1);
      },
    );

    await scenario(
      "disabled or mismatched identities, unavailable account and disabled password remain denied",
      async () => {
        await pending(db);
        for (const statement of [
          "update kova_private.auth_identities set disabled_at=$2 where account_id=$1",
          "update kova_private.auth_identities set normalized_email='changed@example.invalid' where account_id=$1",
          "update kova_private.auth_accounts set primary_email='changed@example.invalid' where id=$1",
          "update kova_private.auth_accounts set suspended_until=$2::timestamptz+interval '1 day' where id=$1",
          "update kova_private.auth_accounts set deleted_at=$2 where id=$1",
          "update kova_private.auth_credentials set disabled_at=$2 where account_id=$1",
        ]) {
          await db.exec("savepoint authority_mutation");
          await db.query(statement, statement.includes("$2") ? [owner, now] : [owner]);
          await denied(db, () => verify(db));
          await db.exec(
            "rollback to savepoint authority_mutation; release savepoint authority_mutation",
          );
        }
      },
    );

    await scenario(
      "resend invalidates the old proof and preserves the original pending password",
      async () => {
        await pending(db);
        const before = (
          await db.query("select id,secret_hash,revision from kova_private.auth_credentials")
        ).rows;
        assert.equal(await resend(db), true);
        assert.deepEqual(
          (await db.query("select id,secret_hash,revision from kova_private.auth_credentials"))
            .rows,
          before,
        );
        await denied(db, () => verify(db, "verify", "old-delivered-link", at(62)));
        await verify(db, "replacement", "replacement-session", at(62));
        await denied(db, () => verify(db, "replacement", "replayed-replacement", at(63)));
      },
    );

    await scenario(
      "enqueue failure during resend preserves the old live proof and pending password",
      async () => {
        await pending(db);
        await failQueue(db);
        await denied(db, () => resend(db), "P0001");
        assert.equal(
          await scalar(
            db,
            "select count(*)::int from kova_private.auth_email_verifications where consumed_at is null",
          ),
          1,
        );
        await verify(db, "verify", "retry-original");
      },
    );

    await scenario(
      "enqueue failure during first signup leaves no owned identity, proof or queue item",
      async () => {
        await db.query("insert into auth.users(id,email) values($1,$2)", [owner, email]);
        await failQueue(db);
        await denied(db, () => pending(db, { seed: false }), "P0001");
        assert.equal(await scalar(db, "select count(*)::int from kova_private.auth_accounts"), 0);
        assert.equal(await scalar(db, "select count(*)::int from public.test_email_queue"), 0);
      },
    );

    await scenario(
      "queued resend plus audit failure rolls back both the queue row and invalidation",
      async () => {
        await pending(db);
        await failAudit(db, "verification_resent");
        await denied(db, () => resend(db), "P0001");
        assert.equal(await scalar(db, "select count(*)::int from public.test_email_queue"), 1);
        assert.equal(
          await scalar(
            db,
            "select count(*)::int from kova_private.auth_email_verifications where consumed_at is null",
          ),
          1,
        );
      },
    );

    await scenario(
      "verification commit failure leaves its proof retryable without a partial session",
      async () => {
        await pending(db);
        await failAudit(db, "email_verified");
        await denied(db, () => verify(db), "P0001");
        await db.exec(
          "drop trigger refuse_fixture_audit on kova_private.auth_audit_events; drop function public.refuse_fixture_audit()",
        );
        await verify(db, "verify", "retry-after-audit");
        await denied(db, () => verify(db, "verify", "duplicate-after-commit"));
      },
    );

    await scenario(
      "downstream generic invalid-parameter errors keep their code and are not classified as rejected proofs",
      async () => {
        await pending(db);
        await failAudit(db, "email_verified", "22023");
        await denied(db, () => verify(db), "22023");
      },
    );

    await scenario(
      "recovery replacement failure preserves its old proof and expired/replayed proofs remain invalid",
      async () => {
        await passwordAccount(db, { email, passwordHash: hash });
        assert.equal(await recovery(db), true);
        await failQueue(db);
        await denied(db, () => recovery(db, "replacement-recovery", at(3), at(3603)), "P0001");
        await denied(db, () => reset(db, "recovery", "expired-recovery", at(3602)));
        const result = await reset(db);
        assert.equal(result.rows[0].account_id, owner);
        await denied(db, () => reset(db, "recovery", "replayed-recovery"));
      },
    );

    await scenario(
      "recovery audit failure rolls back hosted credential/session retirement and proof changes",
      async () => {
        await passwordAccount(db, { email, passwordHash: hash });
        await db.query(
          "update auth.users set encrypted_password='fixture-only-legacy-hash' where id=$1",
          [owner],
        );
        await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
          "40000000-0000-4000-8000-000000000004",
          owner,
        ]);
        await db.query("delete from kova_private.auth_legacy_retirements where account_id=$1", [
          owner,
        ]);
        await recovery(db);
        await failAudit(db, "password_recovered");
        await denied(db, () => reset(db), "P0001");
        await db.exec(
          "drop trigger refuse_fixture_audit on kova_private.auth_audit_events; drop function public.refuse_fixture_audit()",
        );
        await reset(db);
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
            "select count(*)::int from kova_private.auth_legacy_retirements where account_id=$1",
            [owner],
          ),
          1,
        );
      },
    );

    await scenario(
      "recovery lookup and completion reject stale epoch, email, disabled identity or future proof",
      async () => {
        await passwordAccount(db, { email, passwordHash: hash });
        await recovery(db);
        for (const statement of [
          "update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1",
          "update kova_private.auth_accounts set primary_email='changed@example.invalid' where id=$1",
          "update kova_private.auth_identities set disabled_at=$2 where account_id=$1",
        ]) {
          await db.exec("savepoint stale_recovery");
          await db.query(statement, statement.includes("$2") ? [owner, now] : [owner]);
          assert.equal(
            await scalar(db, "select public.kova_auth_recovery_target($1,$2)", [
              digest("recovery"),
              at(3),
            ]),
            null,
          );
          await denied(db, () => reset(db));
          await db.exec("rollback to savepoint stale_recovery; release savepoint stale_recovery");
        }
        assert.equal(
          await scalar(db, "select public.kova_auth_recovery_target($1,$2)", [
            digest("recovery"),
            at(1),
          ]),
          null,
        );
        await denied(db, () => reset(db, "recovery", "before-created", at(1)));
      },
    );

    await scenario(
      "Google-owned already-verified mailbox can activate a pending new password on the same UUID",
      async () => {
        await passwordAccount(db, { email, passwordHash: hash });
        await db.query(
          "update kova_private.auth_credentials set disabled_at=$2 where account_id=$1",
          [owner, now],
        );
        await db.query(
          "delete from kova_private.auth_identities where account_id=$1 and provider='email'",
          [owner],
        );
        await db.query(
          "insert into kova_private.auth_identities(account_id,provider,provider_subject,normalized_email,verified_at,created_at,updated_at) values($1,'google','fixture-google',$2,$3,$3,$3)",
          [owner, email, now],
        );
        await pending(db, { seed: false, proof: "google-password" });
        const result = await verify(db, "google-password", "same-owner-password");
        assert.equal(result.rows[0].account_id, owner);
        assert.equal(await scalar(db, "select count(*)::int from kova_private.auth_accounts"), 1);
        assert.equal(
          await scalar(
            db,
            "select count(*)::int from kova_private.auth_identities where account_id=$1 and provider='google' and disabled_at is null",
            [owner],
          ),
          1,
        );
      },
    );

    await scenario(
      "modified seed helper bounds only verification proof, retaining requested session duration",
      async () => {
        const expiresAt = at(864000);
        await passwordAccount(db, {
          id: other,
          token: "long-session",
          expiresAt,
          at: now,
        });
        assert.equal(
          await scalar(
            db,
            "select extract(epoch from(expires_at-created_at))::int from kova_private.auth_email_verifications where account_id=$1",
            [other],
          ),
          3600,
        );
        assert.equal(
          await scalar(
            db,
            "select extract(epoch from(expires_at-created_at))::int from kova_private.auth_sessions where account_id=$1",
            [other],
          ),
          864000,
        );
      },
    );

    await scenario(
      "new proof SQL composes with prior Argon normalization for recovery and default legacy writes",
      async () => {
        await passwordAccount(db, { email, passwordHash: hash });
        const argon = `$argon2id$v=19$m=19456,p=1,t=2$${Buffer.alloc(16, 1).toString("base64").replace(/=+$/u, "")}$${Buffer.alloc(32, 2).toString("base64").replace(/=+$/u, "")}`;
        await recovery(db);
        await reset(db, "recovery", "argon-recovery", at(3), argon);
        assert.deepEqual(
          (
            await db.query(
              "select account_id,algorithm,revision from kova_private.auth_credentials where account_id=$1 and disabled_at is null",
              [owner],
            )
          ).rows,
          [{ account_id: owner, algorithm: "argon2id", revision: 2 }],
        );
        await recovery(db, "legacy-again", at(4), at(3604));
        await reset(db, "legacy-again", "legacy-recovery", at(5));
        assert.deepEqual(
          (
            await db.query(
              "select account_id,algorithm,revision from kova_private.auth_credentials where account_id=$1 and disabled_at is null",
              [owner],
            )
          ).rows,
          [{ account_id: owner, algorithm: "scrypt-v1", revision: 3 }],
        );
      },
    );

    await scenario(
      "replacement keeps service-only ACLs, private helper denial and bounded recovery lookup",
      async () => {
        for (const signature of [
          "public.kova_auth_consume_verification(text,text,timestamptz,timestamptz)",
          "public.kova_auth_recovery_target(text,timestamptz)",
          "public.kova_auth_consume_recovery(text,text,text,timestamptz,timestamptz)",
        ]) {
          for (const role of ["anon", "authenticated"])
            assert.equal(
              await scalar(db, "select has_function_privilege($1,$2,'execute')", [role, signature]),
              false,
            );
          assert.equal(
            await scalar(db, "select has_function_privilege('service_role',$1,'execute')", [
              signature,
            ]),
            true,
          );
        }
        assert.equal(
          await scalar(
            db,
            "select has_function_privilege('service_role','kova_private.guard_email_action_proof_window()','execute')",
          ),
          false,
        );
        const settings = await scalar(
          db,
          "select proconfig from pg_proc where oid='public.kova_auth_recovery_target(text,timestamptz)'::regprocedure",
        );
        assert.ok(settings.includes("statement_timeout=5s"));
        await pending(db);
        await db.exec("set local role service_role");
        assert.equal((await verify(db)).rows[0].account_id, owner);
        await db.exec("reset role");
      },
    );
  } finally {
    await db.close();
  }
});
