import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";

const wrapper = execFileSync(
  "python3",
  ["scripts/release/google-forward-operator.py", "--print-sql"],
  { encoding: "utf8" },
);
const canonical = await readFile(
  new URL(
    "../../supabase/migrations/20261030132255_google_connection_lifecycle_forward.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.equal(
  createHash("sha256").update(canonical).digest("hex"),
  "4fde05fe365efabf0f5466640dc7ea07e8182864b4529dc7def2a71a4e82c3e2",
);
const owner = "11111111-1111-4111-8111-111111111111";
const version = "20261030132255";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema kova_private;
    grant usage on schema kova_private to service_role;
    create table auth.users(id uuid primary key,deleted_at timestamptz);
    insert into auth.users(id) values('${owner}');
    create function kova_private.auth_user_exists(id uuid) returns boolean
      language sql security definer as $$select exists(select 1 from auth.users where users.id=$1 and deleted_at is null)$$;
    revoke all on function kova_private.auth_user_exists(uuid) from public;
    grant execute on function kova_private.auth_user_exists(uuid) to service_role;
    create table public.account_deletion_fences(user_id uuid primary key);
    create table public.user_preferences(user_id uuid,settings jsonb);
    grant all on public.account_deletion_fences,public.user_preferences to service_role;
    create table public.google_oauth_tokens(
      user_id uuid primary key references auth.users(id) on delete cascade,
      google_sub text,email text,access_token text not null,refresh_token text,
      expires_at timestamptz not null,scopes text not null default '',
      created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    alter table public.google_oauth_tokens enable row level security;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(
      version text primary key,statements text[],name text,created_by text,
      idempotency_key text,rollback text[]);
    insert into supabase_migrations.schema_migrations(version,statements,name)
      values('20261029010000',array['select 1;'],'preserve_synthetic_history');
  `);
  const { rows } = await db.query(`select
    (pg_control_system()).system_identifier::text as identity,
    current_setting('server_version_num')::integer /10000 as major`);
  // Only this isolated test copy changes the production target hash and major.
  const local = wrapper
    .replace(
      "d165ac49d4d2aaa4733f7f220c351c99ff09493dace033a726f6fd722a573a15",
      createHash("sha256").update(rows[0].identity).digest("hex"),
    )
    .replace("/ 10000 = 17", "/ 10000 = " + rows[0].major);
  return { db, local };
}
async function run(db, sql) {
  try {
    await db.exec(sql);
  } catch (error) {
    await db.exec("rollback;");
    throw error;
  }
}
async function history(db) {
  return (await db.query("select * from supabase_migrations.schema_migrations order by version"))
    .rows;
}
async function assertUninstalled(db) {
  const { rows } = await db.query(`select
    to_regprocedure('public.google_connection_rpc(uuid,text,jsonb)') as rpc,
    (select count(*)::integer from information_schema.columns
      where table_schema='public' and table_name='google_oauth_tokens') as columns`);
  assert.equal(rows[0].rpc, null);
  assert.equal(rows[0].columns, 9);
}

test("guarded install preserves prior history and records the exact canonical bytes", async () => {
  const { db, local } = await fixture();
  try {
    const before = await history(db);
    await run(db, local);
    const after = await history(db);
    assert.deepEqual(
      after.filter((r) => r.version !== version),
      before,
    );
    const record = after.find((r) => r.version === version);
    assert.equal(record.name, "google_connection_lifecycle_forward");
    assert.deepEqual(record.statements, [canonical]);
    await db.exec("set role service_role;");
    const list = await db.query("select public.google_connection_rpc($1,'list') as result", [
      owner,
    ]);
    assert.deepEqual(list.rows[0].result.accounts, []);
    await db.exec("reset role;set role authenticated;");
    await assert.rejects(db.query("select * from public.google_oauth_tokens"), /permission denied/);
    await assert.rejects(
      db.query("select public.google_connection_rpc($1,'list')", [owner]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("repeat verification preserves newly connected credentials and all history", async () => {
  const { db, local } = await fixture();
  try {
    await run(db, local);
    await db.query(
      "insert into public.google_oauth_tokens(user_id,access_token,expires_at)values($1,$2,now()+interval '1 hour')",
      [owner, "synthetic-encrypted-token"],
    );
    const beforeTokens = (await db.query("select * from public.google_oauth_tokens")).rows;
    const beforeHistory = await history(db);
    await run(db, local);
    assert.deepEqual(
      (await db.query("select * from public.google_oauth_tokens")).rows,
      beforeTokens,
    );
    assert.deepEqual(await history(db), beforeHistory);
  } finally {
    await db.close();
  }
});

for (const [name, change, expected] of [
  [
    "different history at the target version",
    `insert into supabase_migrations.schema_migrations(version,name,statements)values('${version}','different',array['select 2;'])`,
    /history_conflict/,
  ],
  [
    "same migration name at another version",
    "insert into supabase_migrations.schema_migrations(version,name,statements)values('20261030140000','google_connection_lifecycle_forward',array['select 2;'])",
    /name_collision/,
  ],
  [
    "nonempty legacy credentials",
    `insert into public.google_oauth_tokens(user_id,access_token,expires_at)values('${owner}','synthetic',now()+interval '1 hour')`,
    /requires_empty_legacy_tokens/,
  ],
  [
    "partial lifecycle",
    "create table public.google_oauth_attempts(id uuid)",
    /already_present_or_partial/,
  ],
  [
    "ledger insertion failure",
    `alter table supabase_migrations.schema_migrations add constraint reject_synthetic_target check(version<>'${version}')`,
    /reject_synthetic_target/,
  ],
])
  test("rejects " + name + " atomically", async () => {
    const { db, local } = await fixture();
    try {
      await db.exec(change);
      const beforeHistory = await history(db);
      await assert.rejects(run(db, local), expected);
      assert.deepEqual(await history(db), beforeHistory);
      await assertUninstalled(db);
    } finally {
      await db.close();
    }
  });

test("production target guard rejects an unrelated database before any schema or ledger write", async () => {
  const { db } = await fixture();
  try {
    const before = await history(db);
    await assert.rejects(run(db, wrapper), /wrong_database/);
    assert.deepEqual(await history(db), before);
    await assertUninstalled(db);
  } finally {
    await db.close();
  }
});

test("PostgreSQL major guard is enforced independently of the system identifier", async () => {
  const { db, local } = await fixture();
  try {
    const wrongMajor = local.replace(/\/ 10000 = \d+/, "/ 10000 = 999");
    await assert.rejects(run(db, wrongMajor), /wrong_database/);
    await assertUninstalled(db);
  } finally {
    await db.close();
  }
});

test("changed embedded canonical SQL is rejected before execution", async () => {
  const { db, local } = await fixture();
  try {
    const changed = local.replace(
      "-- Forward install of the canonical Google lifecycle",
      "-- Changed install of the canonical Google lifecycle",
    );
    await assert.rejects(run(db, changed), /source_integrity_failed/);
    await assertUninstalled(db);
  } finally {
    await db.close();
  }
});
