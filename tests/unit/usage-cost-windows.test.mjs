import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chatUsageWindows, legacyFiveHourWindow } from "../../src/lib/plan-usage-policy.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const sqlPath = "supabase/migrations/20261109145000_kova_hourly_windows_monthly_cost_safety.sql";

async function fixture(privatePolicy, costClock) {
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
    create function public.effective_user_plan_tier(uuid)
      returns text language sql stable as $$select 'free'::text$$;
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
  const baseline = readFileSync(
    "supabase/migrations/20260803130000_ai_usage_accounting.sql",
    "utf8",
  );
  await db.exec(baseline);
  await db.exec(readFileSync(sqlPath, "utf8"));
  if (privatePolicy) {
    await db.exec("create schema if not exists kova_private");
    await db.exec(
      readFileSync(
        "supabase/migrations/20261117174500_kova_private_chat_budget_pacing.sql",
        "utf8",
      ),
    );
    for (const [plan, allowance] of Object.entries(privatePolicy)) {
      await db.query("insert into kova_private.chat_plan_budget_policy values ($1,$2)", [
        plan,
        allowance,
      ]);
    }
  }
  if (costClock) {
    // Bind the admission RPC and new ledger rows to the same synthetic UTC clock.
    // The original quota calculator and admission SQL remain unchanged.
    assert.match(costClock, /^2026-11-(09|25)T13:00:00Z$/);
    await db.exec(`
      alter function public.kova_plan_cost_progress(uuid,text,timestamptz)
        rename to fixture_cost_progress_at;
      create function public.kova_plan_cost_progress(
        _user_id uuid, _plan text, _asof timestamptz default statement_timestamp()
      ) returns table(
        month_used numeric, monthly_allowance numeric,
        weekly_used numeric, weekly_allowance numeric,
        five_hour_used numeric, five_hour_allowance numeric
      ) language sql stable security definer set search_path=public,pg_temp as $fixture_clock$
        select * from public.fixture_cost_progress_at(_user_id,_plan,'${costClock}'::timestamptz)
      $fixture_clock$;
      revoke all on function public.kova_plan_cost_progress(uuid,text,timestamptz)
        from public,anon,authenticated;
      grant execute on function public.kova_plan_cost_progress(uuid,text,timestamptz)
        to service_role;
      alter table public.ai_usage_events alter column created_at
        set default '${costClock}'::timestamptz;
    `);
  }
  // The synthetic fixture creates daily_usage without historical production
  // grants. Give the same table access to the server role as production.
  await db.exec("grant select, insert, update on public.daily_usage to service_role");
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
    assert.deepEqual(
      windows.map((window) => window.id),
      ["five_hour", "weekly"],
    );
    assert.equal(windows[0].start, "2026-11-09T11:00:00.000Z");
    assert.equal(windows[0].resetsAt, "2026-11-09T16:00:00.000Z");
    assert.equal(windows[1].resetsAt, "2026-11-16T00:00:00.000Z");
  }
  assert.deepEqual(
    chatUsageWindows("pro", at).map((window) => window.id),
    ["weekly"],
  );
});

test("hourly quota rollover preserves weekly usage", async () => {
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

test("Free uses reserved cost rather than message count alone", async () => {
  for (const [clock, lateMonth] of [
    ["2026-11-09T13:00:00Z", false],
    ["2026-11-25T13:00:00Z", true],
  ]) {
    const db = await fixture(undefined, clock);
    try {
      assert.equal((await request(db, "free", 0.09)).decision, "acquired");
      assert.equal(
        (await request(db, "free", 0.02)).decision,
        lateMonth ? "acquired" : "five_hour_cost",
      );
      if (lateMonth) {
        assert.equal((await request(db, "free", 0.01)).decision, "five_hour_cost");
      }
      const usageSql = "select * from public.kova_plan_cost_progress($1,'free')";
      const { rows } = await db.query(usageSql, [owner]);
      assert.equal(Number(rows[0].monthly_allowance), 3);
      assert.equal(Number(rows[0].five_hour_used), lateMonth ? 0.11 : 0.09);
      assert.ok(Number(rows[0].five_hour_allowance) >= 0.1);
      if (lateMonth) assert.ok(Number(rows[0].five_hour_allowance) > 0.11);
    } finally {
      await db.close();
    }
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
    const costQuery = "select month_used from public.kova_plan_cost_progress($1,'free')";
    const progress = await db.query(costQuery, [owner]);
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
    const costQuery = "select * from public.kova_plan_cost_progress($1,'plus')";
    const first = await db.query(costQuery, [owner]);
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

test("legacy five-hour meter matches epoch-aligned SQL windows across UTC midnight", () => {
  for (const at of ["2026-11-13T23:59:59Z", "2026-11-14T00:59:59Z"]) {
    assert.deepEqual(legacyFiveHourWindow(new Date(at)), {
      start: "2026-11-13T20:00:00.000Z",
      resetsAt: "2026-11-14T01:00:00.000Z",
    });
  }
  assert.deepEqual(legacyFiveHourWindow(new Date("2026-11-14T01:15:00Z")), {
    start: "2026-11-14T01:00:00.000Z",
    resetsAt: "2026-11-14T06:00:00.000Z",
  });
});

test("private policy controls dynamic pacing, atomic monthly admission and customer isolation", async () => {
  // Synthetic amounts deliberately differ from private operator configuration.
  const policy = { free: 2.13, plus: 19.73, pro: 93.71 };
  const db = await fixture(policy);
  try {
    for (const [plan, cap] of Object.entries(policy)) {
      const result = await db.query("select * from public.kova_plan_cost_progress($1,$2)", [
        owner,
        plan,
      ]);
      assert.equal(Number(result.rows[0].monthly_allowance), cap);
      assert.equal((await request(db, plan, cap + 0.01)).decision, "monthly_cost");
    }
    const costQuery = "select * from public.kova_plan_cost_progress($1,'plus')";
    const before = (await db.query(costQuery, [owner])).rows[0];
    const reserved = Math.min(Number(before.five_hour_allowance) / 2, 0.01);
    const event = await request(db, "plus", reserved);
    assert.equal(event.decision, "acquired");
    assert.equal(Number((await db.query(costQuery, [owner])).rows[0].month_used), reserved);
    await db.query(
      "select public.finalize_ai_generation($1,'completed',10,0,5,0,$2,25,'{}',null)",
      [event.event_id, reserved / 2],
    );
    assert.equal(Number((await db.query(costQuery, [owner])).rows[0].month_used), reserved / 2);
    const at = "2026-11-17T12:00:00Z";
    const queryAt = "select * from public.kova_plan_cost_progress($1,'plus',$2::timestamptz)";
    const initial = (await db.query(queryAt, [owner, at])).rows[0];
    await db.query(
      "update public.ai_usage_events set created_at='2026-11-01T12:00:00Z',actual_cost_usd=4 where id=$1",
      [event.event_id],
    );
    const reduced = (await db.query(queryAt, [owner, at])).rows[0];
    assert.ok(Number(reduced.weekly_allowance) < Number(initial.weekly_allowance));
    assert.ok(Number(reduced.five_hour_allowance) < Number(initial.five_hour_allowance));
    const nextMonth = (await db.query(queryAt, [owner, "2026-12-01T00:00:00Z"])).rows[0];
    assert.equal(Number(nextMonth.month_used), 0);
    assert.equal(Number(nextMonth.monthly_allowance), policy.plus);
    await assert.rejects(
      db.query("select * from kova_private.chat_plan_budget_policy"),
      /permission denied/,
    );
    await db.exec("set role authenticated");
    await assert.rejects(db.query(costQuery, [owner]), /permission denied/);
  } finally {
    await db.close();
  }
});

test("private cost budgeting replaces fixed message, token and premium counts", async () => {
  const db = await fixture({ free: 2.13, plus: 19.73, pro: 93.71 });
  try {
    for (let i = 0; i < 3; i++) {
      const count = await db.query("select public.try_consume_paid_message($1,false,1,1) outcome", [
        owner,
      ]);
      assert.equal(count.rows[0].outcome, "allowed");
    }
    assert.equal((await db.query("select chats from public.daily_usage")).rows[0].chats, 3);
    for (const plan of ["free", "plus", "pro"]) {
      const id = crypto.randomUUID();
      const result = await db.query(
        `select * from public.acquire_ai_generation(
          $1,$1,$2,null,null,'thinking',$3,true,'kova-argon-4.6',100,100,0.0001,false,
          0,0,0,10,1000,1000,120,now()-interval '1 month',now()+interval '1 month'
        )`,
        [id, owner, plan],
      );
      assert.equal(result.rows[0].decision, "acquired");
    }
    assert.equal((await request(db, "free", 3)).decision, "monthly_cost");
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select public.try_consume_paid_message($1,false,1,1)", [owner]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
