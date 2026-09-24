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
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
