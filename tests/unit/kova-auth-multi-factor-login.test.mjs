import assert from "node:assert/strict";
import test from "node:test";
import {
  authDatabase,
  passwordAccount,
  pendingFactor,
  enableMfa,
  codeDigests,
  digest,
  now,
  expiry,
  owner,
  other,
} from "../helpers/kova-auth-database.mjs";

async function activateSecondFactor(db, token, nextToken) {
  const factorId = await pendingFactor(db, token, now);
  const session = (
    await db.query("select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)", [
      digest(token),
      factorId,
      codeDigests("backup"),
      digest(nextToken),
      expiry,
      now,
    ])
  ).rows[0];
  return { factorId, session, token: nextToken };
}

test("one challenge can verify and bind any active owned TOTP factor", async () => {
  const db = await authDatabase();
  try {
    const first = await passwordAccount(db);
    const primary = await enableMfa(db);
    const backup = await activateSecondFactor(db, primary.token, "mfa-session-2");

    await db.query("select * from public.kova_auth_begin_mfa_login($1,$2,$3,$4,$5,$6)", [
      owner,
      first.credential.id,
      first.credential.revision,
      digest("multi-login"),
      "2026-09-21T12:05:00Z",
      now,
    ]);

    const factors = (
      await db.query("select * from public.kova_auth_read_mfa_login_challenge($1,$2)", [
        digest("multi-login"),
        now,
      ])
    ).rows;
    assert.equal(factors.length, 2);
    assert.deepEqual(
      new Set(factors.map((row) => row.factor_id)),
      new Set([primary.factorId, backup.factorId]),
    );

    assert.equal(
      (
        await db.query("select public.kova_auth_bind_mfa_login_factor($1,$2,$3) as ok", [
          digest("multi-login"),
          backup.factorId,
          now,
        ])
      ).rows[0].ok,
      true,
    );
    const challenge = (
      await db.query(
        "select factor_id,attempts from kova_private.auth_mfa_login_challenges where token_digest=decode($1,'hex')",
        [digest("multi-login")],
      )
    ).rows[0];
    assert.equal(challenge.factor_id, backup.factorId);
    assert.equal(challenge.attempts, 1);

    const finished = (
      await db.query("select * from public.kova_auth_finish_mfa_login($1,$2,$3,$4)", [
        digest("multi-login"),
        digest("finished-multi"),
        expiry,
        now,
      ])
    ).rows[0];
    assert.equal(finished.account_id, owner);
    assert.equal(finished.assurance_level, "aal2");
    const audit = (
      await db.query(
        "select metadata->>'factor_id' as factor_id from kova_private.auth_audit_events where event_type='mfa_login' order by id desc limit 1",
      )
    ).rows[0];
    assert.equal(audit.factor_id, backup.factorId);

    await assert.rejects(
      db.query("select public.kova_auth_bind_mfa_login_factor($1,$2,$3)", [
        digest("multi-login"),
        primary.factorId,
        now,
      ]),
      /kova_auth_invalid_mfa_challenge/u,
    );
  } finally {
    await db.close();
  }
});

test("factor binding cannot cross accounts and challenge reads increment attempts once", async () => {
  const db = await authDatabase();
  try {
    const first = await passwordAccount(db);
    const primary = await enableMfa(db);
    await passwordAccount(db, { id: other, token: "other-session" });
    const otherFactorId = await pendingFactor(db, "other-session", now);
    await db.query("select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)", [
      digest("other-session"),
      otherFactorId,
      codeDigests("other"),
      digest("other-mfa-session"),
      expiry,
      now,
    ]);
    const otherMfa = { factorId: otherFactorId };

    await db.query("select * from public.kova_auth_begin_mfa_login($1,$2,$3,$4,$5,$6)", [
      owner,
      first.credential.id,
      first.credential.revision,
      digest("owner-login"),
      "2026-09-21T12:05:00Z",
      now,
    ]);
    const factors = (
      await db.query("select * from public.kova_auth_read_mfa_login_challenge($1,$2)", [
        digest("owner-login"),
        now,
      ])
    ).rows;
    assert.ok(factors.some((row) => row.factor_id === primary.factorId));
    assert.equal(
      (
        await db.query(
          "select attempts from kova_private.auth_mfa_login_challenges where token_digest=decode($1,'hex')",
          [digest("owner-login")],
        )
      ).rows[0].attempts,
      1,
    );
    await assert.rejects(
      db.query("select public.kova_auth_bind_mfa_login_factor($1,$2,$3)", [
        digest("owner-login"),
        otherMfa.factorId,
        now,
      ]),
      /kova_auth_invalid_mfa_challenge/u,
    );
  } finally {
    await db.close();
  }
});
