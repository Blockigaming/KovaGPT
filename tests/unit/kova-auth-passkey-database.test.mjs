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
import {
  beginPasskey,
  claimPasskey,
  finishRegistration,
  registerPasskey,
  loginChallenge,
  finishLogin,
} from "../helpers/kova-passkey-database.mjs";

test("passkeys are service-only and private tables grant no browser access", async () => {
  const db = await authDatabase();
  try {
    const result = await db.query(`select p.proname, p.prosecdef, p.proconfig,
      has_function_privilege('service_role',p.oid,'execute') as server,
      has_function_privilege('anon',p.oid,'execute') as anon,
      has_function_privilege('authenticated',p.oid,'execute') as browser
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'kova_auth_%passkey%'`);
    assert.equal(result.rows.length, 8);
    for (const row of result.rows) {
      assert.equal(row.prosecdef, true);
      assert.ok(row.proconfig.includes('search_path=""'));
      assert.equal(row.server, true);
      assert.equal(row.anon, false);
      assert.equal(row.browser, false);
    }
    await db.exec("set role authenticated");
    await assert.rejects(db.query(`select * from kova_private.auth_passkeys`), /permission denied/);
    await assert.rejects(
      db.query(`select * from public.kova_auth_lookup_passkey('unused')`),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("registration binds the current password/session and rotates credentials without changing account UUID", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    await assert.rejects(beginPasskey(db), /reauthentication_required/);
    const { key, principal } = await registerPasskey(db, account.credential);
    assert.equal(principal.account_id, owner);
    assert.equal(principal.assurance_level, "aal2");
    assert.equal(key.account_id, owner);
    assert.equal(key.rp_id, "kova.test");
    assert.equal(Buffer.from(key.user_handle, "base64url").toString(), owner);
    assert.equal(
      (
        await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [
          digest("session"),
          now,
        ])
      ).rows.length,
      0,
    );
    const list = (
      await db.query(`select * from public.kova_auth_list_passkeys($1,$2)`, [
        digest("registered"),
        now,
      ])
    ).rows;
    assert.equal(list.length, 1);
    assert.equal(list[0].friendly_name, "Device");
    assert.equal(Object.hasOwn(list[0], "public_key"), false);
    await assert.rejects(finishRegistration(db), /invalid_session/);
  } finally {
    await db.close();
  }
});

test("a wrong browser, another account, and cross-ceremony claims cannot consume a registration", async () => {
  const db = await authDatabase();
  try {
    const a = await passwordAccount(db);
    const b = await passwordAccount(db, { id: other, token: "other-session" });
    await assert.rejects(
      beginPasskey(db, { credential: b.credential }),
      /reauthentication_required/,
    );
    await beginPasskey(db, { credential: a.credential });
    for (const options of [
      { binding: "wrong" },
      { session: "other-session" },
      { purpose: "authentication" },
    ]) {
      await assert.rejects(claimPasskey(db, options), /invalid_passkey_challenge/);
    }
    await claimPasskey(db);
    await assert.rejects(claimPasskey(db), /invalid_passkey_challenge/);
    await assert.rejects(
      finishRegistration(db, { claim: "wrong-receipt" }),
      /invalid_passkey_challenge/,
    );
    const row = (await db.query(`select consumed_at from kova_private.auth_passkey_challenges`))
      .rows[0];
    assert.equal(row.consumed_at, null);
  } finally {
    await db.close();
  }
});

test("expired or stale registration and invalid metadata roll back without keys or session retirement", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    await beginPasskey(db, { credential: account.credential });
    await claimPasskey(db);
    const scenarios = [
      ["late completion", null, { at: "2026-09-21T12:05:00Z" }],
      ["password changed", `update kova_private.auth_credentials set revision=revision+1`, {}],
      ["revoked session", `update kova_private.auth_sessions set revoked_at='${now}'`, {}],
      ["suspension", `update kova_private.auth_accounts set suspended_until='${expiry}'`, {}],
      ["unverified account", `update kova_private.auth_accounts set email_verified_at=null`, {}],
      ["invalid counter", null, { counter: -1 }],
      ["invalid public key", null, { publicKeyHex: "abc" }],
      ["impossible backup flags", null, { backupEligible: false, backedUp: true }],
      ["invalid transport", null, { transports: ["untrusted"] }],
      ["session token collision", null, { next: "session" }],
    ];
    for (const [label, sql, options] of scenarios) {
      await db.exec("begin");
      try {
        if (sql) await db.exec(sql);
        await db.exec("savepoint attempt");
        await assert.rejects(finishRegistration(db, options), undefined, label);
        await db.exec("rollback to savepoint attempt");
        assert.equal(
          (await db.query(`select count(*)::int n from kova_private.auth_passkeys`)).rows[0].n,
          0,
          label,
        );
        assert.equal(
          (await db.query(`select consumed_at from kova_private.auth_passkey_challenges`)).rows[0]
            .consumed_at,
          null,
          label,
        );
      } finally {
        await db.exec("rollback");
      }
    }
    assert.equal((await finishRegistration(db)).rows[0].assurance_level, "aal2");
  } finally {
    await db.close();
  }
});

test("verified login updates the counter and receipt exactly once and cannot replay", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    const { key } = await registerPasskey(db, account.credential);
    await loginChallenge(db);
    const principal = (await finishLogin(db, key)).rows[0];
    assert.equal(principal.assurance_level, "aal2");
    assert.equal(principal.account_id, owner);
    await assert.rejects(finishLogin(db, key), /invalid_passkey_login/);
    const updated = (await db.query(`select sign_count, revision from kova_private.auth_passkeys`))
      .rows[0];
    assert.equal(updated.sign_count, 1);
    assert.equal(updated.revision, key.revision + 1);
    const audit = (
      await db.query(
        `select metadata from kova_private.auth_audit_events where event_type='passkey_login'`,
      )
    ).rows;
    assert.equal(audit.length, 1);
    assert.deepEqual(Object.keys(audit[0].metadata), ["passkey_id"]);
  } finally {
    await db.close();
  }
});

test("state changed between verification and consumption cannot authenticate or advance a counter", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    const { key } = await registerPasskey(db, account.credential);
    await loginChallenge(db);
    const scenarios = [
      ["revoked credential", `update kova_private.auth_passkeys set disabled_at='${now}'`, {}],
      ["stale revision", null, { revision: key.revision + 1 }],
      ["stale epoch", null, { session_epoch: key.session_epoch + 1 }],
      ["wrong counter", null, { sign_count: 9 }],
      ["wrong handle", null, { user_handle: "other-account" }],
      ["wrong RP", `update kova_private.auth_passkeys set rp_id='another.test'`, {}],
      [
        "suspended account",
        `update kova_private.auth_accounts set suspended_until='${expiry}'`,
        {},
      ],
      ["deleted account", `update kova_private.auth_accounts set deleted_at='${now}'`, {}],
      ["expired challenge", null, { at: "2026-09-21T12:05:00Z" }],
      ["unbounded expiry", null, { expiresAt: "infinity" }],
    ];
    for (const [label, sql, options] of scenarios) {
      await db.exec("begin");
      try {
        if (sql) await db.exec(sql);
        await db.exec("savepoint attempt");
        await assert.rejects(finishLogin(db, key, options), undefined, label);
        await db.exec("rollback to savepoint attempt");
        assert.equal(
          (await db.query(`select sign_count from kova_private.auth_passkeys`)).rows[0].sign_count,
          0,
        );
        assert.equal(
          (
            await db.query(
              `select count(*)::int n from kova_private.auth_sessions where token_digest=$1`,
              [Buffer.from(digest("logged-in"), "hex")],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await db.exec("rollback");
      }
    }
  } finally {
    await db.close();
  }
});

test("zero-counter concurrent proofs serialize through revision checks", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    const { key } = await registerPasskey(db, account.credential);
    await loginChallenge(db, "first");
    await loginChallenge(db, "second");
    await finishLogin(db, key, { challenge: "first", claim: "first-receipt", counter: 0 });
    await assert.rejects(
      finishLogin(db, key, {
        challenge: "second",
        claim: "second-receipt",
        counter: 0,
        next: "second-token",
      }),
      /invalid_passkey_login/,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int n from kova_private.auth_audit_events where event_type='passkey_login'`,
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("rename/removal are account-bound; removal rotates the session and blocks the removed key", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    await passwordAccount(db, { id: other, token: "other-session" });
    const { key } = await registerPasskey(db, account.credential);
    await assert.rejects(
      db.query(`select public.kova_auth_rename_passkey($1,$2,'Mine',$3)`, [
        digest("other-session"),
        key.passkey_id,
        now,
      ]),
      /invalid_passkey_request/,
    );
    await db.query(`select public.kova_auth_rename_passkey($1,$2,'My laptop',$3)`, [
      digest("registered"),
      key.passkey_id,
      now,
    ]);
    await loginChallenge(db);
    const removed = (
      await db.query(`select * from public.kova_auth_remove_passkey($1,$2,$3,$4,$5)`, [
        digest("registered"),
        key.passkey_id,
        digest("after-removal"),
        expiry,
        now,
      ])
    ).rows[0];
    assert.equal(removed.assurance_level, "aal1");
    await assert.rejects(finishLogin(db, key), /invalid_passkey_login/);
    assert.equal(
      (
        await db.query(`select * from public.kova_auth_lookup_passkey($1,$2)`, [
          key.credential_id,
          now,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [
          digest("registered"),
          now,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [
          digest("other-session"),
          now,
        ])
      ).rows[0].account_id,
      other,
    );
  } finally {
    await db.close();
  }
});

test("last usable sign-in credential cannot be removed, and duplicate credential IDs never change owners", async () => {
  const db = await authDatabase();
  try {
    const account = await passwordAccount(db);
    const { key, fixture } = await registerPasskey(db, account.credential);
    await db.query(`update kova_private.auth_credentials set disabled_at=$1 where account_id=$2`, [
      now,
      owner,
    ]);
    await assert.rejects(
      db.query(`select * from public.kova_auth_remove_passkey($1,$2,$3,$4,$5)`, [
        digest("registered"),
        key.passkey_id,
        digest("next"),
        expiry,
        now,
      ]),
      /last_sign_in_method/,
    );
    const second = await passwordAccount(db, { id: other, token: "other-session" });
    await beginPasskey(db, {
      credential: second.credential,
      session: "other-session",
      challenge: "register-other",
    });
    await claimPasskey(db, {
      session: "other-session",
      challenge: "register-other",
      claim: "other-receipt",
    });
    await assert.rejects(
      finishRegistration(db, {
        fixture,
        session: "other-session",
        challenge: "register-other",
        claim: "other-receipt",
      }),
      /duplicate key/,
    );
    assert.equal(
      (await db.query(`select account_id from kova_private.auth_passkeys`)).rows[0].account_id,
      owner,
    );
  } finally {
    await db.close();
  }
});