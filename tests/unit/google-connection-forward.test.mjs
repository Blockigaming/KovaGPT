import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const migration = await readFile(
  new URL(
    "../../supabase/migrations/20261030132255_google_connection_lifecycle_forward.sql",
    import.meta.url,
  ),
  "utf8",
);
const owner = "11111111-1111-4111-8111-111111111111";
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;grant usage on schema kova_private to service_role;
 create table auth.users(id uuid primary key,deleted_at timestamptz);insert into auth.users(id) values('${owner}');
 create function kova_private.auth_user_exists(id uuid)returns boolean language sql security definer as $$select exists(select 1 from auth.users where users.id=$1 and deleted_at is null)$$;revoke all on function kova_private.auth_user_exists(uuid) from public;grant execute on function kova_private.auth_user_exists(uuid) to service_role;
 create table public.account_deletion_fences(user_id uuid primary key);create table public.user_preferences(user_id uuid,settings jsonb);grant all on public.account_deletion_fences,public.user_preferences to service_role;
 create table public.google_oauth_tokens(user_id uuid primary key references auth.users(id)on delete cascade,google_sub text,email text,access_token text not null,refresh_token text,expires_at timestamptz not null,scopes text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now());alter table public.google_oauth_tokens enable row level security;`);
  return db;
}
async function apply(db) {
  try {
    await db.exec("begin;" + migration + "commit;");
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
test("forward install exposes an empty account list only to the service role", async () => {
  const db = await fixture();
  try {
    await apply(db);
    await db.exec("set role service_role");
    const { rows } = await db.query("select public.google_connection_rpc($1,'list') as result", [
      owner,
    ]);
    assert.deepEqual(rows[0].result.accounts, []);
    assert.equal(rows[0].result.selectionRevision, 0);
    await db.exec("reset role;set role authenticated");
    await assert.rejects(
      db.query("select public.google_connection_rpc($1,'list')", [owner]),
      /permission denied/,
    );
    await assert.rejects(db.query("select * from public.google_oauth_tokens"), /permission denied/);
  } finally {
    await db.close();
  }
});
test("complete canonical installation is a no-op and preserves existing credentials", async () => {
  const db = await fixture();
  try {
    await apply(db);
    await db.query(
      "insert into public.google_oauth_tokens(user_id,access_token,expires_at)values($1,$2,now()+interval '1 hour')",
      [owner, "synthetic-encrypted-token"],
    );
    const before = await db.query("select * from public.google_oauth_tokens");
    await apply(db);
    assert.deepEqual(await db.query("select * from public.google_oauth_tokens"), before);
  } finally {
    await db.close();
  }
});
for (const [name, change, error] of [
  [
    "legacy token data",
    `insert into public.google_oauth_tokens(user_id,access_token,expires_at)values('${owner}','synthetic',now()+interval '1 hour')`,
    /requires_empty_legacy_tokens/,
  ],
  [
    "partial lifecycle",
    "create table public.google_oauth_attempts(id uuid)",
    /already_present_or_partial/,
  ],
  [
    "changed legacy shape",
    "alter table public.google_oauth_tokens add column unexpected text",
    /legacy_shape_changed/,
  ],
  ["missing dependency", "drop table public.account_deletion_fences", /dependency_missing/],
])
  test("forward install rejects " + name + " and rolls back", async () => {
    const db = await fixture();
    try {
      await db.exec(change);
      await assert.rejects(apply(db), error);
      assert.equal(
        (
          await db.query(
            "select to_regprocedure('public.google_connection_rpc(uuid,text,jsonb)') as rpc",
          )
        ).rows[0].rpc,
        null,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::integer as n from information_schema.columns where table_name='google_oauth_tokens' and column_name='grant_id'",
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await db.close();
    }
  });
test("changed installed function is rejected without replacing it", async () => {
  const db = await fixture();
  try {
    await apply(db);
    await db.exec(
      "create or replace function public.google_connection_rpc(p_user_id uuid,p_operation text,p_data jsonb default '{}'::jsonb) returns jsonb language sql as $$select '{}'::jsonb$$",
    );
    const before = await db.query(
      "select pg_get_functiondef('public.google_connection_rpc(uuid,text,jsonb)'::regprocedure) as definition",
    );
    await assert.rejects(apply(db), /legacy_shape_changed|already_present_or_partial/);
    assert.deepEqual(
      await db.query(
        "select pg_get_functiondef('public.google_connection_rpc(uuid,text,jsonb)'::regprocedure) as definition",
      ),
      before,
    );
  } finally {
    await db.close();
  }
});
