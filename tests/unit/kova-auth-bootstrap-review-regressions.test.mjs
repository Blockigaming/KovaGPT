import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// These are PostgreSQL-backed behavioral tests, not SQL-string assertions.
// This fixture intentionally covers the bootstrap migration, including its
// conditional dynamic project-invitation definitions. The existing complete
// ordered-migration suite must ALSO run; this does not replace that suite.
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20260920170657_kova_identity_session_store.sql",
    import.meta.url,
  ),
  "utf8",
);

async function database(withProjectBridge = false) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users (
        id uuid primary key, email text, email_confirmed_at timestamptz,
        deleted_at timestamptz, created_at timestamptz default now()
      );
      create table auth.mfa_factors (
        id uuid primary key, user_id uuid not null, status text not null
      );
      create table public.test_email_queue (
        id bigint generated always as identity primary key,
        queue_name text not null, payload jsonb not null
      );
      create function public.enqueue_email(queue_name text, payload jsonb)
      returns bigint language sql as $$
        insert into public.test_email_queue(queue_name, payload)
        values (queue_name, payload) returning id
      $$;
    `);
    if (withProjectBridge) {
      await db.exec(`
        create schema kova_private;
        create type public.project_role as enum ('owner', 'editor', 'viewer');
        create table public.project_invites (
          id uuid primary key, project_id uuid not null, email text not null,
          role public.project_role not null, status text not null,
          accepted_at timestamptz
        );
        create table public.project_members (
          project_id uuid not null, user_id uuid not null,
          role public.project_role not null, primary key(project_id, user_id)
        );
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('test.auth.uid', true), '')::uuid
        $$;
        create function kova_private.accept_project_invite(_invite_id uuid)
        returns uuid language sql as $$ select null::uuid $$;
        create function kova_private.decline_project_invite(_invite_id uuid)
        returns boolean language sql as $$ select false $$;
      `);
    }
    await db.exec(migration);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

const account = "10000000-0000-4000-8000-000000000001";
const candidate = "20000000-0000-4000-8000-000000000002";
const now = "2026-09-22T17:00:00Z";
const expiry = "2026-09-22T18:00:00Z";
const sessionExpiry = "2026-10-22T17:00:00Z";
const email = "owner@example.test";
const digest = (character) => character.repeat(64);
const originalPassword = `scrypt-v1$32768$8$1${"a".repeat(32)}${"b".repeat(64)}`;
const otherPassword = `scrypt-v1$32768$8$1${"c".repeat(32)}${"d".repeat(64)}`;

async function signup(db, candidateId, password, verificationDigest) {
  return db.query(
    `select * from public.kova_auth_create_password_account($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      candidateId,
      email,
      "Owner",
      password,
      verificationDigest,
      expiry,
      JSON.stringify({ to: email, template: "verify", token: "test-only" }),
      now,
    ],
  );
}

async function insertCompatibilityCandidates(db) {
  await db.query(`insert into auth.users(id,email) values ($1,$2),($3,$4)`, [
    account,
    "shadow-a@example.invalid",
    candidate,
    "shadow-b@example.invalid",
  ]);
}

for (const withProjectBridge of [false, true]) {
  test(`bootstrap installs valid function bodies with project bridge ${withProjectBridge}`, async () => {
    const db = await database(withProjectBridge);
    try {
      const result = await db.query(`select
        to_regprocedure('kova_private.verified_auth_user_for_email(text)') is not null as lookup_present,
        to_regprocedure('public.kova_auth_directory_email(uuid)') is not null as directory_present,
        has_function_privilege('anon','public.kova_auth_directory_email(uuid)','EXECUTE') as anon_access,
        has_function_privilege('authenticated','public.kova_auth_directory_email(uuid)','EXECUTE') as browser_access,
        has_function_privilege('service_role','public.kova_auth_directory_email(uuid)','EXECUTE') as server_access
      `);
      assert.deepEqual(result.rows[0], {
        lookup_present: true,
        directory_present: true,
        anon_access: false,
        browser_access: false,
        server_access: true,
      });
    } finally {
      await db.close();
    }
  });
}

test("repeat pending signup preserves the original credential and verification without audit failure", async () => {
  const db = await database();
  try {
    await insertCompatibilityCandidates(db);
    const first = await signup(db, account, originalPassword, digest("1"));
    assert.equal(first.rows[0].verification_created, true);
    const before = await db.query(
      `select id, secret_hash, revision, activated_at, disabled_at
      from kova_private.auth_credentials where account_id=$1`,
      [account],
    );
    const repeat = await signup(db, candidate, otherPassword, digest("2"));
    assert.equal(repeat.rows[0].account_id, account);
    assert.equal(repeat.rows[0].candidate_used, false);
    assert.equal(repeat.rows[0].verification_created, false);
    const after = await db.query(
      `select id, secret_hash, revision, activated_at, disabled_at
      from kova_private.auth_credentials where account_id=$1`,
      [account],
    );
    assert.deepEqual(after.rows, before.rows);
    const verifications = await db.query(
      `select encode(token_digest,'hex') as digest, consumed_at
      from kova_private.auth_email_verifications where account_id=$1`,
      [account],
    );
    assert.deepEqual(verifications.rows, [{ digest: digest("1"), consumed_at: null }]);
    const queue = await db.query("select count(*)::int as count from public.test_email_queue");
    assert.equal(queue.rows[0].count, 1);
    const audit = await db.query(
      `select outcome from kova_private.auth_audit_events
      where account_id=$1 and event_type='signup_pending_account'`,
      [account],
    );
    assert.deepEqual(audit.rows, [{ outcome: "rejected" }]);
    await db.query(`select * from public.kova_auth_consume_verification($1,$2,$3,$4)`, [
      digest("1"),
      digest("3"),
      sessionExpiry,
      now,
    ]);
    const activated = await db.query(
      `select secret_hash, activated_at is not null as active
      from kova_private.auth_credentials where account_id=$1 and disabled_at is null`,
      [account],
    );
    assert.deepEqual(activated.rows, [{ secret_hash: originalPassword, active: true }]);
  } finally {
    await db.close();
  }
});

test("the dynamically replaced project invite bodies execute, not only parse", async () => {
  const db = await database(true);
  try {
    await insertCompatibilityCandidates(db);
    await signup(db, account, originalPassword, digest("1"));
    await db.query(`select * from public.kova_auth_consume_verification($1,$2,$3,$4)`, [
      digest("1"),
      digest("3"),
      sessionExpiry,
      now,
    ]);
    await db.query("select set_config('test.auth.uid',$1,false)", [account]);
    const project = "30000000-0000-4000-8000-000000000003";
    const acceptedInvite = "40000000-0000-4000-8000-000000000004";
    const declinedInvite = "50000000-0000-4000-8000-000000000005";
    await db.query(
      `insert into public.project_invites(id,project_id,email,role,status)
      values ($1,$3,$4,'viewer','pending'),($2,$3,$4,'viewer','pending')`,
      [acceptedInvite, declinedInvite, project, email],
    );
    const accepted = await db.query("select kova_private.accept_project_invite($1) as project", [
      acceptedInvite,
    ]);
    assert.equal(accepted.rows[0].project, project);
    const declined = await db.query("select kova_private.decline_project_invite($1) as declined", [
      declinedInvite,
    ]);
    assert.equal(declined.rows[0].declined, true);
    const statuses = await db.query("select status from public.project_invites order by id");
    assert.deepEqual(statuses.rows, [{ status: "accepted" }, { status: "revoked" }]);
    const member = await db.query(
      "select user_id from public.project_members where project_id=$1",
      [project],
    );
    assert.deepEqual(member.rows, [{ user_id: account }]);
  } finally {
    await db.close();
  }
});
