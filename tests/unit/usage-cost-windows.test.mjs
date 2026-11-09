import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chatUsageWindows } from "../../src/lib/plan-usage-policy.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const migration = "supabase/migrations/20261109145000_kova_hourly_windows_monthly_cost_safety.sql";

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}');
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create table public.daily_usage(
      user_id uuid references auth.users(id),usage_date date,
      chats integer not null default 0,thinking_chats integer not null default 0,
      updated_at timestamptz default now(),primary key(user_id,usage_date)
    );
    create function public.effective_user_usage_multiplier(uuid)
      returns integer language sql stable as $$select 1$$;
    create function public.try_consume_daily_message(uuid,boolean,integer,integer)
      returns boolean language plpgsql security definer set search_path=public as $$
      begin
        insert into public.daily_usage(user_id,usage_date,chats,thinking_chats)
          values($1,(now() at time zone 'UTC')::date,1,case when $2 then 1 else 0 end)
          on conflict(user_id,usage_date) do update set
          chats=daily_usage.chats+1,
          thinking_chats=daily_usage.thinking_chats+case when $2 then 1 else 0 end;
        return true;
      end$$;`);
  await db.exec(readFileSync("supabase/migrations/20260803130000_ai_usage_accounting.sql", "utf8"));
  await db.exec(readFileSync(migration, "utf8"));
  await db.exec("set role service_role");
  return db;
}

async function request(db, plan, cost, model = "kova-argon-4.6") {
  const id = crypto.randomUUID();
  const { rows } = await db.query(
    `select * from public.acquire_ai_generation(
      $1,$1,$2,null,null,'instant',$3,false,$4,1,1,$5,false,
      100000,100000,100000,10,1000,1000,120,
      now()-interval '1 month',now()+interval '1 month'
    )`,
    [id, owner, plan, model, cost],
  );
  return rows[0];
}

test("Free/Plus have hourly-refreshed five-hour and weekly bars; Pro only weekly", () => {
  const at = new Date("2026-11-09T15:37:00Z");
  for (const tier of ["free", "plus"]) {
    const windows = chatUsageWindows(tier, at);
    assert.deepEqual(windows.map((window) => window.id), ["five_hour", "weekly"]);
    assert.equal(windows[0].start, "2026-11-09T11:00:00.000Z");
    assert.equal(windows[0].resetsAt, "2026-11-09T16:00:00.000Z");
    assert.equal(windows[1].resetsAt, "2026-11-16T00:00:00.000Z");
  }
  assert.deepEqual(chatUsageWindows("pro", at).map((window) => window.id), ["weekly"]);
});

test("atomic message quota recovers one hourly bucket while retaining weekly history", async () => {
  const db = await fixture();
  try {
    const consume = async () => {
      const response = await db.query(
        "select public.try_consume_paid_message($1,false,10,2) as outcome",
        [owner],
      );
      return response.rows[0].outcome;
    };
    assert.equal(await consume(), "allowed");
    assert.equal(await consume(), "allowed");
    assert.equal(await consume(), "five_hour");
    await db.query(
      "update public.message_usage_hourly set window_start=window_start-interval '6 hours'",
    );
    assert.equal(await consume(), "allowed");
    const total = await db.query("select chats from public.daily_usage");
    assert.equal(total.rows[0].chats, 3);
    await db.exec("set role authenticated");
    await assert.rejects(consume(), /permission denied/);
  } finally {
    await db.close();
  }
});

test("Free cost-window limit prices every reserved request, not message count alone", async () => {
  const db = await fixture();
  try {
    assert.equal((await request(db, "free", 0.09)).decision, "acquired");
    assert.equal((await request(db, "free", 0.02)).decision, "five_hour_cost");
    const progress = await db.query("select * from public.kova_plan_cost_progress($1,'free')", [
      owner,
    ]);
    const { rows } = progress;
    assert.equal(Number(rows[0].monthly_allowance), 3);
    assert.ok(Number(rows[0].five_hour_used) >= 0.09);
    assert.ok(Number(rows[0].five_hour_allowance) >= 0.1);
  } finally {
    await db.close();
  }
});

test("settled actual cost returns unused estimated allowance", async () => {
  const db = await fixture();
  try {
    const first = await request(db, "free", 0.09);
    assert.equal(first.decision, "acquired");
    const settle = await db.query(
      "select public.finalize_ai_generation($1,'completed',10,0,5,0,0.01,25,'{}',null) ok",
      [first.event_id],
    );
    assert.equal(settle.rows[0].ok, true);
    assert.equal((await request(db, "free", 0.08)).decision, "acquired");
    const progress = await db.query("select month_used from public.kova_plan_cost_progress($1,'free')", [
      owner,
    ]);
    assert.ok(Number(progress.rows[0].month_used) < 0.1);
  } finally {
    await db.close();
  }
});

test("monthly safety cap counts earlier costs and included Pro Argon Lite chat", async () => {
  for (const [tier, previous, next] of [
    ["free", 2.99, 0.02],
    ["plus", 59.99, 0.02],
    ["pro", 299.99, 0.02],
  ]) {
    const db = await fixture();
    try {
      const requestId = crypto.randomUUID();
      await db.query(
        `insert into public.ai_usage_events(
           request_id,idempotency_key,user_id,kova_mode,plan_tier,
           provider_model,estimated_input_tokens,reserved_tokens,estimated_cost_usd,status
         ) values($1,$1,$2,'instant',$3,'kova-argon-4.6',1,1,$4,'completed')`,
        [requestId, owner, tier, previous],
      );
      assert.equal((await request(db, tier, next)).decision, "monthly_cost");
    } finally {
      await db.close();
    }
  }
});

test("only server service role can query raw cost limits and budget ledger", async () => {
  const db = await fixture();
  try {
    const first = await db.query(
      "select * from public.kova_plan_cost_progress($1,'plus')",
      [owner],
    );
    assert.equal(Number(first.rows[0].monthly_allowance), 60);
    assert.equal(first.rows[0].five_hour_allowance !== null, true);
    const pro = await db.query("select * from public.kova_plan_cost_progress($1,'pro')", [owner]);
    assert.equal(pro.rows[0].five_hour_allowance, null);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select * from public.kova_plan_cost_progress($1,'plus')", [owner]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
