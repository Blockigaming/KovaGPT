import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111";
const migration = await readFile(
  "supabase/migrations/20260905030947_irreversible_account_deletion.sql",
  "utf8",
);
async function fixture(preexisting = false) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema kova_private;grant usage on schema auth,kova_private to service_role;
 create table auth.users(id uuid primary key,deleted_at timestamptz,email text,email_confirmed_at timestamptz,banned_until timestamptz,is_anonymous boolean);
 create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade,requested_at timestamptz not null default now(),updated_at timestamptz not null default now());
 alter table public.account_deletion_fences enable row level security;grant all on public.account_deletion_fences to service_role;
 create table public.organizations(id uuid primary key,state text);
 create table public.organization_members(organization_id uuid,user_id uuid,role text,revoked_at timestamptz);
 create table public.developer_funding_attempts(owner_id uuid,state text);
 create table public.memory_fixture(user_id uuid,body text);
 create function kova_private.erase_memory_fixture() returns trigger language plpgsql security definer set search_path='' as $$begin delete from public.memory_fixture where user_id=new.user_id;return new;end$$;
 create trigger memory_erase after insert on public.account_deletion_fences for each row execute function kova_private.erase_memory_fixture();
 grant all on public.organizations,public.organization_members,public.developer_funding_attempts to service_role;
 insert into auth.users(id) values('${owner}');insert into public.memory_fixture values('${owner}','private memory');`);
  await db.exec(
    await readFile("supabase/migrations/20260905001736_private_auth_identity_helpers.sql", "utf8"),
  );
  const org = await readFile(
    "supabase/migrations/20260905001454_organization_administration_foundation.sql",
    "utf8",
  );
  await db.exec(
    org.slice(
      org.indexOf("create function public.prepare_org_account_deletion("),
      org.indexOf("-- Final Auth deletion safety backstop;"),
    ),
  );
  const funding = await readFile(
    "supabase/migrations/20260905013000_developer_prepaid_funding.sql",
    "utf8",
  );
  await db.exec(
    funding.slice(
      funding.indexOf("create function public.guard_developer_funding_account_deletion()"),
      funding.indexOf(
        "\nrevoke all on function public.begin_developer_funding",
        funding.indexOf("create function public.guard_developer_funding_account_deletion()"),
      ),
    ),
  );
  if (preexisting)
    await db.query("insert into public.account_deletion_fences(user_id) values($1)", [owner]);
  await db.exec(migration);
  return db;
}
const state = async (db) =>
  (await db.query("select public.read_account_deletion_state($1) as state", [owner])).rows[0].state;
test("first confirmed organization admission is irreversible, old cancel cannot reopen it, Auth cascade completes it", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    assert.equal((await state(db)).state, "active");
    await db.query("select public.prepare_org_account_deletion($1)", [owner]);
    const first = await state(db);
    assert.equal(first.state, "deleting");
    await db.query("select public.prepare_org_account_deletion($1)", [owner]);
    assert.deepEqual(await state(db), first);
    assert.equal(
      (
        await db.query("select public.cancel_account_export_account_deletion($1) as canceled", [
          owner,
        ])
      ).rows[0].canceled,
      false,
    );
    await assert.rejects(
      db.query("delete from public.account_deletion_fences where user_id=$1", [owner]),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "update public.account_deletion_fences set started_at=now()+interval '1 day' where user_id=$1",
        [owner],
      ),
      /account_deletion_irreversible/,
    );
    await assert.rejects(db.query("select id from auth.users"), /permission denied/);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int as n from public.memory_fixture")).rows[0].n,
      0,
    );
    // Even a privileged old DELETE path hits the trigger while Auth still exists.
    await assert.rejects(
      db.query("delete from public.account_deletion_fences where user_id=$1", [owner]),
      /account_deletion_irreversible/,
    );
    await db.query("delete from auth.users where id=$1", [owner]);
    await db.exec("set role service_role");
    assert.equal((await state(db)).state, "deleted");
  } finally {
    await db.close();
  }
});
test("funding and sole-organization-owner blockers roll back before the first fence and memory erase", async () => {
  const db = await fixture();
  try {
    await db.query("insert into public.developer_funding_attempts values($1,'open')", [owner]);
    await db.exec("set role service_role");
    await assert.rejects(
      db.query("select public.prepare_org_account_deletion($1)", [owner]),
      /developer_payment_reconciliation_pending/,
    );
    assert.equal((await state(db)).state, "active");
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from public.memory_fixture")).rows[0].n,
      1,
    );
    await db.exec("delete from public.developer_funding_attempts");
    await db.query("insert into public.organizations values($1,'active');", [owner]);
    await db.query("insert into public.organization_members values($1,$1,'owner',null)", [owner]);
    await db.exec("set role service_role");
    await assert.rejects(
      db.query("select public.prepare_org_account_deletion($1)", [owner]),
      /organization_ownership_transfer_required/,
    );
    assert.equal((await state(db)).state, "active");
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from public.memory_fixture")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("status/cancel and new exports share the canonical account lock; callers have no direct public status privilege", async () => {
  const db = await fixture();
  try {
    for (const fn of ["read_account_deletion_state", "cancel_account_export_account_deletion"]) {
      const grants = await db.query(
        `select has_function_privilege('authenticated','public.${fn}(uuid)','execute') a,has_function_privilege('anon','public.${fn}(uuid)','execute') n,has_function_privilege('service_role','public.${fn}(uuid)','execute') s`,
      );
      assert.deepEqual(grants.rows, [{ a: false, n: false, s: true }]);
      const source = (
        await db.query(`select prosrc from pg_proc where oid='public.${fn}(uuid)'::regprocedure`)
      ).rows[0].prosrc;
      assert.match(
        source,
        /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text,20260903204500\)\)/,
      );
    }
    // Keep the real role transaction open while asserting the actual held lock.
    await db.exec("begin;set local role service_role");
    await state(db);
    const locks = await db.query(
      "select count(*)::int n from pg_locks where locktype='advisory' and granted",
    );
    assert.ok(locks.rows[0].n > 0);
    await db.exec("rollback");
    const old = await readFile(
      "supabase/migrations/20260903204500_account_export_deletion_fence.sql",
      "utf8",
    );
    assert.match(
      old,
      /pg_advisory_xact_lock\(hashtextextended\(new.user_id::text, 20260903204500\)\)/,
    );
  } finally {
    await db.close();
  }
});
test("preexisting fences gain a nonnullable irreversible start marker without releasing their identity", async () => {
  const db = await fixture(true);
  try {
    assert.equal((await state(db)).state, "deleting");
    const columns = await db.query(
      "select is_nullable from information_schema.columns where table_schema='public' and table_name='account_deletion_fences' and column_name='started_at'",
    );
    assert.equal(columns.rows[0].is_nullable, "NO");
    await assert.rejects(
      db.query(
        "update public.account_deletion_fences set user_id=gen_random_uuid() where user_id=$1",
        [owner],
      ),
      /account_deletion_irreversible/,
    );
  } finally {
    await db.close();
  }
});
async function loadTs(path) {
  const source = stripTypeScriptTypes(await readFile(path, "utf8")).replace(
    /(from\s*["'])@\/([^"']+)(["'])/gu,
    (_match, prefix, relative, suffix) =>
      `${prefix}${new URL(`../../src/${relative}`, import.meta.url).href}${suffix}`,
  );
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}
test("status helper requires one bounded policy RPC and preserves scheduled/finalizing authority", async (t) => {
  const { readAccountDeletionState } = await loadTs("src/lib/account-deletion-state.server.ts");
  const signal = new AbortController().signal;
  const deadlines = [];
  t.mock.method(AbortSignal, "timeout", (ms) => {
    deadlines.push(ms);
    return signal;
  });
  const scheduledAt = "2026-10-19T01:00:00.000Z";
  const recoverUntil = "2026-11-18T01:00:00.000Z";
  const fixture = (data, { error = null, transportError = null, bounded = true } = {}) => {
    const calls = [];
    const admin = {
      rpc(name, args) {
        calls.push({ name, args });
        if (!bounded) return Promise.resolve({ data, error });
        return {
          abortSignal: async (received) => {
            assert.equal(received, signal);
            if (transportError) throw transportError;
            return { data, error };
          },
        };
      },
    };
    return { admin, calls };
  };
  const exactCall = [{ name: "kova_policy_account_status", args: { p_user: owner } }];
  for (const [data, expected] of [
    [
      { state: "active", scheduledAt: null, recoverUntil: null },
      { state: "active", startedAt: null },
    ],
    [
      { state: "scheduled", scheduledAt, recoverUntil },
      { state: "scheduled", startedAt: null },
    ],
    [
      { state: "finalizing", scheduledAt, recoverUntil },
      { state: "deleting", startedAt: scheduledAt },
    ],
  ]) {
    const f = fixture(data);
    assert.deepEqual(await readAccountDeletionState(f.admin, owner), expected);
    assert.deepEqual(f.calls, exactCall);
  }
  for (const data of [
    null,
    undefined,
    [],
    { state: "deleted" },
    { state: "deleting", startedAt: scheduledAt },
    { state: "active", scheduledAt, recoverUntil },
    { state: "scheduled", scheduledAt, recoverUntil: scheduledAt },
    { state: "scheduled", scheduledAt, recoverUntil: "2026-11-17T01:00:00.000Z" },
    { state: "finalizing", scheduledAt: "not-a-date", recoverUntil },
  ]) {
    const f = fixture(data);
    await assert.rejects(readAccountDeletionState(f.admin, owner), /account_policy_/u);
    assert.deepEqual(f.calls, exactCall);
  }
  for (const options of [
    { error: { code: "NONSECRET_FIXTURE_RPC_ERROR" } },
    { transportError: new Error("NONSECRET_FIXTURE_TRANSPORT_ERROR") },
    { bounded: false },
  ]) {
    const f = fixture({ state: "active", scheduledAt: null, recoverUntil: null }, options);
    await assert.rejects(readAccountDeletionState(f.admin, owner));
    assert.deepEqual(f.calls, exactCall, "unavailable authority is not retried");
  }
  const f = fixture(null);
  await assert.rejects(readAccountDeletionState(f.admin, "invalid-owner"), /principal_invalid/u);
  assert.deepEqual(f.calls, []);
  await assert.rejects(readAccountDeletionState(null, owner), /account_policy_unavailable/u);
  assert.equal(deadlines.length, 14);
  assert.ok(deadlines.every((ms) => ms === 10_000));
});
