import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const paths = (await readdir("supabase/migrations")).filter((name) =>
  name.endsWith("_kova_work_browser_launch_forward.sql"),
);
assert.equal(paths.length, 1);
const launch = await readFile(`supabase/migrations/${paths[0]}`, "utf8");
const native = await readFile(
  "tests/fixtures/work-runtime-forward-native-smoke-20261030.sql",
  "utf8",
);
const bootstrap = native.slice(
  native.indexOf("create schema auth;"),
  native.indexOf("begin read only;"),
);

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;" + bootstrap,
    );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

test("the production forward installs the missing runtime and only a renewable 15-minute browser authority", async () => {
  const db = await fixture();
  try {
    await db.exec(launch);
    const result = (
      await db.query(`select
      to_regclass('public.work_execution_runs') is not null as runs,
      (select count(*)::int from pg_constraint where conrelid='public.work_browser_sessions'::regclass and contype='c' and pg_get_constraintdef(oid) like '%expires_at%' and pg_get_constraintdef(oid) like '%created_at%') as age_limits,
      (select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.work_browser_sessions'::regclass and a.attname='expires_at') as idle_default,
      has_function_privilege('service_role','public.admit_work_browser_owner(uuid,uuid,uuid,bigint,bigint,text)','execute') as service,
      has_function_privilege('anon','public.admit_work_browser_owner(uuid,uuid,uuid,bigint,bigint,text)','execute') as anonymous,
      has_function_privilege('authenticated','public.admit_work_browser_owner(uuid,uuid,uuid,bigint,bigint,text)','execute') as signed_in`)
    ).rows[0];
    assert.deepEqual(result, {
      runs: true,
      age_limits: 0,
      idle_default: "(statement_timestamp() + '00:15:00'::interval)",
      service: true,
      anonymous: false,
      signed_in: false,
    });
    const authority = (
      await db.query(
        "select prosrc from pg_proc where oid='public.admit_work_browser_owner(uuid,uuid,uuid,bigint,bigint,text)'::regprocedure",
      )
    ).rows[0].prosrc;
    assert.ok(authority.includes("expires_at=case when p_operation='close'"));
    assert.ok(authority.includes("interval '15 minutes'"));
  } finally {
    await db.close();
  }
});

test("a canonical replay preserves data and cannot replay the one-time expiry constraint removal", async () => {
  const db = await fixture();
  try {
    await db.exec(launch);
    const owner = "11111111-1111-4111-8111-111111111111";
    await db.query("insert into auth.users(id) values($1) on conflict do nothing", [owner]);
    await db.query("insert into work_sync_counters(owner_id,current_version) values($1,7)", [
      owner,
    ]);
    await db.exec(launch);
    assert.equal(
      (
        await db.query("select current_version::int n from work_sync_counters where owner_id=$1", [
          owner,
        ])
      ).rows[0].n,
      7,
    );
  } finally {
    await db.close();
  }
});

test("a partial runtime refuses installation without creating additional Work objects", async () => {
  const db = await fixture();
  try {
    await db.exec("create table public.work_browser_sessions(id uuid)");
    await assert.rejects(db.exec(launch), /work_browser_launch_existing_authority_drift/);
    assert.equal(
      (await db.query("select to_regclass('public.work_execution_runs') as t")).rows[0].t,
      null,
    );
  } finally {
    await db.close();
  }
});

test("an altered idle authority fails closed and is never silently replaced", async () => {
  const db = await fixture();
  try {
    await db.exec(launch);
    await db.exec(
      "alter function public.authorize_work_browser(uuid,uuid,uuid,uuid,text,text,text,bigint,bigint,uuid,text,uuid) security definer",
    );
    await assert.rejects(db.exec(launch), /work_browser_launch_existing_authority_drift/);
    assert.equal(
      (
        await db.query(
          "select prosecdef from pg_proc where oid='public.authorize_work_browser(uuid,uuid,uuid,uuid,text,text,text,bigint,bigint,uuid,text,uuid)'::regprocedure",
        )
      ).rows[0].prosecdef,
      true,
    );
  } finally {
    await db.close();
  }
});
