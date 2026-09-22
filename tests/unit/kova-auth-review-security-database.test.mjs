import assert from "node:assert/strict";
import test from "node:test";
import {
  authDatabase,
  passwordAccount,
  enableMfa,
  pendingFactor,
  codeDigests,
  digest,
  now,
  expiry,
  owner,
  other,
} from "../helpers/kova-auth-database.mjs";

const email = "google-owner@example.invalid";
const envelope = "v1.fixture.only.encrypted.totp.envelope";
const fiveMinutes = "2026-09-21T12:05:00Z";
const later = "2026-09-21T12:06:00Z";

const snapshot = async (db) =>
  (
    await db.query(`select
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_accounts x) as accounts,
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_credentials x) as credentials,
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_identities x) as identities,
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_sessions x) as sessions,
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_session_handoffs x) as handoffs,
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_mfa_login_challenges x) as challenges,
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_mfa_factors x) as factors,
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_mfa_recovery_codes x) as recovery,
  (select jsonb_agg(to_jsonb(x) order by id) from kova_private.auth_email_verifications x) as verification,
  (select count(*)::int from kova_private.auth_audit_events) as audit_count
`)
  ).rows;

async function isolated(db, body) {
  await db.exec("begin");
  try {
    await body();
  } finally {
    await db.exec("rollback");
  }
}

async function google(
  db,
  {
    handoff = "handoff",
    candidate = owner,
    subject = "google-subject",
    at = now,
    verified = true,
  } = {},
) {
  return db.query(
    `select * from public.kova_auth_finish_google($1,$2,$3,$4,'Google Owner',$5,$6,$7)`,
    [candidate, subject, email, verified, digest(handoff), expiry, at],
  );
}

async function exchange(
  db,
  {
    handoff = "handoff",
    session = "google-session",
    challenge = "google-challenge",
    at = now,
    challengeExpiry = fiveMinutes,
  } = {},
) {
  return db.query(`select * from public.kova_auth_consume_handoff_with_mfa($1,$2,$3,$4,$5,$6)`, [
    digest(handoff),
    digest(session),
    expiry,
    digest(challenge),
    challengeExpiry,
    at,
  ]);
}

async function googleFixture(db, mfa = false) {
  await db.query(
    `insert into auth.users(id,email,email_confirmed_at) values($1,'shadow-one@example.invalid',$3),($2,'shadow-two@example.invalid',$3)`,
    [owner, other, now],
  );
  await google(db);
  const first = (await exchange(db)).rows[0];
  assert.equal(first.mfa_required, false);
  assert.equal(first.assurance_level, "aal1");
  if (!mfa) return { first };
  const factor = (
    await db.query(
      `select * from public.kova_auth_begin_totp_enrollment_reauthenticated($1,$2,'Google factor',null,null,$3)`,
      [digest("google-session"), envelope, now],
    )
  ).rows[0].factor_id;
  const active = (
    await db.query(`select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)`, [
      digest("google-session"),
      factor,
      codeDigests("google-code"),
      digest("google-mfa-session"),
      expiry,
      now,
    ])
  ).rows[0];
  return { first, active, factor };
}

async function readyChallenge(db) {
  await google(db, { handoff: "mfa-handoff", candidate: other });
  const result = (await exchange(db, { handoff: "mfa-handoff", session: "must-not-exist" }))
    .rows[0];
  assert.equal(result.mfa_required, true);
  assert.equal(result.session_id, null);
  assert.equal(
    (
      await db.query(
        `select count(*)::int as n from kova_private.auth_sessions where token_digest=decode($1,'hex')`,
        [digest("must-not-exist")],
      )
    ).rows[0].n,
    0,
  );
  await db.query(`select * from public.kova_auth_read_mfa_login_challenge($1,$2)`, [
    digest("google-challenge"),
    now,
  ]);
}

function finish(db, method, { at = now, next = "finished-session", code = "google-code-0" } = {}) {
  return method === "totp"
    ? db.query(`select * from public.kova_auth_finish_mfa_login($1,$2,$3,$4)`, [
        digest("google-challenge"),
        digest(next),
        expiry,
        at,
      ])
    : db.query(`select * from public.kova_auth_finish_mfa_recovery_login($1,$2,$3,$4,$5)`, [
        digest("google-challenge"),
        digest(code),
        digest(next),
        expiry,
        at,
      ]);
}

for (const method of ["totp", "recovery"]) {
  test(`final ordered schema completes Google ${method} without a password and rejects replay`, async () => {
    const db = await authDatabase();
    try {
      await googleFixture(db, true);
      assert.equal(
        (await db.query("select count(*)::int as n from kova_private.auth_credentials")).rows[0].n,
        0,
      );
      await readyChallenge(db);
      const result = (await finish(db, method)).rows[0];
      assert.equal(result.account_id, owner);
      assert.equal(result.assurance_level, "aal2");
      const before = await snapshot(db);
      await assert.rejects(
        finish(db, method, { next: "replay-session" }),
        /kova_auth_invalid_mfa_challenge/u,
      );
      assert.deepEqual(await snapshot(db), before);
      if (method === "recovery") {
        await readyChallengeAfterRecovery(db);
      }
    } finally {
      await db.close();
    }
  });

  test(`Google ${method} rechecks account, epoch, factor, identity, expiry and attempt state atomically`, async (t) => {
    const db = await authDatabase();
    try {
      const { factor } = await googleFixture(db, true);
      await readyChallenge(db);
      const cases = [
        [
          "revoked epoch",
          `update kova_private.auth_accounts set session_epoch=session_epoch+1 where id='${owner}'`,
        ],
        [
          "deleted account",
          `update kova_private.auth_accounts set deleted_at='${now}' where id='${owner}'`,
        ],
        [
          "suspended account",
          `update kova_private.auth_accounts set suspended_until='${expiry}' where id='${owner}'`,
        ],
        [
          "unverified account",
          `update kova_private.auth_accounts set email_verified_at=null where id='${owner}'`,
        ],
        [
          "MFA disabled",
          `update kova_private.auth_accounts set mfa_required=false where id='${owner}'`,
        ],
        [
          "disabled factor",
          `update kova_private.auth_mfa_factors set state='disabled',disabled_at='${now}' where id='${factor}'`,
        ],
        [
          "unverified factor",
          `update kova_private.auth_mfa_factors set verified_at=null where id='${factor}'`,
        ],
        [
          "disabled Google identity",
          `update kova_private.auth_identities set disabled_at='${now}' where provider='google'`,
        ],
        [
          "unverified Google identity",
          `update kova_private.auth_identities set verified_at=null where provider='google'`,
        ],
        [
          "different verified email",
          `update kova_private.auth_identities set normalized_email='changed@example.invalid' where provider='google'`,
        ],
        [
          "missing identity binding",
          `update kova_private.auth_mfa_login_challenges set google_identity_id=null`,
        ],
        [
          "missing epoch binding",
          `alter table kova_private.auth_mfa_login_challenges drop constraint auth_mfa_challenge_epoch_bound; update kova_private.auth_mfa_login_challenges set session_epoch=null`,
        ],
        ["no verified attempt", `update kova_private.auth_mfa_login_challenges set attempts=0`],
        ["expired challenge", null, { at: later }],
      ];
      for (const [label, sql, options] of cases)
        await t.test(label, () =>
          isolated(db, async () => {
            if (sql) await db.exec(sql);
            const before = await snapshot(db);
            await db.exec("savepoint expected_rejection");
            await assert.rejects(finish(db, method, options), /kova_auth_/u);
            await db.exec("rollback to savepoint expected_rejection");
            assert.deepEqual(await snapshot(db), before);
          }),
        );
    } finally {
      await db.close();
    }
  });
}

async function readyChallengeAfterRecovery(db) {
  await google(db, { handoff: "next-handoff", candidate: other });
  await exchange(db, {
    handoff: "next-handoff",
    challenge: "next-challenge",
    session: "unused-next",
  });
  await db.query(`select * from public.kova_auth_read_mfa_login_challenge($1,$2)`, [
    digest("next-challenge"),
    now,
  ]);
  const before = await snapshot(db);
  await assert.rejects(
    db.query(`select * from public.kova_auth_finish_mfa_recovery_login($1,$2,$3,$4,$5)`, [
      digest("next-challenge"),
      digest("google-code-0"),
      digest("reused-code-session"),
      expiry,
      now,
    ]),
    /kova_auth_invalid_recovery_code/u,
  );
  assert.deepEqual(await snapshot(db), before);
}

test("an epoch change or disabled Google identity also invalidates a pre-MFA OAuth handoff", async (t) => {
  const db = await authDatabase();
  try {
    await googleFixture(db);
    await google(db, { candidate: other, handoff: "later-handoff" });
    for (const [name, sql] of [
      [
        "epoch",
        `update kova_private.auth_accounts set session_epoch=session_epoch+1 where id='${owner}'`,
      ],
      [
        "identity",
        `update kova_private.auth_identities set disabled_at='${now}' where provider='google'`,
      ],
    ])
      await t.test(name, () =>
        isolated(db, async () => {
          await db.exec(sql);
          const before = await snapshot(db);
          await db.exec("savepoint expected_rejection");
          await assert.rejects(
            exchange(db, { handoff: "later-handoff", session: "rejected" }),
            /kova_auth_invalid_handoff/u,
          );
          await db.exec("rollback to savepoint expected_rejection");
          assert.deepEqual(await snapshot(db), before);
        }),
      );
  } finally {
    await db.close();
  }
});

test("Google safely claims an expired pending signup without activating its unverified password", async () => {
  const db = await authDatabase();
  try {
    await db.query(
      `insert into auth.users(id,email) values($1,'shadow-one@example.invalid'),($2,'shadow-two@example.invalid')`,
      [owner, other],
    );
    const unverifiedPassword = `scrypt-v1$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}`;
    await db.query(
      `select * from public.kova_auth_create_password_account($1,$2,'Pending',$3,$4,$5,'{}'::jsonb,$6)`,
      [owner, email, unverifiedPassword, digest("original-verification"), fiveMinutes, now],
    );
    const original = (
      await db.query("select id,secret_hash,revision from kova_private.auth_credentials")
    ).rows[0];
    const result = (await google(db, { candidate: other, at: later })).rows[0];
    assert.deepEqual(result, { account_id: owner, candidate_used: false });
    const credential = (
      await db.query(
        "select id,secret_hash,revision,activated_at,disabled_at is not null as retired from kova_private.auth_credentials",
      )
    ).rows[0];
    assert.deepEqual(credential, { ...original, activated_at: null, retired: true });
    assert.equal(
      (
        await db.query(
          "select consumed_at is not null as retired from kova_private.auth_email_verifications",
        )
      ).rows[0].retired,
      true,
    );
    assert.equal(
      (await db.query(`select * from public.kova_auth_password_lookup($1,$2)`, [email, later])).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query(`select * from public.kova_auth_consume_verification($1,$2,$3,$4)`, [
        digest("original-verification"),
        digest("attack-session"),
        expiry,
        later,
      ]),
      /kova_auth_invalid_verification/u,
    );
    const session = (await exchange(db, { at: later })).rows[0];
    assert.equal(session.account_id, owner);
    assert.equal(session.assurance_level, "aal1");
    assert.equal(
      (await db.query("select count(*)::int as n from kova_private.auth_accounts")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("Google preserves a verified password and rejects absent mailbox proof or suspended/deleted ownership", async (t) => {
  const db = await authDatabase();
  try {
    await passwordAccount(db, { email });
    await db.query(`insert into auth.users(id,email) values($1,'candidate@example.invalid')`, [
      other,
    ]);
    for (const [label, sql, options] of [
      ["false email verification", null, { verified: false }],
      ["null email verification", null, { verified: null }],
      [
        "suspended",
        `update kova_private.auth_accounts set suspended_until='${expiry}' where id='${owner}'`,
      ],
      ["deleted", `update kova_private.auth_accounts set deleted_at='${now}' where id='${owner}'`],
    ])
      await t.test(label, () =>
        isolated(db, async () => {
          if (sql) await db.exec(sql);
          const before = await snapshot(db);
          await db.exec("savepoint expected_rejection");
          await assert.rejects(google(db, { candidate: other, ...options }), /kova_auth_/u);
          await db.exec("rollback to savepoint expected_rejection");
          assert.deepEqual(await snapshot(db), before);
        }),
      );
    const beforeCredential = (await db.query("select * from kova_private.auth_credentials")).rows;
    await google(db, { candidate: other });
    assert.deepEqual(
      (await db.query("select * from kova_private.auth_credentials")).rows,
      beforeCredential,
    );
  } finally {
    await db.close();
  }
});

test("password MFA still requires its exact current credential revision under the forward migration", async () => {
  const db = await authDatabase();
  try {
    const password = await passwordAccount(db);
    await enableMfa(db);
    await db.query(`select * from public.kova_auth_begin_mfa_login($1,$2,$3,$4,$5,$6)`, [
      owner,
      password.credential.id,
      password.credential.revision,
      digest("google-challenge"),
      fiveMinutes,
      now,
    ]);
    await db.query(`select * from public.kova_auth_read_mfa_login_challenge($1,$2)`, [
      digest("google-challenge"),
      now,
    ]);
    await db.query(`update kova_private.auth_credentials set revision=revision+1 where id=$1`, [
      password.credential.id,
    ]);
    const before = await snapshot(db);
    await assert.rejects(finish(db, "totp"), /kova_auth_account_unavailable/u);
    await assert.rejects(
      finish(db, "recovery", { code: "code-0" }),
      /kova_auth_account_unavailable/u,
    );
    assert.deepEqual(await snapshot(db), before);
  } finally {
    await db.close();
  }
});

test("first MFA enrollment rejects an old AAL1 cookie, fake freshness, stale credentials and cross-account proof", async (t) => {
  const db = await authDatabase();
  try {
    const password = await passwordAccount(db);
    const second = await passwordAccount(db, { id: other, token: "other-session" });
    const enroll = (id = null, revision = null, token = "session", at = later) =>
      db.query(
        `select * from public.kova_auth_begin_totp_enrollment_reauthenticated($1,$2,'Secure factor',$3,$4,$5)`,
        [digest(token), envelope, id, revision, at],
      );
    for (const [label, prepare, args] of [
      ["old cookie", null, []],
      [
        "recently rotated cookie is not reauthentication",
        async () =>
          db.query(`select * from public.kova_auth_rotate_session($1,$2,$3,$4)`, [
            digest("session"),
            digest("rotated"),
            expiry,
            later,
          ]),
        [null, null, "rotated"],
      ],
      [
        "AAL2 alone is not primary proof",
        async () => db.exec("update kova_private.auth_sessions set assurance_level='aal2'"),
        [],
      ],
      ["unrelated account credential", null, [second.credential.id, second.credential.revision]],
      ["missing revision", null, [password.credential.id, null]],
      ["stale revision", null, [password.credential.id, password.credential.revision + 1]],
    ])
      await t.test(label, () =>
        isolated(db, async () => {
          if (prepare) await prepare();
          const before = await snapshot(db);
          await db.exec("savepoint expected_rejection");
          await assert.rejects(enroll(...args), /kova_auth_reauthentication_required/u);
          await db.exec("rollback to savepoint expected_rejection");
          assert.deepEqual(await snapshot(db), before);
        }),
      );
    const factor = (await enroll(password.credential.id, password.credential.revision)).rows[0];
    assert.equal(factor.email, `${owner}@example.invalid`);
    assert.equal(
      (await db.query("select enrollment_method from kova_private.auth_mfa_factors")).rows[0]
        .enrollment_method,
      "password",
    );
  } finally {
    await db.close();
  }
});

test("Google-first MFA needs no password but its primary sign-in authorization expires after five minutes", async () => {
  const db = await authDatabase();
  try {
    await googleFixture(db);
    const before = await snapshot(db);
    await assert.rejects(
      db.query(
        `select * from public.kova_auth_begin_totp_enrollment_reauthenticated($1,$2,'Factor',null,null,$3)`,
        [digest("google-session"), envelope, fiveMinutes],
      ),
      /kova_auth_reauthentication_required/u,
    );
    assert.deepEqual(await snapshot(db), before);
    const first = await db.query(
      `select * from public.kova_auth_begin_totp_enrollment_reauthenticated($1,$2,'Factor',null,null,$3)`,
      [digest("google-session"), envelope, now],
    );
    assert.equal(first.rows[0].email, email);
    const beforeExpiredActivation = await snapshot(db);
    await assert.rejects(
      db.query(`select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)`, [
        digest("google-session"),
        first.rows[0].factor_id,
        codeDigests(),
        digest("expired-setup"),
        expiry,
        fiveMinutes,
      ]),
      /kova_auth_invalid_mfa_enrollment/u,
    );
    assert.deepEqual(await snapshot(db), beforeExpiredActivation);
  } finally {
    await db.close();
  }
});

test("MFA activation binds the enrollment to its session, epoch and current password revision", async (t) => {
  const db = await authDatabase();
  try {
    const password = await passwordAccount(db);
    await db.query(`select * from public.kova_auth_create_session($1,$2,$3,$4,'aal1',$5,$6)`, [
      owner,
      password.credential.id,
      password.credential.revision,
      digest("sibling"),
      expiry,
      now,
    ]);
    const factor = await pendingFactor(db);
    for (const [label, sql, token] of [
      ["sibling session", null, "sibling"],
      [
        "changed password revision",
        `update kova_private.auth_credentials set revision=revision+1`,
        "session",
      ],
      [
        "missing authorization",
        `update kova_private.auth_mfa_factors set enrollment_authorized_at=null`,
        "session",
      ],
      [
        "changed epoch",
        `update kova_private.auth_accounts set session_epoch=session_epoch+1`,
        "session",
      ],
    ])
      await t.test(label, () =>
        isolated(db, async () => {
          if (sql) await db.exec(sql);
          const before = await snapshot(db);
          await db.exec("savepoint expected_rejection");
          await assert.rejects(
            db.query(
              `select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)`,
              [digest(token), factor, codeDigests(), digest("blocked"), expiry, now],
            ),
            /kova_auth_/u,
          );
          await db.exec("rollback to savepoint expected_rejection");
          assert.deepEqual(await snapshot(db), before);
        }),
      );
  } finally {
    await db.close();
  }
});

test("the unguarded enrollment ABI is retired and new primary-proof storage is browser-inaccessible", async () => {
  const db = await authDatabase();
  try {
    const result = (
      await db.query(`select
      has_function_privilege('service_role','public.kova_auth_begin_totp_enrollment(text,text,text,timestamptz)','execute') as legacy,
      has_function_privilege('service_role','public.kova_auth_begin_totp_enrollment_reauthenticated(text,text,text,uuid,bigint,timestamptz)','execute') as server,
      has_function_privilege('anon','public.kova_auth_begin_totp_enrollment_reauthenticated(text,text,text,uuid,bigint,timestamptz)','execute') as anon,
      has_function_privilege('authenticated','public.kova_auth_begin_totp_enrollment_reauthenticated(text,text,text,uuid,bigint,timestamptz)','execute') as browser,
      has_table_privilege('authenticated','kova_private.auth_mfa_factors','update') as browser_update,
      has_function_privilege('authenticated','kova_private.bind_primary_auth_challenge()','execute') as browser_trigger
    `)
    ).rows[0];
    assert.deepEqual(result, {
      legacy: false,
      server: true,
      anon: false,
      browser: false,
      browser_update: false,
      browser_trigger: false,
    });
    await db.exec("set role service_role");
    await assert.rejects(
      db.query(`select * from public.kova_auth_begin_totp_enrollment($1,$2,'Factor',$3)`, [
        digest("session"),
        envelope,
        now,
      ]),
      /permission denied/u,
    );
  } finally {
    await db.close();
  }
});
