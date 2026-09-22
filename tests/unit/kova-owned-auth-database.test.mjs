import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const foreignKeyIndexMigration = await readFile(
  new URL(
    "../../supabase/migrations/20260920232443_kova_auth_foreign_key_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);
const mfaLoginMigration = await readFile(
  new URL(
    "../../supabase/migrations/20260921002928_kova_owned_totp_login_challenges.sql",
    import.meta.url,
  ),
  "utf8",
);
const mfaLoginIndexMigration = await readFile(
  new URL(
    "../../supabase/migrations/20260921003901_kova_owned_totp_login_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);
const mfaEnrollmentMigration = await readFile(
  new URL(
    "../../supabase/migrations/20260921020250_kova_owned_mfa_enrollment.sql",
    import.meta.url,
  ),
  "utf8",
);
const mfaRecoveryLoginMigration = await readFile(
  new URL(
    "../../supabase/migrations/20260921023426_kova_owned_mfa_recovery_login.sql",
    import.meta.url,
  ),
  "utf8",
);
const mfaRecoveryControlsMigration = await readFile(
  new URL(
    "../../supabase/migrations/20260921160105_kova_owned_mfa_recovery_controls.sql",
    import.meta.url,
  ),
  "utf8",
);

async function database({ legacyRecoveryAbi = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role authenticator;
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
  await db.exec(foreignKeyIndexMigration);
  await db.exec(mfaLoginMigration);
  await db.exec(mfaLoginIndexMigration);
  await db.exec(mfaEnrollmentMigration);
  await db.exec(mfaRecoveryLoginMigration);
  if (legacyRecoveryAbi) {
    await db.exec(`
      create function public.kova_auth_regenerate_mfa_recovery_codes(text,text[],timestamptz default now())
      returns boolean language sql security definer set search_path = '' as $$ select true $$;
      revoke all on function public.kova_auth_regenerate_mfa_recovery_codes(text,text[],timestamptz) from public,anon,authenticated;
      grant execute on function public.kova_auth_regenerate_mfa_recovery_codes(text,text[],timestamptz) to service_role;
    `);
  }
  await db.exec(mfaRecoveryControlsMigration);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260921171133_kova_owned_auth_session_mutations.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../../supabase/migrations/20260921180400_kova_owned_passkeys.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260922001355_kova_owned_compatibility_revocation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}

const firstAccount = "10000000-0000-4000-8000-000000000001";
const secondAccount = "20000000-0000-4000-8000-000000000002";
const now = "2026-09-20T17:00:00Z";
const verificationExpiry = "2026-09-20T18:00:00Z";
const sessionExpiry = "2026-10-20T17:00:00Z";
const digest = (byte) => byte.repeat(64);
const passwordHash = `scrypt-v1$32768$8$1${"a".repeat(32)}${"b".repeat(64)}`;
const replacementPasswordHash = `scrypt-v1$32768$8$1${"c".repeat(32)}${"d".repeat(64)}`;
const namedDigest = (label) => createHash("sha256").update(label).digest("hex");
const replacementDigests = () =>
  Array.from({ length: 8 }, (_, i) => namedDigest(`replacement-${i}`));

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

async function ownedMfaFixture(db) {
  await db.query(
    `insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3), ($4, $5, $3)`,
    [firstAccount, "owner@example.com", now, secondAccount, "other@example.com"],
  );
  const current = await createVerifiedPasswordAccount(db);
  await createVerifiedPasswordAccount(db, {
    accountId: secondAccount,
    email: "other@example.com",
    verificationDigest: digest("3"),
    sessionDigest: digest("4"),
  });
  const started = await db.query(
    `select * from public.kova_auth_begin_totp_enrollment($1, $2, $3, $4)`,
    [digest("2"), "v1.encrypted.secret.envelope", "Primary authenticator", now],
  );
  const factorId = started.rows[0].factor_id;
  const oldDigests = Array.from({ length: 8 }, (_, i) => namedDigest(`initial-${i}`));
  await db.query(`select public.kova_auth_activate_totp($1, $2, $3, $4)`, [
    digest("2"),
    factorId,
    oldDigests,
    now,
  ]);
  const credential = (
    await db.query(`select id, revision from kova_private.auth_credentials where account_id = $1`, [
      firstAccount,
    ])
  ).rows[0];
  await db.query(`select * from public.kova_auth_create_session($1, $2, $3, $4, 'aal2', $5, $6)`, [
    firstAccount,
    credential.id,
    credential.revision,
    namedDigest("sibling-session"),
    sessionExpiry,
    now,
  ]);
  return { current, factorId, credential, oldDigests };
}

async function authSnapshot(db) {
  const [accounts, codes, sessions, audit] = await Promise.all([
    db.query(`select id, session_epoch from kova_private.auth_accounts order by id`),
    db.query(
      `select id, account_id, encode(code_digest,'hex') as digest, consumed_at from kova_private.auth_mfa_recovery_codes order by id`,
    ),
    db.query(
      `select id, account_id, encode(token_digest,'hex') as digest, assurance_level, session_epoch, revoked_at, rotated_from from kova_private.auth_sessions order by id`,
    ),
    db.query(
      `select id, account_id, session_id, event_type, metadata from kova_private.auth_audit_events order by id`,
    ),
  ]);
  return { accounts: accounts.rows, codes: codes.rows, sessions: sessions.rows, audit: audit.rows };
}

const regenerate = (db, changes = {}) =>
  db.query(`select * from public.kova_auth_regenerate_mfa_recovery_codes($1, $2, $3, $4, $5)`, [
    changes.sessionDigest ?? digest("2"),
    changes.codes === undefined ? replacementDigests() : changes.codes,
    changes.nextDigest ?? namedDigest("rotated-current"),
    changes.expiresAt === undefined ? sessionExpiry : changes.expiresAt,
    changes.now === undefined ? now : changes.now,
  ]);

async function beginRecoveryChallenge(
  db,
  credential,
  tokenDigest = namedDigest("login-challenge"),
) {
  await db.query(`select * from public.kova_auth_begin_mfa_login($1,$2,$3,$4,$5,$6)`, [
    firstAccount,
    credential.id,
    credential.revision,
    tokenDigest,
    "2026-09-20T17:05:00Z",
    now,
  ]);
  await db.query(`select * from public.kova_auth_read_mfa_login_challenge($1,$2)`, [
    tokenDigest,
    now,
  ]);
  return tokenDigest;
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
        "auth_mfa_login_challenges",
        "auth_mfa_recovery_codes",
        "auth_oauth_states",
        "auth_passkey_challenges",
        "auth_passkeys",
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
          'public.kova_auth_resolve_session(text,timestamptz)', 'execute') as service_resolve,
        has_function_privilege('anon',
          'public.kova_auth_finish_mfa_recovery_login(text,text,text,timestamptz,timestamptz)',
          'execute') as anon_recovery,
        has_function_privilege('authenticated',
          'public.kova_auth_finish_mfa_recovery_login(text,text,text,timestamptz,timestamptz)',
          'execute') as user_recovery,
        has_function_privilege('service_role',
          'public.kova_auth_finish_mfa_recovery_login(text,text,text,timestamptz,timestamptz)',
          'execute') as service_recovery
    `);
    assert.deepEqual(functionSecurity.rows, [
      {
        user_resolve: false,
        service_resolve: true,
        anon_recovery: false,
        user_recovery: false,
        service_recovery: true,
      },
    ]);
  } finally {
    await db.close();
  }
});

test("follow-up migration covers the staging advisor foreign-key findings", async () => {
  const db = await database();
  try {
    const indexes = await db.query(`
      select indexname
      from pg_indexes
      where schemaname = 'kova_private'
        and indexname in (
          'auth_email_verifications_identity_idx',
          'auth_mfa_recovery_codes_account_idx',
          'auth_session_handoffs_account_idx',
          'auth_audit_session_idx'
        )
      order by indexname
    `);
    assert.deepEqual(
      indexes.rows.map(({ indexname }) => indexname),
      [
        "auth_audit_session_idx",
        "auth_email_verifications_identity_idx",
        "auth_mfa_recovery_codes_account_idx",
        "auth_session_handoffs_account_idx",
      ],
    );
  } finally {
    await db.close();
  }
});

test("owned TOTP login challenges are short-lived, attempt-bounded, and create AAL2 sessions", async () => {
  const db = await database();
  try {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)`, [
      firstAccount,
      "owner@example.com",
      now,
    ]);
    await createVerifiedPasswordAccount(db);
    const credential = await db.query(
      `select id, revision from kova_private.auth_credentials where account_id = $1`,
      [firstAccount],
    );
    const indexes = await db.query(`
      select indexname from pg_indexes where schemaname = 'kova_private'
        and indexname in (
          'auth_mfa_login_challenges_credential_idx',
          'auth_mfa_login_challenges_factor_idx'
        ) order by indexname
    `);
    assert.deepEqual(
      indexes.rows.map(({ indexname }) => indexname),
      ["auth_mfa_login_challenges_credential_idx", "auth_mfa_login_challenges_factor_idx"],
    );
    const factorId = "30000000-0000-4000-8000-000000000003";
    await db.query(
      `insert into kova_private.auth_mfa_factors(
        id, account_id, factor_type, state, secret_ciphertext, verified_at
      ) values ($1, $2, 'totp', 'active', convert_to($3, 'utf8'), $4)`,
      [factorId, firstAccount, "v1.encrypted.secret.envelope", now],
    );
    await db.query(`update kova_private.auth_accounts set mfa_required = true where id = $1`, [
      firstAccount,
    ]);
    const challengeExpiry = "2026-09-20T17:05:00Z";
    const begun = await db.query(
      `select * from public.kova_auth_begin_mfa_login($1, $2, $3, $4, $5, $6)`,
      [
        firstAccount,
        credential.rows[0].id,
        credential.rows[0].revision,
        digest("3"),
        challengeExpiry,
        now,
      ],
    );
    assert.deepEqual(begun.rows, [
      { factor_id: factorId, secret_envelope: "v1.encrypted.secret.envelope" },
    ]);
    const readable = await db.query(
      `select * from public.kova_auth_read_mfa_login_challenge($1, $2)`,
      [digest("3"), now],
    );
    assert.equal(readable.rows[0].account_id, firstAccount);
    assert.equal(readable.rows[0].secret_envelope, "v1.encrypted.secret.envelope");
    const finished = await db.query(
      `select * from public.kova_auth_finish_mfa_login($1, $2, $3, $4)`,
      [digest("3"), digest("4"), sessionExpiry, now],
    );
    assert.equal(finished.rows[0].assurance_level, "aal2");
    const resolved = await db.query(`select * from public.kova_auth_resolve_session($1, $2)`, [
      digest("4"),
      now,
    ]);
    assert.equal(resolved.rows[0].assurance_level, "aal2");
    await assert.rejects(
      db.query(`select * from public.kova_auth_finish_mfa_login($1, $2, $3, $4)`, [
        digest("3"),
        digest("5"),
        sessionExpiry,
        now,
      ]),
      /kova_auth_invalid_mfa_challenge/u,
    );
  } finally {
    await db.close();
  }
});

test("owned recovery-code login is atomic, AAL2, and single-use", async () => {
  const db = await database();
  try {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)`, [
      firstAccount,
      "owner@example.com",
      now,
    ]);
    await createVerifiedPasswordAccount(db);
    const credential = await db.query(
      `select id, revision from kova_private.auth_credentials where account_id = $1`,
      [firstAccount],
    );
    const factorId = "30000000-0000-4000-8000-000000000003";
    await db.query(
      `insert into kova_private.auth_mfa_factors(
        id, account_id, factor_type, state, secret_ciphertext, verified_at
      ) values ($1, $2, 'totp', 'active', convert_to($3, 'utf8'), $4)`,
      [factorId, firstAccount, "v1.encrypted.secret.envelope", now],
    );
    await db.query(`update kova_private.auth_accounts set mfa_required = true where id = $1`, [
      firstAccount,
    ]);
    await db.query(
      `insert into kova_private.auth_mfa_recovery_codes(account_id, code_digest, created_at)
       values ($1, decode($2, 'hex'), $3)`,
      [firstAccount, digest("a"), now],
    );

    const challengeExpiry = "2026-09-20T17:05:00Z";
    await db.query(`select * from public.kova_auth_begin_mfa_login($1, $2, $3, $4, $5, $6)`, [
      firstAccount,
      credential.rows[0].id,
      credential.rows[0].revision,
      digest("9"),
      challengeExpiry,
      now,
    ]);
    await db.query(`select * from public.kova_auth_read_mfa_login_challenge($1, $2)`, [
      digest("9"),
      now,
    ]);

    await assert.rejects(
      db.query(`select * from public.kova_auth_finish_mfa_recovery_login($1, $2, $3, $4, $5)`, [
        digest("9"),
        digest("b"),
        digest("c"),
        sessionExpiry,
        now,
      ]),
      /kova_auth_invalid_recovery_code/u,
    );
    assert.equal(
      (
        await db.query(
          `select consumed_at from kova_private.auth_mfa_recovery_codes
            where account_id = $1 and code_digest = decode($2, 'hex')`,
          [firstAccount, digest("a")],
        )
      ).rows[0].consumed_at,
      null,
    );
    assert.equal(
      (
        await db.query(
          `select consumed_at from kova_private.auth_mfa_login_challenges
            where account_id = $1 and token_digest = decode($2, 'hex')`,
          [firstAccount, digest("9")],
        )
      ).rows[0].consumed_at,
      null,
    );

    const finished = await db.query(
      `select * from public.kova_auth_finish_mfa_recovery_login($1, $2, $3, $4, $5)`,
      [digest("9"), digest("a"), digest("c"), sessionExpiry, now],
    );
    assert.equal(finished.rows[0].assurance_level, "aal2");
    const resolved = await db.query(`select * from public.kova_auth_resolve_session($1, $2)`, [
      digest("c"),
      now,
    ]);
    assert.equal(resolved.rows[0].assurance_level, "aal2");
    assert.notEqual(
      (
        await db.query(
          `select consumed_at from kova_private.auth_mfa_recovery_codes
            where account_id = $1 and code_digest = decode($2, 'hex')`,
          [firstAccount, digest("a")],
        )
      ).rows[0].consumed_at,
      null,
    );
    assert.notEqual(
      (
        await db.query(
          `select consumed_at from kova_private.auth_mfa_login_challenges
            where account_id = $1 and token_digest = decode($2, 'hex')`,
          [firstAccount, digest("9")],
        )
      ).rows[0].consumed_at,
      null,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int as count from kova_private.auth_audit_events
            where account_id = $1 and event_type = 'mfa_recovery_login' and outcome = 'success'`,
          [firstAccount],
        )
      ).rows[0].count,
      1,
    );

    await assert.rejects(
      db.query(`select * from public.kova_auth_finish_mfa_recovery_login($1, $2, $3, $4, $5)`, [
        digest("9"),
        digest("a"),
        digest("d"),
        sessionExpiry,
        now,
      ]),
      /kova_auth_invalid_mfa_challenge/u,
    );

    await db.query(`select * from public.kova_auth_begin_mfa_login($1, $2, $3, $4, $5, $6)`, [
      firstAccount,
      credential.rows[0].id,
      credential.rows[0].revision,
      digest("e"),
      challengeExpiry,
      now,
    ]);
    await db.query(`select * from public.kova_auth_read_mfa_login_challenge($1, $2)`, [
      digest("e"),
      now,
    ]);
    await assert.rejects(
      db.query(`select * from public.kova_auth_finish_mfa_recovery_login($1, $2, $3, $4, $5)`, [
        digest("e"),
        digest("a"),
        digest("f"),
        sessionExpiry,
        now,
      ]),
      /kova_auth_invalid_recovery_code/u,
    );
  } finally {
    await db.close();
  }
});

test("owned TOTP enrollment activates MFA, stores eight digests, and revokes other sessions", async () => {
  const db = await database();
  try {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3)`, [
      firstAccount,
      "owner@example.com",
      now,
    ]);
    await createVerifiedPasswordAccount(db);
    const started = await db.query(
      `select * from public.kova_auth_begin_totp_enrollment($1, $2, $3, $4)`,
      [digest("2"), "v1.encrypted.secret.envelope", "Primary authenticator", now],
    );
    assert.equal(started.rows[0].email, "owner@example.com");
    const factorId = started.rows[0].factor_id;
    const pending = await db.query(
      `select * from public.kova_auth_read_totp_enrollment($1, $2, $3)`,
      [digest("2"), factorId, now],
    );
    assert.equal(pending.rows[0].secret_envelope, "v1.encrypted.secret.envelope");
    const recoveryDigests = ["a", "b", "c", "d", "e", "f", "7", "8"].map(digest);
    assert.equal(
      (
        await db.query(`select public.kova_auth_activate_totp($1, $2, $3, $4) as enabled`, [
          digest("2"),
          factorId,
          recoveryDigests,
          now,
        ])
      ).rows[0].enabled,
      true,
    );
    const factors = await db.query(`select * from public.kova_auth_list_totp_factors($1, $2)`, [
      digest("2"),
      now,
    ]);
    assert.equal(factors.rows[0].recovery_codes_remaining, 8);
    assert.equal(
      (
        await db.query(`select public.kova_auth_remove_totp_factor($1, $2, $3) as removed`, [
          digest("2"),
          factorId,
          now,
        ])
      ).rows[0].removed,
      true,
    );
    const account = await db.query(
      `select mfa_required from kova_private.auth_accounts where id = $1`,
      [firstAccount],
    );
    assert.equal(account.rows[0].mfa_required, false);
  } finally {
    await db.close();
  }
});

test("recovery migration retires the older staging ABI without leaving a non-rotating overload", async () => {
  const db = await database({ legacyRecoveryAbi: true });
  try {
    const rows = (
      await db.query(
        `select p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='kova_auth_regenerate_mfa_recovery_codes'`,
      )
    ).rows;
    assert.deepEqual(rows, [{ pronargs: 5 }]);
    await assert.rejects(
      db.query(`select public.kova_auth_regenerate_mfa_recovery_codes($1,$2,$3)`, [
        digest("2"),
        replacementDigests(),
        now,
      ]),
      /does not exist/u,
    );
  } finally {
    await db.close();
  }
});

test("recovery controls expose only service RPCs, with the private lock helper inaccessible", async () => {
  const db = await database();
  try {
    const rows = (
      await db.query(`
      select n.nspname as schema_name, p.proname as name, p.prosecdef as definer,
        p.proconfig,
        has_function_privilege('anon',p.oid,'execute') as anon_execute,
        has_function_privilege('authenticated',p.oid,'execute') as user_execute,
        has_function_privilege('service_role',p.oid,'execute') as service_execute,
        exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname in ('lock_auth_session','kova_auth_regenerate_mfa_recovery_codes','kova_auth_revoke_other_sessions')
      order by p.proname
    `)
    ).rows;
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.anon_execute, false);
      assert.equal(row.user_execute, false);
      assert.equal(row.public_execute, false);
      assert.ok(row.proconfig.includes('search_path=""'));
      const helper = row.name === "lock_auth_session";
      assert.equal(row.schema_name, helper ? "kova_private" : "public");
      assert.equal(row.definer, !helper);
      assert.equal(row.service_execute, !helper);
      if (!helper) assert.ok(row.proconfig.includes("statement_timeout=5s"));
    }
    await ownedMfaFixture(db);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(regenerate(db), /permission denied/u);
        await assert.rejects(
          db.query(`select public.kova_auth_revoke_other_sessions($1,$2)`, [digest("2"), now]),
          /permission denied/u,
        );
        await assert.rejects(
          db.query(`select * from kova_private.auth_mfa_recovery_codes`),
          /permission denied/u,
        );
      } finally {
        await db.exec("reset role");
      }
    }
    await db.exec("set role service_role");
    assert.equal((await regenerate(db)).rows[0].assurance_level, "aal2");
  } finally {
    await db.close();
  }
});

test("regeneration replaces eight digests, rotates the caller, retires other sessions, and cannot be replayed", async () => {
  const db = await database();
  try {
    const f = await ownedMfaFixture(db);
    const result = (await regenerate(db)).rows[0];
    assert.equal(result.account_id, firstAccount);
    assert.equal(result.assurance_level, "aal2");
    assert.equal(result.email_verified, true);
    assert.notEqual(result.session_id, f.current.session_id);
    const rows = (
      await db.query(
        `select encode(code_digest,'hex') as digest, consumed_at from kova_private.auth_mfa_recovery_codes where account_id=$1 order by digest`,
        [firstAccount],
      )
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.digest),
      replacementDigests().sort(),
    );
    assert.ok(rows.every((r) => r.consumed_at === null && !f.oldDigests.includes(r.digest)));
    for (const retired of [digest("2"), namedDigest("sibling-session")]) {
      assert.deepEqual(
        (await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [retired, now]))
          .rows,
        [],
      );
    }
    for (const [token, owner] of [
      [namedDigest("rotated-current"), firstAccount],
      [digest("4"), secondAccount],
    ]) {
      assert.equal(
        (await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [token, now]))
          .rows[0].account_id,
        owner,
      );
    }
    const successor = (
      await db.query(
        `select rotated_from, session_epoch from kova_private.auth_sessions where id=$1`,
        [result.session_id],
      )
    ).rows[0];
    assert.equal(successor.rotated_from, f.current.session_id);
    assert.equal(Number(successor.session_epoch), 1);
    const audit = (
      await db.query(
        `select session_id, metadata from kova_private.auth_audit_events where event_type='mfa_recovery_codes_regenerated'`,
      )
    ).rows;
    assert.deepEqual(audit, [{ session_id: result.session_id, metadata: { code_count: 8 } }]);
    const beforeReplay = await authSnapshot(db);
    await assert.rejects(regenerate(db), /kova_auth_invalid_session/u);
    await assert.rejects(
      regenerate(db, {
        sessionDigest: namedDigest("rotated-current"),
        nextDigest: namedDigest("another-session"),
      }),
      /kova_auth_invalid_recovery_codes/u,
    );
    assert.deepEqual(await authSnapshot(db), beforeReplay);
  } finally {
    await db.close();
  }
});

test("an active AAL2 device can replace exhausted or absent codes without disabling MFA", async (t) => {
  const db = await database();
  try {
    await ownedMfaFixture(db);
    for (const [name, sql] of [
      [
        "exhausted",
        "update kova_private.auth_mfa_recovery_codes set consumed_at=$1 where account_id=$2",
      ],
      [
        "absent",
        "delete from kova_private.auth_mfa_recovery_codes where created_at<=$1 and account_id=$2",
      ],
    ])
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          await db.query(sql, [now, firstAccount]);
          assert.equal((await regenerate(db)).rows[0].assurance_level, "aal2");
          assert.equal(
            (
              await db.query(
                `select count(*)::int as count from kova_private.auth_mfa_recovery_codes where account_id=$1 and consumed_at is null`,
                [firstAccount],
              )
            ).rows[0].count,
            8,
          );
          assert.equal(
            (
              await db.query(`select mfa_required from kova_private.auth_accounts where id=$1`, [
                firstAccount,
              ])
            ).rows[0].mfa_required,
            true,
          );
        } finally {
          await db.exec("rollback");
        }
      });
  } finally {
    await db.close();
  }
});

test("regeneration fails closed for invalid sessions, account state, factor state, and code sets", async (t) => {
  const db = await database();
  try {
    await ownedMfaFixture(db);
    const mutations = [
      [
        "aal1",
        "update kova_private.auth_sessions set assurance_level='aal1' where token_digest=decode($1,'hex')",
        [digest("2")],
      ],
      [
        "revoked",
        "update kova_private.auth_sessions set revoked_at=$1 where token_digest=decode($2,'hex')",
        [now, digest("2")],
      ],
      [
        "expired",
        "update kova_private.auth_sessions set expires_at=$1 where token_digest=decode($2,'hex')",
        ["2026-09-20T17:00:01Z", digest("2")],
        { now: "2026-09-20T17:00:01Z" },
      ],
      [
        "stale epoch",
        "update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1",
        [firstAccount],
      ],
      [
        "suspended",
        "update kova_private.auth_accounts set suspended_until=$1 where id=$2",
        [sessionExpiry, firstAccount],
      ],
      [
        "deleted",
        "update kova_private.auth_accounts set deleted_at=$1 where id=$2",
        [now, firstAccount],
      ],
      [
        "unverified",
        "update kova_private.auth_accounts set email_verified_at=null where id=$1",
        [firstAccount],
      ],
      [
        "MFA disabled",
        "update kova_private.auth_accounts set mfa_required=false where id=$1",
        [firstAccount],
      ],
      [
        "factor disabled",
        "update kova_private.auth_mfa_factors set state='disabled', disabled_at=$1 where account_id=$2",
        [now, firstAccount],
      ],
      [
        "factor pending",
        "update kova_private.auth_mfa_factors set state='pending', verified_at=null where account_id=$1",
        [firstAccount],
      ],
    ];
    for (const [name, sql, params, changes = {}] of mutations)
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          await db.query(sql, params);
          const before = await authSnapshot(db);
          await db.exec("savepoint attempt");
          await assert.rejects(regenerate(db, changes), /kova_auth_/u);
          await db.exec("rollback to savepoint attempt");
          assert.deepEqual(await authSnapshot(db), before);
        } finally {
          await db.exec("rollback");
        }
      });
    const invalidInputs = [
      ["unknown session", { sessionDigest: namedDigest("missing-session") }],
      ["another account's aal1 session", { sessionDigest: digest("4") }],
      ["same session token", { nextDigest: digest("2") }],
      ["malformed successor", { nextDigest: "invalid" }],
      ["null time", { now: null }],
      ["infinite time", { now: "infinity" }],
      ["null expiry", { expiresAt: null }],
      ["infinite expiry", { expiresAt: "infinity" }],
      ["expired successor", { expiresAt: now }],
      ["null codes", { codes: null }],
      ["empty codes", { codes: [] }],
      ["seven codes", { codes: replacementDigests().slice(1) }],
      ["nine codes", { codes: [...replacementDigests(), namedDigest("ninth")] }],
      ["duplicate codes", { codes: Array(8).fill(namedDigest("duplicate")) }],
      ["null member", { codes: [null, ...replacementDigests().slice(1)] }],
      ["malformed member", { codes: ["invalid", ...replacementDigests().slice(1)] }],
      [
        "uppercase member",
        { codes: [replacementDigests()[0].toUpperCase(), ...replacementDigests().slice(1)] },
      ],
      [
        "two dimensions",
        { codes: [replacementDigests().slice(0, 4), replacementDigests().slice(4)] },
      ],
      [
        "reuse an old code",
        { codes: [namedDigest("initial-0"), ...replacementDigests().slice(1)] },
      ],
    ];
    for (const [name, changes] of invalidInputs)
      await t.test(name, async () => {
        const before = await authSnapshot(db);
        await assert.rejects(regenerate(db, changes), /kova_auth_/u);
        assert.deepEqual(await authSnapshot(db), before);
      });
  } finally {
    await db.close();
  }
});

test("session-insert and audit failures roll back code replacement, revocations, and the epoch", async () => {
  const db = await database();
  try {
    await ownedMfaFixture(db);
    const before = await authSnapshot(db);
    await assert.rejects(regenerate(db, { nextDigest: digest("4") }), /duplicate key/u);
    assert.deepEqual(await authSnapshot(db), before);
    await db.exec(`
      create function public.test_recovery_audit_failure() returns trigger language plpgsql as $$
      begin
        if new.event_type in ('mfa_recovery_codes_regenerated','other_sessions_revoked') then
          raise exception 'test_audit_failure';
        end if;
        return new;
      end $$;
      create trigger test_recovery_audit_failure before insert on kova_private.auth_audit_events
      for each row execute function public.test_recovery_audit_failure();
    `);
    await assert.rejects(regenerate(db), /test_audit_failure/u);
    assert.deepEqual(await authSnapshot(db), before);
    await assert.rejects(
      db.query(`select public.kova_auth_revoke_other_sessions($1,$2)`, [digest("2"), now]),
      /test_audit_failure/u,
    );
    assert.deepEqual(await authSnapshot(db), before);
  } finally {
    await db.close();
  }
});

test("old recovery codes fail after regeneration while a new code still signs in once at AAL2", async () => {
  const db = await database();
  try {
    const f = await ownedMfaFixture(db);
    await regenerate(db);
    const challenge = await beginRecoveryChallenge(db, f.credential);
    const finish = (code, session) =>
      db.query(`select * from public.kova_auth_finish_mfa_recovery_login($1,$2,$3,$4,$5)`, [
        challenge,
        code,
        namedDigest(session),
        sessionExpiry,
        now,
      ]);
    await assert.rejects(
      finish(f.oldDigests[0], "rejected-session"),
      /kova_auth_invalid_recovery_code/u,
    );
    const principal = (await finish(replacementDigests()[0], "recovered-session")).rows[0];
    assert.equal(principal.account_id, firstAccount);
    assert.equal(principal.assurance_level, "aal2");
    assert.equal(
      (
        await db.query(
          `select count(*)::int as count from kova_private.auth_mfa_recovery_codes where account_id=$1 and consumed_at is null`,
          [firstAccount],
        )
      ).rows[0].count,
      7,
    );
    await assert.rejects(
      finish(replacementDigests()[1], "replayed-challenge"),
      /kova_auth_invalid_mfa_challenge/u,
    );
    const nextChallenge = await beginRecoveryChallenge(
      db,
      f.credential,
      namedDigest("fresh-challenge"),
    );
    await assert.rejects(
      db.query(`select * from public.kova_auth_finish_mfa_recovery_login($1,$2,$3,$4,$5)`, [
        nextChallenge,
        replacementDigests()[0],
        namedDigest("replayed-code"),
        sessionExpiry,
        now,
      ]),
      /kova_auth_invalid_recovery_code/u,
    );
  } finally {
    await db.close();
  }
});

test("recovery completion rechecks the factor and credential after the charged challenge read", async (t) => {
  const db = await database();
  try {
    const f = await ownedMfaFixture(db);
    const challenge = await beginRecoveryChallenge(db, f.credential);
    for (const [name, sql, params] of [
      [
        "factor disabled",
        "update kova_private.auth_mfa_factors set state='disabled', disabled_at=$1 where id=$2",
        [now, f.factorId],
      ],
      [
        "factor no longer verified",
        "update kova_private.auth_mfa_factors set verified_at=null where id=$1",
        [f.factorId],
      ],
      [
        "credential revision changed",
        "update kova_private.auth_credentials set revision=revision+1 where id=$1",
        [f.credential.id],
      ],
      [
        "credential disabled",
        "update kova_private.auth_credentials set disabled_at=$1 where id=$2",
        [now, f.credential.id],
      ],
    ])
      await t.test(name, async () => {
        await db.exec("begin");
        try {
          await db.query(sql, params);
          const before = await authSnapshot(db);
          await db.exec("savepoint attempt");
          await assert.rejects(
            db.query(`select * from public.kova_auth_finish_mfa_recovery_login($1,$2,$3,$4,$5)`, [
              challenge,
              f.oldDigests[0],
              namedDigest("denied-login"),
              sessionExpiry,
              now,
            ]),
            /kova_auth_/u,
          );
          await db.exec("rollback to savepoint attempt");
          assert.deepEqual(await authSnapshot(db), before);
          assert.equal(
            (
              await db.query(
                `select consumed_at from kova_private.auth_mfa_login_challenges where token_digest=decode($1,'hex')`,
                [challenge],
              )
            ).rows[0].consumed_at,
            null,
          );
        } finally {
          await db.exec("rollback");
        }
      });
  } finally {
    await db.close();
  }
});

test("owned sign-out preserves the caller, isolates accounts, and retires late old-epoch rotations", async () => {
  const db = await database();
  try {
    await ownedMfaFixture(db);
    assert.equal(
      (
        await db.query(`select public.kova_auth_revoke_other_sessions($1,$2) as count`, [
          digest("2"),
          now,
        ])
      ).rows[0].count,
      1,
    );
    assert.equal(
      (await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [digest("2"), now]))
        .rows[0].account_id,
      firstAccount,
    );
    assert.deepEqual(
      (
        await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [
          namedDigest("sibling-session"),
          now,
        ])
      ).rows,
      [],
    );
    assert.equal(
      (await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [digest("4"), now]))
        .rows[0].account_id,
      secondAccount,
    );
    // A concurrent rotate can insert after the revocation UPDATE snapshot;
    // its copied pre-revocation epoch must still make that token unusable.
    await db.query(
      `insert into kova_private.auth_sessions(account_id,token_digest,assurance_level,session_epoch,expires_at,created_at,last_seen_at)
      values ($1,decode($2,'hex'),'aal2',0,$3,$4,$4)`,
      [firstAccount, namedDigest("late-rotation"), sessionExpiry, now],
    );
    assert.deepEqual(
      (
        await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [
          namedDigest("late-rotation"),
          now,
        ])
      ).rows,
      [],
    );
    assert.equal(
      (
        await db.query(`select public.kova_auth_revoke_other_sessions($1,$2) as count`, [
          digest("2"),
          now,
        ])
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query(`select public.kova_auth_revoke_other_sessions($1,$2) as count`, [
          digest("2"),
          now,
        ])
      ).rows[0].count,
      0,
    );
    // AAL1 is sufficient only for an account that does not require MFA.
    assert.equal(
      (
        await db.query(`select public.kova_auth_revoke_other_sessions($1,$2) as count`, [
          digest("4"),
          now,
        ])
      ).rows[0].count,
      0,
    );
    assert.equal(
      (await db.query(`select * from public.kova_auth_resolve_session($1,$2)`, [digest("2"), now]))
        .rows[0].account_id,
      firstAccount,
    );
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
    const directory = await db.query(
      `select kova_private.verified_auth_user_for_email($1) as account_id,
              public.kova_auth_directory_email($2) as email`,
      ["OWNER@EXAMPLE.COM", firstAccount],
    );
    assert.deepEqual(directory.rows, [{ account_id: firstAccount, email: "owner@example.com" }]);
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

test("a repeated pending signup cannot replace the first password or verification", async () => {
  const db = await database();
  try {
    await db.query(
      `insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3), ($4, $5, $3)`,
      [
        firstAccount,
        "first-shadow@invalid.kovagpt.com",
        now,
        secondAccount,
        "second-shadow@invalid.kovagpt.com",
      ],
    );
    const create = (candidate, password, verification, token) =>
      db.query(
        `select * from public.kova_auth_create_password_account(
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8
        )`,
        [
          candidate,
          "owner@example.com",
          "Owner",
          password,
          verification,
          verificationExpiry,
          JSON.stringify({ to: "owner@example.com", token }),
          now,
        ],
      );

    assert.deepEqual((await create(firstAccount, passwordHash, digest("1"), "first-token")).rows, [
      { account_id: firstAccount, candidate_used: true, verification_created: true },
    ]);
    assert.deepEqual(
      (await create(secondAccount, replacementPasswordHash, digest("3"), "replacement-token")).rows,
      [{ account_id: firstAccount, candidate_used: false, verification_created: false }],
    );

    const credential = await db.query(
      `select secret_hash, revision, activated_at from kova_private.auth_credentials
       where account_id = $1 and credential_type = 'password' and disabled_at is null`,
      [firstAccount],
    );
    assert.equal(credential.rows[0].secret_hash, passwordHash);
    assert.equal(credential.rows[0].revision, 1);
    assert.equal(credential.rows[0].activated_at, null);

    const verification = await db.query(
      `select encode(token_digest,'hex') as digest, consumed_at
         from kova_private.auth_email_verifications where account_id = $1`,
      [firstAccount],
    );
    assert.deepEqual(verification.rows, [{ digest: digest("1"), consumed_at: null }]);
    const queue = await db.query(`select payload from public.test_email_queue order by id`);
    assert.equal(queue.rows.length, 1);
    assert.equal(queue.rows[0].payload.token, "first-token");

    await db.query(`select * from public.kova_auth_consume_verification($1,$2,$3,$4)`, [
      digest("1"),
      digest("2"),
      sessionExpiry,
      now,
    ]);
    assert.equal(
      (
        await db.query(
          `select secret_hash from kova_private.auth_credentials
           where account_id = $1 and credential_type = 'password' and disabled_at is null`,
          [firstAccount],
        )
      ).rows[0].secret_hash,
      passwordHash,
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

test("Google-only accounts continue through owned TOTP and recovery MFA", async () => {
  const db = await database();
  try {
    await db.query(
      `insert into auth.users(id, email, email_confirmed_at) values ($1, $2, $3), ($4, $5, $3)`,
      [
        firstAccount,
        "google-shadow@invalid.kovagpt.com",
        now,
        secondAccount,
        "unused-candidate@invalid.kovagpt.com",
      ],
    );
    await db.query(
      `select * from public.kova_auth_finish_google($1,$2,$3,true,$4,$5,$6,$7)`,
      [
        firstAccount,
        "google-mfa-subject",
        "google-mfa@example.com",
        "Google MFA",
        digest("a"),
        verificationExpiry,
        now,
      ],
    );
    await db.query(`select * from public.kova_auth_consume_handoff($1,$2,$3,$4)`, [
      digest("a"),
      digest("b"),
      sessionExpiry,
      now,
    ]);
    const enrolled = await db.query(
      `select * from public.kova_auth_begin_totp_enrollment($1,$2,$3,$4)`,
      [digest("b"), "v1.google.mfa.secret.envelope", "Google authenticator", now],
    );
    const factorId = enrolled.rows[0].factor_id;
    const recoveryDigests = Array.from({ length: 8 }, (_, i) =>
      namedDigest(`google-recovery-${i}`),
    );
    await db.query(`select public.kova_auth_activate_totp($1,$2,$3,$4)`, [
      digest("b"),
      factorId,
      recoveryDigests,
      now,
    ]);

    const beginGoogleChallenge = async (handoffDigest, challengeDigest, unusedSessionDigest) => {
      await db.query(
        `select * from public.kova_auth_finish_google($1,$2,$3,true,$4,$5,$6,$7)`,
        [
          secondAccount,
          "google-mfa-subject",
          "google-mfa@example.com",
          "Google MFA",
          handoffDigest,
          verificationExpiry,
          now,
        ],
      );
      const exchange = await db.query(
        `select * from public.kova_auth_consume_handoff_with_mfa($1,$2,$3,$4,$5,$6)`,
        [
          handoffDigest,
          unusedSessionDigest,
          sessionExpiry,
          challengeDigest,
          "2026-09-20T17:05:00Z",
          now,
        ],
      );
      assert.equal(exchange.rows[0].mfa_required, true);
      assert.equal(exchange.rows[0].account_id, firstAccount);
      assert.equal(exchange.rows[0].session_id, null);
      assert.equal(exchange.rows[0].email, "google-mfa@example.com");
      const challenge = await db.query(
        `select credential_id, credential_revision, challenge_source
           from kova_private.auth_mfa_login_challenges
          where token_digest = decode($1, 'hex') and consumed_at is null`,
        [challengeDigest],
      );
      assert.deepEqual(challenge.rows, [
        { credential_id: null, credential_revision: null, challenge_source: "google" },
      ]);
      await db.query(`select * from public.kova_auth_read_mfa_login_challenge($1,$2)`, [
        challengeDigest,
        now,
      ]);
    };

    await beginGoogleChallenge(digest("c"), namedDigest("google-totp-challenge"), digest("d"));
    const totp = await db.query(
      `select * from public.kova_auth_finish_mfa_login($1,$2,$3,$4)`,
      [namedDigest("google-totp-challenge"), namedDigest("google-totp-session"), sessionExpiry, now],
    );
    assert.equal(totp.rows[0].account_id, firstAccount);
    assert.equal(totp.rows[0].assurance_level, "aal2");

    await beginGoogleChallenge(digest("e"), namedDigest("google-recovery-challenge"), digest("f"));
    const recovery = await db.query(
      `select * from public.kova_auth_finish_mfa_recovery_login($1,$2,$3,$4,$5)`,
      [
        namedDigest("google-recovery-challenge"),
        recoveryDigests[0],
        namedDigest("google-recovery-session"),
        sessionExpiry,
        now,
      ],
    );
    assert.equal(recovery.rows[0].account_id, firstAccount);
    assert.equal(recovery.rows[0].assurance_level, "aal2");
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
