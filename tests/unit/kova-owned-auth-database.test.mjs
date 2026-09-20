import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260920170657_kova_identity_session_store.sql",
    import.meta.url,
  ),
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz,
      deleted_at timestamptz,
      created_at timestamptz default now()
    );
    create table auth.mfa_factors (
      id uuid primary key,
      user_id uuid not null,
      status text not null
    );
    create table public.test_email_queue (
      id bigint generated always as identity primary key,
      queue_name text not null,
      payload jsonb not null
    );
    create function public.enqueue_email(queue_name text, payload jsonb)
    returns bigint language sql as $$
      insert into public.test_email_queue(queue_name, payload)
      values (queue_name, payload) returning id
    $$;
  `);
  await db.exec(migration);
  return db;
}

const firstAccount = "10000000-0000-4000-8000-000000000001";
const secondAccount = "20000000-0000-4000-8000-000000000002";
const now = "2026-09-20T17:00:00Z";
const verificationExpiry = "2026-09-20T18:00:00Z";
const sessionExpiry = "2026-10-20T17:00:00Z";
const digest = (byte) => byte.repeat(64);
const passwordHash = `scrypt-v1$32768$8$1$${"a".repeat(32)}$${"b".repeat(64)}`;

async function createVerifiedPasswordAccount(db, options = {}) {
  const accountId = options.accountId ?? firstAccount;
  const email = options.email ?? "owner@example.com";
  const verificationDigest = options.verificationDigest ?? digest("1");
  const sessionDigest = options.sessionDigest ?? digest("2");
  await db.query(
    `select * from public.kova_auth_create_password_account(
      $1, $2, $3, $4, $5, $6, $7::jsonb, $8
    )`,
    [
      accountId,
      email,
      "Owner",
      passwordHash,
      verificationDigest,
      verificationExpiry,
      JSON.stringify({ to: email, template: "verify", token: "raw-only-in-queue" }),
      now,
    ],
  );
  const verified = await db.query(
    `select * from public.kova_auth_consume_verification($1, $2, $3, $4)`,
    [verificationDigest, sessionDigest, sessionExpiry, now],
  );
  return verified.rows[0];
}

test("migration creates the complete private auth schema with browser roles denied", async () => {
  const db = await database();
  try {
    const tables = await db.query(`
      select table_name from information_schema.tables
       where table_schema = 'kova_private' order by table_name
    `);
    assert.deepEqual(
      tables.rows.map(({ table_name }) => table_name),
      [
        "auth_accounts",
        "auth_audit_events",
        "auth_credentials",
        "auth_email_verifications",
        "auth_identities",
        "auth_mfa_factors",
        "auth_mfa_recovery_codes",
        "auth_oauth_states",
        "auth_password_recoveries",
        "auth_session_handoffs",
        "auth_sessions",
      ],
    );
    const security = await db.query(`
      select
        bool_and(c.relrowsecurity) as all_rls,
        bool_or(has_table_privilege('anon', format('kova_private.%I', c.relname), 'select')) as anon_read,
        bool_or(has_table_privilege('authenticated', format('kova_private.%I', c.relname), 'select')) as user_read
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'kova_private' and c.relkind = 'r'
    `);
    assert.deepEqual(security.rows, [{ all_rls: true, anon_read: false, user_read: false }]);
    const functionSecurity = await db.query(`
      select
        has_function_privilege('authenticated',
          'public.kova_auth_resolve_session(text,timestamptz)', 'execute') as user_resolve,
        has_function_privilege('service_role',
          'public.kova_auth_resolve_session(text,timestamptz)', 'execute') as service_resolve
    `);
    assert.deepEqual(functionSecurity.rows, [{ user_resolve: false, service_resolve: true }]);
  } finally {
    await db.close();
  }
});

test("signup, verification, and session creation are atomic and one-time", async () => {
  const db = await database();
  try {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, null)`, [
      firstAccount,
      "shadow@invalid.kovagpt.com",
    ]);
    const created = await db.query(
      `select * from public.kova_auth_create_password_account(
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8
      )`,
      [
        firstAccount,
        "Owner@Example.com",
        "Owner",
        passwordHash,
        digest("1"),
        verificationExpiry,
        JSON.stringify({ to: "owner@example.com", token: "raw-only-in-queue" }),
        now,
      ],
    );
    assert.deepEqual(created.rows, [
      { account_id: firstAccount, candidate_used: true, verification_created: true },
    ]);
    const queue = await db.query(`select queue_name, payload from public.test_email_queue`);
    assert.equal(queue.rows.length, 1);
    assert.equal(queue.rows[0].queue_name, "auth_emails");
    assert.equal(queue.rows[0].payload.token, "raw-only-in-queue");

    const beforeVerification = await db.query(
      `select * from public.kova_auth_password_lookup($1, $2)`,
      ["owner@example.com", now],
    );
    assert.deepEqual(beforeVerification.rows, []);

    const verified = await db.query(
      `select * from public.kova_auth_consume_verification($1, $2, $3, $4)`,
      [digest("1"), digest("2"), sessionExpiry, now],
    );
    assert.equal(verified.rows[0].account_id, firstAccount);
    assert.equal(verified.rows[0].email_verified, true);
    const resolved = await db.query(`select * from public.kova_auth_resolve_session($1, $2)`, [
      digest("2"),
      now,
    ]);
    assert.equal(resolved.rows[0].account_id, firstAccount);
    assert.equal(resolved.rows[0].email, "owner@example.com");
    await assert.rejects(() =>
      db.query(`select * from public.kova_auth_consume_verification($1, $2, $3, $4)`, [
        digest("1"),
        digest("3"),
        sessionExpiry,
        now,
      ]),
    );
  } finally {
    await db.close();
  }
});

test("password sessions bind the exact account and rotate or revoke atomically", async () => {
  const db = await database();
  try {
    await db.exec(`
      insert into auth.users(id, email, email_confirmed_at)
      values ('${firstAccount}', 'shadow-one@invalid.kovagpt.com', '${now}'),
             ('${secondAccount}', 'shadow-two@invalid.kovagpt.com', '${now}');
    `);
    await createVerifiedPasswordAccount(db);
    await createVerifiedPasswordAccount(db, {
      accountId: secondAccount,
      email: "other@example.com",
      verificationDigest: digest("3"),
      sessionDigest: digest("4"),
    });
    const lookup = await db.query(`select * from public.kova_auth_password_lookup($1, $2)`, [
      "owner@example.com",
      now,
    ]);
    const credential = lookup.rows[0];
    const login = await db.query(
      `select * from public.kova_auth_create_session($1, $2, $3, $4, 'aal1', $5, $6)`,
      [
        credential.account_id,
        credential.credential_id,
        credential.credential_revision,
        digest("5"),
        sessionExpiry,
        now,
      ],
    );
    assert.equal(login.rows[0].account_id, firstAccount);
    const otherResolution = await db.query(
      `select account_id from public.kova_auth_resolve_session($1, $2)`,
      [digest("4"), now],
    );
    assert.deepEqual(otherResolution.rows, [{ account_id: secondAccount }]);

    await db.query(`select * from public.kova_auth_rotate_session($1, $2, $3, $4)`, [
      digest("5"),
      digest("6"),
      sessionExpiry,
      now,
    ]);
    assert.deepEqual(
      (await db.query(`select * from public.kova_auth_resolve_session($1, $2)`, [digest("5"), now]))
        .rows,
      [],
    );
    assert.equal(
      (
        await db.query(`select account_id from public.kova_auth_resolve_session($1, $2)`, [
          digest("6"),
          now,
        ])
      ).rows[0].account_id,
      firstAccount,
    );
    await db.query(`select public.kova_auth_revoke_session($1, $2)`, [digest("6"), now]);
    assert.deepEqual(
      (await db.query(`select * from public.kova_auth_resolve_session($1, $2)`, [digest("6"), now]))
        .rows,
      [],
    );
  } finally {
    await db.close();
  }
});

test("legacy recovery preserves the stable UUID and consumes the token after password disable", async () => {
  const db = await database();
  try {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)`, [
      firstAccount,
      "legacy@example.com",
      now,
    ]);
    const prepared = await db.query(
      `select public.kova_auth_create_recovery($1, $2, $3, $4::jsonb, $5) as queued`,
      [
        "legacy@example.com",
        digest("7"),
        verificationExpiry,
        JSON.stringify({ to: "legacy@example.com", token: "recovery-secret" }),
        now,
      ],
    );
    assert.equal(prepared.rows[0].queued, true);
    const target = await db.query(`select public.kova_auth_recovery_target($1, $2) as id`, [
      digest("7"),
      now,
    ]);
    assert.equal(target.rows[0].id, firstAccount);

    const recovered = await db.query(
      `select * from public.kova_auth_consume_recovery($1, $2, $3, $4, $5)`,
      [digest("7"), passwordHash, digest("8"), sessionExpiry, now],
    );
    assert.equal(recovered.rows[0].account_id, firstAccount);
    const account = await db.query(
      `select id, legacy_supabase_user_id from kova_private.auth_accounts`,
    );
    assert.deepEqual(account.rows, [{ id: firstAccount, legacy_supabase_user_id: firstAccount }]);
    const credential = await db.query(
      `select activated_at is not null as active, legacy_disabled_at is not null as legacy_disabled
         from kova_private.auth_credentials`,
    );
    assert.deepEqual(credential.rows, [{ active: true, legacy_disabled: true }]);
    await assert.rejects(() =>
      db.query(`select * from public.kova_auth_consume_recovery($1, $2, $3, $4, $5)`, [
        digest("7"),
        passwordHash,
        digest("9"),
        sessionExpiry,
        now,
      ]),
    );
  } finally {
    await db.close();
  }
});

test("legacy MFA accounts cannot silently downgrade to an aal1 Kova session", async () => {
  const db = await database();
  try {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)`, [
      firstAccount,
      "mfa-owner@example.com",
      now,
    ]);
    await db.query(
      `insert into auth.mfa_factors(id, user_id, status) values ($1, $2, 'verified')`,
      ["30000000-0000-4000-8000-000000000003", firstAccount],
    );
    await db.query(`select public.kova_auth_create_recovery($1, $2, $3, $4::jsonb, $5)`, [
      "mfa-owner@example.com",
      digest("d"),
      verificationExpiry,
      JSON.stringify({ to: "mfa-owner@example.com", token: "recovery-secret" }),
      now,
    ]);
    await assert.rejects(
      () =>
        db.query(`select * from public.kova_auth_consume_recovery($1, $2, $3, $4, $5)`, [
          digest("d"),
          passwordHash,
          digest("e"),
          sessionExpiry,
          now,
        ]),
      /kova_auth_mfa_migration_required/u,
    );
    const account = await db.query(
      `select mfa_required from kova_private.auth_accounts where id = $1`,
      [firstAccount],
    );
    assert.deepEqual(account.rows, [{ mfa_required: true }]);
  } finally {
    await db.close();
  }
});

test("Google OAuth state and cross-origin handoff are both single-use", async () => {
  const db = await database();
  try {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)`, [
      firstAccount,
      "google-shadow@invalid.kovagpt.com",
      now,
    ]);
    await db.query(`select public.kova_auth_create_oauth_state($1, $2, $3, $4, $5, $6)`, [
      digest("a"),
      digest("b"),
      "encrypted-pkce-verifier-ciphertext-value",
      "https://kovagpt.com/",
      verificationExpiry,
      now,
    ]);
    const state = await db.query(`select * from public.kova_auth_consume_oauth_state($1, $2)`, [
      digest("a"),
      now,
    ]);
    assert.equal(state.rows[0].nonce_digest_hex, digest("b"));
    await assert.rejects(() =>
      db.query(`select * from public.kova_auth_consume_oauth_state($1, $2)`, [digest("a"), now]),
    );

    const google = await db.query(
      `select * from public.kova_auth_finish_google($1, $2, $3, true, $4, $5, $6, $7)`,
      [
        firstAccount,
        "google-subject-1",
        "google@example.com",
        "Google User",
        digest("c"),
        verificationExpiry,
        now,
      ],
    );
    assert.deepEqual(google.rows, [{ account_id: firstAccount, candidate_used: true }]);
    const handoff = await db.query(
      `select * from public.kova_auth_consume_handoff($1, $2, $3, $4)`,
      [digest("c"), digest("d"), sessionExpiry, now],
    );
    assert.equal(handoff.rows[0].account_id, firstAccount);
    await assert.rejects(() =>
      db.query(`select * from public.kova_auth_consume_handoff($1, $2, $3, $4)`, [
        digest("c"),
        digest("e"),
        sessionExpiry,
        now,
      ]),
    );
  } finally {
    await db.close();
  }
});

test("a Google-created account can add a verified password without changing its UUID", async () => {
  const db = await database();
  try {
    await db.query(
      `insert into auth.users(id, email, email_confirmed_at)
       values ($1, $2, $3), ($4, $5, $3)`,
      [
        firstAccount,
        "google-shadow@invalid.kovagpt.com",
        now,
        secondAccount,
        "password-shadow@invalid.kovagpt.com",
      ],
    );
    await db.query(
      `select * from public.kova_auth_finish_google($1, $2, $3, true, $4, $5, $6, $7)`,
      [
        firstAccount,
        "google-subject-linking",
        "linked@example.com",
        "Linked Owner",
        digest("a"),
        verificationExpiry,
        now,
      ],
    );
    const signup = await db.query(
      `select * from public.kova_auth_create_password_account(
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8
      )`,
      [
        secondAccount,
        "linked@example.com",
        "Linked Owner",
        passwordHash,
        digest("f"),
        verificationExpiry,
        JSON.stringify({ to: "linked@example.com", token: "verification-secret" }),
        now,
      ],
    );
    assert.deepEqual(signup.rows, [
      { account_id: firstAccount, candidate_used: false, verification_created: true },
    ]);
    await db.query(`select * from public.kova_auth_consume_verification($1, $2, $3, $4)`, [
      digest("f"),
      digest("0"),
      sessionExpiry,
      now,
    ]);
    const identities = await db.query(
      `select provider, account_id from kova_private.auth_identities order by provider`,
    );
    assert.deepEqual(identities.rows, [
      { provider: "email", account_id: firstAccount },
      { provider: "google", account_id: firstAccount },
    ]);
  } finally {
    await db.close();
  }
});

test("deleting the compatibility principal cascades every Kova auth secret", async () => {
  const db = await database();
  try {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)`, [
      firstAccount,
      "shadow@invalid.kovagpt.com",
      now,
    ]);
    await createVerifiedPasswordAccount(db);
    await db.query(`delete from auth.users where id = $1`, [firstAccount]);
    for (const table of [
      "auth_accounts",
      "auth_identities",
      "auth_credentials",
      "auth_sessions",
      "auth_email_verifications",
    ]) {
      const result = await db.query(`select count(*)::int as count from kova_private.${table}`);
      assert.equal(result.rows[0].count, 0, table);
    }
    const retainedAudit = await db.query(`
      select count(*)::int as count, bool_and(account_id is null) as anonymized
      from kova_private.auth_audit_events
    `);
    assert.equal(retainedAudit.rows[0].count, 2);
    assert.equal(retainedAudit.rows[0].anonymized, true);
  } finally {
    await db.close();
  }
});
