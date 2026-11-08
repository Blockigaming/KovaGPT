import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { chatUsageWindows } from "../../src/lib/plan-usage-policy.mjs";
const migration = "supabase/migrations/20261108013500_kova_team_premium_usage.sql";
const standard = "11111111-1111-4111-8111-111111111111";
const premium = "22222222-2222-4222-8222-222222222222";
const invited = "33333333-3333-4333-8333-333333333333";
const team = "44444444-4444-4444-8444-444444444444";
const read = (p) => readFileSync(p, "utf8");
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema kova_private;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function public.kova_auth_directory_email(uuid) returns text language sql as $$select 'fixture@example.invalid'::text$$;
    create function kova_private.verified_auth_user_for_email(text) returns uuid language sql as $$select null::uuid$$;
    create table account_deletion_fences(user_id uuid);
    create table subscriptions(user_id uuid,environment text,status text,current_period_end timestamptz);
    create function billing_user_plan_tier(uuid) returns text language sql as $$select 'free'::text$$;
    create function family_owner_of(uuid) returns uuid language sql as $$select null::uuid$$;
    create table daily_usage(user_id uuid references auth.users(id),usage_date date,images integer default 0,chats integer default 0,thinking_chats integer default 0,uploads integer default 0,voice integer default 0,updated_at timestamptz default now(),primary key(user_id,usage_date));
    insert into auth.users(id) values('${standard}'),('${premium}'),('${invited}');`);
  await db.exec(read("supabase/migrations/20261107211137_kova_self_service_team_billing.sql"));
  await db.exec(read("supabase/migrations/20260803130000_ai_usage_accounting.sql"));
  const daily = read(
    "supabase/migrations/20261101012355_kova_daily_message_modes_and_memory_tiers.sql",
  );
  await db.exec(
    daily.slice(
      daily.indexOf("create function public.try_consume_daily_message"),
      daily.indexOf("-- Existing reviewed notes"),
    ),
  );
  await db.exec(read("supabase/migrations/20261104223000_kova_paid_message_usage_windows.sql"));
  await db.exec(read("supabase/migrations/20261018163000_daily_upload_identity.sql"));
  await db.exec(read(migration));
  await db.query(
    "insert into team_workspaces(id,owner_id,name,status,standard_seats,premium_seats,paid_until) values($1,$2,'Usage test','active',2,1,now()+interval '1 month')",
    [team, standard],
  );
  await db.query(
    "insert into team_members(team_id,user_id,seat,state) values($1,$2,'standard','active'),($1,$3,'premium','active'),($1,$4,'premium','invited')",
    [team, standard, premium, invited],
  );
  return db;
}
test("only accepted, paid Premium membership receives 5x, with immediate revocation", async () => {
  const db = await fixture();
  try {
    const factor = async (user) =>
      (await db.query("select effective_user_usage_multiplier($1) n", [user])).rows[0].n;
    assert.equal(await factor(standard), 1);
    assert.equal(await factor(premium), 5);
    assert.equal(await factor(invited), 1);
    for (const update of [
      "billing_hold=true",
      "status='past_due'",
      "paid_until=now()-interval '1 second'",
      "premium_seats=0",
    ]) {
      await db.exec("begin");
      await db.exec(`update team_workspaces set ${update}`);
      assert.equal(await factor(premium), 1);
      await db.exec("rollback");
    }
    for (const user of [standard, premium]) {
      await db.query("insert into account_deletion_fences values($1)", [user]);
      assert.equal(await factor(premium), 1);
      await db.exec("delete from account_deletion_fences");
    }
    await db.exec("update team_members set state='removed' where seat='premium'");
    assert.equal(await factor(premium), 1);
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','effective_user_usage_multiplier(uuid)','execute') n",
        )
      ).rows[0].n,
      false,
    );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('service_role','effective_user_usage_multiplier(uuid)','execute') n",
        )
      ).rows[0].n,
      true,
    );
  } finally {
    await db.close();
  }
});
test("message, image and idempotent upload admission enforce exactly five Standard allowances", async () => {
  const db = await fixture();
  try {
    for (const [user, allowed] of [
      [standard, 2],
      [premium, 10],
    ]) {
      for (let i = 0; i < allowed; i++)
        assert.equal(
          (await db.query("select try_consume_paid_message($1,false,2,null) n", [user])).rows[0].n,
          "allowed",
        );
      assert.equal(
        (await db.query("select try_consume_paid_message($1,false,2,null) n", [user])).rows[0].n,
        "weekly",
      );
      assert.equal(
        (await db.query("select try_increment_daily_usage($1,'images',$2,2) n", [user, allowed]))
          .rows[0].n,
        true,
      );
      assert.equal(
        (await db.query("select try_increment_daily_usage($1,'images',1,2) n", [user])).rows[0].n,
        false,
      );
      const fingerprints = Array.from({ length: allowed }, (_, i) =>
        String(i + 1).padStart(64, "0"),
      );
      assert.equal(
        (await db.query("select try_reserve_daily_uploads($1,$2,2) n", [user, fingerprints]))
          .rows[0].n,
        true,
      );
      assert.equal(
        (await db.query("select try_reserve_daily_uploads($1,$2,2) n", [user, fingerprints]))
          .rows[0].n,
        true,
      );
      assert.equal(
        (await db.query("select try_reserve_daily_uploads($1,$2,2) n", [user, ["f".repeat(64)]]))
          .rows[0].n,
        false,
      );
    }
    assert.equal(
      (await db.query("select try_increment_daily_usage($1,'voice',2,2) n", [premium])).rows[0].n,
      true,
    );
    assert.equal(
      (await db.query("select try_increment_daily_usage($1,'voice',1,2) n", [premium])).rows[0].n,
      false,
    );
  } finally {
    await db.close();
  }
});
test("Premium scales token and advanced-request limits while retaining concurrency and duplicate guards", async () => {
  const db = await fixture();
  try {
    const acquire = async (
      user,
      reserve = 11,
      daily = 10,
      monthly = 100,
      premiumRequest = false,
      request = crypto.randomUUID(),
    ) =>
      (
        await db.query(
          `select * from acquire_ai_generation($1,$1,$2,null,null,'high','pro',$3,'kova-neon-4.6',1,$4,0.01,false,$5,$6,1,1,10,2,120,now()-interval '1 month',now()+interval '1 month')`,
          [request, user, premiumRequest, reserve, daily, monthly],
        )
      ).rows[0];
    assert.equal((await acquire(standard)).decision, "daily_tokens");
    const id = crypto.randomUUID();
    const first = await acquire(premium, 50, 10, 100, false, id);
    assert.equal(first.decision, "acquired");
    assert.equal((await acquire(premium, 1, 10, 100, false, id)).decision, "duplicate");
    assert.equal((await acquire(premium, 51)).decision, "daily_tokens");
    assert.equal((await acquire(premium, 51, 100, 10)).decision, "monthly_tokens");
    await db.exec("delete from ai_usage_events");
    for (let i = 0; i < 5; i++) {
      const row = await acquire(premium, 0, 10, 100, true);
      assert.equal(row.decision, "acquired");
      await db.query("select finalize_ai_generation($1,'completed',0,0,0,0,0,1,'{}',null)", [
        row.event_id,
      ]);
    }
    assert.equal((await acquire(premium, 0, 10, 100, true)).decision, "premium_period");
  } finally {
    await db.close();
  }
});
test("displayed Premium message windows are five times Standard and cannot extend Free or Plus", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const base = chatUsageWindows("pro", now);
  const higher = chatUsageWindows("pro", now, 5);
  assert.equal(higher[0].regularLimit, base[0].regularLimit * 5);
  assert.equal(higher[0].thinkingLimit, base[0].thinkingLimit * 5);
  for (const tier of ["free", "plus"]) assert.throws(() => chatUsageWindows(tier, now, 5));
});
