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

const resolve = async (db, token) =>
  (await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [digest(token), now]))
    .rows;
const snapshot = async (db) =>
  (
    await db.query(`select
  (select jsonb_agg(to_jsonb(s) order by id) from kova_private.auth_sessions s) as sessions,
  (select jsonb_agg(to_jsonb(c) order by id) from kova_private.auth_credentials c) as credentials,
  (select jsonb_agg(to_jsonb(f) order by id) from kova_private.auth_mfa_factors f) as factors,
  (select jsonb_agg(to_jsonb(a) order by id) from kova_private.auth_accounts a) as accounts,
  (select jsonb_agg(to_jsonb(r) order by id) from kova_private.auth_mfa_recovery_codes r) as codes,
  (select count(*)::int from kova_private.auth_audit_events) as audit_count`)
  ).rows;

test("TOTP activation and removal each rotate the current cookie and retire sibling sessions", async () => {
  const db = await authDatabase();
  try {
    const first = await passwordAccount(db);
    await passwordAccount(db, { id: other, token: "other-session" });
    await db.query(`select * from public.kova_auth_create_session($1,$2,$3,$4,'aal1',$5,$6)`, [
      owner,
      first.credential.id,
      first.credential.revision,
      digest("sibling"),
      expiry,
      now,
    ]);
    const active = await enableMfa(db);
    assert.equal(active.assurance_level, "aal2");
    assert.notEqual(active.session_id, first.session_id);
    assert.equal((await resolve(db, "session")).length, 0);
    assert.equal((await resolve(db, "sibling")).length, 0);
    assert.equal((await resolve(db, "mfa-session"))[0].assurance_level, "aal2");
    assert.equal((await resolve(db, "other-session"))[0].account_id, other);
    assert.equal(
      (await db.query(`select count(*)::int as n from kova_private.auth_mfa_recovery_codes`))
        .rows[0].n,
      8,
    );
    const removed = (
      await db.query(`select * from public.kova_auth_remove_totp_with_session($1,$2,$3,$4,$5)`, [
        active.digest,
        active.factorId,
        digest("removed-session"),
        expiry,
        now,
      ])
    ).rows[0];
    assert.equal(removed.assurance_level, "aal1");
    assert.notEqual(removed.session_id, active.session_id);
    assert.equal((await resolve(db, "mfa-session")).length, 0);
    assert.equal((await resolve(db, "removed-session"))[0].assurance_level, "aal1");
    assert.equal(
      (await db.query(`select count(*)::int as n from kova_private.auth_mfa_recovery_codes`))
        .rows[0].n,
      0,
    );
    const events = (
      await db.query(`select event_type from kova_private.auth_audit_events
      where event_type in ('mfa_enabled','mfa_removed') order by id`)
    ).rows;
    assert.deepEqual(
      events.map((r) => r.event_type),
      ["mfa_enabled", "mfa_removed"],
    );
    await assert.rejects(
      db.query(`select * from public.kova_auth_remove_totp_with_session($1,$2,$3,$4,$5)`, [
        active.digest,
        active.factorId,
        digest("replay"),
        expiry,
        now,
      ]),
      /kova_auth_invalid_session/u,
    );
  } finally {
    await db.close();
  }
});

test("TOTP activation fails atomically on malformed/duplicate codes, expired factors, and session-token collisions", async () => {
  const db = await authDatabase();
  try {
    await passwordAccount(db);
    const factor = await pendingFactor(db);
    const before = await snapshot(db);
    const cases = [
      [codeDigests().slice(0, 7), digest("next"), now],
      [Array(8).fill(digest("duplicate")), digest("next"), now],
      [[...codeDigests().slice(0, 7), "not-a-digest"], digest("next"), now],
      [codeDigests(), digest("session"), now],
      [codeDigests(), digest("next"), "2026-09-21T12:10:00Z"],
    ];
    for (const [codes, next, at] of cases) {
      await assert.rejects(
        db.query(`select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)`, [
          digest("session"),
          factor,
          codes,
          next,
          expiry,
          at,
        ]),
      );
      assert.deepEqual(await snapshot(db), before);
    }
  } finally {
    await db.close();
  }
});

test("password change is owner/revision-bound, rotates the current session, and cancels recovery challenges", async () => {
  const db = await authDatabase();
  try {
    const first = await passwordAccount(db);
    await passwordAccount(db, { id: other, token: "other-session" });
    const active = await enableMfa(db);
    await db.query(
      `insert into kova_private.auth_password_recoveries(account_id,token_digest,expires_at,created_at)
      values($1,$2,$3,$4)`,
      [owner, Buffer.from(digest("reset"), "hex"), expiry, now],
    );
    await db.query(`select * from public.kova_auth_begin_mfa_login($1,$2,$3,$4,$5,$6)`, [
      owner,
      first.credential.id,
      first.credential.revision,
      digest("login"),
      "2026-09-21T12:05:00Z",
      now,
    ]);
    const newHash = `scrypt-v1$32768$8$1$${"c".repeat(22)}$${"d".repeat(43)}`;
    const changed = (
      await db.query(`select * from public.kova_auth_change_password($1,$2,$3,$4,$5,$6,$7)`, [
        active.digest,
        first.credential.id,
        first.credential.revision,
        newHash,
        digest("changed-session"),
        expiry,
        now,
      ])
    ).rows[0];
    assert.equal(changed.account_id, owner);
    assert.equal(changed.assurance_level, "aal2");
    assert.equal((await resolve(db, "mfa-session")).length, 0);
    assert.equal((await resolve(db, "changed-session"))[0].session_id, changed.session_id);
    assert.equal((await resolve(db, "other-session"))[0].account_id, other);
    const credential = (
      await db.query(`select revision,secret_hash from kova_private.auth_credentials where id=$1`, [
        first.credential.id,
      ])
    ).rows[0];
    assert.equal(credential.revision, first.credential.revision + 1);
    assert.equal(credential.secret_hash, newHash);
    assert.equal(
      (
        await db.query(
          `select count(*)::int as n from kova_private.auth_password_recoveries where consumed_at is null`,
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int as n from kova_private.auth_mfa_login_challenges where consumed_at is null`,
        )
      ).rows[0].n,
      0,
    );
    const audit = (
      await db.query(
        `select metadata from kova_private.auth_audit_events where event_type='password_changed'`,
      )
    ).rows;
    assert.deepEqual(audit, [{ metadata: {} }]);
    assert.ok(!JSON.stringify(audit).includes(newHash));
    await assert.rejects(
      db.query(`select * from public.kova_auth_change_password($1,$2,$3,$4,$5,$6,$7)`, [
        active.digest,
        first.credential.id,
        first.credential.revision,
        newHash,
        digest("replay"),
        expiry,
        now,
      ]),
    );
  } finally {
    await db.close();
  }
});

test("credential mutation failures roll back hashes, epochs, sessions, recovery codes and audit events", async () => {
  const db = await authDatabase();
  try {
    const first = await passwordAccount(db);
    const second = await passwordAccount(db, { id: other, token: "other-session" });
    const before = await snapshot(db);
    const hash = `scrypt-v1$32768$8$1$${"c".repeat(22)}$${"d".repeat(43)}`;
    const cases = [
      [second.credential.id, 1, hash, digest("new"), expiry],
      [first.credential.id, 2, hash, digest("new"), expiry],
      [first.credential.id, 1, "plaintext", digest("new"), expiry],
      [first.credential.id, 1, hash, digest("session"), expiry],
      [first.credential.id, 1, hash, digest("other-session"), expiry],
      [first.credential.id, 1, hash, digest("new"), "infinity"],
    ];
    for (const [id, revision, encoded, next, expiration] of cases) {
      await assert.rejects(
        db.query(`select * from public.kova_auth_change_password($1,$2,$3,$4,$5,$6,$7)`, [
          digest("session"),
          id,
          revision,
          encoded,
          next,
          expiration,
          now,
        ]),
      );
      assert.deepEqual(await snapshot(db), before);
    }
  } finally {
    await db.close();
  }
});

test("TOTP finishing rechecks a factor disabled after the challenge read", async () => {
  const db = await authDatabase();
  try {
    const first = await passwordAccount(db);
    const active = await enableMfa(db);
    await db.query(`select * from public.kova_auth_begin_mfa_login($1,$2,$3,$4,$5,$6)`, [
      owner,
      first.credential.id,
      first.credential.revision,
      digest("login"),
      "2026-09-21T12:05:00Z",
      now,
    ]);
    await db.query(`select * from public.kova_auth_read_mfa_login_challenge($1,$2)`, [
      digest("login"),
      now,
    ]);
    await db.query(
      `update kova_private.auth_mfa_factors set disabled_at=$1,state='disabled' where id=$2`,
      [now, active.factorId],
    );
    const before = await snapshot(db);
    await assert.rejects(
      db.query(`select * from public.kova_auth_finish_mfa_login($1,$2,$3,$4)`, [
        digest("login"),
        digest("illegal-session"),
        expiry,
        now,
      ]),
      /kova_auth_invalid_mfa_challenge/u,
    );
    assert.deepEqual(await snapshot(db), before);
    assert.equal((await resolve(db, "illegal-session")).length, 0);
  } finally {
    await db.close();
  }
});

test("runtime roles cannot use unrotated MFA APIs or private mutation helpers", async () => {
  const db = await authDatabase();
  try {
    const signatures = [
      "public.kova_auth_activate_totp_with_session(text,uuid,text[],text,timestamptz,timestamptz)",
      "public.kova_auth_remove_totp_with_session(text,uuid,text,timestamptz,timestamptz)",
      "public.kova_auth_change_password(text,uuid,bigint,text,text,timestamptz,timestamptz)",
    ];
    for (const signature of signatures) {
      const security = (
        await db.query(
          `select p.prosecdef, p.proconfig,
        has_function_privilege('anon',p.oid,'execute') as anon_execute,
        has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
        has_function_privilege('service_role',p.oid,'execute') as service_execute
        from pg_proc p where p.oid=$1::regprocedure`,
          [signature],
        )
      ).rows[0];
      assert.equal(security.prosecdef, true);
      assert.ok(security.proconfig.includes('search_path=""'));
      assert.equal(security.anon_execute, false);
      assert.equal(security.authenticated_execute, false);
      assert.equal(security.service_execute, true);
    }
    for (const signature of [
      "public.kova_auth_activate_totp(text,uuid,text[],timestamptz)",
      "public.kova_auth_remove_totp_factor(text,uuid,timestamptz)",
      "kova_private.rotate_security_session(kova_private.auth_sessions,text,text,timestamptz,text,jsonb,timestamptz)",
    ]) {
      assert.equal(
        (
          await db.query(`select has_function_privilege('service_role',$1,'execute') as allowed`, [
            signature,
          ])
        ).rows[0].allowed,
        false,
      );
    }
  } finally {
    await db.close();
  }
});