import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;create table auth.users(id uuid primary key);create function kova_private.auth_user_exists(p_id uuid) returns boolean language sql security definer set search_path='' as $$select exists(select 1 from auth.users where id=p_id)$$;revoke all on function kova_private.auth_user_exists(uuid) from public;grant usage on schema auth,kova_private to service_role;grant execute on function kova_private.auth_user_exists(uuid) to service_role;create table account_deletion_fences(user_id uuid);create table banned_users(user_id uuid);create table user_preferences(user_id uuid,settings jsonb);grant select on account_deletion_fences,banned_users,user_preferences to service_role;insert into auth.users values('${owner}'),('${other}');`,
    );
    await db.exec(
      await readFile("supabase/migrations/20260905040500_discovery_daily_admission.sql", "utf8"),
    );
    await db.exec("set role service_role");
    return {
      db,
      admit: async (user = owner, userLimit = 3, globalLimit = 4) =>
        (
          await db.query("select admit_discovery_request($1,$2,$3) allowed", [
            user,
            userLimit,
            globalLimit,
          ])
        ).rows[0].allowed,
    };
  } catch (e) {
    await db.close();
    throw e;
  }
}
test("daily admission conserves a global cap across users and concurrent attempts without granting authenticated writes", async () => {
  const f = await fixture();
  try {
    const calls = await Promise.all(
      Array.from({ length: 12 }, (_, i) => f.admit(i % 2 ? owner : other, 3, 4)),
    );
    assert.equal(calls.filter(Boolean).length, 4);
    assert.equal(
      (await f.db.query("select requests from discovery_provider_days")).rows[0].requests,
      4,
    );
    assert.equal(
      (await f.db.query("select sum(requests)::integer n from discovery_usage_days")).rows[0].n,
      4,
    );
    for (const role of ["anon", "authenticated"])
      for (const table of ["discovery_usage_days", "discovery_provider_days"])
        for (const action of ["select", "insert", "update", "delete"])
          assert.equal(
            (
              await f.db.query("select has_table_privilege($1,$2,$3) allowed", [
                role,
                table,
                action,
              ])
            ).rows[0].allowed,
            false,
          );
    assert.equal(
      (await f.db.query("select has_table_privilege('service_role','auth.users','select') allowed"))
        .rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await f.db.query(
          "select has_function_privilege('authenticated','admit_discovery_request(uuid,integer,integer)','execute') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await f.db.close();
  }
});
test("per-owner caps and reduced trusted global configuration never refund prior dispatch attempts", async () => {
  const f = await fixture();
  try {
    assert.equal(await f.admit(owner, 1, 10), true);
    assert.equal(await f.admit(owner, 1, 10), false);
    assert.equal(await f.admit(other, 3, 1), false);
    assert.equal(await f.admit(other, 3, 10), true);
    for (const limits of [
      [0, 10],
      [1, 0],
      [1001, 10],
      [1, 100001],
      [null, 10],
    ])
      await assert.rejects(f.admit(owner, ...limits), /configuration_invalid/);
  } finally {
    await f.db.close();
  }
});
test("account deletion, bans, and Lockdown are authoritative before provider admission and consume no counts", async () => {
  const f = await fixture();
  try {
    for (const table of ["account_deletion_fences", "banned_users"]) {
      await f.db.exec(`reset role;insert into ${table} values('${owner}');set role service_role`);
      await assert.rejects(f.admit(), /owner_unavailable/);
      await f.db.exec(`reset role;delete from ${table};set role service_role`);
    }
    await f.db.exec(
      `reset role;insert into user_preferences values('${owner}','{"lockdown_mode":true}');set role service_role`,
    );
    await assert.rejects(f.admit(), /lockdown/);
    assert.equal(
      (await f.db.query("select count(*)::integer n from discovery_provider_days")).rows[0].n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("old count-only records expire with activation off and Auth deletion cascades personal counts, never global budget", async () => {
  const f = await fixture();
  try {
    await f.admit();
    await f.db.query(
      "insert into discovery_usage_days(user_id,day,requests) values($1,current_date-10,2)",
      [owner],
    );
    await f.db.exec("insert into discovery_provider_days(day,requests) values(current_date-10,2)");
    assert.equal((await f.db.query("select expire_discovery_usage(100) n")).rows[0].n, 1);
    const exported = (await f.db.query("select * from discovery_usage_export_records")).rows[0];
    assert.deepEqual(Object.keys(exported).sort(), ["day", "id", "requests", "user_id"]);
    await f.db.exec(`reset role;delete from auth.users where id='${owner}';set role service_role`);
    assert.equal(
      (await f.db.query("select count(*)::integer n from discovery_usage_days")).rows[0].n,
      0,
    );
    assert.equal(
      (await f.db.query("select requests from discovery_provider_days")).rows[0].requests,
      1,
    );
    await assert.rejects(f.admit(), /owner_unavailable/);
  } finally {
    await f.db.close();
  }
});
