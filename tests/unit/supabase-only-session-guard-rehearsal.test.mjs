import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const script = readFileSync(
  new URL("../../docs/azure/supabase-only-session-guard-rehearsal.sql", import.meta.url),
  "utf8",
);
const owner = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role authenticated;
    create schema kova_auth_guard;
    create schema kova_private;
    create table kova_private.auth_legacy_retirements(account_id uuid primary key);
    create table kova_private.auth_sessions(revoked_at timestamptz, expires_at timestamptz);
    create function kova_auth_guard.session_is_active() returns boolean
      language sql stable as $$ select true $$;
    grant usage on schema kova_auth_guard to authenticated;
    grant execute on function kova_auth_guard.session_is_active() to authenticated;
    create table public.fixture_data(owner_id uuid primary key);
    insert into public.fixture_data values ('${owner}'), ('${other}');
    alter table public.fixture_data enable row level security;
    grant select on public.fixture_data to authenticated;
    create policy owner_read on public.fixture_data for select to authenticated
      using (owner_id::text = current_setting('request.jwt.claims', true)::jsonb->>'sub');
    create policy owned_guard on public.fixture_data as restrictive for all to authenticated
      using ((select kova_auth_guard.session_is_active()))
      with check ((select kova_auth_guard.session_is_active()));
  `);
  return db;
}

test("the exact rehearsal executes successfully and rolls back its replacement", async (t) => {
  const db = await fixture(t);
  await db.exec(script);
  const result = await db.query(
    "select pg_get_functiondef('kova_auth_guard.session_is_active()'::regprocedure) as body",
  );
  assert.match(result.rows[0].body, /select true/u);
});

test("retirement preserves hosted owner isolation and rejects retired credentials", async (t) => {
  const db = await fixture(t);
  assert.match(script, /rollback;\s*$/u);
  await db.exec(script.replace(/rollback;\s*$/u, ""));
  for (const [claims, expected] of [
    [{ role: "authenticated", sub: owner }, [owner]],
    [{ role: "authenticated", sub: other }, [other]],
    [{ role: "authenticated", sub: owner, kova_auth: 1 }, []],
    [{ role: "authenticated", sub: other, kova_auth: null }, []],
    [{ role: "authenticated", sub: owner, user_metadata: { kova_auth: 1 } }, [owner]],
  ]) {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec("set local role authenticated");
    const rows = await db.query("select owner_id from public.fixture_data order by owner_id");
    assert.deepEqual(
      rows.rows.map((row) => row.owner_id),
      expected,
    );
    await db.exec("reset role");
  }
  await db.query("insert into kova_private.auth_legacy_retirements values ($1)", [owner]);
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "authenticated", sub: owner }),
  ]);
  await db.exec("set local role authenticated");
  assert.equal((await db.query("select * from public.fixture_data")).rows.length, 0);
  await db.exec("rollback");
});

test("the rehearsal refuses to replace authority while an owned session is active", async (t) => {
  const db = await fixture(t);
  await db.exec("insert into kova_private.auth_sessions values (null, now() + interval '1 day')");
  await assert.rejects(db.exec(script), /Active owned sessions require disposition/u);
  await db.exec("rollback");
});
