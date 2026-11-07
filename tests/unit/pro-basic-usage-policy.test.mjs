import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  isUnlimitedBasicChat,
  PLAN_USAGE_FACTOR,
  DAILY_PLAN_ALLOWANCES,
} from "../../src/lib/plan-usage-policy.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const migration = "supabase/migrations/20261107215527_kova_pro_unlimited_basic_chat.sql";
async function fixture() {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${owner}'); create function auth.uid() returns uuid language sql as $$select null::uuid$$;`,
  );
  await db.exec(readFileSync("supabase/migrations/20260803130000_ai_usage_accounting.sql", "utf8"));
  await db.exec(readFileSync(migration, "utf8"));
  await db.exec("set role service_role");
  const acquire = async ({
    plan = "pro",
    mode = "instant",
    model = "kova-argon-4.6",
    premium = false,
    limit = 1,
    reserve = 100,
    request = crypto.randomUUID(),
    principal = 2,
  } = {}) =>
    (
      await db.query(
        `select * from public.acquire_ai_generation($1,$1,$2,null,null,$3,$4,$5,$6,1,$7,0.01,false,$8,$8,1,1,10,$9,120,now()-interval '1 month',now()+interval '1 month')`,
        [request, owner, mode, plan, premium, model, reserve, limit, principal],
      )
    ).rows[0];
  const finish = async (id, tokens = 100) =>
    db.query(`select public.finalize_ai_generation($1,'completed',$2,0,1,0,0.01,5,'{}',null)`, [
      id,
      tokens,
    ]);
  return { db, acquire, finish };
}
test("published multipliers are 5x Free, 20x Plus and 100x Free for every metered allowance", () => {
  assert.equal(PLAN_USAGE_FACTOR.plus / PLAN_USAGE_FACTOR.free, 5);
  assert.equal(PLAN_USAGE_FACTOR.pro / PLAN_USAGE_FACTOR.plus, 20);
  for (const kind of ["regularMessages", "thinkingMessages", "images", "uploads"]) {
    assert.equal(DAILY_PLAN_ALLOWANCES.pro[kind] / DAILY_PLAN_ALLOWANCES.plus[kind], 20);
    assert.equal(DAILY_PLAN_ALLOWANCES.pro[kind] / DAILY_PLAN_ALLOWANCES.free[kind], 100);
  }
});
test("unlimited basic chat requires the exact Pro, Argon Lite combination", () => {
  for (const tier of ["guest", "free", "plus", "pro"])
    for (const model of ["kova-argon-4.6", "kova-neon-4.6", "kova-xenon-5", "unknown"])
      for (const mode of ["instant", "thinking", "high", "extra_high", "max", "ultra"])
        assert.equal(
          isUnlimitedBasicChat(tier, model, mode),
          tier === "pro" && model === "kova-argon-4.6" && mode === "instant",
        );
});
test("Pro basic bypasses token allowances but keeps full usage receipts and cannot consume advanced headroom", async () => {
  const f = await fixture();
  try {
    const basic = await f.acquire();
    assert.equal(basic.decision, "acquired");
    await f.finish(basic.event_id, 20000);
    const rows = (
      await f.db.query(
        "select actual_billable_tokens,input_tokens,actual_cost_usd,status from ai_usage_events",
      )
    ).rows;
    assert.equal(rows[0].actual_billable_tokens, 20001);
    assert.equal(rows[0].input_tokens, 20000);
    assert.equal(rows[0].status, "completed");
    const advanced = await f.acquire({ model: "kova-neon-4.6", limit: 50, reserve: 10 });
    assert.equal(advanced.decision, "acquired");
    await f.finish(advanced.event_id, 60);
    const exhausted = await f.acquire({ model: "kova-xenon-5", limit: 50, reserve: 1 });
    assert.equal(exhausted.decision, "daily_tokens");
    const after = await f.acquire();
    assert.equal(after.decision, "acquired");
  } finally {
    await f.db.close();
  }
});
test("Free, Plus, advanced efforts and advanced foundations stay limited", async () => {
  const f = await fixture();
  try {
    for (const config of [
      { plan: "free" },
      { plan: "plus" },
      { mode: "thinking" },
      { model: "kova-neon-4.6" },
      { model: "kova-xenon-5" },
      { premium: true },
    ])
      assert.equal((await f.acquire(config)).decision, "daily_tokens", JSON.stringify(config));
  } finally {
    await f.db.close();
  }
});
test("included basic requests still enforce concurrency, idempotency and RPC access", async () => {
  const f = await fixture();
  try {
    const id = crypto.randomUUID();
    assert.equal((await f.acquire({ request: id })).decision, "acquired");
    assert.equal((await f.acquire({ request: id })).decision, "duplicate");
    assert.equal((await f.acquire()).decision, "acquired");
    assert.equal((await f.acquire()).decision, "principal_concurrency");
    await f.db.exec("set role authenticated");
    await assert.rejects(f.acquire(), /permission denied/);
  } finally {
    await f.db.close();
  }
});
