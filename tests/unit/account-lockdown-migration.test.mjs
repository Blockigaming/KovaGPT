import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../../supabase/migrations/20260903200000_account_lockdown_mode.sql", import.meta.url),
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create schema kova_private;
    create role anon;
    create role authenticated;
    create role service_role;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    create table public.user_preferences (
      user_id uuid primary key references auth.users(id) on delete cascade,
      settings jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    alter table public.user_preferences enable row level security;
    create policy "preferences owner crud" on public.user_preferences
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create table public.account_audit_entries (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      event_type text not null,
      safe_description text not null,
      actor_id uuid,
      target_id text,
      result text not null check (result in ('success','failure')),
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);
  await db.exec(migration);
  return db;
}

test("the Lockdown RPC preserves other preferences and emits factual audit entries", async () => {
  const db = await database();
  const user = "10000000-0000-4000-8000-000000000001";
  await db.exec(`insert into auth.users(id) values ('${user}')`);
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`);
  await db.query(`select public.set_lockdown_mode(true)`);
  await db.exec(`reset role`);

  let rows = await db.query(
    `select settings, event_type, safe_description, metadata
       from public.user_preferences
       join public.account_audit_entries using (user_id)`,
  );
  assert.deepEqual(rows.rows, [
    {
      settings: { lockdown_mode: true },
      event_type: "lockdown_mode_changed",
      safe_description: "Lockdown Mode enabled",
      metadata: { enabled: true },
    },
  ]);

  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`);
  await db.exec(`update public.user_preferences set settings = settings || '{"language":"en"}'`);
  await db.query(`select public.set_lockdown_mode(false)`);
  await db.exec(`reset role`);
  rows = await db.query(`select settings from public.user_preferences where user_id = '${user}'`);
  assert.deepEqual(rows.rows, [{ settings: { language: "en", lockdown_mode: false } }]);
  const count = await db.query(
    `select count(*)::int as count from public.account_audit_entries where user_id = '${user}'`,
  );
  assert.deepEqual(count.rows, [{ count: 2 }]);
  await db.close();
});

test("the Lockdown RPC is owner-scoped and not executable by anonymous callers", async () => {
  const db = await database();
  const first = "10000000-0000-4000-8000-000000000001";
  const second = "20000000-0000-4000-8000-000000000002";
  await db.exec(`insert into auth.users(id) values ('${first}'), ('${second}')`);
  await assert.rejects(() => db.query(`select public.set_lockdown_mode(true)`));
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${first}'`);
  await db.query(`select public.set_lockdown_mode(true)`);
  const visible = await db.query(`select user_id from public.user_preferences`);
  assert.deepEqual(visible.rows, [{ user_id: first }]);
  await db.exec(`reset role`);
  const anonymous = await db.query(
    `select has_function_privilege('anon', 'public.set_lockdown_mode(boolean)', 'execute') as can_execute`,
  );
  assert.deepEqual(anonymous.rows, [{ can_execute: false }]);
  await db.close();
});

test("Lockdown audit trigger is private, definer-scoped, and has a pinned path", async () => {
  const db = await database();
  const rows = await db.query(`
    select p.prosecdef as security_definer,
           p.proconfig as config,
           has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kova_private' and p.proname = 'audit_lockdown_mode_change'
  `);
  assert.equal(rows.rows[0].security_definer, true);
  assert.deepEqual(rows.rows[0].config, ['search_path=""']);
  assert.equal(rows.rows[0].authenticated_execute, false);
  await db.close();
});
