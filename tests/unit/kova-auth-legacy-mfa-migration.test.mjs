import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  authDatabase,
  codeDigests,
  digest,
  now,
  expiry,
  owner,
  other,
  passwordAccount,
} from "../helpers/kova-auth-database.mjs";

const stagedHash = `scrypt-v1$32768$8$1$${"s".repeat(22)}$${"t".repeat(43)}`;
const envelope = "v1.test-only.fresh-kova-totp.envelope";

async function installLegacyMfa(db, id = owner) {
  await db.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [
    randomUUID(),
    id,
  ]);
  await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [randomUUID(), id]);
}

const gapCount = async (db) =>
  (await db.query("select public.kova_auth_legacy_mfa_gap_count($1) as n", [now])).rows[0].n;
const adoptionGapCount = async (db, rpId = "kova.test") =>
  (await db.query("select public.kova_auth_legacy_adoption_gap_count($1,$2) as n", [rpId, now]))
    .rows[0].n;

test("a suspended legacy-MFA account still blocks the cutover census", async () => {
  const db = await authDatabase();
  try {
    await passwordAccount(db);
    await installLegacyMfa(db);
    await db.query("update kova_private.auth_accounts set suspended_until=$2 where id=$1", [
      owner,
      expiry,
    ]);
    assert.equal(await gapCount(db), 1);
    assert.equal(await adoptionGapCount(db), 1); // The hosted session has not been retired.
    await db.query("update kova_private.auth_accounts set suspended_until=null where id=$1", [
      owner,
    ]);
    assert.equal(await gapCount(db), 1);
  } finally {
    await db.close();
  }
});

test("an owned MFA requirement without an active factor blocks cutover after hosted MFA removal", async () => {
  const db = await authDatabase();
  try {
    await passwordAccount(db);
    assert.equal(await gapCount(db), 0);
    await db.query(
      "update kova_private.auth_accounts set mfa_required=true, suspended_until=$2 where id=$1",
      [owner, expiry],
    );
    assert.equal(await gapCount(db), 1);
    await installLegacyMfa(db);
    assert.equal(await gapCount(db), 1);
    await db.query("delete from auth.mfa_factors where user_id=$1", [owner]);
    assert.equal(await gapCount(db), 1);
    await db.query("update kova_private.auth_accounts set suspended_until=null where id=$1", [
      owner,
    ]);
    await db.query("update kova_private.auth_accounts set mfa_required=false where id=$1", [owner]);
    assert.equal(await gapCount(db), 0);
  } finally {
    await db.close();
  }
});

test("cutover census includes untouched hosted users and accounts without a usable owned credential", async () => {
  const db = await authDatabase();
  try {
    assert.equal(await adoptionGapCount(db), 0);
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,$3,'legacy-hash')",
      [owner, `${owner}@example.invalid`, now],
    );
    await installLegacyMfa(db);
    assert.equal(await gapCount(db), 0); // A separate census must catch unmapped MFA users.
    assert.equal(await adoptionGapCount(db), 1);
    await db.query(
      `insert into kova_private.auth_accounts(id,legacy_supabase_user_id,primary_email,email_verified_at)
       values($1,$1,$2,$3)`,
      [owner, `${owner}@example.invalid`, now],
    );
    assert.equal(await gapCount(db), 1);
    assert.equal(await adoptionGapCount(db), 1);
    await db.query(
      `insert into kova_private.auth_credentials(account_id,credential_type,secret_hash,algorithm)
       values($1,'password',$2,'scrypt-v1')`,
      [owner, stagedHash],
    );
    assert.equal(await adoptionGapCount(db), 1);
    await db.query("update kova_private.auth_credentials set activated_at=$2 where account_id=$1", [
      owner,
      now,
    ]);
    await db.query(
      "update kova_private.auth_legacy_retirements set retired_at=$2 where account_id=$1",
      [owner, now],
    );
    assert.equal(await adoptionGapCount(db), 0);
    assert.equal(await gapCount(db), 1);

    // An unadopted, suspended hosted user must also remain in the census.
    await db.query(
      `insert into auth.users(id,email,email_confirmed_at,banned_until)
       values($1,$2,$3,$4)`,
      [other, `${other}@example.invalid`, now, expiry],
    );
    assert.equal(await adoptionGapCount(db), 1);
    await db.query("update auth.users set deleted_at=$2 where id=$1", [other, now]);
    assert.equal(await adoptionGapCount(db), 0);

    // Kova's full inert shadow shape is excluded, but a malformed shadow is not.
    const shadow = (
      await db.query("select public.kova_auth_create_compatibility_principal() as id")
    ).rows[0].id;
    assert.equal(await adoptionGapCount(db), 0);
    await db.query("update auth.users set banned_until=null where id=$1", [shadow]);
    assert.equal(await adoptionGapCount(db), 1);
  } finally {
    await db.close();
  }
});

test("cutover census accepts a verified owned Google credential for an adopted hosted identity", async () => {
  const db = await authDatabase();
  try {
    const email = `${owner}@example.invalid`;
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
      owner,
      email,
      now,
    ]);
    await db.query(
      `insert into kova_private.auth_accounts(id,legacy_supabase_user_id,primary_email,email_verified_at)
       values($1,$1,$2,$3)`,
      [owner, email, now],
    );
    assert.equal(await adoptionGapCount(db), 1);
    await db.query(
      `insert into kova_private.auth_identities(account_id,provider,provider_subject,normalized_email,verified_at)
       values($1,'google','provider-subject',$2,$3)`,
      [owner, email, now],
    );
    assert.equal(await adoptionGapCount(db), 1); // Adoption alone does not retire hosted access.
    await db.query(
      "insert into kova_private.auth_legacy_retirements(account_id,retired_at) values($1,$2)",
      [owner, now],
    );
    assert.equal(await adoptionGapCount(db), 0);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [randomUUID(), owner]);
    assert.equal(await adoptionGapCount(db), 1);
    await db.query("delete from auth.sessions where user_id=$1", [owner]);
    assert.equal(await adoptionGapCount(db), 0);
  } finally {
    await db.close();
  }
});

test("passkey-only adoption needs a key for the audited RP and retired hosted issuance", async () => {
  const db = await authDatabase();
  try {
    const email = `${owner}@example.invalid`;
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)", [
      owner,
      email,
      now,
    ]);
    await db.query(
      `insert into kova_private.auth_accounts(id,legacy_supabase_user_id,primary_email,email_verified_at)
       values($1,$1,$2,$3)`,
      [owner, email, now],
    );
    await db.query(
      `insert into kova_private.auth_passkeys(
        account_id,rp_id,credential_id,public_key,user_handle,sign_count,
        backup_eligible,backed_up,friendly_name,created_at
      ) values($1,'old.kova.test','old-credential',decode(repeat('ab',16),'hex'),
        'owner-handle',0,false,false,'Old domain',$2)`,
      [owner, now],
    );
    await db.query(
      "insert into kova_private.auth_legacy_retirements(account_id,retired_at) values($1,$2)",
      [owner, now],
    );
    assert.equal(await adoptionGapCount(db), 1);
    assert.equal(await adoptionGapCount(db, "old.kova.test"), 0);
    await db.query(
      `insert into kova_private.auth_passkeys(
        account_id,rp_id,credential_id,public_key,user_handle,sign_count,
        backup_eligible,backed_up,friendly_name,created_at
      ) values($1,'kova.test','current-credential',decode(repeat('ab',16),'hex'),
        'owner-handle',0,false,false,'Current domain',$2)`,
      [owner, now],
    );
    assert.equal(await adoptionGapCount(db), 0);
    await db.query("update auth.users set encrypted_password='legacy-hash' where id=$1", [owner]);
    assert.equal(await adoptionGapCount(db), 1);
    await db.query("update auth.users set encrypted_password=null where id=$1", [owner]);
    assert.equal(await adoptionGapCount(db), 0);
    await assert.rejects(
      db.query("select public.kova_auth_legacy_adoption_gap_count($1,$2)", [
        "wrong.example:443",
        now,
      ]),
      /kova_auth_invalid_cutover_configuration/u,
    );
    assert.equal(
      (
        await db.query(
          "select to_regprocedure('public.kova_auth_legacy_adoption_gap_count(timestamptz)') is null as dropped",
        )
      ).rows[0].dropped,
      true,
    );
  } finally {
    await db.close();
  }
});

test("hosted MFA migrates to a fresh owned factor before hosted authority is retired", async () => {
  const db = await authDatabase();
  try {
    await passwordAccount(db);
    // Model an adopted account whose hosted authority still exists from before
    // retirement enforcement was added.
    await db.query("delete from kova_private.auth_legacy_retirements where account_id=$1", [owner]);
    await db.query("update auth.users set encrypted_password='legacy-hash' where id=$1", [owner]);
    await installLegacyMfa(db);

    assert.equal(await gapCount(db), 1);
    const status = (
      await db.query("select * from public.kova_auth_legacy_mfa_migration_status($1,$2)", [
        owner,
        now,
      ])
    ).rows[0];
    assert.equal(status.primary_ready, true);
    assert.equal(status.legacy_mfa, true);

    const started = (
      await db.query("select * from public.kova_auth_begin_legacy_mfa_migration($1,$2,$3,$4,$5)", [
        owner,
        envelope,
        "Migrated authenticator",
        null,
        now,
      ])
    ).rows[0];
    assert.equal(started.email, `${owner}@example.invalid`);

    const secret = (
      await db.query("select * from public.kova_auth_read_legacy_mfa_migration($1,$2,$3)", [
        owner,
        started.factor_id,
        now,
      ])
    ).rows[0];
    assert.equal(secret.secret_envelope, envelope);

    const migrated = (
      await db.query(
        "select * from public.kova_auth_activate_legacy_mfa_migration($1,$2,$3,$4,$5,$6)",
        [
          owner,
          started.factor_id,
          codeDigests("legacy-migrated"),
          digest("legacy-migrated-session"),
          expiry,
          now,
        ],
      )
    ).rows[0];
    assert.equal(migrated.account_id, owner);
    assert.equal(migrated.assurance_level, "aal2");
    assert.equal(await gapCount(db), 0);
    assert.equal(
      (await db.query("select count(*)::int n from auth.sessions where user_id=$1", [owner]))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.auth_legacy_retirements where account_id=$1",
          [owner],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from kova_private.auth_mfa_recovery_codes where account_id=$1 and consumed_at is null",
          [owner],
        )
      ).rows[0].n,
      8,
    );
    assert.equal(
      (
        await db.query("select state from kova_private.auth_mfa_factors where id=$1", [
          started.factor_id,
        ])
      ).rows[0].state,
      "active",
    );
    assert.equal(
      (await db.query("select public.kova_auth_legacy_session_allowed($1) as ok", [owner])).rows[0]
        .ok,
      false,
    );
  } finally {
    await db.close();
  }
});

test("legacy password-only MFA stages a new Kova password until the fresh factor succeeds", async () => {
  const db = await authDatabase();
  try {
    const email = "legacy-password@example.invalid";
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,$3,'legacy-hash')",
      [owner, email, now],
    );
    await db.query(
      `insert into kova_private.auth_accounts(
        id,legacy_supabase_user_id,primary_email,email_verified_at,mfa_required,created_at,updated_at
      ) values($1,$1,$2,$3,true,$3,$3)`,
      [owner, email, now],
    );
    await db.query(
      `insert into kova_private.auth_identities(
        account_id,provider,provider_subject,normalized_email,verified_at,created_at,updated_at
      ) values($1,'email',$2,$2,$3,$3,$3)`,
      [owner, email, now],
    );
    await installLegacyMfa(db);

    const status = (
      await db.query("select * from public.kova_auth_legacy_mfa_migration_status($1,$2)", [
        owner,
        now,
      ])
    ).rows[0];
    assert.equal(status.primary_ready, false);
    await assert.rejects(
      db.query("select * from public.kova_auth_begin_legacy_mfa_migration($1,$2,$3,$4,$5)", [
        owner,
        envelope,
        "Migrated authenticator",
        null,
        now,
      ]),
      /kova_auth_primary_migration_required/u,
    );

    const started = (
      await db.query("select * from public.kova_auth_begin_legacy_mfa_migration($1,$2,$3,$4,$5)", [
        owner,
        envelope,
        "Migrated authenticator",
        stagedHash,
        now,
      ])
    ).rows[0];
    await db.query("select * from public.kova_auth_read_legacy_mfa_migration($1,$2,$3)", [
      owner,
      started.factor_id,
      now,
    ]);
    const migrated = (
      await db.query(
        "select * from public.kova_auth_activate_legacy_mfa_migration($1,$2,$3,$4,$5,$6)",
        [
          owner,
          started.factor_id,
          codeDigests("legacy-password"),
          digest("owned-after-legacy"),
          expiry,
          now,
        ],
      )
    ).rows[0];
    assert.equal(migrated.assurance_level, "aal2");
    const credential = (
      await db.query(
        "select secret_hash,activated_at,disabled_at from kova_private.auth_credentials where account_id=$1 and disabled_at is null",
        [owner],
      )
    ).rows[0];
    assert.equal(credential.secret_hash, stagedHash);
    assert.ok(credential.activated_at);
    assert.equal(
      (await db.query("select encrypted_password from auth.users where id=$1", [owner])).rows[0]
        .encrypted_password,
      null,
    );
    assert.equal(await gapCount(db), 0);
  } finally {
    await db.close();
  }
});

test("legacy MFA migration RPCs remain service-role only", async () => {
  const db = await authDatabase();
  try {
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select * from public.kova_auth_legacy_mfa_migration_status($1,$2)", [owner, now]),
      /permission denied/u,
    );
    await assert.rejects(
      db.query("select public.kova_auth_legacy_adoption_gap_count($1,$2)", ["kova.test", now]),
      /permission denied/u,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
