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

const envelope = "v1.test-only.primary.binding.envelope";

test("forward migrations retire existing unbound login challenges, OAuth handoffs and unauthenticated enrollments", async () => {
  const at = new Date().toISOString();
  const future = new Date(Date.now() + 300_000).toISOString();
  let pendingFactorId;
  const db = await authDatabase({
    beforeMigration: async (name, connection) => {
      if (name.endsWith("_kova_owned_google_mfa_review_fixes.sql")) {
        const password = await passwordAccount(connection, { at, expiresAt: future });
        await connection.query(
          `insert into kova_private.auth_mfa_factors(account_id,factor_type,state,secret_ciphertext,verified_at,created_at)
          values($1,'totp','active',convert_to($2,'utf8'),$3,$3)`,
          [owner, envelope, at],
        );
        await connection.query(
          `update kova_private.auth_accounts set mfa_required=true where id=$1`,
          [owner],
        );
        await connection.query(
          `select * from public.kova_auth_begin_mfa_login($1,$2,$3,$4,$5,$6)`,
          [
            owner,
            password.credential.id,
            password.credential.revision,
            digest("legacy-challenge"),
            future,
            at,
          ],
        );
        await connection.query(
          `select * from public.kova_auth_finish_google($1,'subject',$2,true,'Fixture',$3,$4,$5)`,
          [owner, `${owner}@example.invalid`, digest("legacy-handoff"), future, at],
        );
      }
      if (name.endsWith("_kova_owned_mfa_enrollment_step_up.sql")) {
        await passwordAccount(connection, {
          id: other,
          token: "legacy-setup-session",
          at,
          expiresAt: future,
        });
        pendingFactorId = (
          await connection.query(
            `select * from public.kova_auth_begin_totp_enrollment($1,$2,'Old pending setup',$3)`,
            [digest("legacy-setup-session"), envelope, at],
          )
        ).rows[0].factor_id;
      }
    },
  });
  try {
    const retired = (
      await db.query(
        `select
      (select bool_and(consumed_at is not null) from kova_private.auth_mfa_login_challenges) as challenges_retired,
      (select bool_and(consumed_at is not null) from kova_private.auth_session_handoffs) as handoffs_retired,
      (select state='disabled' and disabled_at is not null from kova_private.auth_mfa_factors where id=$1) as pending_setup_retired`,
        [pendingFactorId],
      )
    ).rows[0];
    assert.deepEqual(retired, {
      challenges_retired: true,
      handoffs_retired: true,
      pending_setup_retired: true,
    });
    await assert.rejects(
      db.query(`select * from public.kova_auth_finish_mfa_login($1,$2,$3,$4)`, [
        digest("legacy-challenge"),
        digest("must-not-exist"),
        future,
        at,
      ]),
      /kova_auth_invalid_mfa_challenge/u,
    );
    await assert.rejects(
      db.query(`select * from public.kova_auth_consume_handoff($1,$2,$3,$4)`, [
        digest("legacy-handoff"),
        digest("must-not-exist"),
        future,
        at,
      ]),
      /kova_auth_invalid_handoff/u,
    );
    assert.equal(
      (
        await db.query(`select * from public.kova_auth_read_totp_enrollment($1,$2,$3)`, [
          digest("legacy-setup-session"),
          pendingFactorId,
          at,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

test("a primary-auth audit proof must name this account and session, succeed, be current, and have an allowed method", async (t) => {
  const db = await authDatabase();
  try {
    const password = await passwordAccount(db);
    const second = await passwordAccount(db, { id: other, token: "other" });
    const enroll = () =>
      db.query(
        `select * from public.kova_auth_begin_totp_enrollment_reauthenticated($1,$2,'Factor',null,null,$3)`,
        [digest("session"), envelope, now],
      );
    for (const [label, accountId, sessionId, type, outcome, at, accepted] of [
      ["fresh Google", owner, password.session_id, "oauth_handoff_consumed", "success", now, true],
      ["fresh passkey", owner, password.session_id, "passkey_login", "success", now, true],
      [
        "rotation is not primary authentication",
        owner,
        password.session_id,
        "session_rotated",
        "success",
        now,
        false,
      ],
      [
        "MFA activation is not primary authentication",
        owner,
        password.session_id,
        "mfa_enabled",
        "success",
        now,
        false,
      ],
      ["wrong session", owner, second.session_id, "passkey_login", "success", now, false],
      ["wrong account", other, password.session_id, "passkey_login", "success", now, false],
      ["rejected event", owner, password.session_id, "passkey_login", "rejected", now, false],
      ["future event", owner, password.session_id, "passkey_login", "success", expiry, false],
      [
        "event older than session",
        owner,
        password.session_id,
        "passkey_login",
        "success",
        "2026-09-21T11:59:59Z",
        false,
      ],
    ])
      await t.test(label, async () => {
        await db.exec("begin");
        try {
          await db.query(`select kova_private.audit($1,$2,$3,$4,'{}'::jsonb,$5)`, [
            accountId,
            sessionId,
            type,
            outcome,
            at,
          ]);
          if (accepted) assert.equal((await enroll()).rows.length, 1);
          else await assert.rejects(enroll(), /kova_auth_reauthentication_required/u);
        } finally {
          await db.exec("rollback");
        }
      });
  } finally {
    await db.close();
  }
});
